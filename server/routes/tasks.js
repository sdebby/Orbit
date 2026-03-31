const express = require('express');
const router = express.Router({ mergeParams: true });
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

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', 'uploads'),
    filename: (req, file, cb) => cb(null, `task-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFilter,
});

function ownsBucket(userId, bucketId) {
  return db.prepare('SELECT b.id FROM buckets b JOIN projects p ON b.project_id = p.id WHERE b.id = ? AND p.user_id = ?')
    .get(bucketId, userId);
}

function ownsTask(userId, taskId) {
  return db.prepare(`
    SELECT t.* FROM tasks t
    JOIN buckets b ON t.bucket_id = b.id
    JOIN projects p ON b.project_id = p.id
    WHERE t.id = ? AND p.user_id = ?
  `).get(taskId, userId);
}

// GET /api/buckets/:bucketId/tasks
router.get('/', requireAuth, (req, res) => {
  if (!ownsBucket(req.user.userId, req.params.bucketId)) {
    return res.status(404).json({ error: 'Bucket not found' });
  }
  const tasks = db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM task_checklists WHERE task_id = t.id) AS checklist_total,
      (SELECT COUNT(*) FROM task_checklists WHERE task_id = t.id AND checked = 1) AS checklist_done
    FROM tasks t WHERE t.bucket_id = ? ORDER BY t.position ASC, t.created_at ASC
  `).all(req.params.bucketId);
  res.json(tasks.map(t => ({ ...t, tags: JSON.parse(t.tags || '[]'), picture: safePicturePath(t.picture) })));
});

// POST /api/buckets/:bucketId/tasks
router.post('/', requireAuth, upload.single('picture'), (req, res) => {
  if (!ownsBucket(req.user.userId, req.params.bucketId)) {
    return res.status(404).json({ error: 'Bucket not found' });
  }
  const { description, priority, due_date, tags } = req.body;
  if (!description) return res.status(400).json({ error: 'Description is required' });
  if (description.length > 2000) return res.status(400).json({ error: 'Description must be 2000 characters or fewer' });

  const validPriorities = ['Low', 'Medium', 'High'];
  const p = validPriorities.includes(priority) ? priority : 'Medium';
  const tagsArr = tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : [];
  if (tagsArr.length > 20) return res.status(400).json({ error: 'Too many tags (max 20)' });
  if (tagsArr.some(t => t.length > 50)) return res.status(400).json({ error: 'Each tag must be 50 characters or fewer' });
  const picture = req.file ? `/uploads/${req.file.filename}` : null;

  const maxPos = db.prepare('SELECT MAX(position) as m FROM tasks WHERE bucket_id = ?').get(req.params.bucketId);
  const position = (maxPos.m || 0) + 1;

  const result = db.prepare(
    'INSERT INTO tasks (bucket_id, description, priority, due_date, tags, position, picture) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.params.bucketId, description, p, due_date || null, JSON.stringify(tagsArr), position, picture);

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...task, tags: JSON.parse(task.tags), picture: safePicturePath(task.picture) });
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
  res.json({ ...task, tags: JSON.parse(task.tags || '[]'), picture: safePicturePath(task.picture) });
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
  if (description !== undefined && description.length > 2000) return res.status(400).json({ error: 'Description must be 2000 characters or fewer' });
  const validPriorities = ['Low', 'Medium', 'High'];
  const p = validPriorities.includes(priority) ? priority : task.priority;

  // Allow moving task to a different bucket only within the same project
  let targetBucketId = task.bucket_id;
  if (bucket_id && bucket_id !== task.bucket_id) {
    const currentProject = db.prepare('SELECT project_id FROM buckets WHERE id = ?').get(task.bucket_id);
    const targetBucket = db.prepare('SELECT project_id FROM buckets WHERE id = ?').get(bucket_id);
    if (!targetBucket || !currentProject || targetBucket.project_id !== currentProject.project_id) {
      return res.status(400).json({ error: 'Target bucket must be in the same project' });
    }
    if (ownsBucket(req.user.userId, bucket_id)) targetBucketId = bucket_id;
  }

  const tagsArr = tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : JSON.parse(task.tags || '[]');
  if (tagsArr.length > 20) return res.status(400).json({ error: 'Too many tags (max 20)' });
  if (tagsArr.some(t => t.length > 50)) return res.status(400).json({ error: 'Each tag must be 50 characters or fewer' });
  const picture = req.file ? `/uploads/${req.file.filename}` : safePicturePath(task.picture);

  let completedAt = task.completed_at;
  if (completed === 'true' || completed === true) {
    completedAt = completedAt || Math.floor(Date.now() / 1000);
  } else if (completed === 'false' || completed === false) {
    completedAt = null;
  }

  db.prepare('UPDATE tasks SET bucket_id = ?, description = ?, priority = ?, due_date = ?, tags = ?, position = ?, picture = ?, completed_at = ? WHERE id = ?')
    .run(targetBucketId, description || task.description, p, due_date ?? task.due_date, JSON.stringify(tagsArr), position ?? task.position, picture, completedAt, task.id);

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
  res.json({ ...updated, tags: JSON.parse(updated.tags), picture: safePicturePath(updated.picture) });
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

// GET /api/tasks/:id/checklists
router.get('/:id/checklists', requireAuth, (req, res) => {
  const task = ownsTask(req.user.userId, req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const items = db.prepare('SELECT * FROM task_checklists WHERE task_id = ? ORDER BY position ASC, created_at ASC')
    .all(req.params.id);
  res.json(items);
});

// POST /api/tasks/:id/checklists
router.post('/:id/checklists', requireAuth, (req, res) => {
  const task = ownsTask(req.user.userId, req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });
  if (text.length > 500) return res.status(400).json({ error: 'Text must be 500 characters or fewer' });
  const maxPos = db.prepare('SELECT MAX(position) as m FROM task_checklists WHERE task_id = ?').get(req.params.id);
  const position = (maxPos.m || 0) + 1;
  const result = db.prepare('INSERT INTO task_checklists (task_id, text, position) VALUES (?, ?, ?)')
    .run(req.params.id, text.trim(), position);
  const item = db.prepare('SELECT * FROM task_checklists WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(item);
});

module.exports = router;
