const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');
const { hashPassword, verifyPassword } = require('../utils/hash');

function validatePassword(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password))          return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(password))          return 'Password must contain at least one number';
  if (!/[^A-Za-z0-9]/.test(password))  return 'Password must contain at least one special character';
  return null;
}
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const ALLOWED_EXT = /\.(jpg|jpeg|png)$/i;
const ALLOWED_MIME = ['image/jpeg', 'image/png'];

function imageFilter(req, file, cb) {
  if (ALLOWED_MIME.includes(file.mimetype) && ALLOWED_EXT.test(file.originalname)) {
    cb(null, true);
  } else {
    cb(new Error('Only .jpg, .jpeg and .png files are allowed'));
  }
}

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => cb(null, `avatar-${req.user.userId}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: imageFilter });

// PUT /api/profile  — update profile picture or password
router.put('/', requireAuth, upload.single('profile_picture'), async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { current_password, new_password, username } = req.body;
  let passwordHash = user.password_hash;

  if (new_password) {
    if (!current_password) return res.status(400).json({ error: 'Current password is required to set a new password' });
    const valid = await verifyPassword(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    const pwErr = validatePassword(new_password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    passwordHash = await hashPassword(new_password);
  }

  const picture = req.file ? `/uploads/${req.file.filename}` : user.profile_picture;
  const updatedUsername = username !== undefined ? (username.trim() || null) : user.username;

  db.prepare('UPDATE users SET profile_picture = ?, password_hash = ?, username = ? WHERE id = ?')
    .run(picture, passwordHash, updatedUsername, user.id);

  const updated = db.prepare('SELECT id, email, username, profile_picture, created_at FROM users WHERE id = ?').get(user.id);
  res.json({ userId: updated.id, email: updated.email, username: updated.username, profilePicture: updated.profile_picture, createdAt: updated.created_at });
});

// DELETE /api/profile  — permanently delete account and all data
router.delete('/', requireAuth, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.userId);
  res.json({ message: 'Account deleted' });
});

module.exports = router;
