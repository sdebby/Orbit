const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../models/db');
const { sha512 } = require('../utils/hash');
const { signToken } = require('../middleware/auth');
const { sendPasswordResetEmail } = require('../utils/email');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (!EMAIL_REGEX.test(email)) return res.status(400).json({ error: 'Invalid email format' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const emailNorm = email.toLowerCase().trim();
  const emailHash = sha512(emailNorm);
  const passwordHash = sha512(password);

  try {
    const stmt = db.prepare(
      'INSERT INTO users (email, email_hash, password_hash) VALUES (?, ?, ?)'
    );
    const result = stmt.run(emailNorm, emailHash, passwordHash);
    const token = signToken(result.lastInsertRowid);
    res.status(201).json({ token, userId: result.lastInsertRowid, email: emailNorm });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already registered' });
    throw err;
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const emailNorm = email.toLowerCase().trim();
  const emailHash = sha512(emailNorm);
  const passwordHash = sha512(password);

  const user = db.prepare('SELECT * FROM users WHERE email_hash = ?').get(emailHash);
  if (!user || user.password_hash !== passwordHash) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signToken(user.id);
  res.json({ token, userId: user.id, email: user.email, profilePicture: user.profile_picture });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const emailNorm = email.toLowerCase().trim();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(emailNorm);

  // Always return success to prevent user enumeration
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 3600000; // 1 hour
    db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?')
      .run(token, expires, user.id);

    const resetLink = `${process.env.APP_URL || 'http://localhost:3000'}/client/index.html#/reset-password/${token}`;
    sendPasswordResetEmail(emailNorm, resetLink).catch(console.error);
  }

  res.json({ message: 'If that email exists, a reset link has been sent' });
});

// POST /api/auth/reset-password/:token
router.post('/reset-password/:token', (req, res) => {
  const { token } = req.params;
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token);
  if (!user || user.reset_token_expires < Date.now()) {
    return res.status(400).json({ error: 'Reset token is invalid or expired' });
  }

  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?')
    .run(sha512(password), user.id);

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
    const user = db.prepare('SELECT id, email, profile_picture, created_at FROM users WHERE id = ?').get(payload.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ userId: user.id, email: user.email, profilePicture: user.profile_picture, createdAt: user.created_at });
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
