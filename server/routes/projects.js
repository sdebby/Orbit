const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');
const { safePicturePath } = require('../utils/hash');
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
router.get('/', requireAuth, (req, res) => {
  const { q, tags, workspace } = req.query;
  let query = 'SELECT * FROM projects WHERE user_id = ?';
  const params = [req.user.userId];

  if (q) {
    query += ' AND (title LIKE ? OR description LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }

  if (workspace && workspace !== 'all') {
    if (workspace === 'none') {
      query += ' AND workspace_id IS NULL';
    } else {
      const wsId = parseInt(workspace, 10);
      if (!isNaN(wsId)) { query += ' AND workspace_id = ?'; params.push(wsId); }
    }
  }

  let projects = db.prepare(query + ' ORDER BY favorite DESC, title COLLATE NOCASE ASC').all(...params);

  if (tags) {
    const tagList = tags.split(',').map(t => t.trim().toLowerCase());
    projects = projects.filter(p => {
      const ptags = JSON.parse(p.tags || '[]').map(t => t.toLowerCase());
      return tagList.some(t => ptags.includes(t));
    });
  }

  projects = projects.map(p => ({ ...p, tags: JSON.parse(p.tags || '[]'), picture: safePicturePath(p.picture) }));

  if (projects.length) {
    const today = new Date().toISOString().slice(0, 10);
    const ids = projects.map(p => p.id);
    const placeholders = ids.map(() => '?').join(',');

    const taskRows = db.prepare(`
      SELECT b.project_id AS project_id,
             COUNT(t.id) AS task_total,
             SUM(CASE WHEN t.completed_at IS NOT NULL THEN 1 ELSE 0 END) AS task_completed,
             SUM(CASE WHEN t.completed_at IS NULL AND t.due_date IS NOT NULL AND t.due_date < ? THEN 1 ELSE 0 END) AS overdue_count
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

// GET /api/projects/:id
router.get('/:id', requireAuth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json({ ...project, tags: JSON.parse(project.tags || '[]'), picture: safePicturePath(project.picture) });
});

// PUT /api/projects/:id
router.put('/:id', requireAuth, upload.single('picture'), (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
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

// PUT /api/projects/:id/favorite
router.put('/:id/favorite', requireAuth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const newVal = project.favorite ? 0 : 1;
  db.prepare('UPDATE projects SET favorite = ? WHERE id = ?').run(newVal, project.id);
  res.json({ favorite: newVal });
});

// DELETE /api/projects/:id
router.delete('/:id', requireAuth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
  res.json({ message: 'Project deleted' });
});

module.exports = router;
