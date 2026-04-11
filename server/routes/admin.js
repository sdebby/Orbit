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
    'SELECT id, email, username, profile_picture, created_at, last_active, email_verified, status FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);

  const mapped = users.map(u => ({
    id: u.id,
    email: decryptEmail(u.email),
    username: u.username,
    profilePicture: u.profile_picture,
    createdAt: u.created_at,
    lastActive: u.last_active,
    emailVerified: u.email_verified,
    status: u.status || 'active',
  }));

  // Filter by search query (email or username) in JS since emails are encrypted
  const filtered = q
    ? mapped.filter(u => (u.email && u.email.toLowerCase().includes(q)) || (u.username && u.username.toLowerCase().includes(q)))
    : mapped;

  res.json({ users: filtered, total, page, totalPages: Math.ceil(total / limit) });
});

// GET /api/admin/users/:id — user detail + activity counts
router.get('/users/:id', (req, res) => {
  const targetId = parseInt(req.params.id);
  const user = db.prepare(
    'SELECT id, email, username, profile_picture, created_at, last_active, email_verified, status FROM users WHERE id = ?'
  ).get(targetId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const projectCount = db.prepare('SELECT COUNT(*) as c FROM projects WHERE user_id = ?').get(targetId).c;
  const taskCount = db.prepare(
    'SELECT COUNT(*) as c FROM tasks t JOIN buckets b ON t.bucket_id = b.id JOIN projects p ON b.project_id = p.id WHERE p.user_id = ?'
  ).get(targetId).c;
  const riskCount = db.prepare(
    'SELECT COUNT(*) as c FROM risks WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)'
  ).get(targetId).c;

  res.json({
    id: user.id,
    email: decryptEmail(user.email),
    username: user.username,
    profilePicture: user.profile_picture,
    createdAt: user.created_at,
    lastActive: user.last_active,
    emailVerified: user.email_verified,
    status: user.status || 'active',
    projectCount,
    taskCount,
    riskCount,
  });
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

// POST /api/admin/users/bulk-delete
router.post('/users/bulk-delete', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'No users selected' });

  const targetIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id) && id !== req.user.userId);
  if (!targetIds.length) return res.status(400).json({ error: 'Cannot delete your own admin account' });

  const placeholders = targetIds.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...targetIds);
  res.json({ message: `${result.changes} user(s) deleted` });
});

// POST /api/admin/users/bulk-status
router.post('/users/bulk-status', (req, res) => {
  const { ids, status } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'No users selected' });
  const validStatuses = ['active', 'deactivated', 'banned'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const targetIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id) && id !== req.user.userId);
  if (!targetIds.length) return res.status(400).json({ error: 'Cannot modify your own account' });

  const placeholders = targetIds.map(() => '?').join(',');
  // Bump token_version to immediately invalidate sessions for affected users
  db.prepare(`UPDATE users SET status = ?, token_version = token_version + 1 WHERE id IN (${placeholders})`)
    .run(status, ...targetIds);
  res.json({ message: `${targetIds.length} user(s) set to ${status}` });
});

// POST /api/admin/users/:id/status
router.post('/users/:id/status', (req, res) => {
  const targetId = parseInt(req.params.id);
  if (targetId === req.user.userId) {
    return res.status(400).json({ error: 'Cannot change your own account status' });
  }

  const { status } = req.body;
  const validStatuses = ['active', 'deactivated', 'banned'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const user = db.prepare('SELECT id, token_version FROM users WHERE id = ?').get(targetId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newVersion = (user.token_version || 0) + 1;
  db.prepare('UPDATE users SET status = ?, token_version = ? WHERE id = ?').run(status, newVersion, targetId);
  res.json({ message: `User ${status}`, status });
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
  const resetLink = `${process.env.APP_URL || 'http://localhost:3000'}/#/reset-password/${token}`;
  sendPasswordResetEmail(email, resetLink).catch(console.error);

  res.json({ message: 'Password reset email sent' });
});

module.exports = router;
