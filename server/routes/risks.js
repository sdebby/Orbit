const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');
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
    filename: (req, file, cb) => cb(null, `risk-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFilter,
});

function ownsProject(userId, projectId) {
  return db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
}

function ownsRisk(userId, riskId) {
  return db.prepare(`
    SELECT r.* FROM risks r
    JOIN projects p ON r.project_id = p.id
    WHERE r.id = ? AND p.user_id = ?
  `).get(riskId, userId);
}

function computeRpn(severity, probability, detectability) {
  return severity * probability * detectability;
}

function serializeRisk(r) {
  return {
    ...r,
    tags: JSON.parse(r.tags || '[]'),
    photos: JSON.parse(r.photos || '[]'),
    solution_photos: JSON.parse(r.solution_photos || '[]'),
    rpn: computeRpn(r.severity, r.probability, r.detectability),
  };
}

// GET /api/projects/:projectId/risks
router.get('/', requireAuth, (req, res) => {
  if (!ownsProject(req.user.userId, req.params.projectId)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const risks = db.prepare('SELECT * FROM risks WHERE project_id = ? ORDER BY position ASC, created_at ASC')
    .all(req.params.projectId);
  res.json(risks.map(serializeRisk));
});

// POST /api/projects/:projectId/risks
router.post('/', requireAuth, upload.single('photo'), (req, res) => {
  if (!ownsProject(req.user.userId, req.params.projectId)) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const { description, severity, probability, detectability, solution_description, status, tags } = req.body;
  if (!description) return res.status(400).json({ error: 'Description is required' });
  if (description.length > 2000) return res.status(400).json({ error: 'Description must be 2000 characters or fewer' });
  if (solution_description && solution_description.length > 5000) return res.status(400).json({ error: 'Solution description must be 5000 characters or fewer' });

  const s = Math.min(10, Math.max(1, parseInt(severity) || 5));
  const pr = Math.min(10, Math.max(1, parseInt(probability) || 5));
  const d = Math.min(10, Math.max(1, parseInt(detectability) || 5));
  const validStatus = ['Open', 'Resolved'].includes(status) ? status : 'Open';
  const tagsArr = tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : [];
  if (tagsArr.length > 20) return res.status(400).json({ error: 'Too many tags (max 20)' });
  if (tagsArr.some(t => t.length > 50)) return res.status(400).json({ error: 'Each tag must be 50 characters or fewer' });
  const photosArr = req.file ? [`/uploads/${req.file.filename}`] : [];

  const maxPos = db.prepare('SELECT MAX(position) as m FROM risks WHERE project_id = ?').get(req.params.projectId);
  const position = (maxPos.m || 0) + 1;

  const result = db.prepare(`
    INSERT INTO risks (project_id, description, severity, probability, detectability, solution_description, status, tags, photos, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.projectId, description, s, pr, d, solution_description || null, validStatus, JSON.stringify(tagsArr), JSON.stringify(photosArr), position);

  const risk = db.prepare('SELECT * FROM risks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(serializeRisk(risk));
});

// GET /api/risks/:id
router.get('/:id', requireAuth, (req, res) => {
  const risk = ownsRisk(req.user.userId, req.params.id);
  if (!risk) return res.status(404).json({ error: 'Risk not found' });
  res.json(serializeRisk(risk));
});

// PUT /api/risks/:id
router.put('/:id', requireAuth, upload.single('photo'), (req, res) => {
  const risk = ownsRisk(req.user.userId, req.params.id);
  if (!risk) return res.status(404).json({ error: 'Risk not found' });

  const { description, severity, probability, detectability, solution_description, status, tags, position } = req.body;
  if (description !== undefined && description.length > 2000) return res.status(400).json({ error: 'Description must be 2000 characters or fewer' });
  if (solution_description !== undefined && solution_description.length > 5000) return res.status(400).json({ error: 'Solution description must be 5000 characters or fewer' });
  const s = Math.min(10, Math.max(1, parseInt(severity) || risk.severity));
  const pr = Math.min(10, Math.max(1, parseInt(probability) || risk.probability));
  const d = Math.min(10, Math.max(1, parseInt(detectability) || risk.detectability));
  const validStatus = ['Open', 'Resolved'].includes(status) ? status : risk.status;
  const tagsArr = tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : JSON.parse(risk.tags || '[]');
  if (tagsArr.length > 20) return res.status(400).json({ error: 'Too many tags (max 20)' });
  if (tagsArr.some(t => t.length > 50)) return res.status(400).json({ error: 'Each tag must be 50 characters or fewer' });
  const existingPhotos = JSON.parse(risk.photos || '[]');
  const photosArr = req.file ? [...existingPhotos, `/uploads/${req.file.filename}`] : existingPhotos;

  db.prepare(`
    UPDATE risks SET description = ?, severity = ?, probability = ?, detectability = ?,
    solution_description = ?, status = ?, tags = ?, photos = ?, position = ? WHERE id = ?
  `).run(
    description || risk.description, s, pr, d,
    solution_description ?? risk.solution_description, validStatus,
    JSON.stringify(tagsArr), JSON.stringify(photosArr), position ?? risk.position, risk.id
  );

  const updated = db.prepare('SELECT * FROM risks WHERE id = ?').get(risk.id);
  res.json(serializeRisk(updated));
});

// DELETE /api/risks/:id
router.delete('/:id', requireAuth, (req, res) => {
  const risk = ownsRisk(req.user.userId, req.params.id);
  if (!risk) return res.status(404).json({ error: 'Risk not found' });
  db.prepare('DELETE FROM risks WHERE id = ?').run(risk.id);
  res.json({ message: 'Risk deleted' });
});

module.exports = router;
