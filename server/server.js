require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
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

// API Routes
app.use('/api/auth/forgot-password', forgotPasswordLimiter);
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/projects/:projectId/buckets', require('./routes/buckets'));
app.use('/api/buckets/:bucketId/tasks', require('./routes/tasks'));
app.use('/api/projects/:projectId/risks', require('./routes/risks'));
app.use('/api/profile', require('./routes/profile'));

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
  console.log(`Orbit server running on http://localhost:${PORT}`);
});
