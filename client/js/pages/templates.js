import { api } from '../api.js';
import { toast, showModal, hideModal, escHtml, tagsHtml } from '../utils.js';
import { navbarHtml, setupNavbar } from './projects.js';

export async function renderTemplates(app) {
  app.innerHTML = `
    <div class="app-layout">
      ${navbarHtml()}
      <div class="board-container" id="tmpl-container">
        <div class="board-header">
          <a class="back-link" href="#/projects">&#8592; Projects</a>
          <h2>Bucket Templates</h2>
        </div>
        <div class="board-scroll" id="tmpl-scroll">
          <div class="spinner-wrap" style="height:300px;flex:1"><div class="spinner"></div></div>
        </div>
      </div>
    </div>
  `;
  setupNavbar();
  loadTemplates();
}

async function loadTemplates() {
  const scroll = document.getElementById('tmpl-scroll');
  if (!scroll) return;
  try {
    const templates = await api.getTemplates();
    renderBoard(scroll, templates);
  } catch (err) {
    scroll.innerHTML = `<p style="color:var(--red);padding:20px">${escHtml(err.message)}</p>`;
  }
}

function renderBoard(scroll, templates) {
  scroll.innerHTML = '';
  if (!templates.length) {
    toast('No templates available', 'info');
    return;
  }
  templates.forEach(t => scroll.appendChild(createTemplateCol(t)));
}

function createTemplateCol(t) {
  const data = JSON.parse(t.bucket_data || '{}');
  const tasks = data.tasks || [];

  const col = document.createElement('div');
  col.className = 'bucket-col';
  col.dataset.id = t.id;

  col.innerHTML = `
    <div class="bucket-header">
      <span class="bucket-title">${escHtml(t.name)}</span>
      <span class="text-muted text-sm">${tasks.length}</span>
      <button class="bucket-menu-btn" title="Options">&#8942;</button>
    </div>
    <div class="bucket-section tasks-section">
      <div class="bucket-section-label">Tasks</div>
      <div class="bucket-items">
        ${tasks.map(task => `
          <div class="card task-card">
            <div class="task-body">
              <div class="card-description">${escHtml(task.description)}</div>
            </div>
            ${task.tags && task.tags.length ? `<div class="card-footer">${tagsHtml(task.tags)}</div>` : ''}
            ${task.checklists && task.checklists.length ? `
              <div class="card-footer" style="font-size:11px;color:var(--text2)">
                &#9744; ${task.checklists.length} checklist item${task.checklists.length !== 1 ? 's' : ''}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // Wire ⋮ menu
  col.querySelector('.bucket-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    showTemplateMenu(e.currentTarget, t.id, t.name);
  });

  return col;
}

function showTemplateMenu(btn, id, name) {
  document.querySelectorAll('.dropdown').forEach(d => d.remove());
  const menu = document.createElement('div');
  menu.className = 'dropdown';
  menu.innerHTML = `
    <button class="dropdown-item" id="tm-rename">Rename</button>
    <button class="dropdown-item danger" id="tm-delete">Delete</button>
  `;
  document.body.appendChild(menu);
  const rect = btn.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${rect.left + window.scrollX}px`;

  menu.querySelector('#tm-rename').onclick = () => { menu.remove(); showRenameModal(id, name); };
  menu.querySelector('#tm-delete').onclick = () => { menu.remove(); deleteTemplate(id, name); };

  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
}

function showRenameModal(id, currentName) {
  showModal(`
    <h2>Rename template</h2>
    <form id="rename-form">
      <div class="form-group">
        <label>Template name</label>
        <input class="form-control" id="rename-input" value="${escHtml(currentName)}" required />
      </div>
      <div id="rename-err" class="text-sm" style="color:var(--red);display:none;margin-bottom:8px;"></div>
      <div style="display:flex;gap:8px;justify-content:space-between">
        <button type="button" class="btn btn-secondary" id="rename-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `);
  document.getElementById('rename-cancel').onclick = hideModal;
  document.getElementById('rename-form').onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('rename-input').value.trim();
    if (!name) return;
    const errEl = document.getElementById('rename-err');
    const submitBtn = e.target.querySelector('[type=submit]');
    submitBtn.disabled = true;
    try {
      await api.updateTemplate(id, { name });
      hideModal();
      toast('Template renamed', 'success');
      loadTemplates();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      submitBtn.disabled = false;
    }
  };
}

async function deleteTemplate(id, name) {
  if (!confirm(`Delete template "${name}"? This cannot be undone.`)) return;
  try {
    await api.deleteTemplate(id);
    toast('Template deleted', 'success');
    loadTemplates();
  } catch (err) {
    toast(err.message, 'error');
  }
}
