const express = require('express');
const router = express.Router({ mergeParams: true });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');
const { isProjectOwner, canViewProject } = require('../utils/access');
const { sha256, sha512, encryptEmail, decryptEmail, safePicturePath } = require('../utils/hash');
const { sendProjectShareEmail, sendProjectShareInviteEmail } = require('../utils/email');
const { assignShareToSharedWorkspace } = require('../utils/pendingShares');

const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Throttle invite creation so an owner can't spam the SMTP server. Each invite POST
// sends an email — outbound-mail abuse / quota burn is the primary risk.
const shareInviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many invitations sent — try again in a few minutes.' },
});

const UPLOAD_DIR = path.resolve(__dirname, '..', 'uploads');
const UPLOAD_PATH_RE = /^\/uploads\/[a-zA-Z0-9][\w\-\.]*\.(jpg|jpeg|png)$/i;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ['viewer', 'editor'];

// Duplicate an upload file with a fresh UUID name; returns the new /uploads/<file> path,
// or null if the source is missing or the path is not a recognised upload.
function copyUpload(srcPath, prefix) {
  if (!srcPath || !UPLOAD_PATH_RE.test(srcPath)) return null;
  const srcResolved = path.resolve(UPLOAD_DIR, path.basename(srcPath));
  if (srcResolved !== UPLOAD_DIR && !srcResolved.startsWith(UPLOAD_DIR + path.sep)) return null;
  if (!fs.existsSync(srcResolved)) return null;
  const ext = path.extname(srcResolved).toLowerCase();
  const newName = `${prefix}-${crypto.randomUUID()}${ext}`;
  fs.copyFileSync(srcResolved, path.join(UPLOAD_DIR, newName));
  return `/uploads/${newName}`;
}

function copyJsonPhotoArray(jsonStr, prefix) {
  if (!jsonStr) return '[]';
  let arr;
  try { arr = JSON.parse(jsonStr); } catch { return '[]'; }
  if (!Array.isArray(arr)) return '[]';
  const copies = arr
    .filter(p => typeof p === 'string')
    .map(p => copyUpload(p, prefix))
    .filter(Boolean);
  return JSON.stringify(copies);
}

