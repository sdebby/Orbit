const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

const ALLOWED_EXT = /\.(jpg|jpeg|png)$/i;
const ALLOWED_MIME = ['image/jpeg', 'image/png'];

function imageFilter(req, file, cb) {
  if (ALLOWED_MIME.includes(file.mimetype) && ALLOWED_EXT.test(file.originalname)) {
    cb(null, true);
  } else {
    cb(new Error('Only .jpg, .jpeg and .png files are allowed'));
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', 'uploads'),
    filename: (req, file, cb) => cb(null, `task-${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFilter,
});

function ownsBucket(userId, bucketId) {
  return db.prepare('SELECT b.id FROM buckets b JOIN projects p ON b.project_id = p.id WHERE b.id = ? AND p.user_id = ?')
    .get(bucketId, userId);
}

// GET /api/buckets/:bucketId/tasks
router.get('/', requireAuth, (req, res) => {
  if (!ownsBucket(req.user.userId, req.params.bucketId)) {
    return res.status(404).json({ error: 'Bucket not found' });
  }
  const tasks = db.prepare('SELECT * FROM tasks WHERE bucket_id = ? ORDER BY position ASC, created_at ASC')
    .all(req.params.bucketId);
  res.json(tasks.map(t => ({ ...t, tags: JSON.parse(t.tags || '[]') })));
});

// POST /api/buckets/:bucketId/tasks
router.post('/', requireAuth, upload.single('picture'), (req, res) => {
  if (!ownsBucket(req.user.userId, req.params.bucketId)) {
    return res.status(404).json({ error: 'Bucket not found' });
  }
  const { description, priority, due_date, tags } = req.body;
  if (!description) return res.status(400).json({ error: 'Description is required' });

  const validPriorities = ['Low', 'Medium', 'High'];
  const p = validPriorities.includes(priority) ? priority : 'Medium';
  const tagsArr = tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : [];
  const picture = req.file ? `/uploads/${req.file.filename}` : null;

  const maxPos = db.prepare('SELECT MAX(position) as m FROM tasks WHERE bucket_id = ?').get(req.params.bucketId);
  const position = (maxPos.m || 0) + 1;

  const result = db.prepare(
    'INSERT INTO tasks (bucket_id, description, priority, due_date, tags, position, picture) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.params.bucketId, description, p, due_date || null, JSON.stringify(tagsArr), position, picture);

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...task, tags: JSON.parse(task.tags) });
});

// GET /api/tasks/:id
router.get('/:id', requireAuth, (req, res) => {
  const task = db.prepare(`
    SELECT t.* FROM tasks t
    JOIN buckets b ON t.bucket_id = b.id
    JOIN projects p ON b.project_id = p.id
    WHERE t.id = ? AND p.user_id = ?
  `).get(req.params.id, req.user.userId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json({ ...task, tags: JSON.parse(task.tags || '[]') });
});

// PUT /api/tasks/:id
router.put('/:id', requireAuth, upload.single('picture'), (req, res) => {
  const task = db.prepare(`
    SELECT t.* FROM tasks t
    JOIN buckets b ON t.bucket_id = b.id
    JOIN projects p ON b.project_id = p.id
    WHERE t.id = ? AND p.user_id = ?
  `).get(req.params.id, req.user.userId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { description, priority, due_date, tags, position, bucket_id, completed } = req.body;
  const validPriorities = ['Low', 'Medium', 'High'];
  const p = validPriorities.includes(priority) ? priority : task.priority;

  // Allow moving task to a different bucket (within same user's project)
  let targetBucketId = task.bucket_id;
  if (bucket_id && bucket_id !== task.bucket_id) {
    if (ownsBucket(req.user.userId, bucket_id)) targetBucketId = bucket_id;
  }

  const tagsArr = tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : JSON.parse(task.tags || '[]');
  const picture = req.file ? `/uploads/${req.file.filename}` : task.picture;

  let completedAt = task.completed_at;
  if (completed === 'true' || completed === true) {
    completedAt = completedAt || Math.floor(Date.now() / 1000);
  } else if (completed === 'false' || completed === false) {
    completedAt = null;
  }

  db.prepare('UPDATE tasks SET bucket_id = ?, description = ?, priority = ?, due_date = ?, tags = ?, position = ?, picture = ?, completed_at = ? WHERE id = ?')
    .run(targetBucketId, description || task.description, p, due_date ?? task.due_date, JSON.stringify(tagsArr), position ?? task.position, picture, completedAt, task.id);

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
  res.json({ ...updated, tags: JSON.parse(updated.tags) });
});

// DELETE /api/tasks/:id
router.delete('/:id', requireAuth, (req, res) => {
  const task = db.prepare(`
    SELECT t.* FROM tasks t
    JOIN buckets b ON t.bucket_id = b.id
    JOIN projects p ON b.project_id = p.id
    WHERE t.id = ? AND p.user_id = ?
  `).get(req.params.id, req.user.userId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  res.json({ message: 'Task deleted' });
});

module.exports = router;
