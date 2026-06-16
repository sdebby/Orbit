const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');
const { hashPassword, verifyPassword, decryptEmail, safePicturePath } = require('../utils/hash');
const { collectUserUploadPaths, deleteUploadFiles } = require('../utils/uploads');
const { signToken } = require('../middleware/auth');
const { sendPasswordChangedEmail } = require('../utils/email');

function stripHtmlTags(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/<\/?[a-zA-Z][^>]*>/g, '');
}

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
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: imageFilter });

// PUT /api/profile  — update profile picture or password
router.put('/', requireAuth, upload.single('profile_picture'), async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { current_password, new_password, username, reminder_interval, workspaces_enabled, theme } = req.body;
  let passwordHash = user.password_hash;

  let reminderInterval = user.reminder_interval || 0;
  if (reminder_interval !== undefined) {
    const n = parseInt(reminder_interval, 10);
    if (isNaN(n) || n < 0 || n > 365) return res.status(400).json({ error: 'reminder_interval must be 0–365' });
    reminderInterval = n;
  }

  let userTheme = user.theme || 'light';
  if (theme !== undefined) {
    if (theme !== 'light' && theme !== 'dark') return res.status(400).json({ error: 'theme must be light or dark' });
    userTheme = theme;
  }

  let wsEnabled = user.workspaces_enabled || 0;
  if (workspaces_enabled !== undefined) {
    wsEnabled = (workspaces_enabled === '1' || workspaces_enabled === 'true') ? 1 : 0;
    if (wsEnabled === 1 && !user.workspaces_enabled) {
      const existing = db.prepare('SELECT id FROM workspaces WHERE user_id = ? LIMIT 1').get(user.id);
      if (!existing) {
        const ws = db.prepare('INSERT INTO workspaces (user_id, name, position) VALUES (?, ?, 0)')
          .run(user.id, 'Default Workspace');
        db.prepare('UPDATE projects SET workspace_id = ? WHERE user_id = ? AND workspace_id IS NULL')
          .run(ws.lastInsertRowid, user.id);
        // Shared projects use a per-recipient workspace_id on project_shares (not on the
        // project row, which belongs to the owner). Drop unassigned shares into Default too.
        db.prepare('UPDATE project_shares SET workspace_id = ? WHERE user_id = ? AND workspace_id IS NULL')
          .run(ws.lastInsertRowid, user.id);
      }
    }
  }

  if (new_password) {
    if (!current_password) return res.status(400).json({ error: 'Current password is required to set a new password' });
    const valid = await verifyPassword(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    const pwErr = validatePassword(new_password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    passwordHash = await hashPassword(new_password);
  }

  const picture = req.file ? `/uploads/${req.file.filename}` : safePicturePath(user.profile_picture);
  const trimmedUsername = username !== undefined ? username.trim() : null;
  if (trimmedUsername !== null && trimmedUsername.length > 50) return res.status(400).json({ error: 'Username must be 50 characters or fewer' });
  const updatedUsername = username !== undefined ? stripHtmlTags(trimmedUsername) || null : user.username;

  // If password changed, bump token_version to invalidate all other sessions and clear reset tokens
  let newVersion = user.token_version || 0;
  if (new_password) {
    newVersion = newVersion + 1;
    db.prepare('UPDATE users SET profile_picture = ?, password_hash = ?, username = ?, token_version = ?, reset_token = NULL, reset_token_expires = NULL, reminder_interval = ?, workspaces_enabled = ?, theme = ? WHERE id = ?')
      .run(picture, passwordHash, updatedUsername, newVersion, reminderInterval, wsEnabled, userTheme, user.id);
  } else {
    db.prepare('UPDATE users SET profile_picture = ?, password_hash = ?, username = ?, reminder_interval = ?, workspaces_enabled = ?, theme = ? WHERE id = ?')
      .run(picture, passwordHash, updatedUsername, reminderInterval, wsEnabled, userTheme, user.id);
  }

  if (new_password) {
    const toEmail = decryptEmail(user.email);
    if (toEmail) {
      sendPasswordChangedEmail(toEmail, {
        method: 'profile',
        changedAt: new Date(),
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      }).catch(err => console.error('[EMAIL] password-changed notice failed:', err.message));
    }
  }

  // Re-issue cookie with current token_version so the current session stays valid
  const token = signToken(user.id, newVersion);
  res.cookie('orbit_token', token, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
  });

  const updated = db.prepare('SELECT id, email, username, profile_picture, created_at, reminder_interval, workspaces_enabled, theme FROM users WHERE id = ?').get(user.id);
  res.json({ userId: updated.id, email: decryptEmail(updated.email), username: updated.username, profilePicture: updated.profile_picture, createdAt: updated.created_at, reminderInterval: updated.reminder_interval || 0, workspacesEnabled: updated.workspaces_enabled || 0, theme: updated.theme || 'light' });
});

