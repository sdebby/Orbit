import { api } from '../api.js';
import { toast, escHtml } from '../utils.js';
import { navigate } from '../router.js';
import { navbarHtml, setupNavbar } from './projects.js';

let searchTimeout = null;
let currentPage = 1;
let statsInterval = null;

export async function renderAdmin(app) {
  // Check admin access client-side (server enforces it too)
  const user = JSON.parse(localStorage.getItem('orbit_user') || '{}');
  if (!user.isAdmin) {
    navigate('/projects');
    return;
  }

  if (statsInterval) clearInterval(statsInterval);

  app.innerHTML = `
    <div class="app-layout">
      ${navbarHtml()}
      <div class="projects-subbar">
        <h1 class="projects-subbar-title">Admin Panel</h1>
      </div>
      <div class="page-content">
        <div class="admin-stats-grid" id="admin-stats">
          <div class="spinner-wrap" style="height:100px"><div class="spinner"></div></div>
        </div>
        <div class="admin-users-section">
          <div class="admin-users-header">
            <h2>Users</h2>
            <div class="projects-search-box">
              <div class="projects-search-icon"></div>
              <input type="search" id="admin-search" placeholder="Search users…" />
            </div>
          </div>
          <div id="admin-users-table">
            <div class="spinner-wrap" style="height:200px"><div class="spinner"></div></div>
          </div>
          <div class="admin-pagination" id="admin-pagination"></div>
        </div>
      </div>
    </div>
  `;

  setupNavbar();
  loadStats();
  loadUsers();

  statsInterval = setInterval(loadStats, 30000);

  document.getElementById('admin-search').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    currentPage = 1;
    searchTimeout = setTimeout(() => loadUsers(e.target.value), 300);
  });
}

async function loadStats() {
  const el = document.getElementById('admin-stats');
  if (!el) { clearInterval(statsInterval); return; }
  try {
    const s = await api.getAdminStats();
    el.innerHTML = `
      <div class="admin-stat-card">
        <div class="admin-stat-number">${s.totalUsers}</div>
        <div class="admin-stat-label">Total Users</div>
      </div>
      <div class="admin-stat-card accent">
        <div class="admin-stat-number">${s.onlineNow}</div>
        <div class="admin-stat-label">Online Now</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-number">${s.registeredToday}</div>
        <div class="admin-stat-label">Registered Today</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-number">${s.registeredLast7Days}</div>
        <div class="admin-stat-label">Last 7 Days</div>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<p style="color:var(--red)">${escHtml(err.message)}</p>`;
  }
}

async function loadUsers(q = '') {
  const el = document.getElementById('admin-users-table');
  if (!el) return;
  try {
    const data = await api.getAdminUsers(q, currentPage);
    renderUsersTable(el, data.users);
    renderPagination(data.page, data.totalPages);
  } catch (err) {
    el.innerHTML = `<p style="color:var(--red)">${escHtml(err.message)}</p>`;
  }
}

function formatRelative(epoch) {
  if (!epoch) return '<span class="text-muted">Never</span>';
  const diff = Math.floor(Date.now() / 1000) - epoch;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(epoch * 1000).toLocaleDateString();
}

function formatDateShort(epoch) {
  if (!epoch) return '—';
  return new Date(epoch * 1000).toLocaleDateString();
}

function renderUsersTable(el, users) {
  if (!users.length) {
    el.innerHTML = '<p class="text-muted" style="padding:16px">No users found.</p>';
    return;
  }

  const currentUser = JSON.parse(localStorage.getItem('orbit_user') || '{}');

  el.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th></th>
          <th>Email</th>
          <th>Username</th>
          <th>Registered</th>
          <th>Last Active</th>
          <th>Verified</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${users.map(u => {
          const initial = (u.username || u.email || '?').charAt(0).toUpperCase();
          const avatar = u.profilePicture
            ? `<img src="${escHtml(u.profilePicture)}" alt="" class="admin-user-avatar" />`
            : `<span class="admin-user-avatar admin-avatar-initial">${escHtml(initial)}</span>`;
          const isSelf = u.id === currentUser.userId;
          return `
            <tr>
              <td>${avatar}</td>
              <td>${escHtml(u.email || '')}${isSelf ? ' <span class="admin-you-badge">you</span>' : ''}</td>
              <td>${escHtml(u.username || '—')}</td>
              <td>${formatDateShort(u.createdAt)}</td>
              <td>${formatRelative(u.lastActive)}</td>
              <td>${u.emailVerified ? '<span class="admin-verified">&#10003;</span>' : '<span class="admin-unverified">&#10007;</span>'}</td>
              <td class="admin-actions">
                ${isSelf ? '' : `
                  <button class="btn btn-sm btn-outline admin-reset-btn" data-id="${u.id}" data-email="${escHtml(u.email || '')}">Send Reset Email</button>
                  <button class="btn btn-sm btn-danger admin-delete-btn" data-id="${u.id}" data-email="${escHtml(u.email || '')}">Delete</button>
                `}
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  el.querySelectorAll('.admin-reset-btn').forEach(btn => {
    btn.addEventListener('click', () => sendResetEmail(btn.dataset.id, btn.dataset.email));
  });

  el.querySelectorAll('.admin-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteUser(btn.dataset.id, btn.dataset.email));
  });
}

function renderPagination(page, totalPages) {
  const el = document.getElementById('admin-pagination');
  if (!el || totalPages <= 1) { if (el) el.innerHTML = ''; return; }

  el.innerHTML = `
    <button class="btn btn-sm btn-outline" id="admin-prev" ${page <= 1 ? 'disabled' : ''}>Previous</button>
    <span class="admin-page-info">Page ${page} of ${totalPages}</span>
    <button class="btn btn-sm btn-outline" id="admin-next" ${page >= totalPages ? 'disabled' : ''}>Next</button>
  `;

  document.getElementById('admin-prev')?.addEventListener('click', () => {
    currentPage = Math.max(1, currentPage - 1);
    loadUsers(document.getElementById('admin-search')?.value || '');
  });
  document.getElementById('admin-next')?.addEventListener('click', () => {
    currentPage++;
    loadUsers(document.getElementById('admin-search')?.value || '');
  });
}

async function sendResetEmail(userId, email) {
  if (!confirm(`Send a password reset email to "${email}"?`)) return;
  try {
    await api.adminResetPassword(userId);
    toast('Password reset email sent');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteUser(userId, email) {
  if (!confirm(`Delete user "${email}"? This will permanently remove all their data.`)) return;
  try {
    await api.adminDeleteUser(userId);
    toast('User deleted');
    loadStats();
    loadUsers(document.getElementById('admin-search')?.value || '');
  } catch (err) {
    toast(err.message, 'error');
  }
}
