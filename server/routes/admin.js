const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sha512, decryptEmail } = require('../utils/hash');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('../utils/email');

// All admin routes require auth + admin check
router.use(requireAuth, requireAdmin);

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const sevenDaysAgo = now - 7 * 24 * 60 * 60;
  const fifteenMinAgo = now - 15 * 60;

  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const registeredToday = db.prepare('SELECT COUNT(*) as c FROM users WHERE created_at >= ?').get(todayStart).c;
  const registeredLast7Days = db.prepare('SELECT COUNT(*) as c FROM users WHERE created_at >= ?').get(sevenDaysAgo).c;
  const onlineNow = db.prepare('SELECT COUNT(*) as c FROM users WHERE last_active >= ?').get(fifteenMinAgo).c;

  res.json({ totalUsers, registeredToday, registeredLast7Days, onlineNow });
});

// GET /api/admin/users
router.get('/users', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 20;
  const offset = (page - 1) * limit;
  const q = (req.query.q || '').trim().toLowerCase();

  const total = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const users = db.prepare(
    'SELECT id, email, username, profile_picture, created_at, last_active, email_verified FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);

  const mapped = users.map(u => ({
    id: u.id,
    email: decryptEmail(u.email),
    username: u.username,
    profilePicture: u.profile_picture,
    createdAt: u.created_at,
    lastActive: u.last_active,
    emailVerified: u.email_verified,
  }));

  // Filter by search query (email or username) in JS since emails are encrypted
  const filtered = q
    ? mapped.filter(u => (u.email && u.email.toLowerCase().includes(q)) || (u.username && u.username.toLowerCase().includes(q)))
    : mapped;

  res.json({ users: filtered, total, page, totalPages: Math.ceil(total / limit) });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', (req, res) => {
  const targetId = parseInt(req.params.id);
  if (targetId === req.user.userId) {
    return res.status(400).json({ error: 'Cannot delete your own admin account' });
  }

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  res.json({ message: 'User deleted' });
});

// POST /api/admin/users/:id/reset-password
// Generates a reset token and sends a password-reset email to the user
router.post('/users/:id/reset-password', (req, res) => {
  const targetId = parseInt(req.params.id);

  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(targetId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 3600000; // 1 hour
  db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?')
    .run(token, expires, targetId);

  const email = decryptEmail(user.email);
  const resetLink = `${process.env.APP_URL || 'http://localhost:3000'}/client/index.html#/reset-password/${token}`;
  sendPasswordResetEmail(email, resetLink).catch(console.error);

  res.json({ message: 'Password reset email sent' });
});

module.exports = router;
