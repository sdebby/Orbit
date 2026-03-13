const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');

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
  const { title, description } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const maxPos = db.prepare('SELECT MAX(position) as m FROM buckets WHERE project_id = ?')
    .get(req.params.projectId);
  const position = (maxPos.m || 0) + 1;

  const result = db.prepare(
    'INSERT INTO buckets (project_id, title, description, position) VALUES (?, ?, ?, ?)'
  ).run(req.params.projectId, title, description || null, position);

  const bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(bucket);
});

// PUT /api/buckets/:id
router.put('/:id', requireAuth, (req, res) => {
  const bucket = db.prepare('SELECT b.* FROM buckets b JOIN projects p ON b.project_id = p.id WHERE b.id = ? AND p.user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!bucket) return res.status(404).json({ error: 'Bucket not found' });

  const { title, description, position } = req.body;
  db.prepare('UPDATE buckets SET title = ?, description = ?, position = ? WHERE id = ?')
    .run(title || bucket.title, description ?? bucket.description, position ?? bucket.position, bucket.id);

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
