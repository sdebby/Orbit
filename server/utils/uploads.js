const fs = require('fs');
const path = require('path');
const db = require('../models/db');

const UPLOAD_DIR = path.resolve(__dirname, '..', 'uploads');
const UPLOAD_PATH_RE = /^\/uploads\/[\w\-\.]+$/;

function pushFromJsonArray(field, out) {
  if (!field) return;
  let arr;
  try { arr = JSON.parse(field); } catch { return; }
  if (!Array.isArray(arr)) return;
  for (const item of arr) {
    if (typeof item === 'string') out.push(item);
  }
}

function collectUserUploadPaths(userId) {
  const paths = [];

  const user = db.prepare('SELECT profile_picture FROM users WHERE id = ?').get(userId);
  if (user?.profile_picture) paths.push(user.profile_picture);

  const projects = db.prepare('SELECT picture FROM projects WHERE user_id = ?').all(userId);
  for (const p of projects) if (p.picture) paths.push(p.picture);

  const tasks = db.prepare(`
    SELECT t.picture FROM tasks t
    JOIN buckets b ON t.bucket_id = b.id
    JOIN projects p ON b.project_id = p.id
    WHERE p.user_id = ?
  `).all(userId);
  for (const t of tasks) if (t.picture) paths.push(t.picture);

  const risks = db.prepare(`
    SELECT r.photos, r.solution_photos FROM risks r
    JOIN projects p ON r.project_id = p.id
    WHERE p.user_id = ?
  `).all(userId);
  for (const r of risks) {
    pushFromJsonArray(r.photos, paths);
    pushFromJsonArray(r.solution_photos, paths);
  }

  return paths;
}

function deleteUploadFiles(paths) {
  for (const p of paths) {
    if (typeof p !== 'string' || !UPLOAD_PATH_RE.test(p)) continue;
    const resolved = path.resolve(UPLOAD_DIR, path.basename(p));
    if (resolved !== UPLOAD_DIR && !resolved.startsWith(UPLOAD_DIR + path.sep)) continue;
    fs.unlink(resolved, (err) => {
      if (err && err.code !== 'ENOENT') {
        console.error(`[uploads] failed to delete ${resolved}: ${err.message}`);
      }
    });
  }
}

function deleteUserUploads(userId) {
  const paths = collectUserUploadPaths(userId);
  deleteUploadFiles(paths);
}

module.exports = { collectUserUploadPaths, deleteUploadFiles, deleteUserUploads };
