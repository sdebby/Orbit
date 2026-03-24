const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');
const { hashPassword, verifyPassword, decryptEmail } = require('../utils/hash');

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
  res.json({ userId: updated.id, email: decryptEmail(updated.email), username: updated.username, profilePicture: updated.profile_picture, createdAt: updated.created_at });
});

// GET /api/profile/export  — download all user data as XML
router.get('/export', requireAuth, (req, res) => {
  function escXml(val) {
    if (val === null || val === undefined) return '';
    return String(val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  const projects = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at ASC').all(req.user.userId);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<orbit-export version="1" exported-at="${new Date().toISOString()}">`,
    '  <projects>',
  ];

  for (const p of projects) {
    const pTags = JSON.parse(p.tags || '[]');
    const buckets = db.prepare('SELECT * FROM buckets WHERE project_id = ? ORDER BY position ASC').all(p.id);
    const risks = db.prepare('SELECT * FROM risks WHERE project_id = ? ORDER BY position ASC').all(p.id);

    lines.push('    <project>');
    lines.push(`      <title>${escXml(p.title)}</title>`);
    lines.push(`      <description>${escXml(p.description)}</description>`);
    lines.push('      <tags>');
    pTags.forEach(t => lines.push(`        <tag>${escXml(t)}</tag>`));
    lines.push('      </tags>');

    lines.push('      <buckets>');
    for (const b of buckets) {
      const tasks = db.prepare('SELECT * FROM tasks WHERE bucket_id = ? ORDER BY position ASC').all(b.id);
      lines.push('        <bucket>');
      lines.push(`          <title>${escXml(b.title)}</title>`);
      lines.push(`          <description>${escXml(b.description)}</description>`);
      lines.push(`          <color>${escXml(b.color)}</color>`);
      lines.push('          <tasks>');
      for (const t of tasks) {
        const tTags = JSON.parse(t.tags || '[]');
        lines.push('            <task>');
        lines.push(`              <description>${escXml(t.description)}</description>`);
        lines.push(`              <priority>${escXml(t.priority)}</priority>`);
        lines.push(`              <due-date>${escXml(t.due_date)}</due-date>`);
        lines.push(`              <completed>${t.completed_at ? 'true' : 'false'}</completed>`);
        lines.push('              <tags>');
        tTags.forEach(tag => lines.push(`                <tag>${escXml(tag)}</tag>`));
        lines.push('              </tags>');
        lines.push('            </task>');
      }
      lines.push('          </tasks>');
      lines.push('        </bucket>');
    }
    lines.push('      </buckets>');

    lines.push('      <risks>');
    for (const r of risks) {
      const rTags = JSON.parse(r.tags || '[]');
      lines.push('        <risk>');
      lines.push(`          <description>${escXml(r.description)}</description>`);
      lines.push(`          <severity>${r.severity}</severity>`);
      lines.push(`          <probability>${r.probability}</probability>`);
      lines.push(`          <detectability>${r.detectability}</detectability>`);
      lines.push(`          <solution-description>${escXml(r.solution_description)}</solution-description>`);
      lines.push(`          <status>${escXml(r.status)}</status>`);
      lines.push('          <tags>');
      rTags.forEach(tag => lines.push(`            <tag>${escXml(tag)}</tag>`));
      lines.push('          </tags>');
      lines.push('        </risk>');
    }
    lines.push('      </risks>');
    lines.push('    </project>');
  }

  lines.push('  </projects>');
  lines.push('</orbit-export>');

  const filename = `orbit-export-${new Date().toISOString().split('T')[0]}.xml`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(lines.join('\n'));
});

// DELETE /api/profile  — permanently delete account and all data
router.delete('/', requireAuth, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.userId);
  res.json({ message: 'Account deleted' });
});

module.exports = router;
