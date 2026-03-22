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
        <button class="btn btn-primary" onclick="document.getElementById('new-project-btn').click()">+ New Project</button>
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
      <div class="project-card-footer">
        <button class="btn btn-sm btn-ghost edit-project" data-id="${p.id}">Edit</button>
        <button class="btn btn-sm btn-danger delete-project" data-id="${p.id}">Delete</button>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.project-card-footer')) return;
      navigate(`/projects/${card.dataset.id}`);
    });
  });

  grid.querySelectorAll('.edit-project').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const projects = await api.getProjects();
      const project = projects.find(p => p.id == btn.dataset.id);
      if (project) showProjectModal(project, loadProjects);
    });
  });

  grid.querySelectorAll('.delete-project').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this project? This cannot be undone.')) return;
      try {
        await api.deleteProject(btn.dataset.id);
        toast('Project deleted', 'success');
        loadProjects();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  grid.querySelectorAll('.favorite-star').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await api.toggleFavorite(btn.dataset.id);
        loadProjects(document.getElementById('project-search')?.value || '');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
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
        <label>Background Picture</label>
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
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="btn btn-secondary" id="p-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Create Project'}</button>
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

export function navbarHtml({ hideProfile = false } = {}) {
  const user = JSON.parse(localStorage.getItem('orbit_user') || '{}');
  const initial = (user.username || user.email || '?').charAt(0).toUpperCase();
  const avatarInner = user.profilePicture
    ? `<img src="${escHtml(user.profilePicture)}" alt="" />`
    : escHtml(initial);
  const avatarEl = hideProfile
    ? `<span class="navbar-avatar">${avatarInner}</span>`
    : `<button class="navbar-avatar" id="nav-profile" title="Profile">${avatarInner}</button>`;
  return `
    <nav class="navbar">
      <span class="navbar-brand">
        <img src="/icon-dark-512.png" alt="" class="navbar-logo-light" />
        <img src="/icon-light-512.png" alt="" class="navbar-logo-dark" />
        Orbit
      </span>
      <div class="navbar-sep"></div>
      <span class="navbar-spacer"></span>
      ${avatarEl}
      <button class="nav-link" id="nav-logout">Sign out</button>
    </nav>
  `;
}

export function setupNavbar() {
  document.getElementById('nav-profile')?.addEventListener('click', () => navigate('/profile'));
  document.getElementById('nav-logout')?.addEventListener('click', () => {
    localStorage.removeItem('orbit_token');
    localStorage.removeItem('orbit_user');
    document.cookie = 'orbit_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Strict';
    navigate('/login');
  });
}
