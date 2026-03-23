const BASE = '/api';

async function request(method, path, body, formData) {
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
  resetPassword: (token, password) => request('POST', `/auth/reset-password/${token}`, { password }),
  verifyEmail: (token) => request('GET', `/auth/verify-email/${token}`),

  // Profile
  updateProfile: (formData) => request('PUT', '/profile', null, formData),
  deleteAccount: () => request('DELETE', '/profile'),

  // Projects
  getProjects: (q, tags) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tags) params.set('tags', tags);
    const qs = params.toString();
    return request('GET', `/projects${qs ? '?' + qs : ''}`);
  },
  createProject: (formData) => request('POST', '/projects', null, formData),
  getProject: (id) => request('GET', `/projects/${id}`),
  updateProject: (id, formData) => request('PUT', `/projects/${id}`, null, formData),
  toggleFavorite: (id) => request('PUT', `/projects/${id}/favorite`),
  deleteProject: (id) => request('DELETE', `/projects/${id}`),

  // Buckets
  getBuckets: (projectId) => request('GET', `/projects/${projectId}/buckets`),
  createBucket: (projectId, data) => request('POST', `/projects/${projectId}/buckets`, data),
  updateBucket: (id, data) => request('PUT', `/buckets/${id}`, data),
  deleteBucket: (id) => request('DELETE', `/buckets/${id}`),

  // Tasks
  getTasks: (bucketId) => request('GET', `/buckets/${bucketId}/tasks`),
  createTask: (bucketId, data) => data instanceof FormData
    ? request('POST', `/buckets/${bucketId}/tasks`, null, data)
    : request('POST', `/buckets/${bucketId}/tasks`, data),
  updateTask: (id, data) => data instanceof FormData
    ? request('PUT', `/tasks/${id}`, null, data)
    : request('PUT', `/tasks/${id}`, data),
  deleteTask: (id) => request('DELETE', `/tasks/${id}`),

  // Admin
  getAdminStats: () => request('GET', '/admin/stats'),
  getAdminUsers: (q, page) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (page) params.set('page', page);
    const qs = params.toString();
    return request('GET', `/admin/users${qs ? '?' + qs : ''}`);
  },
  adminDeleteUser: (id) => request('DELETE', `/admin/users/${id}`),
  adminResetPassword: (id) => request('POST', `/admin/users/${id}/reset-password`),

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
