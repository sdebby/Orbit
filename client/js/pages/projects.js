import { api } from '../api.js';
import { toast, showModal, hideModal, tagsInput, tagsHtml, escHtml, formatDate } from '../utils.js';
import { navigate } from '../router.js';

let searchTimeout = null;
let activeWorkspace = 'all';
let workspacesCache = [];

const LAST_WORKSPACE_KEY = 'orbit_last_workspace';

function setActiveWorkspace(val) {
  activeWorkspace = val;
  localStorage.setItem(LAST_WORKSPACE_KEY, val);
}

export async function renderProjects(app) {
  activeWorkspace = localStorage.getItem(LAST_WORKSPACE_KEY) || 'all';
  const user = JSON.parse(localStorage.getItem('orbit_user') || '{}');
  const wsEnabled = !!user.workspacesEnabled;

  app.innerHTML = `
    <div class="app-layout">
      ${navbarHtml()}
      ${wsEnabled ? `
      <div class="workspace-tabs-bar">
        <div class="workspace-tabs" id="workspace-tabs"></div>
        <button class="workspace-add-btn" id="workspace-add-btn" title="New Workspace">+</button>
      </div>` : ''}
      <div class="projects-subbar">
        <h1 class="projects-subbar-title">My Projects</h1>
        <div class="projects-subbar-right">
          <div class="projects-search-box">
            <div class="projects-search-icon"></div>
            <input type="search" id="project-search" placeholder="Search projects…" />
          </div>
          <button class="projects-add-btn" id="new-project-btn" title="New Project">+</button>
        </div>
      </div>
      <div class="page-content">
        <div id="projects-grid" class="projects-grid">
          <div class="spinner-wrap" style="height:200px"><div class="spinner"></div></div>
        </div>
      </div>
    </div>
  `;

  setupNavbar();

  if (wsEnabled) {
    await loadWorkspaceTabs();
  }

  loadProjects();

  document.getElementById('project-search').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadProjects(e.target.value), 300);
  });

  document.getElementById('new-project-btn').addEventListener('click', () => showProjectModal());
}

// ---- Workspace tabs ----

const WS_ICONS = ['💼','🏠','🎯','🚀','📚','💡','⭐','🔧','🎨','📊'];

async function loadWorkspaceTabs() {
  try {
    workspacesCache = await api.getWorkspaces();
  } catch {
    workspacesCache = [];
  }
  if (activeWorkspace !== 'all' && !workspacesCache.some(w => String(w.id) === activeWorkspace)) {
    setActiveWorkspace('all');
  }
  renderWorkspaceTabs();
}

function renderWorkspaceTabs() {
  const container = document.getElementById('workspace-tabs');
  if (!container) return;

  const wsTabs = workspacesCache.map(ws => `
    <button class="ws-tab ${activeWorkspace === String(ws.id) ? 'active' : ''}" data-ws="${ws.id}">
      ${ws.icon ? `<span class="ws-icon">${escHtml(ws.icon)}</span>` : ws.color ? `<span class="ws-dot" style="background:${escHtml(ws.color)}"></span>` : ''}
      ${escHtml(ws.name)}
      <span class="ws-tab-menu-btn" data-wsid="${ws.id}" title="Workspace options">&#8942;</span>
    </button>
  `).join('');

  container.innerHTML = wsTabs;

  container.querySelectorAll('.ws-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      if (e.target.closest('.ws-tab-menu-btn')) return;
      setActiveWorkspace(tab.dataset.ws);
      renderWorkspaceTabs();
      loadProjects(document.getElementById('project-search')?.value || '');
    });
  });

  container.querySelectorAll('.ws-tab-menu-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wsId = parseInt(btn.dataset.wsid, 10);
      const ws = workspacesCache.find(w => w.id === wsId);
      if (ws) showWorkspaceMenu(btn, ws);
    });
  });

  document.getElementById('workspace-add-btn')?.addEventListener('click', () => {
    showWorkspaceModal();
  });
}

