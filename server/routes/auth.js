const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../models/db');
const { sha512, hashPassword, verifyPassword, encryptEmail, decryptEmail } = require('../utils/hash');
const { requireAuth, signToken, getAdminEmailHash } = require('../middleware/auth');
const { sendPasswordResetEmail, sendVerificationEmail } = require('../utils/email');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_TOKEN_RE = /^[0-9a-f]{64}$/; // 32 bytes = 64 hex chars

function validatePassword(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password))          return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(password))          return 'Password must contain at least one number';
  if (!/[^A-Za-z0-9]/.test(password))  return 'Password must contain at least one special character';
  return null;
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (!EMAIL_REGEX.test(email)) return res.status(400).json({ error: 'Invalid email format' });
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  const emailNorm = email.toLowerCase().trim();
  const emailHash = sha512(emailNorm);
  const passwordHash = await hashPassword(password);
  const verifyToken = crypto.randomBytes(32).toString('hex');
  const verifyExpires = Date.now() + 1800000; // 30 minutes

  try {
    const encEmail = encryptEmail(emailNorm);
    const result = db.prepare(
      'INSERT INTO users (email, email_hash, password_hash, email_verified, verify_token, verify_token_expires) VALUES (?, ?, ?, 0, ?, ?)'
    ).run(encEmail, emailHash, passwordHash, verifyToken, verifyExpires);

    const verifyLink = `${process.env.APP_URL || 'http://localhost:3000'}/#/verify-email/${verifyToken}`;
    sendVerificationEmail(emailNorm, verifyLink).catch(console.error);

    res.status(201).json({ message: 'Account created. Please check your email to verify your account before signing in.' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already registered' });
    throw err;
  }
});

// POST /api/auth/login
// MIN_LOGIN_MS ensures constant-time response to prevent user enumeration via timing
const MIN_LOGIN_MS = 300;
router.post('/login', async (req, res) => {
  const start = Date.now();
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const emailNorm = email.toLowerCase().trim();
  const emailHash = sha512(emailNorm);

  const user = db.prepare('SELECT * FROM users WHERE email_hash = ?').get(emailHash);

  // Always run a password verification to keep timing constant even when user doesn't exist
  const dummyHash = '$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const valid = await verifyPassword(password, user ? user.password_hash : dummyHash);

  function delayedResponse(status, body) {
    const elapsed = Date.now() - start;
    setTimeout(() => res.status(status).json(body), Math.max(0, MIN_LOGIN_MS - elapsed));
  }

  if (!user || !valid) return delayedResponse(401, { error: 'Invalid email or password' });

  if (!user.email_verified) {
    return delayedResponse(403, { error: 'EMAIL_NOT_VERIFIED' });
  }

  const adminHash = getAdminEmailHash();
  const isAdmin = adminHash ? user.email_hash === adminHash : false;

  // Clear any pre-existing session cookie before issuing a new one (session fixation defense)
  res.clearCookie('orbit_token', { path: '/', sameSite: 'strict' });
  const token = signToken(user.id, user.token_version);
  res.cookie('orbit_token', token, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
  });
  const elapsed = Date.now() - start;
  setTimeout(() => {
    res.json({ userId: user.id, email: decryptEmail(user.email), username: user.username, profilePicture: user.profile_picture, isAdmin });
  }, Math.max(0, MIN_LOGIN_MS - elapsed));
});

// GET /api/auth/verify-email/:token
router.get('/verify-email/:token', (req, res) => {
  const { token } = req.params;
  if (!HEX_TOKEN_RE.test(token)) return res.status(400).json({ error: 'Invalid verification link' });
  const user = db.prepare('SELECT * FROM users WHERE verify_token = ?').get(token);

  if (!user) return res.status(400).json({ error: 'Invalid or already used verification link' });
  if (user.verify_token_expires < Date.now()) return res.status(400).json({ error: 'Verification link has expired. Please register again.' });

  db.prepare('UPDATE users SET email_verified = 1, verify_token = NULL, verify_token_expires = NULL WHERE id = ?').run(user.id);
  res.json({ message: 'Email verified successfully. You can now sign in.' });
});

// POST /api/auth/forgot-password
// MIN_RESPONSE_MS ensures constant-time response to prevent user enumeration via timing
const MIN_RESPONSE_MS = 300;
router.post('/forgot-password', (req, res) => {
  const start = Date.now();
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const emailNorm = email.toLowerCase().trim();
  const emailHash = sha512(emailNorm);
  const user = db.prepare('SELECT * FROM users WHERE email_hash = ?').get(emailHash);

  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 3600000; // 1 hour
    db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?')
      .run(token, expires, user.id);

    const resetLink = `${process.env.APP_URL || 'http://localhost:3000'}/#/reset-password/${token}`;
    sendPasswordResetEmail(emailNorm, resetLink).catch(console.error);
  }

  // Always delay to the same minimum duration regardless of whether the user exists
  const elapsed = Date.now() - start;
  setTimeout(
    () => res.json({ message: 'If that email exists, a reset link has been sent' }),
    Math.max(0, MIN_RESPONSE_MS - elapsed)
  );
});

// GET /api/auth/validate-reset-token/:token
router.get('/validate-reset-token/:token', (req, res) => {
  const { token } = req.params;
  if (!HEX_TOKEN_RE.test(token)) return res.status(400).json({ error: 'Invalid reset link' });

  const user = db.prepare('SELECT id, reset_token_expires FROM users WHERE reset_token = ?').get(token);
  if (!user) return res.status(400).json({ error: 'This reset link has already been used' });
  if (user.reset_token_expires < Date.now()) {
    // Clean up expired token
    db.prepare('UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE id = ?').run(user.id);
    return res.status(400).json({ error: 'This reset link has expired' });
  }
  res.json({ valid: true });
});

// POST /api/auth/reset-password/:token
router.post('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  if (!HEX_TOKEN_RE.test(token)) return res.status(400).json({ error: 'Invalid reset link' });
  const { password } = req.body;
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token);
  if (!user) return res.status(400).json({ error: 'This reset link has already been used' });
  if (user.reset_token_expires < Date.now()) {
    db.prepare('UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE id = ?').run(user.id);
    return res.status(400).json({ error: 'This reset link has expired' });
  }

  const passwordHash = await hashPassword(password);
  const newVersion = (user.token_version || 0) + 1;
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL, token_version = ? WHERE id = ?')
    .run(passwordHash, newVersion, user.id);

  res.json({ message: 'Password updated successfully' });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, email_hash, username, profile_picture, created_at, token_version FROM users WHERE id = ?').get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const isAdmin = process.env.SUPER_ADMIN_EMAIL
    ? user.email_hash === sha512(process.env.SUPER_ADMIN_EMAIL.toLowerCase().trim())
    : false;

  // Refresh cookie with current token_version
  const token = signToken(user.id, user.token_version);
  res.cookie('orbit_token', token, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
  });
  res.json({ userId: user.id, email: decryptEmail(user.email), username: user.username, profilePicture: user.profile_picture, createdAt: user.created_at, isAdmin });
});

module.exports = router;
