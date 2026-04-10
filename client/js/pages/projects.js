import { api } from '../api.js';
import { toast, showModal, hideModal, tagsInput, tagsHtml, escHtml, formatDate } from '../utils.js';
import { navigate } from '../router.js';

let searchTimeout = null;

export async function renderProjects(app) {
  app.innerHTML = `
    <div class="app-layout">
      ${navbarHtml()}
      <div class="projects-subbar">
        <h1 class="projects-subbar-title">My Projects</h1>
        <div class="projects-subbar-right">
          <div class="projects-search-box">
            <div class="projects-search-icon"></div>
            <input type="search" id="project-search" placeholder="Search projects…" />
          </div>
          <button class="projects-add-btn" id="new-project-btn">+ New Project</button>
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
  loadProjects();

  document.getElementById('project-search').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadProjects(e.target.value), 300);
  });

  document.getElementById('new-project-btn').addEventListener('click', () => showProjectModal());
}

async function loadProjects(q = '') {
  const grid = document.getElementById('projects-grid');
  if (!grid) return;
  try {
    const projects = await api.getProjects(q);
    renderGrid(grid, projects);
  } catch (err) {
    grid.innerHTML = `<p class="text-sm" style="color:var(--red)">${escHtml(err.message)}</p>`;
  }
}

function renderGrid(grid, projects) {
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

  grid.innerHTML = projects.map(p => `
    <div class="project-card" data-id="${p.id}">
      <div class="project-card-cover" style="background:${p.picture ? 'transparent' : projectColor(p.id)}">
        ${p.picture ? `<img src="${escHtml(p.picture)}" alt="" />` : ''}
        <button class="favorite-star ${p.favorite ? 'active' : ''}" data-id="${p.id}" title="Favorite">&#9733;</button>
      </div>
      <div class="project-card-body">
        <div class="project-card-title">${escHtml(p.title)}</div>
        ${p.description ? `<div class="project-card-desc">${escHtml(p.description)}</div>` : ''}
        <div class="project-card-tags">${tagsHtml(p.tags)}</div>
      </div>
      <button class="project-card-menu-btn" data-id="${p.id}" title="Options" aria-label="Options">&#8942;</button>
    </div>
  `).join('');

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
    <button class="dropdown-item" id="pm-edit">Edit</button>
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
  const html = `
    <h2>${isEdit ? 'Edit Project' : 'New Project'}</h2>
    <form id="project-form">
      <div class="form-group">
        <label>Title *</label>
        <input class="form-control" id="p-title" value="${escHtml(project?.title || '')}" required />
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea class="form-control" id="p-desc">${escHtml(project?.description || '')}</textarea>
      </div>
      <div class="form-group">
        <label>Image</label>
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
  const colors = [
    'linear-gradient(135deg,#185FA5,#0d3a6e)',
    'linear-gradient(135deg,#00875a,#003629)',
    'linear-gradient(135deg,#6e44b8,#3b1e6e)',
    'linear-gradient(135deg,#c04030,#6b1e0e)',
    'linear-gradient(135deg,#b06010,#5a3000)',
    'linear-gradient(135deg,#0890a8,#004a58)',
  ];
  return colors[id % colors.length];
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
    : `<button class="dropdown-item" id="nav-profile">Profile</button>`;
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
      <button class="nav-icon-btn" id="nav-notifications" title="Notifications" aria-label="Notifications">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
      </button>
      <div class="navbar-user-menu" id="navbar-user-menu">
        <button class="navbar-avatar" id="nav-avatar-btn" title="Account" aria-haspopup="true" aria-expanded="false">${avatarInner}</button>
        <div class="user-dropdown" id="user-dropdown" hidden>
          ${profileItem}
          <button class="dropdown-item" id="nav-templates">Edit templates</button>
          ${adminItem}
          <div class="dropdown-divider"></div>
          <button class="dropdown-item dropdown-item-danger" id="nav-logout">Sign out</button>
        </div>
      </div>
    </nav>
  `;
}

export function setupNavbar() {
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

  document.getElementById('nav-notifications')?.addEventListener('click', () => {
    import('../utils.js').then(({ toast }) => toast('No notifications', 'info'));
  });
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
  document.getElementById('nav-logout')?.addEventListener('click', () => {
    localStorage.removeItem('orbit_user');
    document.cookie = 'orbit_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Strict';
    navigate('/login');
  });
}