function showWorkspaceMenu(btn, ws) {
  document.querySelectorAll('.dropdown').forEach(d => d.remove());
  const menu = document.createElement('div');
  menu.className = 'dropdown';
  menu.innerHTML = `
    <button class="dropdown-item" id="wsm-rename">Rename</button>
    <button class="dropdown-item danger" id="wsm-delete">Delete Workspace</button>
  `;
  document.body.appendChild(menu);
  const rect = btn.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${Math.min(rect.right + window.scrollX - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8)}px`;

  menu.querySelector('#wsm-rename').onclick = () => { menu.remove(); showWorkspaceModal(ws); };
  menu.querySelector('#wsm-delete').onclick = async () => {
    menu.remove();
    if (!confirm(`Delete workspace "${ws.name}"? Its projects will become unassigned.`)) return;
    try {
      await api.deleteWorkspace(ws.id);
      if (activeWorkspace === String(ws.id)) setActiveWorkspace('all');
      workspacesCache = workspacesCache.filter(w => w.id !== ws.id);
      renderWorkspaceTabs();
      loadProjects(document.getElementById('project-search')?.value || '');
      toast('Workspace deleted', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };

  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
}

function showWorkspaceModal(ws = null) {
  const isEdit = !!ws;
  const iconPickerHtml = WS_ICONS.map(ic => `
    <button type="button" class="ws-icon-btn${ws?.icon === ic ? ' selected' : ''}" data-icon="${ic}" title="${ic}">${ic}</button>
  `).join('');

  showModal(`
    <h2>${isEdit ? 'Edit Workspace' : 'New Workspace'}</h2>
    <form id="ws-form">
      <div class="form-group">
        <label>Name *</label>
        <input class="form-control" id="ws-name" value="${escHtml(ws?.name || '')}" required maxlength="80" dir="auto" />
      </div>
      <div class="form-group">
        <label>Icon</label>
        <div class="ws-icon-picker" id="ws-icon-picker">
          <button type="button" class="ws-icon-btn ws-icon-none${!ws?.icon ? ' selected' : ''}" data-icon="" title="No icon">&#8709;</button>
          ${iconPickerHtml}
        </div>
      </div>
      <div id="ws-error" class="text-sm" style="color:var(--red);display:none;margin-bottom:8px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="btn btn-secondary" id="ws-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Create'}</button>
      </div>
    </form>
  `);

  document.getElementById('ws-cancel').onclick = hideModal;

  document.getElementById('ws-icon-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('.ws-icon-btn');
    if (!btn) return;
    document.querySelectorAll('.ws-icon-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });

  document.getElementById('ws-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('ws-error');
    errEl.style.display = 'none';
    const submitBtn = e.target.querySelector('[type=submit]');
    submitBtn.disabled = true;
    const name = document.getElementById('ws-name').value.trim();
    const selectedIcon = document.querySelector('.ws-icon-btn.selected')?.dataset.icon || null;
    const icon = selectedIcon || null;
    try {
      if (isEdit) {
        const updated = await api.updateWorkspace(ws.id, { name, icon });
        workspacesCache = workspacesCache.map(w => w.id === ws.id ? updated : w);
      } else {
        const created = await api.createWorkspace({ name, icon });
        workspacesCache = [...workspacesCache, created];
        setActiveWorkspace(String(created.id));
      }
      hideModal();
      renderWorkspaceTabs();
      loadProjects(document.getElementById('project-search')?.value || '');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      submitBtn.disabled = false;
    }
  });
}

// ---- Projects grid ----

async function loadProjects(q = '') {
  const grid = document.getElementById('projects-grid');
  if (!grid) return;
  const user = JSON.parse(localStorage.getItem('orbit_user') || '{}');
  const wsEnabled = !!user.workspacesEnabled;
  const wsFilter = wsEnabled ? activeWorkspace : undefined;
  try {
    const projects = await api.getProjects(q, undefined, wsFilter);
    renderGrid(grid, projects, wsEnabled && activeWorkspace === 'all');
  } catch (err) {
    grid.innerHTML = `<p class="text-sm" style="color:var(--red)">${escHtml(err.message)}</p>`;
  }
}

function renderGrid(grid, projects, showWsBadge = false) {
  if (!projects.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>No projects yet</h3>
        <p>Create your first project to get started.</p>
      </div>
    `;
    return;
  }

  grid.classList.toggle('single-row', projects.length <= 4);

  grid.innerHTML = projects.map(p => projectCardHtml(p, showWsBadge)).join('');

  grid.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.project-card-menu-btn') || e.target.closest('.favorite-star')) return;
      navigate(`/projects/${card.dataset.id}`);
    });
  });

  grid.querySelectorAll('.project-card-menu-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const projectId = btn.dataset.id;
      showProjectMenu(btn, projectId);
    });
  });

  grid.querySelectorAll('.favorite-star').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const result = await api.toggleFavorite(btn.dataset.id);
        toast(result.favorite ? '⭐ Marked as favorite' : 'Removed from favorites', 'info');
        loadProjects(document.getElementById('project-search')?.value || '');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

