const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../models/db');
const { sha256, sha512, hashPassword, verifyPassword, encryptEmail, decryptEmail } = require('../utils/hash');
const { requireAuth, signToken, getAdminEmailHash } = require('../middleware/auth');
const { sendPasswordResetEmail, sendVerificationEmail } = require('../utils/email');
const { createSampleProject } = require('../utils/sampleProject');
const { promotePendingShares } = require('../utils/pendingShares');

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
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (!EMAIL_REGEX.test(email)) return res.status(400).json({ error: 'Invalid email format' });
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  const emailNorm = email.toLowerCase().trim();
  const emailHash = sha512(emailNorm);
  const passwordHash = await hashPassword(password);
  const verifyToken = crypto.randomBytes(32).toString('hex');
  const verifyTokenHash = sha256(verifyToken);
  const verifyExpires = Date.now() + 1800000; // 30 minutes

  try {
    const encEmail = encryptEmail(emailNorm);
    const result = db.prepare(
      'INSERT INTO users (email, email_hash, password_hash, email_verified, verify_token, verify_token_expires) VALUES (?, ?, ?, 0, ?, ?)'
    ).run(encEmail, emailHash, passwordHash, verifyTokenHash, verifyExpires);

    try { createSampleProject(result.lastInsertRowid); } catch (e) { console.error('Sample project creation failed:', e.message); }

    const verifyLink = `${process.env.APP_URL || 'http://localhost:3000'}/#/verify-email/${verifyToken}`;
    sendVerificationEmail(emailNorm, verifyLink).catch(() => console.error('[register] verification email send failed'));

    res.status(201).json({ message: 'Account created. Please check your email to verify your account before signing in.' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already registered' });
    throw err;
  }
});

// POST /api/auth/login
// MIN_LOGIN_MS ensures constant-time response to prevent user enumeration via timing
const MIN_LOGIN_MS = 300;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

router.post('/login', async (req, res) => {
  const start = Date.now();
  const { email, password } = req.body;
  // Type guards: a non-string email/password (e.g. JSON object/array/null) used to crash
  // `email.toLowerCase()` and trigger an unhandled-error 500. Treat as the same 400 as missing fields.
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required' });
  }
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

  // Reset expired lockout so the attempt counter starts fresh after the penalty period
  if (user && user.login_locked_until && user.login_locked_until <= Date.now()) {
    db.prepare('UPDATE users SET login_attempts = 0, login_locked_until = NULL WHERE id = ?').run(user.id);
    user.login_attempts = 0;
    user.login_locked_until = null;
  }

  // Return 429 if the account is still within the lockout window
  if (user && user.login_locked_until && user.login_locked_until > Date.now()) {
    const retryAfterSec = Math.ceil((user.login_locked_until - Date.now()) / 1000);
    return delayedResponse(429, { error: `Account temporarily locked. Try again in ${retryAfterSec} seconds.` });
  }

  if (!user || !valid) {
    if (user) {
      const attempts = (user.login_attempts || 0) + 1;
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        db.prepare('UPDATE users SET login_attempts = ?, login_locked_until = ? WHERE id = ?')
          .run(attempts, Date.now() + LOCKOUT_MS, user.id);
      } else {
        db.prepare('UPDATE users SET login_attempts = ? WHERE id = ?').run(attempts, user.id);
      }
    }
    return delayedResponse(401, { error: 'Invalid email or password' });
  }

  if (!user.email_verified) {
    return delayedResponse(403, { error: 'EMAIL_NOT_VERIFIED' });
  }

  // Successful login — clear lockout state
  db.prepare('UPDATE users SET login_attempts = 0, login_locked_until = NULL WHERE id = ?').run(user.id);

  // Promote any pending project share invitations addressed to this email
  try { promotePendingShares(user.id, user.email_hash); } catch (e) { console.error('[login] promote pending shares:', e.message); }

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
    res.json({ userId: user.id, email: decryptEmail(user.email), username: user.username, profilePicture: user.profile_picture, isAdmin, workspacesEnabled: user.workspaces_enabled || 0, theme: user.theme || 'light' });
  }, Math.max(0, MIN_LOGIN_MS - elapsed));
});

