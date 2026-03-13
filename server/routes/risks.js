const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', 'uploads'),
    filename: (req, file, cb) => cb(null, `risk-${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function ownsBucket(userId, bucketId) {
  return db.prepare('SELECT b.id FROM buckets b JOIN projects p ON b.project_id = p.id WHERE b.id = ? AND p.user_id = ?')
    .get(bucketId, userId);
}

function computeRpn(severity, probability, detectability) {
  return severity * probability * detectability;
}

// GET /api/buckets/:bucketId/risks
router.get('/', requireAuth, (req, res) => {
  if (!ownsBucket(req.user.userId, req.params.bucketId)) {
    return res.status(404).json({ error: 'Bucket not found' });
  }
  const risks = db.prepare('SELECT * FROM risks WHERE bucket_id = ? ORDER BY position ASC, created_at ASC')
    .all(req.params.bucketId);
  res.json(risks.map(r => ({
    ...r,
    tags: JSON.parse(r.tags || '[]'),
    photos: JSON.parse(r.photos || '[]'),
    solution_photos: JSON.parse(r.solution_photos || '[]'),
    rpn: computeRpn(r.severity, r.probability, r.detectability),
  })));
});

// POST /api/buckets/:bucketId/risks
router.post('/', requireAuth, upload.single('photo'), (req, res) => {
  if (!ownsBucket(req.user.userId, req.params.bucketId)) {
    return res.status(404).json({ error: 'Bucket not found' });
  }

  const { description, severity, probability, detectability, solution_description, status, tags } = req.body;
  if (!description) return res.status(400).json({ error: 'Description is required' });

  const s = Math.min(10, Math.max(1, parseInt(severity) || 5));
  const pr = Math.min(10, Math.max(1, parseInt(probability) || 5));
  const d = Math.min(10, Math.max(1, parseInt(detectability) || 5));
  const validStatus = ['Open', 'Resolved'].includes(status) ? status : 'Open';
  const tagsArr = tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : [];
  const photosArr = req.file ? [`/uploads/${req.file.filename}`] : [];

  const maxPos = db.prepare('SELECT MAX(position) as m FROM risks WHERE bucket_id = ?').get(req.params.bucketId);
  const position = (maxPos.m || 0) + 1;

  const result = db.prepare(`
    INSERT INTO risks (bucket_id, description, severity, probability, detectability, solution_description, status, tags, photos, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.bucketId, description, s, pr, d, solution_description || null, validStatus, JSON.stringify(tagsArr), JSON.stringify(photosArr), position);

  const risk = db.prepare('SELECT * FROM risks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({
    ...risk,
    tags: JSON.parse(risk.tags),
    photos: JSON.parse(risk.photos || '[]'),
    solution_photos: JSON.parse(risk.solution_photos || '[]'),
    rpn: computeRpn(risk.severity, risk.probability, risk.detectability),
  });
});

// GET /api/risks/:id
router.get('/:id', requireAuth, (req, res) => {
  const risk = db.prepare(`
    SELECT r.* FROM risks r
    JOIN buckets b ON r.bucket_id = b.id
    JOIN projects p ON b.project_id = p.id
    WHERE r.id = ? AND p.user_id = ?
  `).get(req.params.id, req.user.userId);
  if (!risk) return res.status(404).json({ error: 'Risk not found' });
  res.json({
    ...risk,
    tags: JSON.parse(risk.tags || '[]'),
    photos: JSON.parse(risk.photos || '[]'),
    solution_photos: JSON.parse(risk.solution_photos || '[]'),
    rpn: computeRpn(risk.severity, risk.probability, risk.detectability),
  });
});

// PUT /api/risks/:id
router.put('/:id', requireAuth, upload.single('photo'), (req, res) => {
  const risk = db.prepare(`
    SELECT r.* FROM risks r
    JOIN buckets b ON r.bucket_id = b.id
    JOIN projects p ON b.project_id = p.id
    WHERE r.id = ? AND p.user_id = ?
  `).get(req.params.id, req.user.userId);
  if (!risk) return res.status(404).json({ error: 'Risk not found' });

  const { description, severity, probability, detectability, solution_description, status, tags, position } = req.body;
  const s = Math.min(10, Math.max(1, parseInt(severity) || risk.severity));
  const pr = Math.min(10, Math.max(1, parseInt(probability) || risk.probability));
  const d = Math.min(10, Math.max(1, parseInt(detectability) || risk.detectability));
  const validStatus = ['Open', 'Resolved'].includes(status) ? status : risk.status;
  const tagsArr = tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : JSON.parse(risk.tags || '[]');
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
  res.json({
    ...updated,
    tags: JSON.parse(updated.tags),
    photos: JSON.parse(updated.photos || '[]'),
    solution_photos: JSON.parse(updated.solution_photos || '[]'),
    rpn: computeRpn(updated.severity, updated.probability, updated.detectability),
  });
});

// DELETE /api/risks/:id
router.delete('/:id', requireAuth, (req, res) => {
  const risk = db.prepare(`
    SELECT r.* FROM risks r
    JOIN buckets b ON r.bucket_id = b.id
    JOIN projects p ON b.project_id = p.id
    WHERE r.id = ? AND p.user_id = ?
  `).get(req.params.id, req.user.userId);
  if (!risk) return res.status(404).json({ error: 'Risk not found' });

  db.prepare('DELETE FROM risks WHERE id = ?').run(risk.id);
  res.json({ message: 'Risk deleted' });
});

module.exports = router;