function showProjectMenu(btn, projectId) {
  document.querySelectorAll('.dropdown').forEach(d => d.remove());
  const menu = document.createElement('div');
  menu.className = 'dropdown';
  menu.innerHTML = `
    <button class="dropdown-item" id="pm-edit">Edit project details</button>
    <button class="dropdown-item danger" id="pm-delete">Delete</button>
  `;
  document.body.appendChild(menu);
  const rect = btn.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${rect.right + window.scrollX - menu.offsetWidth}px`;

  menu.querySelector('#pm-edit').onclick = async () => {
    menu.remove();
    const projects = await api.getProjects();
    const project = projects.find(p => p.id == projectId);
    if (project) showProjectModal(project, loadProjects);
  };
  menu.querySelector('#pm-delete').onclick = async () => {
    menu.remove();
    if (!confirm('Delete this project? This cannot be undone.')) return;
    try {
      await api.deleteProject(projectId);
      toast('Project deleted', 'success');
      loadProjects();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
}

export function showProjectModal(project = null, onSuccess = null) {
  const isEdit = !!project;
  const user = JSON.parse(localStorage.getItem('orbit_user') || '{}');
  const wsEnabled = !!user.workspacesEnabled;

  const workspaceSelector = wsEnabled && workspacesCache.length ? `
    <div class="form-group">
      <label>Workspace</label>
      <select class="form-control" id="p-workspace">
        <option value="">— Unassigned —</option>
        ${workspacesCache.map(ws => {
          const selected = isEdit
            ? (project.workspace_id === ws.id ? 'selected' : '')
            : (activeWorkspace === String(ws.id) ? 'selected' : '');
          return `<option value="${ws.id}" ${selected}>${escHtml(ws.name)}</option>`;
        }).join('')}
      </select>
    </div>
  ` : '';

  const html = `
    <h2>${isEdit ? 'Edit Project' : 'New Project'}</h2>
    <form id="project-form">
      <div class="form-group">
        <label>Title *</label>
        <input class="form-control" id="p-title" value="${escHtml(project?.title || '')}" required dir="auto" />
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea class="form-control" id="p-desc" dir="auto">${escHtml(project?.description || '')}</textarea>
      </div>
      <div class="form-group">
        <label>Cover</label>
        ${project?.picture ? `
          <div style="margin-bottom:8px;position:relative">
            <img id="p-picture-preview" src="${escHtml(project.picture)}" style="width:100%;height:100px;object-fit:cover;border-radius:4px" />
            <button type="button" id="p-remove-picture" class="btn btn-danger btn-sm" style="position:absolute;top:6px;right:6px">Remove</button>
          </div>
        ` : ''}
        <input type="file" id="p-picture" accept="image/*" class="form-control" style="padding:4px" />
      </div>
      <div class="form-group">
        <label>Tags</label>
        <div id="p-tags-input"></div>
      </div>
      ${workspaceSelector}
      <div id="p-error" class="text-sm" style="color:var(--red);display:none;margin-bottom:8px;"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        ${isEdit ? `
          <label class="theme-toggle" style="font-size:13px;font-weight:500;color:var(--text)">
            <input type="checkbox" id="p-risks-toggle" ${localStorage.getItem('orbit_risks_hidden_' + project.id) ? '' : 'checked'}>
            <span class="theme-toggle-track"><span class="theme-toggle-thumb"></span></span>
            Add risk bucket
          </label>
        ` : '<span></span>'}
        <div style="display:flex;gap:8px">
          <button type="button" class="btn btn-secondary" id="p-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Create Project'}</button>
        </div>
      </div>
    </form>
  `;
  showModal(html);

  const tagsWidget = tagsInput(document.getElementById('p-tags-input'), project?.tags || []);
  document.getElementById('p-cancel').onclick = hideModal;

  let removePicture = false;
  const removePicBtn = document.getElementById('p-remove-picture');
  if (removePicBtn) {
    removePicBtn.onclick = () => {
      removePicture = true;
      document.getElementById('p-picture-preview').style.display = 'none';
      removePicBtn.style.display = 'none';
    };
  }

  document.getElementById('project-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('p-error');
    errEl.style.display = 'none';
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;

    const fd = new FormData();
    fd.append('title', document.getElementById('p-title').value);
    fd.append('description', document.getElementById('p-desc').value);
    fd.append('tags', JSON.stringify(tagsWidget.getValue()));
    const pic = document.getElementById('p-picture').files[0];
    if (pic) fd.append('picture', pic);
    if (removePicture) fd.append('remove_picture', 'true');
    const wsSelect = document.getElementById('p-workspace');
    if (wsSelect) fd.append('workspace_id', wsSelect.value);

    try {
      if (isEdit) {
        await api.updateProject(project.id, fd);
        const risksToggle = document.getElementById('p-risks-toggle');
        if (risksToggle) {
          if (risksToggle.checked) {
            localStorage.removeItem('orbit_risks_hidden_' + project.id);
          } else {
            localStorage.setItem('orbit_risks_hidden_' + project.id, '1');
          }
        }
        toast('Project updated', 'success');
      } else {
        await api.createProject(fd);
        toast('Project created', 'success');
      }
      hideModal();
      if (onSuccess) onSuccess();
      else loadProjects();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      btn.disabled = false;
    }
  });
}

function projectColor(id) {
  const gradients = [
    'linear-gradient(135deg,#0052cc 0%,#185FA5 50%,#0d3a6e 100%)',
    'linear-gradient(135deg,#00b37a 0%,#00875a 55%,#003629 100%)',
    'linear-gradient(135deg,#8777d9 0%,#5f4db0 60%,#2d1f6b 100%)',
    'linear-gradient(135deg,#de350b 0%,#a52407 60%,#5c1201 100%)',
    'linear-gradient(135deg,#ff8b00 0%,#b06010 55%,#5a3000 100%)',
    'linear-gradient(135deg,#00b8d9 0%,#0890a8 55%,#00424d 100%)',
  ];
  return gradients[id % gradients.length];
}

function projectGradientAccent(id) {
  const accents = [
    ['#185FA5', '#63a0ff'],
    ['#00875a', '#6fd095'],
    ['#8777d9', '#b0a0ee'],
    ['#de350b', '#ff8b00'],
    ['#ff8b00', '#ffc266'],
    ['#0890a8', '#63d4e8'],
  ];
  return accents[id % accents.length];
}

function timeAgo(unixSecs) {
  if (!unixSecs) return '';
  const diff = Math.floor(Date.now() / 1000 - unixSecs);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  return formatDate(new Date(unixSecs * 1000).toISOString());
}

function riskSparklineHtml(tiers) {
  const total = (tiers.high || 0) + (tiers.medium || 0) + (tiers.low || 0);
  if (!total) return '';
  const bars = [];
  for (let i = 0; i < Math.min(tiers.high, 2); i++) bars.push({ color: '#A32D2D', height: 14 - i * 4 });
  for (let i = 0; i < Math.min(tiers.medium, 2); i++) bars.push({ color: '#854F0B', height: 10 - i * 2 });
  for (let i = 0; i < Math.min(tiers.low, 2); i++) bars.push({ color: '#3B6D11', height: 5 - i });
  const html = bars.map(b => `<i style="background:${b.color};height:${b.height}px"></i>`).join('');
  return `<span class="pc-risks" title="${total} open risk${total === 1 ? '' : 's'}">${html}</span>`;
}

function projectCardHtml(p, showWsBadge = false) {
  const stats = p.stats || { taskTotal: 0, taskCompleted: 0, overdueCount: 0, riskOpen: 0, riskTiers: { high: 0, medium: 0, low: 0 } };
  const { taskTotal, taskCompleted, overdueCount, riskOpen, riskTiers } = stats;
  const pct = taskTotal ? Math.round((taskCompleted / taskTotal) * 100) : 0;
  const atRisk = overdueCount > 0 || (riskTiers.high || 0) > 0;
  const allClear = taskTotal > 0 && riskOpen === 0 && overdueCount === 0;
  const complete = taskTotal > 0 && taskCompleted === taskTotal;
  let chipText = '';
  let chipClass = '';
  if (atRisk) { chipText = '&#9888; At risk'; chipClass = 'pc-chip-warn'; }
  else if (complete) { chipText = '&#10003; Complete'; chipClass = 'pc-chip-ok'; }
  const [accentA, accentB] = projectGradientAccent(p.id);
  const barGradient = atRisk
    ? 'linear-gradient(90deg,#de350b,#ff8b00)'
    : `linear-gradient(90deg,${accentA},${accentB})`;
  const pctColor = atRisk ? '#854F0B' : (pct >= 80 ? '#3B6D11' : 'var(--text2)');
  const cardClasses = ['project-card', atRisk ? 'is-at-risk' : '', complete ? 'is-complete' : ''].filter(Boolean).join(' ');

  let footerRight = '';
  if (overdueCount > 0) {
    footerRight = `<span class="pc-stat pc-stat-danger">${overdueCount} overdue</span>`;
  } else if (riskOpen > 0) {
    footerRight = riskSparklineHtml(riskTiers);
  } else if (taskTotal === 0) {
    footerRight = `<span class="pc-stat pc-stat-muted">No tasks yet</span>`;
  } else {
    footerRight = `<span class="pc-stat pc-stat-muted">Created ${timeAgo(p.created_at)}</span>`;
  }

  let statusLeft;
  if (riskOpen > 0) {
    const critical = (riskTiers.high || 0) > 0;
    statusLeft = `<span class="pc-stat"><span class="pc-dot" style="background:${critical ? '#de350b' : '#854F0B'}"></span>${riskOpen} open risk${riskOpen === 1 ? '' : 's'}${critical ? ' · critical' : ''}</span>`;
  } else if (allClear) {
    statusLeft = `<span class="pc-stat"><span class="pc-dot" style="background:#3B6D11"></span>All clear</span>`;
  } else {
    statusLeft = `<span class="pc-stat pc-stat-muted"><span class="pc-dot" style="background:var(--text3)"></span>No risks tracked</span>`;
  }

  const coverBg = p.picture ? '' : `style="background:${projectColor(p.id)}"`;
  const progressHeader = taskTotal
    ? `<div class="pc-prog-head"><span>${taskCompleted} of ${taskTotal} task${taskTotal === 1 ? '' : 's'}</span><span style="color:${pctColor};font-weight:600">${pct}%</span></div>`
    : `<div class="pc-prog-head"><span>No tasks yet</span><span style="color:var(--text3)">—</span></div>`;

  let wsBadge = '';
  if (showWsBadge && p.workspace_id) {
    const ws = workspacesCache.find(w => w.id === p.workspace_id);
    if (ws) {
      wsBadge = `<div class="pc-workspace-badge">${ws.color ? `<span class="ws-dot ws-dot-sm" style="background:${escHtml(ws.color)}"></span>` : ''}${escHtml(ws.name)}</div>`;
    }
  }

  return `
    <div class="${cardClasses}" data-id="${p.id}">
      <div class="project-card-cover" ${coverBg}>
        ${p.picture ? `<img src="${escHtml(p.picture)}" alt="" />` : `
          <div class="pc-orbit" aria-hidden="true">
            <span class="pc-ring pc-ring-3"></span>
            <span class="pc-ring pc-ring-2"></span>
            <span class="pc-ring pc-ring-1"></span>
            <span class="pc-sat${atRisk ? ' pc-sat-warn' : ''}"></span>
          </div>
          <div class="pc-scrim"></div>
        `}
        <button class="favorite-star ${p.favorite ? 'active' : ''}" data-id="${p.id}" title="Favorite">&#9733;</button>
        ${chipText ? `
          <div class="pc-meta">
            <span class="pc-chip ${chipClass}">${chipText}</span>
          </div>
        ` : ''}
      </div>
      <div class="project-card-body">
        <div class="project-card-title" dir="auto">${escHtml(p.title)}</div>
        ${p.description ? `<div class="project-card-desc" dir="auto">${escHtml(p.description)}</div>` : ''}
        <div class="pc-prog">
          ${progressHeader}
          <div class="pc-bar"><span style="width:${pct}%;background:${barGradient}"></span></div>
        </div>
        <div class="pc-footer">
          ${statusLeft}
          ${footerRight}
        </div>
        ${p.tags && p.tags.length ? `<div class="project-card-tags">${tagsHtml(p.tags)}</div>` : ''}
        ${wsBadge}
      </div>
      <button class="project-card-menu-btn" data-id="${p.id}" title="Options" aria-label="Options">&#8942;</button>
    </div>
  `;
}

export function breadcrumbHtml(label = 'Projects') {
  return `<a class="back-link" href="#/projects">&#8592; ${escHtml(label)}</a>`;
}

