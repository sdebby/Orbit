const db = require('../models/db');

// If the recipient has workspaces enabled, return the id of their "Shared Projects"
// workspace, creating it if necessary. Returns null when workspaces are disabled
// (so shares land in the recipient's unassigned bucket).
function getOrCreateSharedWorkspace(userId) {
  const user = db.prepare('SELECT workspaces_enabled FROM users WHERE id = ?').get(userId);
  if (!user || !user.workspaces_enabled) return null;

  const existing = db.prepare(
    "SELECT id FROM workspaces WHERE user_id = ? AND name = 'Shared Projects' LIMIT 1"
  ).get(userId);
  if (existing) return existing.id;

  const maxPos = db.prepare('SELECT MAX(position) AS m FROM workspaces WHERE user_id = ?').get(userId);
  const position = (maxPos.m || 0) + 1;
  const result = db.prepare(
    "INSERT INTO workspaces (user_id, name, position) VALUES (?, 'Shared Projects', ?)"
  ).run(userId, position);
  return result.lastInsertRowid;
}

// Assign a fresh project_shares row to the recipient's "Shared Projects" workspace.
// No-op when workspaces are disabled for that user.
function assignShareToSharedWorkspace(userId, projectId) {
  const wsId = getOrCreateSharedWorkspace(userId);
  if (!wsId) return;
  db.prepare(
    'UPDATE project_shares SET workspace_id = ? WHERE project_id = ? AND user_id = ? AND workspace_id IS NULL'
  ).run(wsId, projectId, userId);
}

// Promote every pending_share matching `emailHash` into a real project_shares
// row owned by `userId`. Idempotent — safe to call on every login / /me.
// Returns the number of promoted invites.
function promotePendingShares(userId, emailHash) {
  if (!userId || !emailHash) return 0;
  const pending = db.prepare(
    'SELECT id, project_id, role FROM pending_shares WHERE invited_email_hash = ?'
  ).all(emailHash);
  if (!pending.length) return 0;

  let promoted = 0;
  for (const p of pending) {
    // Skip if a share already exists (e.g. owner re-invited after the user signed up)
    const existing = db.prepare(
      'SELECT id FROM project_shares WHERE project_id = ? AND user_id = ?'
    ).get(p.project_id, userId);
    if (!existing) {
      try {
        db.prepare('INSERT INTO project_shares (project_id, user_id, role) VALUES (?, ?, ?)')
          .run(p.project_id, userId, p.role);
        assignShareToSharedWorkspace(userId, p.project_id);
        promoted++;
      } catch (e) { /* ignore — best-effort promotion */ }
    }
    db.prepare('DELETE FROM pending_shares WHERE id = ?').run(p.id);
  }
  return promoted;
}

module.exports = { promotePendingShares, assignShareToSharedWorkspace, getOrCreateSharedWorkspace };
