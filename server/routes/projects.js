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

// GET /api/projects  — with optional search
router.get('/', requireAuth, (req, res) => {
  const { q, tags } = req.query;
  let query = 'SELECT * FROM projects WHERE user_id = ?';
  const params = [req.user.userId];

  if (q) {
    query += ' AND (title LIKE ? OR description LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
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
  res.json(projects);
});

// POST /api/projects
router.post('/', requireAuth, upload.single('picture'), (req, res) => {
  const { title, description, tags } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  if (title.length > 100) return res.status(400).json({ error: 'Title must be 100 characters or fewer' });
  if (description && description.length > 5000) return res.status(400).json({ error: 'Description must be 5000 characters or fewer' });

  const tagsArr = parseTags(tags);
  if (tagsArr === null) return res.status(400).json({ error: 'tags must be an array of strings' });
  if (tagsArr.length > 20) return res.status(400).json({ error: 'Too many tags (max 20)' });
  if (tagsArr.some(t => t.length > 50)) return res.status(400).json({ error: 'Each tag must be 50 characters or fewer' });
  const picture = req.file ? `/uploads/${req.file.filename}` : null;

  const result = db.prepare(
    'INSERT INTO projects (user_id, title, description, picture, tags) VALUES (?, ?, ?, ?, ?)'
  ).run(req.user.userId, stripHtmlTags(title), stripHtmlTags(description) || null, picture, JSON.stringify(tagsArr.map(stripHtmlTags)));

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

  const { title, description, tags, remove_picture } = req.body;
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

  db.prepare('UPDATE projects SET title = ?, description = ?, picture = ?, tags = ? WHERE id = ?')
    .run(stripHtmlTags(title || project.title), stripHtmlTags(description ?? project.description), picture, JSON.stringify(tagsArr.map(stripHtmlTags)), project.id);

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