export function navbarHtml({ hideProfile = false } = {}) {
  const user = JSON.parse(localStorage.getItem('orbit_user') || '{}');
  const initial = (user.username || user.email || '?').charAt(0).toUpperCase();
  const avatarInner = user.profilePicture
    ? `<img src="${escHtml(user.profilePicture)}" alt="" />`
    : escHtml(initial);
  const profileItem = hideProfile
    ? ''
    : `<button class="dropdown-item" id="nav-profile">Options</button>`;
  const adminItem = user.isAdmin
    ? `<button class="dropdown-item" id="nav-admin">Admin</button>`
    : '';
  return `
    <nav class="navbar">
      <a class="navbar-brand" href="#/projects">
        <img src="/icon-dark-512.png" alt="" class="navbar-logo-light" />
        <img src="/icon-light-512.png" alt="" class="navbar-logo-dark" />
        Orbit
      </a>
      <div class="navbar-sep"></div>
      <span class="navbar-spacer"></span>
      <div class="notif-wrapper" id="notif-wrapper">
        <button class="nav-icon-btn" id="nav-notifications" title="Notifications" aria-label="Notifications">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path id="notif-bell-path" d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span class="notif-badge" id="notif-badge" hidden></span>
        </button>
        <div class="notif-panel" id="notif-panel">
          <div class="notif-panel-header">Overdue Tasks</div>
          <div class="notif-list" id="notif-list"></div>
        </div>
      </div>
      <div class="navbar-user-menu" id="navbar-user-menu">
        <button class="navbar-avatar" id="nav-avatar-btn" title="Account" aria-haspopup="true" aria-expanded="false">${avatarInner}</button>
        <div class="user-dropdown" id="user-dropdown" hidden>
          ${profileItem}
          <button class="dropdown-item" id="nav-templates">Edit templates</button>
          ${adminItem}
          <div class="dropdown-divider"></div>
          <button class="dropdown-item" id="nav-feedback">Feedback</button>
          <button class="dropdown-item dropdown-item-danger" id="nav-logout">Sign out</button>
        </div>
      </div>
    </nav>
  `;
}

