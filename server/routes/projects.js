const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');
const { safePicturePath, decryptEmail } = require('../utils/hash');
const { getProjectRole, isProjectOwner, VIEWABLE_PROJECT_IDS_SQL } = require('../utils/access');
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
  filename: (req, file, cb) => cb(null, `project-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024, fieldSize: 10 * 1024 }, fileFilter: imageFilter });

function stripHtmlTags(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/<\/?[a-zA-Z][^>]*>/g, '');
}

function parseTags(val, fallback) {
  if (val === undefined || val === null) return fallback !== undefined ? fallback : [];
  let arr;
  if (Array.isArray(val)) {
    arr = val;
  } else if (typeof val === 'string') {
    try { arr = JSON.parse(val); } catch { return null; }
  } else {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  if (arr.some(t => typeof t !== 'string')) return null;
  return arr;
}

// GET /api/projects  — with optional search and workspace filter
// Returns projects owned by the user plus projects shared with them. Each project
// includes a `role` field ('owner' | 'editor' | 'viewer'). Shared projects also
// include `sharedBy` { email, username } and `unseenShare` boolean.
router.get('/', requireAuth, (req, res) => {
  const { q, tags, workspace } = req.query;
  // Owned + shared (workspace filter only applies to owned; shared projects don't have a workspace
  // on the recipient's side, so they're treated as "unassigned" in workspace views).
  let query = `
    SELECT p.*,
           CASE WHEN p.user_id = ? THEN 'owner' ELSE s.role END AS role,
           s.seen_at AS share_seen_at,
           s.workspace_id AS share_workspace_id,
           owner_u.email AS owner_email, owner_u.username AS owner_username
    FROM projects p
    LEFT JOIN project_shares s ON s.project_id = p.id AND s.user_id = ?
    LEFT JOIN users owner_u ON owner_u.id = p.user_id
    WHERE (p.user_id = ? OR s.user_id = ?)
  `;
  const params = [req.user.userId, req.user.userId, req.user.userId, req.user.userId];

  if (q) {
    query += ' AND (p.title LIKE ? OR p.description LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }

  // Workspace filter spans owned projects (project.workspace_id) and shared projects
  // (project_shares.workspace_id — per-recipient).
  if (workspace && workspace !== 'all') {
    if (workspace === 'none') {
      query += ` AND (
        (p.user_id = ? AND p.workspace_id IS NULL)
        OR (s.user_id = ? AND s.workspace_id IS NULL)
      )`;
      params.push(req.user.userId, req.user.userId);
    } else {
      const wsId = parseInt(workspace, 10);
      if (!isNaN(wsId)) {
        query += ` AND (
          (p.user_id = ? AND p.workspace_id = ?)
          OR (s.user_id = ? AND s.workspace_id = ?)
        )`;
        params.push(req.user.userId, wsId, req.user.userId, wsId);
      }
    }
  }

  let projects = db.prepare(query + ' ORDER BY p.favorite DESC, p.title COLLATE NOCASE ASC').all(...params);

  if (tags) {
    const tagList = tags.split(',').map(t => t.trim().toLowerCase());
    projects = projects.filter(p => {
      const ptags = JSON.parse(p.tags || '[]').map(t => t.toLowerCase());
      return tagList.some(t => ptags.includes(t));
    });
  }

  projects = projects.map(p => {
    const base = {
      ...p,
      tags: JSON.parse(p.tags || '[]'),
      picture: safePicturePath(p.picture),
      role: p.role,
      unseenShare: p.role !== 'owner' && !p.share_seen_at,
    };
    // For non-owners, the effective workspace_id is the per-recipient value on project_shares
    // (the project row's workspace_id belongs to the owner and is irrelevant to the recipient).
    if (p.role !== 'owner') {
      base.workspace_id = p.share_workspace_id ?? null;
      base.sharedBy = {
        userId: p.user_id,
        email: p.owner_email ? decryptEmail(p.owner_email) : null,
        username: p.owner_username || null,
      };
    }
    // Strip internal join columns
    delete base.share_seen_at;
    delete base.share_workspace_id;
    delete base.owner_email;
    delete base.owner_username;
    return base;
  });

  // Batch-fetch member info for all projects in one query (owner + shared users)
  if (projects.length) {
    const ids = projects.map(p => p.id);
    const placeholders = ids.map(() => '?').join(',');
    // Members list is used for avatar stacks. Emails are intentionally omitted —
    // they leak collaborator PII to all other members. The share-management modal
    // uses GET /shares (owner-only) which does include emails.
    const memberRows = db.prepare(`
      SELECT p.id AS project_id, u.id AS user_id, u.username, u.profile_picture, 1 AS is_owner
      FROM projects p JOIN users u ON u.id = p.user_id
      WHERE p.id IN (${placeholders})
      UNION ALL
      SELECT s.project_id, u.id AS user_id, u.username, u.profile_picture, 0 AS is_owner
      FROM project_shares s JOIN users u ON u.id = s.user_id
      WHERE s.project_id IN (${placeholders})
    `).all(...ids, ...ids);

    const byProject = new Map();
    for (const r of memberRows) {
      const list = byProject.get(r.project_id) || [];
      list.push({
        userId: r.user_id,
        username: r.username,
        profilePicture: safePicturePath(r.profile_picture),
        isOwner: !!r.is_owner,
      });
      byProject.set(r.project_id, list);
    }
    projects.forEach(p => { p.members = byProject.get(p.id) || []; });
  }

  if (projects.length) {
    const today = new Date().toISOString().slice(0, 10);
    const ids = projects.map(p => p.id);
    const placeholders = ids.map(() => '?').join(',');

    const taskRows = db.prepare(`
      SELECT b.project_id AS project_id,
             COUNT(t.id) AS task_total,
             SUM(CASE WHEN t.completed_at IS NOT NULL THEN 1 ELSE 0 END) AS task_completed,
             SUM(CASE WHEN t.completed_at IS NULL AND t.due_date IS NOT NULL AND t.due_date != '' AND t.due_date < ? THEN 1 ELSE 0 END) AS overdue_count
      FROM buckets b
      LEFT JOIN tasks t ON t.bucket_id = b.id
      WHERE b.project_id IN (${placeholders})
      GROUP BY b.project_id
    `).all(today, ...ids);

    const riskRows = db.prepare(`
      SELECT project_id,
             COUNT(*) AS total,
             SUM(CASE WHEN (severity * probability * detectability) >= 200 THEN 1 ELSE 0 END) AS tier_high,
             SUM(CASE WHEN (severity * probability * detectability) >= 100 AND (severity * probability * detectability) < 200 THEN 1 ELSE 0 END) AS tier_med,
             SUM(CASE WHEN (severity * probability * detectability) < 100 THEN 1 ELSE 0 END) AS tier_low
      FROM risks
      WHERE status = 'Open' AND project_id IN (${placeholders})
      GROUP BY project_id
    `).all(...ids);

    const taskMap = new Map(taskRows.map(r => [r.project_id, r]));
    const riskMap = new Map(riskRows.map(r => [r.project_id, r]));

    projects = projects.map(p => {
      const t = taskMap.get(p.id) || { task_total: 0, task_completed: 0, overdue_count: 0 };
      const r = riskMap.get(p.id) || { total: 0, tier_high: 0, tier_med: 0, tier_low: 0 };
      return {
        ...p,
        stats: {
          taskTotal: t.task_total || 0,
          taskCompleted: t.task_completed || 0,
          overdueCount: t.overdue_count || 0,
          riskOpen: r.total || 0,
          riskTiers: { high: r.tier_high || 0, medium: r.tier_med || 0, low: r.tier_low || 0 },
        },
      };
    });
  }

  res.json(projects);
});

// POST /api/projects
router.post('/', requireAuth, upload.single('picture'), (req, res) => {
  const { title, description, tags, workspace_id } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  if (title.length > 100) return res.status(400).json({ error: 'Title must be 100 characters or fewer' });
  if (description && description.length > 5000) return res.status(400).json({ error: 'Description must be 5000 characters or fewer' });

  const tagsArr = parseTags(tags);
  if (tagsArr === null) return res.status(400).json({ error: 'tags must be an array of strings' });
  if (tagsArr.length > 20) return res.status(400).json({ error: 'Too many tags (max 20)' });
  if (tagsArr.some(t => t.length > 50)) return res.status(400).json({ error: 'Each tag must be 50 characters or fewer' });
  const picture = req.file ? `/uploads/${req.file.filename}` : null;

  let wsId = workspace_id ? parseInt(workspace_id, 10) : null;
  if (wsId) {
    const ws = db.prepare('SELECT id FROM workspaces WHERE id = ? AND user_id = ?').get(wsId, req.user.userId);
    if (!ws) return res.status(400).json({ error: 'Invalid workspace' });
  }

  const result = db.prepare(
    'INSERT INTO projects (user_id, title, description, picture, tags, workspace_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user.userId, stripHtmlTags(title), stripHtmlTags(description) || null, picture, JSON.stringify(tagsArr.map(stripHtmlTags)), wsId || null);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...project, tags: JSON.parse(project.tags) });
});

// GET /api/projects/:id  — owner or any shared member
router.get('/:id', requireAuth, (req, res) => {
  const role = getProjectRole(req.user.userId, req.params.id);
  if (!role) return res.status(404).json({ error: 'Project not found' });
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json({ ...project, tags: JSON.parse(project.tags || '[]'), picture: safePicturePath(project.picture), role });
});

// PUT /api/projects/:id  — owner only (project meta is owner-controlled)
router.put('/:id', requireAuth, upload.single('picture'), (req, res) => {
  if (!isProjectOwner(req.user.userId, req.params.id)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { title, description, tags, remove_picture, workspace_id } = req.body;
  if (title !== undefined && title.length > 100) return res.status(400).json({ error: 'Title must be 100 characters or fewer' });
  if (description !== undefined && description.length > 5000) return res.status(400).json({ error: 'Description must be 5000 characters or fewer' });
  const tagsArr = parseTags(tags, JSON.parse(project.tags || '[]'));
  if (tagsArr === null) return res.status(400).json({ error: 'tags must be an array of strings' });
  if (tagsArr.length > 20) return res.status(400).json({ error: 'Too many tags (max 20)' });
  if (tagsArr.some(t => t.length > 50)) return res.status(400).json({ error: 'Each tag must be 50 characters or fewer' });
  let picture;
  if (req.file) picture = `/uploads/${req.file.filename}`;
  else if (remove_picture === 'true') picture = null;
  else picture = safePicturePath(project.picture);

  let wsId = project.workspace_id;
  if (workspace_id !== undefined) {
    wsId = workspace_id ? parseInt(workspace_id, 10) : null;
    if (wsId) {
      const ws = db.prepare('SELECT id FROM workspaces WHERE id = ? AND user_id = ?').get(wsId, req.user.userId);
      if (!ws) return res.status(400).json({ error: 'Invalid workspace' });
    }
  }

  db.prepare('UPDATE projects SET title = ?, description = ?, picture = ?, tags = ?, workspace_id = ? WHERE id = ?')
    .run(stripHtmlTags(title || project.title), stripHtmlTags(description ?? project.description), picture, JSON.stringify(tagsArr.map(stripHtmlTags)), wsId, project.id);

  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id);
  res.json({ ...updated, tags: JSON.parse(updated.tags) });
});

// PUT /api/projects/:id/favorite  — owner only (favorites only meaningful on owned projects)
router.put('/:id/favorite', requireAuth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const newVal = project.favorite ? 0 : 1;
  db.prepare('UPDATE projects SET favorite = ? WHERE id = ?').run(newVal, project.id);
  res.json({ favorite: newVal });
});

// DELETE /api/projects/:id  — owner only (cascades to shares via FK)
router.delete('/:id', requireAuth, (req, res) => {
  if (!isProjectOwner(req.user.userId, req.params.id)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ message: 'Project deleted' });
});

module.exports = router;
