const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
function validColor(c) { return c && HEX_COLOR_RE.test(c) ? c : null; }

function stripHtmlTags(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/<\/?[a-zA-Z][^>]*>/g, '');
}

function ownsWorkspace(userId, wsId) {
  return db.prepare('SELECT * FROM workspaces WHERE id = ? AND user_id = ?').get(wsId, userId);
}

// GET /api/workspaces
router.get('/', requireAuth, (req, res) => {
  const workspaces = db.prepare(
    'SELECT * FROM workspaces WHERE user_id = ? ORDER BY position ASC, created_at ASC'
  ).all(req.user.userId);
  res.json(workspaces);
});

// POST /api/workspaces
router.post('/', requireAuth, (req, res) => {
  const { name, color } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const trimmed = stripHtmlTags(name.trim());
  if (trimmed.length > 80) return res.status(400).json({ error: 'Name must be 80 characters or fewer' });

  const maxPos = db.prepare('SELECT MAX(position) as m FROM workspaces WHERE user_id = ?').get(req.user.userId);
  const position = (maxPos.m || 0) + 1;

  const result = db.prepare(
    'INSERT INTO workspaces (user_id, name, color, position) VALUES (?, ?, ?, ?)'
  ).run(req.user.userId, trimmed, validColor(color), position);

  const ws = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(ws);
});

// PUT /api/workspaces/:id
router.put('/:id', requireAuth, (req, res) => {
  const ws = ownsWorkspace(req.user.userId, parseInt(req.params.id, 10));
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const { name, color, position } = req.body;
  const newName = name !== undefined ? stripHtmlTags(name.trim()) : ws.name;
  if (newName.length === 0) return res.status(400).json({ error: 'Name is required' });
  if (newName.length > 80) return res.status(400).json({ error: 'Name must be 80 characters or fewer' });

  const newColor = color !== undefined ? validColor(color) : ws.color;
  const newPos = position !== undefined ? parseInt(position, 10) : ws.position;

  db.prepare('UPDATE workspaces SET name = ?, color = ?, position = ? WHERE id = ?')
    .run(newName, newColor, newPos, ws.id);

  const updated = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(ws.id);
  res.json(updated);
});

// DELETE /api/workspaces/:id
router.delete('/:id', requireAuth, (req, res) => {
  const ws = ownsWorkspace(req.user.userId, parseInt(req.params.id, 10));
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  // Move projects to unassigned before deleting
  db.prepare('UPDATE projects SET workspace_id = NULL WHERE workspace_id = ?').run(ws.id);
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(ws.id);
  res.json({ message: 'Workspace deleted' });
});

module.exports = router;
