import { api } from '../api.js';
import { toast, showModal, hideModal, tagsInput, tagsHtml, escHtml, formatDate, isOverdue, rpnClass } from '../utils.js';
import { navigate } from '../router.js';
import { navbarHtml, setupNavbar, showProjectModal } from './projects.js';

export async function renderBoard(app, params) {
  const projectId = params.id;
  app.innerHTML = `
    <div class="app-layout">
      ${navbarHtml()}
      <div class="board-container" id="board-container">
        <div class="board-header">
          <button class="back-link" id="back-btn">&#8592; Projects</button>
          <h2 id="board-title">Loading…</h2>
          <button class="btn btn-secondary btn-sm" id="edit-project-btn" style="display:none">&#9998; Edit Project</button>
          <span class="navbar-spacer"></span>
          <input type="search" class="form-control" id="board-search" placeholder="Search tasks &amp; risks…" style="max-width:220px" />
        </div>
        <div class="board-scroll" id="board-scroll">
          <div class="spinner-wrap" style="height:300px;flex:1"><div class="spinner"></div></div>
        </div>
      </div>
    </div>
  `;

  setupNavbar();
  document.getElementById('back-btn').onclick = () => navigate('/projects');

  let project, buckets, itemsByBucket = {};
  let searchQ = '';

  async function loadAll() {
    try {
      [project, buckets] = await Promise.all([api.getProject(projectId), api.getBuckets(projectId)]);
      document.getElementById('board-title').textContent = project.title;

      // Show and wire Edit Project button
      const editBtn = document.getElementById('edit-project-btn');
      if (editBtn) {
        editBtn.style.display = '';
        editBtn.onclick = () => showProjectModal(project, loadAll);
      }

      // Apply project picture as dimmed background
      const container = document.getElementById('board-container');
      if (project.picture) {
        container.style.backgroundImage = `url('${project.picture}')`;
        container.style.backgroundSize = 'cover';
        container.style.backgroundPosition = 'center';
        container.classList.add('has-bg');
      } else {
        container.style.backgroundImage = '';
        container.classList.remove('has-bg');
      }

      await Promise.all(buckets.map(async b => {
        const [tasks, risks] = await Promise.all([api.getTasks(b.id), api.getRisks(b.id)]);
        itemsByBucket[b.id] = { tasks, risks };
      }));
      renderBoard();
    } catch (err) {
      document.getElementById('board-scroll').innerHTML = `<p style="color:var(--red);padding:20px">${escHtml(err.message)}</p>`;
    }
  }

  function renderBoard() {
    const scroll = document.getElementById('board-scroll');
    if (!scroll) return;
    scroll.innerHTML = '';

    buckets.forEach(bucket => {
      const col = createBucketCol(bucket);
      scroll.appendChild(col);
    });

    // Add bucket button
    const addBtn = document.createElement('button');
    addBtn.className = 'add-bucket-btn';
    addBtn.textContent = '+ Add Bucket';
    addBtn.onclick = () => showBucketModal();
    scroll.appendChild(addBtn);
  }

  function filterItems(items) {
    if (!searchQ) return items;
    const q = searchQ.toLowerCase();
    return items.filter(item =>
      item.description.toLowerCase().includes(q) ||
      (item.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }

  function createBucketCol(bucket) {
    const col = document.createElement('div');
    col.className = 'bucket-col';
    col.dataset.id = bucket.id;

    const { tasks, risks } = itemsByBucket[bucket.id] || { tasks: [], risks: [] };
    const filteredTasks = filterItems(tasks);
    const filteredRisks = filterItems(risks);

    col.innerHTML = `
      <div class="bucket-header">
        <span class="bucket-title" title="${escHtml(bucket.title)}">${escHtml(bucket.title)}</span>
        <span class="text-muted text-sm">${filteredTasks.length + filteredRisks.length}</span>
        <button class="bucket-menu-btn" title="Bucket options">&#8942;</button>
      </div>
      <div class="bucket-items" id="items-${bucket.id}">
        ${filteredTasks.map(t => taskCardHtml(t)).join('')}
        ${filteredRisks.map(r => riskCardHtml(r)).join('')}
      </div>
      <button class="bucket-add-btn add-task" data-bucket="${bucket.id}">+ Task</button>
      <button class="bucket-add-btn add-risk" data-bucket="${bucket.id}" style="border-color:var(--red);color:var(--red);">+ Risk</button>
    `;

    // Apply bucket color to header
    if (bucket.color) {
      const header = col.querySelector('.bucket-header');
      header.style.background = bucket.color;
      header.style.borderRadius = 'var(--radius) var(--radius) 0 0';
      header.querySelector('.bucket-title').style.color = '#fff';
      header.querySelector('.bucket-menu-btn').style.color = 'rgba(255,255,255,0.8)';
      col.querySelector('.text-muted').style.color = 'rgba(255,255,255,0.7)';
    }

    // Bucket menu
    col.querySelector('.bucket-menu-btn').onclick = (e) => {
      e.stopPropagation();
      showBucketMenu(e.currentTarget, bucket);
    };

    // Bucket title click to edit
    col.querySelector('.bucket-title').onclick = () => showBucketModal(bucket);

    // Task cards
    col.querySelectorAll('.task-card').forEach(card => {
      card.onclick = () => {
        const task = tasks.find(t => t.id == card.dataset.id);
        if (task) showTaskModal(bucket.id, task);
      };
      card.querySelector('.card-edit-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const task = tasks.find(t => t.id == card.dataset.id);
        if (task) showTaskModal(bucket.id, task);
      });
      card.querySelector('.card-delete-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this task?')) return;
        await api.deleteTask(card.dataset.id);
        toast('Task deleted', 'success');
        await loadAll();
      });
    });

    // Risk cards
    col.querySelectorAll('.risk-card').forEach(card => {
      card.onclick = () => {
        const risk = risks.find(r => r.id == card.dataset.id);
        if (risk) showRiskModal(bucket.id, risk);
      };
      card.querySelector('.card-edit-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const risk = risks.find(r => r.id == card.dataset.id);
        if (risk) showRiskModal(bucket.id, risk);
      });
      card.querySelector('.card-delete-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this risk?')) return;
        await api.deleteRisk(card.dataset.id);
        toast('Risk deleted', 'success');
        await loadAll();
      });
    });

    col.querySelector('.add-task').onclick = () => showTaskModal(bucket.id);
    col.querySelector('.add-risk').onclick = () => showRiskModal(bucket.id);

    return col;
  }

  function taskCardHtml(t) {
    const overdue = isOverdue(t.due_date);
    return `
      <div class="card task-card" data-id="${t.id}">
        <div class="card-actions">
          <button class="card-action-btn card-edit-btn" title="Edit">&#9998;</button>
          <button class="card-action-btn card-delete-btn" title="Delete">&#128465;</button>
        </div>
        <div class="card-type-badge task">Task</div>
        ${t.picture ? `<img src="${escHtml(t.picture)}" style="width:100%;height:80px;object-fit:cover;border-radius:4px;margin-bottom:6px" />` : ''}
        <div class="card-description">${escHtml(t.description)}</div>
        <div class="card-footer">
          <span class="priority ${t.priority}">${t.priority}</span>
          ${t.due_date ? `<span class="due-date ${overdue ? 'overdue' : ''}">${formatDate(t.due_date)}</span>` : ''}
          ${tagsHtml(t.tags)}
        </div>
      </div>
    `;
  }

  function riskCardHtml(r) {
    const cls = rpnClass(r.rpn);
    return `
      <div class="card risk-card" data-id="${r.id}">
        <div class="card-actions">
          <button class="card-action-btn card-edit-btn" title="Edit">&#9998;</button>
          <button class="card-action-btn card-delete-btn" title="Delete">&#128465;</button>
        </div>
        <div class="card-type-badge risk">Risk</div>
        ${r.photos?.length ? `<img src="${escHtml(r.photos[0])}" style="width:100%;height:80px;object-fit:cover;border-radius:4px;margin-bottom:6px" />` : ''}
        <div class="card-description">${escHtml(r.description)}</div>
        <div class="card-footer">
          <span class="rpn-badge ${cls}" title="RPN = Severity × Probability × Detectability">RPN ${r.rpn}</span>
          <span class="status-badge ${r.status}">${r.status}</span>
          ${tagsHtml(r.tags)}
        </div>
      </div>
    `;
  }

  // ---- Bucket Modal ----
  const BUCKET_COLORS = [
    { label: 'None',   value: '' },
    { label: 'Blue',   value: '#0052cc' },
    { label: 'Teal',   value: '#00875a' },
    { label: 'Purple', value: '#8777d9' },
    { label: 'Red',    value: '#de350b' },
    { label: 'Orange', value: '#ff8b00' },
    { label: 'Cyan',   value: '#00b8d9' },
    { label: 'Pink',   value: '#e91e8c' },
    { label: 'Yellow', value: '#f5cd47' },
  ];

  function showBucketModal(bucket = null) {
    const isEdit = !!bucket;
    const currentColor = bucket?.color || '';

    const swatchesHtml = BUCKET_COLORS.map(c => `
      <button type="button" class="color-swatch ${c.value === currentColor ? 'selected' : ''}"
        data-color="${c.value}"
        title="${c.label}"
        style="background:${c.value || 'var(--gray-300)'}">
      </button>
    `).join('');

    showModal(`
      <h2>${isEdit ? 'Edit Bucket' : 'Add Bucket'}</h2>
      <form id="bucket-form">
        <div class="form-group">
          <label>Title *</label>
          <input class="form-control" id="b-title" value="${escHtml(bucket?.title || '')}" required />
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea class="form-control" id="b-desc">${escHtml(bucket?.description || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Color</label>
          <div class="color-swatches">${swatchesHtml}</div>
        </div>
        <div id="b-err" class="text-sm" style="color:var(--red);display:none;margin-bottom:8px;"></div>
        ${isEdit ? `<button type="button" class="btn btn-danger btn-sm" id="delete-bucket-btn" style="margin-bottom:12px">Delete Bucket</button>` : ''}
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="btn btn-secondary" id="b-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Add Bucket'}</button>
        </div>
      </form>
    `);
    document.getElementById('b-cancel').onclick = hideModal;

    // Color swatch selection
    let selectedColor = currentColor;
    document.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
        selectedColor = swatch.dataset.color;
      });
    });

    if (isEdit) {
      document.getElementById('delete-bucket-btn').onclick = async () => {
        if (!confirm('Delete this bucket and all its tasks/risks?')) return;
        await api.deleteBucket(bucket.id);
        toast('Bucket deleted', 'success');
        hideModal();
        await loadAll();
      };
    }

    document.getElementById('bucket-form').onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('b-err');
      const btn = e.target.querySelector('[type=submit]');
      btn.disabled = true;
      const data = {
        title: document.getElementById('b-title').value,
        description: document.getElementById('b-desc').value,
        color: selectedColor,
      };
      try {
        if (isEdit) {
          await api.updateBucket(bucket.id, data);
          toast('Bucket updated', 'success');
        } else {
          await api.createBucket(projectId, data);
          toast('Bucket added', 'success');
        }
        hideModal();
        await loadAll();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
        btn.disabled = false;
      }
    };
  }

  // ---- Task Modal ----
  function showTaskModal(bucketId, task = null) {
    const isEdit = !!task;
    showModal(`
      <h2>${isEdit ? 'Edit Task' : 'Add Task'}</h2>
      <form id="task-form">
        <div class="form-group">
          <label>Description *</label>
          <textarea class="form-control" id="t-desc" required>${escHtml(task?.description || '')}</textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Priority</label>
            <select class="form-control" id="t-priority">
              ${['Low','Medium','High'].map(p => `<option ${task?.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Due Date</label>
            <input type="date" class="form-control" id="t-due" value="${task?.due_date || ''}" />
          </div>
        </div>
        <div class="form-group">
          <label>Picture</label>
          ${task?.picture ? `<div style="margin-bottom:8px"><img src="${escHtml(task.picture)}" style="max-width:100%;max-height:140px;border-radius:4px;object-fit:cover" /></div>` : ''}
          <input type="file" id="t-picture" accept="image/*" class="form-control" style="padding:4px" />
        </div>
        <div class="form-group">
          <label>Tags</label>
          <div id="t-tags-input"></div>
        </div>
        <div id="t-err" class="text-sm" style="color:var(--red);display:none;margin-bottom:8px;"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="btn btn-secondary" id="t-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Add Task'}</button>
        </div>
      </form>
    `);
    const tagsWidget = tagsInput(document.getElementById('t-tags-input'), task?.tags || []);
    document.getElementById('t-cancel').onclick = hideModal;

    document.getElementById('task-form').onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('t-err');
      const btn = e.target.querySelector('[type=submit]');
      btn.disabled = true;
      const fd = new FormData();
      fd.append('description', document.getElementById('t-desc').value);
      fd.append('priority', document.getElementById('t-priority').value);
      fd.append('due_date', document.getElementById('t-due').value || '');
      fd.append('tags', JSON.stringify(tagsWidget.getValue()));
      const pic = document.getElementById('t-picture').files[0];
      if (pic) fd.append('picture', pic);
      try {
        if (isEdit) {
          await api.updateTask(task.id, fd);
          toast('Task updated', 'success');
        } else {
          await api.createTask(bucketId, fd);
          toast('Task added', 'success');
        }
        hideModal();
        await loadAll();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
        btn.disabled = false;
      }
    };
  }

  // ---- Risk Modal ----
  function showRiskModal(bucketId, risk = null) {
    const isEdit = !!risk;
    const sv = risk?.severity || 5, pr = risk?.probability || 5, de = risk?.detectability || 5;
    showModal(`
      <h2>${isEdit ? 'Edit Risk' : 'Add Risk'}</h2>
      <form id="risk-form">
        <div class="form-group">
          <label>Description *</label>
          <textarea class="form-control" id="r-desc" required>${escHtml(risk?.description || '')}</textarea>
        </div>

        <div class="section-label" style="margin-top:16px">Risk Scoring</div>
        <div class="rpn-row">
          <label>Severity</label>
          <input type="range" id="r-sv" min="1" max="10" value="${sv}" />
          <span class="rpn-val" id="r-sv-val">${sv}</span>
        </div>
        <div class="rpn-row">
          <label>Probability</label>
          <input type="range" id="r-pr" min="1" max="10" value="${pr}" />
          <span class="rpn-val" id="r-pr-val">${pr}</span>
        </div>
        <div class="rpn-row">
          <label>Detectability</label>
          <input type="range" id="r-de" min="1" max="10" value="${de}" />
          <span class="rpn-val" id="r-de-val">${de}</span>
        </div>
        <div class="rpn-result">
          <span>RPN (S × P × D)</span>
          <strong id="r-rpn-display">${sv * pr * de}</strong>
        </div>

        <div class="form-group" style="margin-top:16px">
          <label>Status</label>
          <select class="form-control" id="r-status">
            <option ${(!risk || risk.status === 'Open') ? 'selected' : ''}>Open</option>
            <option ${risk?.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
          </select>
        </div>
        <div class="form-group">
          <label>Solution Description</label>
          <textarea class="form-control" id="r-solution">${escHtml(risk?.solution_description || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Photo</label>
          ${risk?.photos?.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${risk.photos.map(p => `<img src="${escHtml(p)}" style="height:70px;border-radius:4px;object-fit:cover" />`).join('')}</div>` : ''}
          <input type="file" id="r-photo" accept="image/*" class="form-control" style="padding:4px" />
        </div>
        <div class="form-group">
          <label>Tags</label>
          <div id="r-tags-input"></div>
        </div>
        <div id="r-err" class="text-sm" style="color:var(--red);display:none;margin-bottom:8px;"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="btn btn-secondary" id="r-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Add Risk'}</button>
        </div>
      </form>
    `);

    const tagsWidget = tagsInput(document.getElementById('r-tags-input'), risk?.tags || []);
    document.getElementById('r-cancel').onclick = hideModal;

    // RPN live calculation
    ['r-sv', 'r-pr', 'r-de'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => {
        const s = +document.getElementById('r-sv').value;
        const p = +document.getElementById('r-pr').value;
        const d = +document.getElementById('r-de').value;
        document.getElementById('r-sv-val').textContent = s;
        document.getElementById('r-pr-val').textContent = p;
        document.getElementById('r-de-val').textContent = d;
        document.getElementById('r-rpn-display').textContent = s * p * d;
      });
    });

    document.getElementById('risk-form').onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('r-err');
      const btn = e.target.querySelector('[type=submit]');
      btn.disabled = true;
      const fd = new FormData();
      fd.append('description', document.getElementById('r-desc').value);
      fd.append('severity', document.getElementById('r-sv').value);
      fd.append('probability', document.getElementById('r-pr').value);
      fd.append('detectability', document.getElementById('r-de').value);
      fd.append('status', document.getElementById('r-status').value);
      fd.append('solution_description', document.getElementById('r-solution').value);
      fd.append('tags', JSON.stringify(tagsWidget.getValue()));
      const photo = document.getElementById('r-photo').files[0];
      if (photo) fd.append('photo', photo);
      try {
        if (isEdit) {
          await api.updateRisk(risk.id, fd);
          toast('Risk updated', 'success');
        } else {
          await api.createRisk(bucketId, fd);
          toast('Risk added', 'success');
        }
        hideModal();
        await loadAll();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
        btn.disabled = false;
      }
    };
  }

  // ---- Bucket dropdown menu ----
  function showBucketMenu(btn, bucket) {
    document.querySelectorAll('.dropdown').forEach(d => d.remove());
    const menu = document.createElement('div');
    menu.className = 'dropdown';
    menu.innerHTML = `
      <button class="dropdown-item" id="dm-edit">Edit Bucket</button>
      <button class="dropdown-item danger" id="dm-delete">Delete Bucket</button>
    `;
    document.body.appendChild(menu);
    const rect = btn.getBoundingClientRect();
    menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
    menu.style.left = `${rect.left + window.scrollX}px`;

    menu.querySelector('#dm-edit').onclick = () => { menu.remove(); showBucketModal(bucket); };
    menu.querySelector('#dm-delete').onclick = async () => {
      menu.remove();
      if (!confirm('Delete this bucket?')) return;
      await api.deleteBucket(bucket.id);
      toast('Bucket deleted', 'success');
      await loadAll();
    };

    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
  }

  // Search
  document.getElementById('board-search').addEventListener('input', (e) => {
    searchQ = e.target.value.trim();
    renderBoard();
  });

  await loadAll();
}
