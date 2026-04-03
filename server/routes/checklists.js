const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');

function stripHtmlTags(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/<\/?[a-zA-Z][^>]*>/g, '');
}

function ownsChecklist(userId, checklistId) {
  return db.prepare(`
    SELECT c.* FROM task_checklists c
    JOIN tasks t ON c.task_id = t.id
    JOIN buckets b ON t.bucket_id = b.id
    JOIN projects p ON b.project_id = p.id
    WHERE c.id = ? AND p.user_id = ?
  `).get(checklistId, userId);
}

// PUT /api/checklists/:id
router.put('/:id', requireAuth, (req, res) => {
  const item = ownsChecklist(req.user.userId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Checklist item not found' });
  const { text, checked } = req.body;
  if (text !== undefined && (!text.trim() || text.length > 500)) {
    return res.status(400).json({ error: 'Text must be 1–500 characters' });
  }
  const newText = text !== undefined ? stripHtmlTags(text.trim()) : item.text;
  const newChecked = checked !== undefined ? (checked ? 1 : 0) : item.checked;
  db.prepare('UPDATE task_checklists SET text = ?, checked = ? WHERE id = ?')
    .run(newText, newChecked, item.id);
  const updated = db.prepare('SELECT * FROM task_checklists WHERE id = ?').get(item.id);
  res.json(updated);
});

// DELETE /api/checklists/:id
router.delete('/:id', requireAuth, (req, res) => {
  const item = ownsChecklist(req.user.userId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Checklist item not found' });
  db.prepare('DELETE FROM task_checklists WHERE id = ?').run(item.id);
  res.json({ message: 'Checklist item deleted' });
});

module.exports = router;
