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
  crossOriginResourcePolicy: false,
  hsts: false,
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

// CSRF defense: reject state-changing requests whose Origin doesn't match
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const origin = req.get('Origin') || req.get('Referer') || '';
    if (origin && !origin.startsWith(ALLOWED_ORIGIN)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  next();
});

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Static files — uploads require authentication via HttpOnly cookie
const jwt = require('jsonwebtoken');
app.use('/uploads', (req, res, next) => {
  const cookie = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith('orbit_token='));
  const token = cookie ? cookie.split('=')[1] : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    jwt.verify(token, process.env.JWT_SECRET || 'orbit-dev-secret-change-in-production');
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
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

// Standalone bucket/task/risk routes (without prefix context)
app.use('/api/buckets', require('./routes/buckets'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/risks', require('./routes/risks'));

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
  if (err.message && err.message.startsWith('Only .jpg')) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Orbit server running on ${ALLOWED_ORIGIN}`);
  if (ALLOWED_ORIGIN.includes('localhost')) {
    console.log(`\n⚠  APP_URL is set to ${ALLOWED_ORIGIN}`);
    console.log(`   If accessing from an external IP or domain, update APP_URL in .env to match.\n`);
  }
});
