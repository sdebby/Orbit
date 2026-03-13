const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');
const { sha512 } = require('../utils/hash');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => cb(null, `avatar-${req.user.userId}-${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 } });

// PUT /api/profile  — update profile picture or password
router.put('/', requireAuth, upload.single('profile_picture'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { current_password, new_password } = req.body;
  let passwordHash = user.password_hash;

  if (new_password) {
    if (!current_password) return res.status(400).json({ error: 'Current password is required to set a new password' });
    if (sha512(current_password) !== user.password_hash) return res.status(401).json({ error: 'Current password is incorrect' });
    if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
    passwordHash = sha512(new_password);
  }

  const picture = req.file ? `/uploads/${req.file.filename}` : user.profile_picture;

  db.prepare('UPDATE users SET profile_picture = ?, password_hash = ? WHERE id = ?')
    .run(picture, passwordHash, user.id);

  const updated = db.prepare('SELECT id, email, profile_picture, created_at FROM users WHERE id = ?').get(user.id);
  res.json({ userId: updated.id, email: updated.email, profilePicture: updated.profile_picture, createdAt: updated.created_at });
});

module.exports = router;
