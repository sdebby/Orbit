const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../models/db');
const { sha512, hashPassword, verifyPassword } = require('../utils/hash');
const { signToken } = require('../middleware/auth');
const { sendPasswordResetEmail, sendVerificationEmail } = require('../utils/email');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const result = db.prepare(
      'INSERT INTO users (email, email_hash, password_hash, email_verified, verify_token, verify_token_expires) VALUES (?, ?, ?, 0, ?, ?)'
    ).run(emailNorm, emailHash, passwordHash, verifyToken, verifyExpires);

    const verifyLink = `${process.env.APP_URL || 'http://localhost:3000'}/#/verify-email/${verifyToken}`;
    sendVerificationEmail(emailNorm, verifyLink).catch(console.error);

    res.status(201).json({ message: 'Account created. Please check your email to verify your account before signing in.' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already registered' });
    throw err;
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const emailNorm = email.toLowerCase().trim();
  const emailHash = sha512(emailNorm);

  const user = db.prepare('SELECT * FROM users WHERE email_hash = ?').get(emailHash);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  if (!user.email_verified) {
    return res.status(403).json({ error: 'EMAIL_NOT_VERIFIED' });
  }

  const token = signToken(user.id);
  res.json({ token, userId: user.id, email: user.email, username: user.username, profilePicture: user.profile_picture });
});

// GET /api/auth/verify-email/:token
router.get('/verify-email/:token', (req, res) => {
  const { token } = req.params;
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
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(emailNorm);

  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 3600000; // 1 hour
    db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?')
      .run(token, expires, user.id);

    const resetLink = `${process.env.APP_URL || 'http://localhost:3000'}/client/index.html#/reset-password/${token}`;
    sendPasswordResetEmail(emailNorm, resetLink).catch(console.error);
  }

  // Always delay to the same minimum duration regardless of whether the user exists
  const elapsed = Date.now() - start;
  setTimeout(
    () => res.json({ message: 'If that email exists, a reset link has been sent' }),
    Math.max(0, MIN_RESPONSE_MS - elapsed)
  );
});

// POST /api/auth/reset-password/:token
router.post('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token);
  if (!user || user.reset_token_expires < Date.now()) {
    return res.status(400).json({ error: 'Reset token is invalid or expired' });
  }

  const passwordHash = await hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?')
    .run(passwordHash, user.id);

  res.json({ message: 'Password updated successfully' });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  const header = req.headers['authorization'];
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'orbit-dev-secret-change-in-production';
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, email, username, profile_picture, created_at FROM users WHERE id = ?').get(payload.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ userId: user.id, email: user.email, username: user.username, profilePicture: user.profile_picture, createdAt: user.created_at });
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
