const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');

function stripHtmlTags(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/<\/?[a-zA-Z][^>]*>/g, '');
}

// GET /api/templates
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT id, name, bucket_data FROM bucket_templates WHERE user_id = ? ORDER BY name COLLATE NOCASE ASC'
  ).all(req.user.userId);
  res.json(rows);
});

// POST /api/templates
router.post('/', requireAuth, (req, res) => {
  const { name, bucket_data } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  if (!bucket_data) return res.status(400).json({ error: 'bucket_data is required' });
  try { JSON.parse(bucket_data); } catch { return res.status(400).json({ error: 'bucket_data must be valid JSON' }); }

  try {
    const result = db.prepare(
      'INSERT INTO bucket_templates (user_id, name, bucket_data) VALUES (?, ?, ?)'
    ).run(req.user.userId, stripHtmlTags(String(name).trim()), bucket_data);
    const row = db.prepare('SELECT id, name, bucket_data FROM bucket_templates WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A template with this name already exists' });
    }
    throw err;
  }
});

// PUT /api/templates/:id — rename
router.put('/:id', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  const row = db.prepare('SELECT id FROM bucket_templates WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!row) return res.status(404).json({ error: 'Template not found' });
  try {
    db.prepare('UPDATE bucket_templates SET name = ? WHERE id = ?')
      .run(stripHtmlTags(String(name).trim()), row.id);
    const updated = db.prepare('SELECT id, name, bucket_data FROM bucket_templates WHERE id = ?').get(row.id);
    res.json(updated);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A template with this name already exists' });
    }
    throw err;
  }
});

// DELETE /api/templates/:id
router.delete('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT id FROM bucket_templates WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!row) return res.status(404).json({ error: 'Template not found' });
  db.prepare('DELETE FROM bucket_templates WHERE id = ?').run(row.id);
  res.json({ message: 'Template deleted' });
});

module.exports = router;
