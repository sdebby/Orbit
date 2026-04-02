import { api } from '../api.js';
import { toast, escHtml } from '../utils.js';
import { navigate } from '../router.js';
import { navbarHtml, setupNavbar } from './projects.js';

let searchTimeout = null;
let currentPage = 1;
let statsInterval = null;
let selectedIds = new Set();

export async function renderAdmin(app) {
  // Check admin access client-side (server enforces it too)
  const user = JSON.parse(localStorage.getItem('orbit_user') || '{}');
  if (!user.isAdmin) {
    navigate('/projects');
    return;
  }

  if (statsInterval) clearInterval(statsInterval);
  selectedIds.clear();

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
          <div class="admin-bulk-bar" id="admin-bulk-bar" style="display:none">
            <span id="admin-selected-count">0 selected</span>
            <button class="btn btn-sm btn-danger" id="admin-bulk-delete">Delete Selected</button>
            <button class="btn btn-sm btn-outline" id="admin-bulk-clear">Clear Selection</button>
          </div>
          <div id="admin-users-table">
            <div class="spinner-wrap" style="height:200px"><div class="spinner"></div></div>
          </div>
          <div class="admin-pagination" id="admin-pagination"></div>
        </div>
      </div>
    </div>
    <div class="admin-drawer-backdrop" id="admin-drawer-backdrop"></div>
    <aside class="admin-drawer" id="admin-drawer" aria-label="User details">
      <button class="admin-drawer-close" id="admin-drawer-close" title="Close">&#10005;</button>
      <div class="admin-drawer-content" id="admin-drawer-content"></div>
    </aside>
  `;

  setupNavbar();
  loadStats();
  loadUsers();

  document.getElementById('admin-drawer-close').addEventListener('click', closeDrawer);
  document.getElementById('admin-drawer-backdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') closeDrawer();
    if (!document.getElementById('admin-drawer')) document.removeEventListener('keydown', onEsc);
  });

  statsInterval = setInterval(loadStats, 30000);

  document.getElementById('admin-search').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    currentPage = 1;
    searchTimeout = setTimeout(() => loadUsers(e.target.value), 300);
  });

  document.getElementById('admin-bulk-delete').addEventListener('click', bulkDelete);
  document.getElementById('admin-bulk-clear').addEventListener('click', () => {
    selectedIds.clear();
    updateBulkBar();
    document.querySelectorAll('.admin-row-cb').forEach(cb => cb.checked = false);
    const selectAll = document.getElementById('admin-select-all');
    if (selectAll) selectAll.checked = false;
  });
}

function updateBulkBar() {
  const bar = document.getElementById('admin-bulk-bar');
  if (!bar) return;
  if (selectedIds.size > 0) {
    bar.style.display = '';
    document.getElementById('admin-selected-count').textContent = `${selectedIds.size} selected`;
  } else {
    bar.style.display = 'none';
  }
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
      <div class="admin-stat-card">
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
  const selectableIds = users.filter(u => u.id !== currentUser.userId).map(u => u.id);

  el.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th class="admin-cb-col"><input type="checkbox" id="admin-select-all" title="Select all" /></th>
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
              <td class="admin-cb-col">
                ${isSelf ? '' : `<input type="checkbox" class="admin-row-cb" data-id="${u.id}" ${selectedIds.has(u.id) ? 'checked' : ''} />`}
              </td>
              <td>${avatar}</td>
              <td>${escHtml(u.email || '')}${isSelf ? ' <span class="admin-you-badge">you</span>' : ''}</td>
              <td>${escHtml(u.username || '—')}</td>
              <td>${formatDateShort(u.createdAt)}</td>
              <td>${formatRelative(u.lastActive)}</td>
              <td>${u.emailVerified ? '<span class="admin-verified">&#10003;</span>' : '<span class="admin-unverified">&#10007;</span>'}</td>
              <td class="admin-actions">
                ${isSelf
                  ? `<span class="admin-self-lock">&#128274; Your account</span>`
                  : `<button class="btn btn-sm btn-outline admin-reset-btn" data-id="${u.id}" data-email="${escHtml(u.email || '')}">Send Reset Email</button>
                     <button class="btn btn-sm btn-danger admin-delete-btn" data-id="${u.id}" data-email="${escHtml(u.email || '')}">Delete</button>`
                }
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  // Select-all checkbox
  const selectAllCb = document.getElementById('admin-select-all');
  selectAllCb.checked = selectableIds.length > 0 && selectableIds.every(id => selectedIds.has(id));
  selectAllCb.addEventListener('change', (e) => {
    if (e.target.checked) {
      selectableIds.forEach(id => selectedIds.add(id));
    } else {
      selectableIds.forEach(id => selectedIds.delete(id));
    }
    el.querySelectorAll('.admin-row-cb').forEach(cb => cb.checked = e.target.checked);
    updateBulkBar();
  });

  // Row checkboxes
  el.querySelectorAll('.admin-row-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = parseInt(cb.dataset.id);
      if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
      selectAllCb.checked = selectableIds.every(id => selectedIds.has(id));
      updateBulkBar();
    });
  });

  el.querySelectorAll('.admin-reset-btn').forEach(btn => {
    btn.addEventListener('click', () => sendResetEmail(btn.dataset.id, btn.dataset.email));
  });

  el.querySelectorAll('.admin-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteUser(btn.dataset.id, btn.dataset.email));
  });

  // Row click → user detail drawer (skip clicks on checkboxes, buttons, or the cb column)
  el.querySelectorAll('tbody tr').forEach((tr, i) => {
    const user = users[i];
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button, input, .admin-cb-col')) return;
      openDrawer(user);
    });
  });

  updateBulkBar();
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
    selectedIds.delete(parseInt(userId));
    loadStats();
    loadUsers(document.getElementById('admin-search')?.value || '');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function closeDrawer() {
  document.getElementById('admin-drawer')?.classList.remove('open');
  document.getElementById('admin-drawer-backdrop')?.classList.remove('open');
}

