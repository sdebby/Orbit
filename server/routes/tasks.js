const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');
const { safePicturePath } = require('../utils/hash');
const { canViewProject, canEditProject, VIEWABLE_PROJECT_IDS_SQL } = require('../utils/access');
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
  limits: { fileSize: 5 * 1024 * 1024, fieldSize: 10 * 1024 },
  fileFilter: imageFilter,
});

// Editor-level access through a bucket (used for task mutations).
function canEditBucket(userId, bucketId) {
  const row = db.prepare('SELECT project_id FROM buckets WHERE id = ?').get(bucketId);
  return row && canEditProject(userId, row.project_id) ? row : null;
}

// Viewer-level access through a bucket (used for task GET).
function canViewBucket(userId, bucketId) {
  const row = db.prepare('SELECT project_id FROM buckets WHERE id = ?').get(bucketId);
  return row && canViewProject(userId, row.project_id) ? row : null;
}

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

// Editor access to a task (owner or editor of its project)
function canEditTask(userId, taskId) {
  const row = db.prepare(`
    SELECT t.*, b.project_id AS project_id
    FROM tasks t JOIN buckets b ON t.bucket_id = b.id
    WHERE t.id = ?
  `).get(taskId);
  return row && canEditProject(userId, row.project_id) ? row : null;
}

// Viewer access to a task (any role)
function canViewTask(userId, taskId) {
  const row = db.prepare(`
    SELECT t.*, b.project_id AS project_id
    FROM tasks t JOIN buckets b ON t.bucket_id = b.id
    WHERE t.id = ?
  `).get(taskId);
  return row && canViewProject(userId, row.project_id) ? row : null;
}