// Deep-clone a project (incl. buckets, tasks, checklists, risks, uploaded files)
// into a new project owned by targetUserId. Returns the new project id.
function forkProjectToUser(projectId, targetUserId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;

  const newPicture = copyUpload(safePicturePath(project.picture), 'project');
  const newProjectResult = db.prepare(
    'INSERT INTO projects (user_id, title, description, picture, tags, favorite) VALUES (?, ?, ?, ?, ?, 0)'
  ).run(targetUserId, project.title, project.description, newPicture, project.tags || '[]');
  const newProjectId = newProjectResult.lastInsertRowid;

  const buckets = db.prepare('SELECT * FROM buckets WHERE project_id = ? ORDER BY position ASC').all(projectId);
  for (const b of buckets) {
    const newBucketResult = db.prepare(
      'INSERT INTO buckets (project_id, title, description, storyboard, color, position) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(newProjectId, b.title, b.description, b.storyboard, b.color, b.position);
    const newBucketId = newBucketResult.lastInsertRowid;

    const tasks = db.prepare('SELECT * FROM tasks WHERE bucket_id = ? ORDER BY position ASC').all(b.id);
    for (const t of tasks) {
      const newTaskPicture = copyUpload(safePicturePath(t.picture), 'task');
      const newTaskResult = db.prepare(
        'INSERT INTO tasks (bucket_id, description, picture, priority, due_date, tags, position, completed_at, reminder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(newBucketId, t.description, newTaskPicture, t.priority, t.due_date, t.tags || '[]', t.position, t.completed_at, t.reminder || 0);
      const newTaskId = newTaskResult.lastInsertRowid;

      const checklists = db.prepare('SELECT * FROM task_checklists WHERE task_id = ? ORDER BY position ASC').all(t.id);
      for (const c of checklists) {
        db.prepare('INSERT INTO task_checklists (task_id, text, checked, position) VALUES (?, ?, ?, ?)')
          .run(newTaskId, c.text, c.checked || 0, c.position);
      }
    }
  }

  const risks = db.prepare('SELECT * FROM risks WHERE project_id = ? ORDER BY position ASC').all(projectId);
  for (const r of risks) {
    const newPhotos = copyJsonPhotoArray(r.photos, 'risk');
    const newSolutionPhotos = copyJsonPhotoArray(r.solution_photos, 'risk');
    db.prepare(`
      INSERT INTO risks (project_id, description, photos, severity, probability, detectability, solution_description, solution_photos, status, tags, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(newProjectId, r.description, newPhotos, r.severity, r.probability, r.detectability, r.solution_description, newSolutionPhotos, r.status, r.tags || '[]', r.position);
  }

  return newProjectId;
}

// GET /api/projects/:projectId/shares  — owner only
// Returns both registered members and pending invites. Pending entries have
// pending:true and a numeric `pendingId` for cancellation.
router.get('/', requireAuth, (req, res) => {
  if (!isProjectOwner(req.user.userId, req.params.projectId)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const rows = db.prepare(`
    SELECT s.user_id, s.role, s.created_at, s.seen_at,
           u.email, u.username, u.profile_picture
    FROM project_shares s
    JOIN users u ON s.user_id = u.id
    WHERE s.project_id = ?
    ORDER BY s.created_at ASC
  `).all(req.params.projectId);
  const members = rows.map(r => ({
    pending: false,
    userId: r.user_id,
    role: r.role,
    createdAt: r.created_at,
    seenAt: r.seen_at,
    email: decryptEmail(r.email),
    username: r.username,
    profilePicture: r.profile_picture,
  }));

  const pendingRows = db.prepare(
    'SELECT id, invited_email, role, created_at, expires_at FROM pending_shares WHERE project_id = ? ORDER BY created_at ASC'
  ).all(req.params.projectId);
  const pendings = pendingRows.map(r => ({
    pending: true,
    pendingId: r.id,
    role: r.role,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    email: decryptEmail(r.invited_email),
  }));

  res.json([...members, ...pendings]);
});

// POST /api/projects/:projectId/shares  — owner invites by email
router.post('/', shareInviteLimiter, requireAuth, async (req, res) => {
  if (!isProjectOwner(req.user.userId, req.params.projectId)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { email, role } = req.body;
  if (!email || !EMAIL_REGEX.test(email)) return res.status(400).json({ error: 'Invalid email' });
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Role must be viewer or editor' });

  const emailNorm = email.toLowerCase().trim();
  const emailHash = sha512(emailNorm);
  const project = db.prepare('SELECT id, user_id, title FROM projects WHERE id = ?').get(req.params.projectId);
  const owner = db.prepare('SELECT email, username FROM users WHERE id = ?').get(req.user.userId);
  const ownerName = owner?.username || decryptEmail(owner.email);
  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  const target = db.prepare('SELECT id, email_verified FROM users WHERE email_hash = ?').get(emailHash);

  if (target) {
    // Registered user: create real share immediately
    if (target.id === project.user_id) {
      return res.status(400).json({ error: 'You already own this project.' });
    }
    const existing = db.prepare('SELECT id FROM project_shares WHERE project_id = ? AND user_id = ?')
      .get(project.id, target.id);
    if (existing) return res.status(409).json({ error: 'This user already has access.' });

    db.prepare('INSERT INTO project_shares (project_id, user_id, role) VALUES (?, ?, ?)')
      .run(project.id, target.id, role);
    // If the recipient uses workspaces, drop the share into their "Shared Projects" workspace
    // (creating it on first use) so the project is visible somewhere by default.
    try { assignShareToSharedWorkspace(target.id, project.id); } catch (e) { console.error('[shares] assign workspace failed:', e.message); }

    try {
      const recipientEmail = decryptEmail(
        db.prepare('SELECT email FROM users WHERE id = ?').get(target.id).email
      );
      sendProjectShareEmail(recipientEmail, { ownerName, projectTitle: project.title, role, appUrl })
        .catch(() => console.error('[shares] notify email send failed'));
    } catch { /* notification is best-effort */ }

    return res.status(201).json({ pending: false, userId: target.id, role });
  }

  // Unregistered email: create pending invite + send registration link
  const existingPending = db.prepare(
    'SELECT id FROM pending_shares WHERE project_id = ? AND invited_email_hash = ?'
  ).get(project.id, emailHash);
  if (existingPending) return res.status(409).json({ error: 'An invitation has already been sent to this email.' });

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(rawToken);
  const expiresAt = Date.now() + INVITE_TOKEN_TTL_MS;
  const encEmail = encryptEmail(emailNorm);
  const result = db.prepare(
    'INSERT INTO pending_shares (project_id, invited_email, invited_email_hash, role, token_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(project.id, encEmail, emailHash, role, tokenHash, expiresAt);

  const inviteLink = `${appUrl}/#/accept-invite/${rawToken}`;
  sendProjectShareInviteEmail(emailNorm, { ownerName, projectTitle: project.title, role, inviteLink })
    .catch(() => console.error('[shares] invite email send failed'));

  res.status(201).json({ pending: true, pendingId: result.lastInsertRowid, role, email: emailNorm });
});

// PUT /api/projects/:projectId/shares/workspace  — recipient moves their own copy
// of a shared project into a different personal workspace.
// Declared before /:userId so Express matches the literal first.
router.put('/workspace', requireAuth, (req, res) => {
  const share = db.prepare(
    'SELECT id FROM project_shares WHERE project_id = ? AND user_id = ?'
  ).get(req.params.projectId, req.user.userId);
  if (!share) return res.status(404).json({ error: 'Project not found' });

  const { workspace_id } = req.body;
  let wsId = null;
  if (workspace_id !== null && workspace_id !== undefined && workspace_id !== '') {
    wsId = parseInt(workspace_id, 10);
    if (isNaN(wsId)) return res.status(400).json({ error: 'Invalid workspace id' });
    const owns = db.prepare('SELECT id FROM workspaces WHERE id = ? AND user_id = ?')
      .get(wsId, req.user.userId);
    if (!owns) return res.status(400).json({ error: 'Workspace not found' });
  }
  db.prepare('UPDATE project_shares SET workspace_id = ? WHERE id = ?').run(wsId, share.id);
  res.json({ workspaceId: wsId });
});

// DELETE /api/projects/:projectId/shares/pending/:pendingId  — cancel a pending invite
// Declared before /:userId so Express matches the literal first.
router.delete('/pending/:pendingId', requireAuth, (req, res) => {
  if (!isProjectOwner(req.user.userId, req.params.projectId)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const row = db.prepare('SELECT id FROM pending_shares WHERE id = ? AND project_id = ?')
    .get(req.params.pendingId, req.params.projectId);
  if (!row) return res.status(404).json({ error: 'Invitation not found' });
  db.prepare('DELETE FROM pending_shares WHERE id = ?').run(row.id);
  res.json({ message: 'Invitation cancelled' });
});

// PUT /api/projects/:projectId/shares/seen  — clear "new share" badge for current user
// Declared before /:userId so Express matches the literal first.
router.put('/seen', requireAuth, (req, res) => {
  if (!canViewProject(req.user.userId, req.params.projectId)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  db.prepare('UPDATE project_shares SET seen_at = ? WHERE project_id = ? AND user_id = ? AND seen_at IS NULL')
    .run(Math.floor(Date.now() / 1000), req.params.projectId, req.user.userId);
  res.json({ message: 'Marked as seen' });
});

// PUT /api/projects/:projectId/shares/:userId  — owner changes role
router.put('/:userId', requireAuth, (req, res) => {
  if (!isProjectOwner(req.user.userId, req.params.projectId)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { role } = req.body;
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Role must be viewer or editor' });

  const targetId = parseInt(req.params.userId, 10);
  const share = db.prepare('SELECT id FROM project_shares WHERE project_id = ? AND user_id = ?')
    .get(req.params.projectId, targetId);
  if (!share) return res.status(404).json({ error: 'Share not found' });

  db.prepare('UPDATE project_shares SET role = ? WHERE id = ?').run(role, share.id);
  res.json({ userId: targetId, role });
});

// DELETE /api/projects/:projectId/shares/:userId  — owner revokes
// Forks the project to the revoked user's account so they keep an independent copy.
router.delete('/:userId', requireAuth, (req, res) => {
  if (!isProjectOwner(req.user.userId, req.params.projectId)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const targetId = parseInt(req.params.userId, 10);
  const share = db.prepare('SELECT id FROM project_shares WHERE project_id = ? AND user_id = ?')
    .get(req.params.projectId, targetId);
  if (!share) return res.status(404).json({ error: 'Share not found' });

  let forkedProjectId;
  try {
    forkedProjectId = forkProjectToUser(parseInt(req.params.projectId, 10), targetId);
  } catch (err) {
    console.error('[shares] fork failed:', err.message);
    return res.status(500).json({ error: 'Failed to fork project' });
  }

  db.prepare('DELETE FROM project_shares WHERE id = ?').run(share.id);
  res.json({ message: 'Share revoked', forkedProjectId });
});

module.exports = router;
module.exports.forkProjectToUser = forkProjectToUser;
