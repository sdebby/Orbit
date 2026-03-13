const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/projects  — with optional search
router.get('/', requireAuth, (req, res) => {
  const { q, tags } = req.query;
  let query = 'SELECT * FROM projects WHERE user_id = ?';
  const params = [req.user.userId];

  if (q) {
    query += ' AND (title LIKE ? OR description LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }

  let projects = db.prepare(query + ' ORDER BY created_at DESC').all(...params);

  if (tags) {
    const tagList = tags.split(',').map(t => t.trim().toLowerCase());
    projects = projects.filter(p => {
      const ptags = JSON.parse(p.tags || '[]').map(t => t.toLowerCase());
      return tagList.some(t => ptags.includes(t));
    });
  }

  projects = projects.map(p => ({ ...p, tags: JSON.parse(p.tags || '[]') }));
  res.json(projects);
});

// POST /api/projects
router.post('/', requireAuth, upload.single('picture'), (req, res) => {
  const { title, description, tags } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const tagsArr = tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : [];
  const picture = req.file ? `/uploads/${req.file.filename}` : null;

  const result = db.prepare(
    'INSERT INTO projects (user_id, title, description, picture, tags) VALUES (?, ?, ?, ?, ?)'
  ).run(req.user.userId, title, description || null, picture, JSON.stringify(tagsArr));

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...project, tags: JSON.parse(project.tags) });
});

// GET /api/projects/:id
router.get('/:id', requireAuth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json({ ...project, tags: JSON.parse(project.tags || '[]') });
});

// PUT /api/projects/:id
router.put('/:id', requireAuth, upload.single('picture'), (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { title, description, tags, remove_picture } = req.body;
  const tagsArr = tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : JSON.parse(project.tags || '[]');
  let picture;
  if (req.file) picture = `/uploads/${req.file.filename}`;
  else if (remove_picture === 'true') picture = null;
  else picture = project.picture;

  db.prepare('UPDATE projects SET title = ?, description = ?, picture = ?, tags = ? WHERE id = ?')
    .run(title || project.title, description ?? project.description, picture, JSON.stringify(tagsArr), project.id);

  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id);
  res.json({ ...updated, tags: JSON.parse(updated.tags) });
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