// POST /api/auth/verify-email/:token
router.post('/verify-email/:token', (req, res) => {
  const { token } = req.params;
  if (!HEX_TOKEN_RE.test(token)) return res.status(400).json({ error: 'Invalid verification link' });
  const user = db.prepare('SELECT * FROM users WHERE verify_token = ?').get(sha256(token));

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
  if (typeof email !== 'string' || !email) return res.status(400).json({ error: 'Email is required' });

  const emailNorm = email.toLowerCase().trim();
  const emailHash = sha512(emailNorm);
  const user = db.prepare('SELECT * FROM users WHERE email_hash = ?').get(emailHash);

  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 3600000; // 1 hour
    db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?')
      .run(sha256(token), expires, user.id);

    const resetLink = `${process.env.APP_URL || 'http://localhost:3000'}/#/reset-password/${token}`;
    sendPasswordResetEmail(emailNorm, resetLink).catch(() => console.error('[forgot-password] reset email send failed'));
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

  const user = db.prepare('SELECT id, reset_token_expires FROM users WHERE reset_token = ?').get(sha256(token));
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

  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(sha256(token));
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
  const user = db.prepare('SELECT id, email, email_hash, username, profile_picture, created_at, token_version, reminder_interval, workspaces_enabled, theme FROM users WHERE id = ?').get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Promote any pending invites that match this account (handles invites sent after sign-up)
  try { promotePendingShares(user.id, user.email_hash); } catch { /* best-effort */ }

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
  res.json({ userId: user.id, email: decryptEmail(user.email), username: user.username, profilePicture: user.profile_picture, createdAt: user.created_at, isAdmin, reminderInterval: user.reminder_interval || 0, workspacesEnabled: user.workspaces_enabled || 0, theme: user.theme || 'light' });
});

// GET /api/auth/invite/:token  — public; describe the pending invite
router.get('/invite/:token', (req, res) => {
  const { token } = req.params;
  if (!HEX_TOKEN_RE.test(token)) return res.status(400).json({ error: 'Invalid invitation link' });
  const tokenHash = sha256(token);
  const invite = db.prepare(`
    SELECT p.id AS pending_id, p.project_id, p.invited_email, p.invited_email_hash, p.role, p.expires_at,
           pr.title AS project_title,
           u.email AS owner_email, u.username AS owner_username
    FROM pending_shares p
    JOIN projects pr ON p.project_id = pr.id
    JOIN users u ON pr.user_id = u.id
    WHERE p.token_hash = ?
  `).get(tokenHash);
  if (!invite) return res.status(404).json({ error: 'This invitation is no longer valid' });
  if (invite.expires_at < Date.now()) {
    db.prepare('DELETE FROM pending_shares WHERE id = ?').run(invite.pending_id);
    return res.status(400).json({ error: 'This invitation has expired' });
  }

  const email = decryptEmail(invite.invited_email);
  const existingUser = db.prepare('SELECT id FROM users WHERE email_hash = ?').get(invite.invited_email_hash);
  res.json({
    email,
    projectTitle: invite.project_title,
    role: invite.role,
    ownerName: invite.owner_username || decryptEmail(invite.owner_email),
    alreadyRegistered: !!existingUser,
  });
});

// POST /api/auth/register-with-invite/:token  — accept invite by registering a new account.
// The invite link in the email proved ownership of the address, so the new account is
// marked email_verified=1 immediately.
router.post('/register-with-invite/:token', async (req, res) => {
  const { token } = req.params;
  if (!HEX_TOKEN_RE.test(token)) return res.status(400).json({ error: 'Invalid invitation link' });
  const { password } = req.body;
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  const tokenHash = sha256(token);
  const invite = db.prepare(
    'SELECT id, project_id, invited_email, invited_email_hash, role, expires_at FROM pending_shares WHERE token_hash = ?'
  ).get(tokenHash);
  if (!invite) return res.status(404).json({ error: 'This invitation is no longer valid' });
  if (invite.expires_at < Date.now()) {
    db.prepare('DELETE FROM pending_shares WHERE id = ?').run(invite.id);
    return res.status(400).json({ error: 'This invitation has expired' });
  }

  const emailNorm = decryptEmail(invite.invited_email);

  // Account may already exist (e.g. user registered normally between invite send and click).
  // In that case, promote the invite and ask them to sign in.
  const existing = db.prepare('SELECT id FROM users WHERE email_hash = ?').get(invite.invited_email_hash);
  if (existing) {
    promotePendingShares(existing.id, invite.invited_email_hash);
    return res.status(409).json({ error: 'You already have an Orbit account. Please sign in.', alreadyRegistered: true });
  }

  const passwordHash = await hashPassword(password);
  const encEmail = encryptEmail(emailNorm);
  const result = db.prepare(
    'INSERT INTO users (email, email_hash, password_hash, email_verified) VALUES (?, ?, ?, 1)'
  ).run(encEmail, invite.invited_email_hash, passwordHash);
  const newUserId = result.lastInsertRowid;

  try { createSampleProject(newUserId); } catch (e) { console.error('Sample project creation failed:', e.message); }

  // Promote ALL pending invites for this email (this one + any others)
  promotePendingShares(newUserId, invite.invited_email_hash);

  // Issue cookie, log them in directly
  const token2 = signToken(newUserId, 0);
  res.cookie('orbit_token', token2, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
  });

  const adminHash = getAdminEmailHash();
  const isAdmin = adminHash ? invite.invited_email_hash === adminHash : false;
  res.status(201).json({
    userId: newUserId,
    email: emailNorm,
    username: null,
    profilePicture: null,
    isAdmin,
    workspacesEnabled: 0,
    theme: 'light',
  });
});

module.exports = router;