// GET /api/profile/export  — download all user data as XML
// Query params: projects=1 (default 1), templates=1 (default 1)
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

  const includeProjects  = req.query.projects  !== '0';
  const includeTemplates = req.query.templates !== '0';
  const includeWorkspaces = req.query.workspaces !== '0';

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<orbit-export version="1" exported-at="${new Date().toISOString()}">`,
  ];

  // Build workspace name map for project cross-referencing
  const wsMap = {};
  if (includeWorkspaces && includeProjects) {
    const workspaces = db.prepare(
      'SELECT * FROM workspaces WHERE user_id = ? ORDER BY position ASC, created_at ASC'
    ).all(req.user.userId);
    if (workspaces.length) {
      lines.push('  <workspaces>');
      for (const ws of workspaces) {
        wsMap[ws.id] = ws.name;
        lines.push('    <workspace>');
        lines.push(`      <name>${escXml(ws.name)}</name>`);
        if (ws.color) lines.push(`      <color>${escXml(ws.color)}</color>`);
        if (ws.icon)  lines.push(`      <icon>${escXml(ws.icon)}</icon>`);
        lines.push('    </workspace>');
      }
      lines.push('  </workspaces>');
    }
  }

  if (includeProjects) {
    const projects = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at ASC').all(req.user.userId);
    lines.push('  <projects>');

    for (const p of projects) {
      const pTags = JSON.parse(p.tags || '[]');
      const buckets = db.prepare('SELECT * FROM buckets WHERE project_id = ? ORDER BY position ASC').all(p.id);
      const risks = db.prepare('SELECT * FROM risks WHERE project_id = ? ORDER BY position ASC').all(p.id);

      lines.push('    <project>');
      lines.push(`      <title>${escXml(p.title)}</title>`);
      lines.push(`      <description>${escXml(p.description)}</description>`);
      if (includeWorkspaces && p.workspace_id && wsMap[p.workspace_id]) {
        lines.push(`      <workspace>${escXml(wsMap[p.workspace_id])}</workspace>`);
      }
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
  }

  if (includeTemplates) {
    const templates = db.prepare(
      'SELECT id, name, bucket_data FROM bucket_templates WHERE user_id = ? ORDER BY name COLLATE NOCASE ASC'
    ).all(req.user.userId);
    lines.push('  <templates>');

    for (const tmpl of templates) {
      let bd;
      try { bd = JSON.parse(tmpl.bucket_data || '{}'); } catch { bd = {}; }
      const tasks = Array.isArray(bd.tasks) ? bd.tasks : [];

      lines.push('    <template>');
      lines.push(`      <name>${escXml(tmpl.name)}</name>`);
      lines.push(`      <bucket-title>${escXml(bd.title || '')}</bucket-title>`);
      lines.push('      <tasks>');
      for (const t of tasks) {
        const tTags = Array.isArray(t.tags) ? t.tags : [];
        const checklists = Array.isArray(t.checklists) ? t.checklists : [];
        lines.push('        <task>');
        lines.push(`          <description>${escXml(t.description)}</description>`);
        lines.push(`          <priority>${escXml(t.priority || 'Medium')}</priority>`);
        lines.push('          <tags>');
        tTags.forEach(tag => lines.push(`            <tag>${escXml(tag)}</tag>`));
        lines.push('          </tags>');
        lines.push('          <checklists>');
        checklists.forEach(item => lines.push(`            <item>${escXml(item)}</item>`));
        lines.push('          </checklists>');
        lines.push('        </task>');
      }
      lines.push('      </tasks>');
      lines.push('    </template>');
    }

    lines.push('  </templates>');
  }

  lines.push('</orbit-export>');

  const filename = `orbit-export-${new Date().toISOString().split('T')[0]}.xml`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(lines.join('\n'));
});

// DELETE /api/profile  — permanently delete account and all data
router.delete('/', requireAuth, (req, res) => {
  const uploadPaths = collectUserUploadPaths(req.user.userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.userId);
  deleteUploadFiles(uploadPaths);
  res.json({ message: 'Account deleted' });
});

module.exports = router;