async function openDrawer(user) {
  const drawer = document.getElementById('admin-drawer');
  const backdrop = document.getElementById('admin-drawer-backdrop');
  const content = document.getElementById('admin-drawer-content');
  if (!drawer) return;

  const currentUser = JSON.parse(localStorage.getItem('orbit_user') || '{}');
  const isSelf = user.id === currentUser.userId;
  const initial = (user.username || user.email || '?').charAt(0).toUpperCase();
  const avatar = user.profilePicture && /^\/uploads\/[\w\-\.]+$/.test(user.profilePicture)
    ? `<img src="${escHtml(user.profilePicture)}" class="admin-drawer-avatar" />`
    : `<span class="admin-drawer-avatar admin-drawer-avatar-initial">${escHtml(initial)}</span>`;

  content.innerHTML = `
    <div class="admin-drawer-hero">
      ${avatar}
      <div class="admin-drawer-hero-info">
        <div class="admin-drawer-name">${escHtml(user.username || '—')}${isSelf ? ' <span class="admin-you-badge">you</span>' : ''}</div>
        <div class="admin-drawer-email">${escHtml(user.email || '')}</div>
      </div>
    </div>
    <dl class="admin-drawer-details">
      <dt>Registered</dt><dd>${formatDateShort(user.createdAt)}</dd>
      <dt>Last Active</dt><dd>${formatRelative(user.lastActive)}</dd>
      <dt>Email Verified</dt><dd>${user.emailVerified ? '<span class="admin-verified">&#10003; Yes</span>' : '<span class="admin-unverified">&#10007; No</span>'}</dd>
      <dt>Projects</dt><dd id="drawer-projects"><span class="spinner" style="width:12px;height:12px"></span></dd>
      <dt>Tasks</dt><dd id="drawer-tasks"><span class="spinner" style="width:12px;height:12px"></span></dd>
      <dt>Risks</dt><dd id="drawer-risks"><span class="spinner" style="width:12px;height:12px"></span></dd>
    </dl>
    ${isSelf ? `<p class="admin-drawer-self-note">&#128274; You cannot modify your own account.</p>` : `
    <div class="admin-drawer-actions">
      <button class="btn btn-outline btn-sm" id="drawer-reset-btn">Send Reset Email</button>
      <button class="btn btn-danger btn-sm" id="drawer-delete-btn">Delete User</button>
    </div>`}
  `;

  drawer.classList.add('open');
  backdrop.classList.add('open');

  // Wire actions
  document.getElementById('drawer-reset-btn')?.addEventListener('click', () => {
    closeDrawer();
    sendResetEmail(user.id, user.email);
  });
  document.getElementById('drawer-delete-btn')?.addEventListener('click', () => {
    closeDrawer();
    deleteUser(user.id, user.email);
  });

  // Load activity counts
  try {
    const detail = await api.getAdminUser(user.id);
    const pEl = document.getElementById('drawer-projects');
    const tEl = document.getElementById('drawer-tasks');
    const rEl = document.getElementById('drawer-risks');
    if (pEl) pEl.textContent = detail.projectCount;
    if (tEl) tEl.textContent = detail.taskCount;
    if (rEl) rEl.textContent = detail.riskCount;
  } catch {
    ['drawer-projects', 'drawer-tasks', 'drawer-risks'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
  }
}

async function bulkDelete() {
  if (!selectedIds.size) return;
  if (!confirm(`Delete ${selectedIds.size} user(s)? This will permanently remove all their data.`)) return;
  try {
    const result = await api.adminBulkDeleteUsers([...selectedIds]);
    toast(result.message);
    selectedIds.clear();
    loadStats();
    loadUsers(document.getElementById('admin-search')?.value || '');
  } catch (err) {
    toast(err.message, 'error');
  }
}