// GET /api/tasks/overdue?projectId=123  (projectId optional)
// Includes overdue tasks from shared projects as well.
router.get('/overdue', requireAuth, (req, res) => {
  const userId = req.user.userId;
  const today = new Date().toISOString().slice(0, 10);
  const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;

  let sql = `
    SELECT t.id, t.description, t.due_date,
           b.id AS bucket_id, b.title AS bucket_title,
           p.id AS project_id, p.title AS project_title
    FROM tasks t
    JOIN buckets b ON t.bucket_id = b.id
    JOIN projects p ON b.project_id = p.id
    WHERE p.id IN (${VIEWABLE_PROJECT_IDS_SQL})
      AND t.completed_at IS NULL
      AND t.due_date IS NOT NULL
      AND t.due_date != ''
      AND t.due_date < ?
  `;
  const params = [userId, userId, today];
  if (projectId) { sql += ' AND p.id = ?'; params.push(projectId); }
  sql += ' ORDER BY t.due_date ASC';

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// GET /api/buckets/:bucketId/tasks  — any role
router.get('/', requireAuth, (req, res) => {
  if (!canViewBucket(req.user.userId, req.params.bucketId)) {
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

// POST /api/buckets/:bucketId/tasks  — editor and owner
router.post('/', requireAuth, upload.single('picture'), (req, res) => {
  if (!canEditBucket(req.user.userId, req.params.bucketId)) {
    return res.status(404).json({ error: 'Bucket not found' });
  }
  const { description, priority, due_date, tags, reminder } = req.body;
  if (!description) return res.status(400).json({ error: 'Description is required' });
  if (description.length > 2000) return res.status(400).json({ error: 'Description must be 2000 characters or fewer' });

  const validPriorities = ['Low', 'Medium', 'High'];
  const p = validPriorities.includes(priority) ? priority : 'Medium';
  const tagsArr = parseTags(tags);
  if (tagsArr === null) return res.status(400).json({ error: 'tags must be an array of strings' });
  if (tagsArr.length > 20) return res.status(400).json({ error: 'Too many tags (max 20)' });
  if (tagsArr.some(t => t.length > 50)) return res.status(400).json({ error: 'Each tag must be 50 characters or fewer' });
  const picture = req.file ? `/uploads/${req.file.filename}` : null;
  const reminderVal = (reminder === 'true' || reminder === true || reminder === '1' || reminder === 1) ? 1 : 0;

  const maxPos = db.prepare('SELECT MAX(position) as m FROM tasks WHERE bucket_id = ?').get(req.params.bucketId);
  const position = (maxPos.m || 0) + 1;

  const result = db.prepare(
    'INSERT INTO tasks (bucket_id, description, priority, due_date, tags, position, picture, reminder) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.params.bucketId, stripHtmlTags(description), p, due_date || null, JSON.stringify(tagsArr.map(stripHtmlTags)), position, picture, reminderVal);

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...task, tags: JSON.parse(task.tags), picture: safePicturePath(task.picture) });
});

// GET /api/tasks/:id  — any role
router.get('/:id', requireAuth, (req, res) => {
  const task = canViewTask(req.user.userId, req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json({ ...task, tags: JSON.parse(task.tags || '[]'), picture: safePicturePath(task.picture) });
});

// PUT /api/tasks/:id  — editor and owner
router.put('/:id', requireAuth, upload.single('picture'), (req, res) => {
  const task = canEditTask(req.user.userId, req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { description, priority, due_date, tags, position, bucket_id, completed, reminder } = req.body;
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
    if (canEditBucket(req.user.userId, bucket_id)) targetBucketId = bucket_id;
  }

  const tagsArr = parseTags(tags, JSON.parse(task.tags || '[]'));
  if (tagsArr === null) return res.status(400).json({ error: 'tags must be an array of strings' });
  if (tagsArr.length > 20) return res.status(400).json({ error: 'Too many tags (max 20)' });
  if (tagsArr.some(t => t.length > 50)) return res.status(400).json({ error: 'Each tag must be 50 characters or fewer' });
  const picture = req.file ? `/uploads/${req.file.filename}` : safePicturePath(task.picture);

  let completedAt = task.completed_at;
  if (completed === 'true' || completed === true) {
    completedAt = completedAt || Math.floor(Date.now() / 1000);
  } else if (completed === 'false' || completed === false) {
    completedAt = null;
  }

  let reminderVal = task.reminder;
  if (reminder !== undefined) {
    reminderVal = (reminder === 'true' || reminder === true || reminder === '1' || reminder === 1) ? 1 : 0;
  }

  const newDueDate = due_date === undefined ? task.due_date : (due_date || null);

  db.prepare('UPDATE tasks SET bucket_id = ?, description = ?, priority = ?, due_date = ?, tags = ?, position = ?, picture = ?, completed_at = ?, reminder = ? WHERE id = ?')
    .run(targetBucketId, stripHtmlTags(description || task.description), p, newDueDate, JSON.stringify(tagsArr.map(stripHtmlTags)), position ?? task.position, picture, completedAt, reminderVal, task.id);

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
  res.json({ ...updated, tags: JSON.parse(updated.tags), picture: safePicturePath(updated.picture) });
});

// DELETE /api/tasks/:id  — editor and owner
router.delete('/:id', requireAuth, (req, res) => {
  const task = canEditTask(req.user.userId, req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  res.json({ message: 'Task deleted' });
});

// GET /api/tasks/:id/checklists  — any role
router.get('/:id/checklists', requireAuth, (req, res) => {
  const task = canViewTask(req.user.userId, req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const items = db.prepare('SELECT * FROM task_checklists WHERE task_id = ? ORDER BY position ASC, created_at ASC')
    .all(req.params.id);
  res.json(items);
});

const MAX_CHECKLIST_ITEMS = 100;

// POST /api/tasks/:id/checklists  — editor and owner
router.post('/:id/checklists', requireAuth, (req, res) => {
  const task = canEditTask(req.user.userId, req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });
  if (text.length > 500) return res.status(400).json({ error: 'Text must be 500 characters or fewer' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM task_checklists WHERE task_id = ?').get(req.params.id).c;
  if (count >= MAX_CHECKLIST_ITEMS) {
    return res.status(400).json({ error: `A task can have at most ${MAX_CHECKLIST_ITEMS} checklist items` });
  }
  const maxPos = db.prepare('SELECT MAX(position) as m FROM task_checklists WHERE task_id = ?').get(req.params.id);
  const position = (maxPos.m || 0) + 1;
  const result = db.prepare('INSERT INTO task_checklists (task_id, text, position) VALUES (?, ?, ?)')
    .run(req.params.id, stripHtmlTags(text.trim()), position);
  const item = db.prepare('SELECT * FROM task_checklists WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(item);
});

module.exports = router;
