const db = require('../models/db');

// Returns the project row if userId is the owner, otherwise null.
function getOwnedProject(userId, projectId) {
  return db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
}

// Returns 'owner' | 'editor' | 'viewer' | null
function getProjectRole(userId, projectId) {
  const owned = db.prepare('SELECT 1 AS x FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
  if (owned) return 'owner';
  const share = db.prepare('SELECT role FROM project_shares WHERE project_id = ? AND user_id = ?').get(projectId, userId);
  return share ? share.role : null;
}

// Can the user see this project at all?
function canViewProject(userId, projectId) {
  return getProjectRole(userId, projectId) !== null;
}

// Can the user mutate buckets/tasks/risks/checklists inside this project?
// Editors and owners can; viewers cannot.
function canEditProject(userId, projectId) {
  const role = getProjectRole(userId, projectId);
  return role === 'owner' || role === 'editor';
}

// Owner-only: rename project, change picture, delete, manage shares.
function isProjectOwner(userId, projectId) {
  return getProjectRole(userId, projectId) === 'owner';
}

// SQL fragment: projects the user can VIEW. Use with `id IN (<fragment>)` and
// bind userId twice.
const VIEWABLE_PROJECT_IDS_SQL = `
  SELECT id FROM projects WHERE user_id = ?
  UNION
  SELECT project_id FROM project_shares WHERE user_id = ?
`;

module.exports = {
  getOwnedProject,
  getProjectRole,
  canViewProject,
  canEditProject,
  isProjectOwner,
  VIEWABLE_PROJECT_IDS_SQL,
};
