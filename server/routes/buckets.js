const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
function validColor(c) {
  return c && HEX_COLOR_RE.test(c) ? c : null;
}

function stripHtmlTags(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/<\/?[a-zA-Z][^>]*>/g, '');
}

function ownsProject(userId, projectId) {
  return db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
}

// GET /api/projects/:projectId/buckets
router.get('/', requireAuth, (req, res) => {
  if (!ownsProject(req.user.userId, req.params.projectId)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const buckets = db.prepare('SELECT * FROM buckets WHERE project_id = ? ORDER BY position ASC, created_at ASC')
    .all(req.params.projectId);
  res.json(buckets);
});

// POST /api/projects/:projectId/buckets
router.post('/', requireAuth, (req, res) => {
  if (!ownsProject(req.user.userId, req.params.projectId)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const { title, description, storyboard, color } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  if (title.length > 100) return res.status(400).json({ error: 'Title must be 100 characters or fewer' });
  if (description && description.length > 5000) return res.status(400).json({ error: 'Description must be 5000 characters or fewer' });
  if (storyboard && storyboard.length > 5000) return res.status(400).json({ error: 'Storyboard must be 5000 characters or fewer' });

  const maxPos = db.prepare('SELECT MAX(position) as m FROM buckets WHERE project_id = ?')
    .get(req.params.projectId);
  const position = (maxPos.m || 0) + 1;

  const result = db.prepare(
    'INSERT INTO buckets (project_id, title, description, storyboard, color, position) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.params.projectId, stripHtmlTags(title), stripHtmlTags(description) || null, stripHtmlTags(storyboard) || null, validColor(color), position);

  const bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(bucket);
});

// PUT /api/buckets/:id
router.put('/:id', requireAuth, (req, res) => {
  const bucket = db.prepare('SELECT b.* FROM buckets b JOIN projects p ON b.project_id = p.id WHERE b.id = ? AND p.user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!bucket) return res.status(404).json({ error: 'Bucket not found' });

  const { title, description, storyboard, color, position } = req.body;
  if (title !== undefined && title.length > 100) return res.status(400).json({ error: 'Title must be 100 characters or fewer' });
  if (description !== undefined && description.length > 5000) return res.status(400).json({ error: 'Description must be 5000 characters or fewer' });
  if (storyboard !== undefined && storyboard.length > 5000) return res.status(400).json({ error: 'Storyboard must be 5000 characters or fewer' });
  const safePos = position !== undefined ? Math.min(Math.max(1, parseInt(position) || 1), 10000) : bucket.position;
  db.prepare('UPDATE buckets SET title = ?, description = ?, storyboard = ?, color = ?, position = ? WHERE id = ?')
    .run(stripHtmlTags(title || bucket.title), stripHtmlTags(description ?? bucket.description), stripHtmlTags(storyboard ?? bucket.storyboard), color !== undefined ? validColor(color) : bucket.color, safePos, bucket.id);

  const updated = db.prepare('SELECT * FROM buckets WHERE id = ?').get(bucket.id);
  res.json(updated);
});

// DELETE /api/buckets/:id
router.delete('/:id', requireAuth, (req, res) => {
  const bucket = db.prepare('SELECT b.* FROM buckets b JOIN projects p ON b.project_id = p.id WHERE b.id = ? AND p.user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!bucket) return res.status(404).json({ error: 'Bucket not found' });

  db.prepare('DELETE FROM buckets WHERE id = ?').run(bucket.id);
  res.json({ message: 'Bucket deleted' });
});

module.exports = router;
