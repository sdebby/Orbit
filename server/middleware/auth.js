const jwt = require('jsonwebtoken');
const db = require('../models/db');

if (!process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is required. Set it in .env before starting the server.');
}
const JWT_SECRET = process.env.JWT_SECRET;

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

function extractToken(req) {
  // 1. Bearer header (for backward compat / API clients)
  const header = req.headers['authorization'];
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  // 2. HttpOnly cookie (primary auth mechanism)
  return parseCookie(req.headers.cookie, 'orbit_token');
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    req.token = token;

    // Verify token_version matches — rejects tokens issued before a password reset/change
    const row = db.prepare('SELECT token_version, status FROM users WHERE id = ?').get(req.user.userId);
    if (!row) return res.status(401).json({ error: 'User not found' });
    if ((req.user.tokenVersion || 0) !== (row.token_version || 0)) {
      return res.status(401).json({ error: 'Session expired — please sign in again' });
    }
    if (row.status === 'banned') {
      return res.status(403).json({ error: 'Your account has been banned' });
    }
    if (row.status === 'deactivated') {
      return res.status(403).json({ error: 'Your account has been deactivated' });
    }

    db.prepare('UPDATE users SET last_active = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), req.user.userId);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Cache admin email hash at startup to avoid recomputing on every request
const { sha512 } = require('../utils/hash');
let _cachedAdminHash = null;
function getAdminEmailHash() {
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;
  if (!superAdminEmail) return null;
  if (!_cachedAdminHash) _cachedAdminHash = sha512(superAdminEmail.toLowerCase().trim());
  return _cachedAdminHash;
}

function requireAdmin(req, res, next) {
  const adminHash = getAdminEmailHash();
  if (!adminHash) return res.status(403).json({ error: 'Forbidden' });

  const user = db.prepare('SELECT email_hash FROM users WHERE id = ?').get(req.user.userId);

  if (!user || user.email_hash !== adminHash) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

function signToken(userId, tokenVersion) {
  return jwt.sign({ userId, tokenVersion: tokenVersion || 0 }, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { requireAuth, requireAdmin, signToken, getAdminEmailHash, parseCookie };
