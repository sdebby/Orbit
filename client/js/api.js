const BASE = '/api';

export async function request(method, path, body, formData) {
  const headers = {};

  let reqBody;
  if (formData) {
    reqBody = formData;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    reqBody = JSON.stringify(body);
  }

  const res = await fetch(BASE + path, { method, headers, body: reqBody, credentials: 'include' });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // Auto-redirect to login on auth failure (expired/invalid cookie)
    if (res.status === 401 && !path.startsWith('/auth/')) {
      localStorage.removeItem('orbit_user');
      document.cookie = 'orbit_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Strict';
      window.location.hash = '#/login';
    }
    const err = new Error(data.error || `Request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  // Auth
  register: (email, password) => request('POST', '/auth/register', { email, password }),
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  me: () => request('GET', '/auth/me'),
  forgotPassword: (email) => request('POST', '/auth/forgot-password', { email }),
  validateResetToken: (token) => request('GET', `/auth/validate-reset-token/${token}`),
  resetPassword: (token, password) => request('POST', `/auth/reset-password/${token}`, { password }),
  verifyEmail: (token) => request('POST', `/auth/verify-email/${token}`),

  // Feedback
  sendFeedback: (message) => request('POST', '/feedback', { message }),

  // Profile
  updateProfile: (formData) => request('PUT', '/profile', null, formData),
  deleteAccount: () => request('DELETE', '/profile'),
  exportData: async ({ projects = true, templates = true, workspaces = true } = {}) => {
    const params = new URLSearchParams();
    if (!projects)   params.set('projects',   '0');
    if (!templates)  params.set('templates',  '0');
    if (!workspaces) params.set('workspaces', '0');
    const qs = params.toString();
    const res = await fetch(BASE + '/profile/export' + (qs ? '?' + qs : ''), { credentials: 'include' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Export failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orbit-export-${new Date().toISOString().split('T')[0]}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // Projects
  getProjects: (q, tags, workspace) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tags) params.set('tags', tags);
    if (workspace !== undefined && workspace !== 'all') params.set('workspace', workspace);
    const qs = params.toString();
    return request('GET', `/projects${qs ? '?' + qs : ''}`);
  },
  createProject: (formData) => request('POST', '/projects', null, formData),
  getProject: (id) => request('GET', `/projects/${id}`),
  updateProject: (id, formData) => request('PUT', `/projects/${id}`, null, formData),
  toggleFavorite: (id) => request('PUT', `/projects/${id}/favorite`),
  deleteProject: (id) => request('DELETE', `/projects/${id}`),

  // Workspaces
  getWorkspaces: () => request('GET', '/workspaces'),
  createWorkspace: (data) => request('POST', '/workspaces', data),
  updateWorkspace: (id, data) => request('PUT', `/workspaces/${id}`, data),
  deleteWorkspace: (id) => request('DELETE', `/workspaces/${id}`),

  // Buckets
  getBuckets: (projectId) => request('GET', `/projects/${projectId}/buckets`),
  createBucket: (projectId, data) => request('POST', `/projects/${projectId}/buckets`, data),
  updateBucket: (id, data) => request('PUT', `/buckets/${id}`, data),
  deleteBucket: (id) => request('DELETE', `/buckets/${id}`),

  // Tasks
  getTasks: (bucketId) => request('GET', `/buckets/${bucketId}/tasks`),
  getTask: (id) => request('GET', `/tasks/${id}`),
  createTask: (bucketId, data) => data instanceof FormData
    ? request('POST', `/buckets/${bucketId}/tasks`, null, data)
    : request('POST', `/buckets/${bucketId}/tasks`, data),
  updateTask: (id, data) => data instanceof FormData
    ? request('PUT', `/tasks/${id}`, null, data)
    : request('PUT', `/tasks/${id}`, data),
  deleteTask: (id) => request('DELETE', `/tasks/${id}`),
  getOverdueTasks: (projectId) =>
    request('GET', `/tasks/overdue${projectId ? `?projectId=${projectId}` : ''}`),

  // Checklists
  getChecklists: (taskId) => request('GET', `/tasks/${taskId}/checklists`),
  createChecklist: (taskId, text) => request('POST', `/tasks/${taskId}/checklists`, { text }),
  updateChecklist: (id, data) => request('PUT', `/checklists/${id}`, data),
  deleteChecklist: (id) => request('DELETE', `/checklists/${id}`),

  // Templates
  getTemplates:   ()       => request('GET',    '/templates'),
  createTemplate: (data)   => request('POST',   '/templates', data),
  updateTemplate: (id, data) => request('PUT',  `/templates/${id}`, data),
  deleteTemplate: (id)     => request('DELETE', `/templates/${id}`),

  // Risks
  getRisks: (projectId) => request('GET', `/projects/${projectId}/risks`),
  createRisk: (projectId, data) => data instanceof FormData
    ? request('POST', `/projects/${projectId}/risks`, null, data)
    : request('POST', `/projects/${projectId}/risks`, data),
  updateRisk: (id, data) => data instanceof FormData
    ? request('PUT', `/risks/${id}`, null, data)
    : request('PUT', `/risks/${id}`, data),
  deleteRisk: (id) => request('DELETE', `/risks/${id}`),
};