export function setupNavbar({ projectId } = {}) {
  const avatarBtn = document.getElementById('nav-avatar-btn');
  const dropdown = document.getElementById('user-dropdown');

  if (avatarBtn && dropdown) {
    avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !dropdown.hidden;
      dropdown.hidden = open;
      avatarBtn.setAttribute('aria-expanded', String(!open));
    });

    const closeOnOutside = () => {
      if (!document.body.contains(dropdown)) {
        document.removeEventListener('click', closeOnOutside);
        return;
      }
      dropdown.hidden = true;
      avatarBtn.setAttribute('aria-expanded', 'false');
    };
    document.addEventListener('click', closeOnOutside);
  }

  function bellFill(n) {
    if (n === 0) return 'none';
    if (n <= 10) return '#f5c518';
    if (n <= 20) return '#ff8c00';
    if (n <= 30) return '#8B5E3C';
    return '#ff6b6b';
  }

  async function loadNotifications() {
    try {
      const tasks = await api.getOverdueTasks(projectId);
      const count = tasks.length;
      const badge = document.getElementById('notif-badge');
      const bellPath = document.getElementById('notif-bell-path');
      const list = document.getElementById('notif-list');
      if (badge) { badge.textContent = count > 99 ? '99+' : count; badge.hidden = count === 0; }
      if (bellPath) bellPath.setAttribute('fill', bellFill(count));
      if (list) {
        if (count === 0) {
          list.innerHTML = '<div class="notif-empty">No overdue tasks</div>';
        } else {
          list.innerHTML = tasks.map(t => `
            <div class="notif-item" data-project-id="${t.project_id}" role="button" tabindex="0">
              <div class="notif-item-desc" dir="auto">${escHtml(t.description)}</div>
              <div class="notif-item-meta">${escHtml(t.project_title)} &bull; Due ${escHtml(t.due_date)}</div>
            </div>
          `).join('');
          list.querySelectorAll('.notif-item').forEach(el => {
            el.addEventListener('click', () => {
              document.getElementById('notif-panel').hidden = true;
              navigate('/projects/' + el.dataset.projectId);
            });
          });
        }
      }
    } catch { /* notifications are non-critical */ }
  }

  loadNotifications();
  document.getElementById('nav-profile')?.addEventListener('click', () => {
    if (dropdown) dropdown.hidden = true;
    navigate('/profile');
  });
  document.getElementById('nav-templates')?.addEventListener('click', async () => {
    if (dropdown) dropdown.hidden = true;
    try {
      const templates = await api.getTemplates();
      if (!templates.length) { toast('No templates available', 'info'); return; }
      navigate('/templates');
    } catch { navigate('/templates'); }
  });
  document.getElementById('nav-admin')?.addEventListener('click', () => {
    if (dropdown) dropdown.hidden = true;
    navigate('/admin');
  });
  document.getElementById('nav-feedback')?.addEventListener('click', () => {
    if (dropdown) dropdown.hidden = true;
    showFeedbackModal();
  });
  document.getElementById('nav-logout')?.addEventListener('click', () => {
    localStorage.removeItem('orbit_user');
    document.cookie = 'orbit_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Strict';
    navigate('/login');
  });
}

function showFeedbackModal() {
  showModal(`
    <h2>Send Feedback</h2>
    <p class="text-sm text-muted" style="margin:-8px 0 16px">Share your thoughts, suggestions, or report a problem.</p>
    <form id="feedback-form">
      <div class="form-group">
        <label>Message *</label>
        <textarea class="form-control" id="fb-message" rows="6" maxlength="5000" placeholder="Your feedback…" required dir="auto"></textarea>
      </div>
      <div id="fb-err" class="text-sm" style="color:var(--red);display:none;margin-bottom:8px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="btn btn-secondary" id="fb-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Submit</button>
      </div>
    </form>
  `);
  document.getElementById('fb-cancel').onclick = hideModal;
  document.getElementById('feedback-form').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('fb-err');
    const btn = e.target.querySelector('[type=submit]');
    const message = document.getElementById('fb-message').value.trim();
    if (!message) return;
    btn.disabled = true;
    hideModal();
    try {
      await api.sendFeedback(message);
      toast('Feedback sent — thank you!', 'success');
    } catch (err) {
      toast(err.message || 'Failed to send feedback', 'error');
    }
  };
}
