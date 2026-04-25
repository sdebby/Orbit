require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.APP_URL || 'http://localhost:3000';

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: true,
  hsts: true,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
}));

// CORS — restrict to known origin only
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// CSRF defense: reject state-changing requests whose Origin/Referer doesn't match.
// Bearer-token requests are exempt — CSRF only applies to cookie-based auth.
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const authHeader = req.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) return next();

    const origin = req.get('Origin') || req.get('Referer') || '';
    if (!origin) return res.status(403).json({ error: 'Forbidden' });
    if (!origin.startsWith(ALLOWED_ORIGIN)) return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Static files — uploads require authentication AND ownership of the referencing resource
const jwt = require('jsonwebtoken');
const db = require('./models/db');
const { getAdminEmailHash, parseCookie } = require('./middleware/auth');

const UPLOAD_FILENAME_RE = /^\/[a-zA-Z0-9][\w\-\.]*\.(jpg|jpeg|png)$/i;

function userOwnsUpload(userId, filepath) {
  if (db.prepare('SELECT 1 AS x FROM users WHERE id = ? AND profile_picture = ?').get(userId, filepath)) return true;
  if (db.prepare('SELECT 1 AS x FROM projects WHERE picture = ? AND user_id = ?').get(filepath, userId)) return true;
  if (db.prepare(`
    SELECT 1 AS x FROM tasks t
    JOIN buckets b ON t.bucket_id = b.id
    JOIN projects p ON b.project_id = p.id
    WHERE t.picture = ? AND p.user_id = ?
  `).get(filepath, userId)) return true;
  // Risk photos / solution_photos are stored as JSON arrays of paths.
  // The path regex permits no quotes/backslashes, so a quoted needle uniquely matches one element.
  const jsonNeedle = `%"${filepath}"%`;
  if (db.prepare(`
    SELECT 1 AS x FROM risks r
    JOIN projects p ON r.project_id = p.id
    WHERE p.user_id = ? AND (r.photos LIKE ? OR r.solution_photos LIKE ?)
  `).get(userId, jsonNeedle, jsonNeedle)) return true;
  return false;
}

app.use('/uploads', (req, res, next) => {
  const token = parseCookie(req.headers.cookie, 'orbit_token');
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  let payload;
  try { payload = jwt.verify(token, process.env.JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Invalid token' }); }

  const user = db.prepare('SELECT token_version, email_hash, status FROM users WHERE id = ?').get(payload.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  if ((payload.tokenVersion || 0) !== (user.token_version || 0)) {
    return res.status(401).json({ error: 'Session expired' });
  }
  if (user.status === 'banned' || user.status === 'deactivated') {
    return res.status(403).json({ error: 'Account not active' });
  }

  if (!UPLOAD_FILENAME_RE.test(req.path)) return res.status(400).json({ error: 'Invalid path' });

  const adminHash = getAdminEmailHash();
  if (adminHash && user.email_hash === adminHash) return next();

  if (userOwnsUpload(payload.userId, `/uploads${req.path}`)) return next();

  return res.status(403).json({ error: 'Forbidden' });
}, express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'client')));

// Rate limiters for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests, please try again later' },
});

const verifyEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts, please try again later' },
});

const profileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many profile requests, please try again later' },
});

// API Routes
app.use('/api/auth/verify-email', verifyEmailLimiter);
app.use('/api/auth/forgot-password', forgotPasswordLimiter);
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/projects/:projectId/buckets', require('./routes/buckets'));
app.use('/api/buckets/:bucketId/tasks', require('./routes/tasks'));
app.use('/api/projects/:projectId/risks', require('./routes/risks'));
app.use('/api/profile', profileLimiter, require('./routes/profile'));
app.use('/api/admin', require('./routes/admin'));

app.use('/api/templates', require('./routes/templates'));

// Standalone bucket/task/risk/checklist routes (without prefix context)
app.use('/api/buckets', require('./routes/buckets'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/risks', require('./routes/risks'));
app.use('/api/checklists', require('./routes/checklists'));

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
  }
});

// Global error handler
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large' });
  }
  if (err.code === 'LIMIT_FIELD_VALUE') {
    return res.status(400).json({ error: 'Field value too large' });
  }
  if (err.status === 413 || err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }
  if (err.message && err.message.startsWith('Only .jpg')) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const { startReminderScheduler } = require('./utils/reminderScheduler');

app.listen(PORT, () => {
  startReminderScheduler();
  console.log(`Orbit server running on ${ALLOWED_ORIGIN}`);
  if (ALLOWED_ORIGIN.includes('localhost')) {
    console.log(`\n⚠  APP_URL is set to ${ALLOWED_ORIGIN}`);
    console.log(`   If accessing from an external IP or domain, update APP_URL in .env to match.\n`);
  }
});
