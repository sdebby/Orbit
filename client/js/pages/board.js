import { api } from '../api.js';
import { toast, showModal, hideModal, tagsInput, tagsHtml, escHtml, formatDate, isOverdue, dueDateClass, rpnClass, isTouchDevice } from '../utils.js';
import { navigate } from '../router.js';
import { navbarHtml, setupNavbar, showProjectModal, breadcrumbHtml } from './projects.js';

function soundsEnabled() {
  return localStorage.getItem('orbit_sounds_enabled') !== '0';
}

function playDing() {
  if (!soundsEnabled()) return;
  try {
    const audio = new Audio('/assets/ding.mp3');
    audio.volume = 0.6;
    audio.play().catch(() => {});
  } catch { /* audio not available */ }
}

function playTaskCreate() {
  if (!soundsEnabled()) return;
  try {
    const audio = new Audio('/assets/task-create.mp3');
    audio.volume = 0.6;
    audio.play().catch(() => {});
  } catch { /* audio not available */ }
}

function checkConfettiMilestone() {
  const milestoneKey = 'orbit_milestone_10_shown';
  if (localStorage.getItem(milestoneKey)) return false;
  const countKey = 'orbit_total_done';
  const n = parseInt(localStorage.getItem(countKey) || '0', 10) + 1;
  localStorage.setItem(countKey, n);
  if (n >= 10) {
    localStorage.setItem(milestoneKey, '1');
    return true;
  }
  return false;
}

function showConfetti() {
  const colors = ['#f44336','#e91e63','#9c27b0','#3f51b5','#2196f3','#00bcd4','#4caf50','#ffeb3b','#ff9800','#ff5722'];
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;overflow:hidden';
  document.body.appendChild(wrap);
  for (let i = 0; i < 100; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    const color = colors[Math.floor(Math.random() * colors.length)];
    const size = 6 + Math.random() * 8;
    const duration = 2.2 + Math.random() * 1.8;
    const delay = Math.random() * 1.0;
    el.style.cssText = `
      left:${Math.random() * 100}%;
      top:-20px;
      width:${size}px;
      height:${size}px;
      background:${color};
      border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
      animation-duration:${duration}s;
      animation-delay:${delay}s;
    `;
    wrap.appendChild(el);
  }
  setTimeout(() => wrap.remove(), 4500);
}

export async function renderBoard(app, params) {
  const projectId = params.id;
  app.innerHTML = `
    <div class="app-layout">
      ${navbarHtml()}
      <div class="board-container" id="board-container">
        <div class="board-header">
          ${breadcrumbHtml()}
          <h2 id="board-title">Loading…</h2>
          <span id="board-project-desc" class="board-project-desc"></span>
          <span class="navbar-spacer"></span>
          <input type="search" class="form-control board-search" id="board-search" placeholder="Search tasks, tags &amp; risks…" />
        </div>
        <div class="board-scroll" id="board-scroll">
          <div class="spinner-wrap" style="height:300px;flex:1"><div class="spinner"></div></div>
        </div>
      </div>
    </div>
  `;

  setupNavbar({ projectId });

  let project, buckets, itemsByBucket = {}, projectRisks = [];
  let searchQ = '';
  // Role-based gating. `role` is set on the project payload (owner | editor | viewer).
  // Viewers see a read-only board; editors get full CRUD on contents but not project meta.
  let readOnly = false;

  async function loadAll() {
    try {
      [project, buckets] = await Promise.all([api.getProject(projectId), api.getBuckets(projectId)]);
      readOnly = project.role === 'viewer';
      document.getElementById('board-title').textContent = project.title;
      const descEl = document.getElementById('board-project-desc');
      if (descEl) descEl.textContent = project.description || '';

      // Add role pill on the board header so users know what they can do
      const headerEl = document.querySelector('.board-header');
      headerEl?.querySelector('.board-role-pill')?.remove();
      if (project.role && project.role !== 'owner') {
        const pill = document.createElement('span');
        pill.className = `board-role-pill board-role-${project.role}`;
        pill.textContent = project.role === 'viewer' ? 'View only' : 'Editor';
        const titleEl = document.getElementById('board-title');
        titleEl?.insertAdjacentElement('afterend', pill);
      }

      // Apply project picture as a banner on the board header only
      // Only allow /uploads/ paths to prevent CSS injection
      const container = document.getElementById('board-container');
      const header = container.querySelector('.board-header');
      const safePicture = project.picture && /^\/uploads\/[\w\-\.]+$/.test(project.picture) ? project.picture : null;
      if (safePicture) {
        header.style.backgroundImage = `url('${safePicture}')`;
        container.classList.add('has-bg');
      } else {
        header.style.backgroundImage = '';
        container.classList.remove('has-bg');
      }

      const [risks, ...taskResults] = await Promise.all([
        api.getRisks(projectId),
        ...buckets.map(b => api.getTasks(b.id)),
      ]);
      projectRisks = risks;
      buckets.forEach((b, i) => { itemsByBucket[b.id] = { tasks: taskResults[i] }; });

      // Pre-load checklists for all tasks that have items
      const allTasks = buckets.flatMap(b => itemsByBucket[b.id].tasks);
      const tasksWithChecklists = allTasks.filter(t => t.checklist_total > 0);
      if (tasksWithChecklists.length) {
        const clResults = await Promise.all(
          tasksWithChecklists.map(t => api.getChecklists(t.id).catch(() => []))
        );
        tasksWithChecklists.forEach((t, i) => { t.checklistItems = clResults[i]; });
      }

      renderBoard();
    } catch (err) {
      document.getElementById('board-scroll').innerHTML = `<p style="color:var(--red);padding:20px">${escHtml(err.message)}</p>`;
    }
  }

  function renderBoard() {
    const scroll = document.getElementById('board-scroll');
    if (!scroll) return;
    scroll.innerHTML = '';

    const filteredProjectRisks = filterItems(projectRisks);
    const risksHidden = !!localStorage.getItem(`orbit_risks_hidden_${projectId}`);

    // During search, hide buckets with no matching tasks and the risks column
    // when no risks match — show only relevant results
    const visibleBuckets = searchQ
      ? buckets.filter(b => filterItems(itemsByBucket[b.id]?.tasks || []).length > 0)
      : buckets;
    const showRiskCol = !risksHidden && (!searchQ || filteredProjectRisks.length > 0);

    // Insert columns in saved order (risks col position persisted per project)
    const savedRiskPos = parseInt(localStorage.getItem(`orbit_risks_pos_${projectId}`), 10);

    if (showRiskCol) {
      const riskCol = createProjectRiskCol(filteredProjectRisks);
      if (searchQ) {
        visibleBuckets.forEach(bucket => scroll.appendChild(createBucketCol(bucket)));
        scroll.appendChild(riskCol);
      } else {
        visibleBuckets.forEach((bucket, i) => {
          if (!isNaN(savedRiskPos) && i === savedRiskPos) scroll.appendChild(riskCol);
          scroll.appendChild(createBucketCol(bucket));
        });
        // Append risk col at end if not yet inserted (no saved pos, or pos >= buckets.length)
        if (isNaN(savedRiskPos) || savedRiskPos >= visibleBuckets.length) {
          scroll.appendChild(riskCol);
        }
      }
    } else {
      visibleBuckets.forEach(bucket => scroll.appendChild(createBucketCol(bucket)));
    }

    // Add Bucket + Add template bucket — stacked in one column.
    // Hidden for viewers (read-only access).
    if (!readOnly) {
      const addBucketCol = document.createElement('div');
      addBucketCol.className = 'add-col';
      const addBucketBtn = document.createElement('button');
      addBucketBtn.className = 'add-col-btn';
      addBucketBtn.textContent = '+ Add Bucket';
      addBucketBtn.onclick = () => showBucketModal();
      const tmplBtn = document.createElement('button');
      tmplBtn.className = 'add-col-btn add-col-btn--template';
      tmplBtn.textContent = '+ Add template bucket';
      tmplBtn.onclick = () => showTemplatePicker(tmplBtn);
      addBucketCol.appendChild(addBucketBtn);
      addBucketCol.appendChild(tmplBtn);
      scroll.appendChild(addBucketCol);
    }

    if (!readOnly) {
      makeBoardSortable(scroll);
      makeTasksDraggable(scroll);
    }
  }

  function makeBoardSortable(scroll) {
    if (isTouchDevice) return;  // HTML5 drag-and-drop doesn't fire from touch input
    let dragSrc = null;

    scroll.querySelectorAll('.bucket-col').forEach(col => {
      col.setAttribute('draggable', 'true');

      col.addEventListener('dragstart', (e) => {
        // Don't start column drag when interacting with buttons, inputs, textareas, or task cards
        if (e.composedPath().some(el => el.tagName &&
            ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A'].includes(el.tagName)) ||
            e.composedPath().some(el => el.classList?.contains('task-card'))) {
          e.preventDefault();
          return;
        }
        dragSrc = col;
        e.dataTransfer.effectAllowed = 'move';
        requestAnimationFrame(() => col.classList.add('dragging'));
      });

      col.addEventListener('dragend', () => {
        col.classList.remove('dragging');
        scroll.querySelectorAll('.bucket-col').forEach(c => c.classList.remove('drag-over'));
        if (dragSrc) persistColumnOrder(scroll);
        dragSrc = null;
      });

      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!dragSrc || col === dragSrc) return;
        scroll.querySelectorAll('.bucket-col').forEach(c => c.classList.remove('drag-over'));
        col.classList.add('drag-over');
        const rect = col.getBoundingClientRect();
        if (e.clientX < rect.left + rect.width / 2) {
          col.before(dragSrc);
        } else {
          col.after(dragSrc);
        }
      });
    });
  }

  function makeTasksDraggable(scroll) {
    if (isTouchDevice) return;  // HTML5 drag-and-drop doesn't fire from touch input
    let dragCard = null;
    let dragBucketId = null;

    scroll.querySelectorAll('.bucket-col:not(.risk-col)').forEach(col => {
      const bucketId = col.dataset.id;
      const itemsContainer = col.querySelector('.bucket-items');
      if (!itemsContainer) return;

      // Make each task card draggable
      itemsContainer.querySelectorAll('.task-card:not(.task-done)').forEach(card => {
        card.setAttribute('draggable', 'true');

        card.addEventListener('dragstart', (e) => {
          e.stopPropagation(); // prevent column drag
          dragCard = card;
          dragBucketId = bucketId;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', card.dataset.id);
          requestAnimationFrame(() => card.classList.add('task-dragging'));
        });

        card.addEventListener('dragend', () => {
          card.classList.remove('task-dragging');
          scroll.querySelectorAll('.bucket-items').forEach(c => c.classList.remove('task-drop-target'));
          scroll.querySelectorAll('.task-card').forEach(c => c.classList.remove('task-drop-above'));
          dragCard = null;
          dragBucketId = null;
        });
      });

      // Make bucket items container a drop zone
      itemsContainer.addEventListener('dragover', (e) => {
        if (!dragCard) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        itemsContainer.classList.add('task-drop-target');

        // Find the card we're hovering over for insertion position
        const cards = [...itemsContainer.querySelectorAll('.task-card:not(.task-dragging)')];
        cards.forEach(c => c.classList.remove('task-drop-above'));
        const afterCard = cards.find(c => {
          const rect = c.getBoundingClientRect();
          return e.clientY < rect.top + rect.height / 2;
        });
        if (afterCard) afterCard.classList.add('task-drop-above');
      });

      itemsContainer.addEventListener('dragleave', (e) => {
        if (!itemsContainer.contains(e.relatedTarget)) {
          itemsContainer.classList.remove('task-drop-target');
          itemsContainer.querySelectorAll('.task-card').forEach(c => c.classList.remove('task-drop-above'));
        }
      });

      itemsContainer.addEventListener('drop', async (e) => {
        e.preventDefault();
        itemsContainer.classList.remove('task-drop-target');
        itemsContainer.querySelectorAll('.task-card').forEach(c => c.classList.remove('task-drop-above'));
        if (!dragCard) return;

        const taskId = dragCard.dataset.id;
        const targetBucketId = bucketId;

        // Visual: move the card in DOM immediately
        const cards = [...itemsContainer.querySelectorAll('.task-card:not(.task-dragging)')];
        const afterCard = cards.find(c => {
          const rect = c.getBoundingClientRect();
          return e.clientY < rect.top + rect.height / 2;
        });
        if (afterCard) {
          itemsContainer.insertBefore(dragCard, afterCard);
        } else {
          itemsContainer.appendChild(dragCard);
        }

        // Compute new positions for every active card in the target container
        const activeCards = [...itemsContainer.querySelectorAll('.task-card:not(.task-done)')];
        const newPositions = activeCards.map((card, idx) => ({ id: card.dataset.id, position: idx + 1 }));
        const movedPos = newPositions.find(u => u.id === taskId)?.position ?? 1;

        try {
          // Persist the moved task (bucket + position)
          await api.updateTask(taskId, { bucket_id: targetBucketId, position: movedPos });
          // Persist shifted neighbors in the target bucket
          const others = newPositions.filter(u => u.id !== taskId);
          await Promise.all(others.map(u => api.updateTask(u.id, { position: u.position })));
          await loadAll();
        } catch (err) {
          toast('Failed to move task', 'error');
          await loadAll();
        }
      });
    });
  }

  async function persistColumnOrder(scroll) {
    const colEls = [...scroll.querySelectorAll('.bucket-col')];

    // Save risks column position (index in the columns list)
    const riskIdx = colEls.findIndex(c => c.classList.contains('risk-col'));
    if (riskIdx !== -1) {
      // Store as index among bucket cols only (exclude risk col itself)
      const bucketsBefore = colEls.slice(0, riskIdx).filter(c => !c.classList.contains('risk-col')).length;
      localStorage.setItem(`orbit_risks_pos_${projectId}`, bucketsBefore);
    }

    // Update bucket positions to match new DOM order
    const bucketEls = colEls.filter(c => c.dataset.id);
    const updates = [];
    bucketEls.forEach((el, i) => {
      const bucket = buckets.find(b => b.id == el.dataset.id);
      if (!bucket) return;
      const newPos = i + 1;
      if (bucket.position !== newPos) {
        bucket.position = newPos;
        updates.push(api.updateBucket(bucket.id, { position: newPos }));
      }
    });
    // Reorder local buckets array to match new order
    const orderedIds = bucketEls.map(el => parseInt(el.dataset.id));
    buckets.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));

    if (updates.length) {
      try {
        await Promise.all(updates);
      } catch {
        toast('Failed to save column order', 'error');
      }
    }
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

    const { tasks } = itemsByBucket[bucket.id] || { tasks: [] };
    const filteredTasks = filterItems(tasks);
    const activeTasks = filteredTasks.filter(t => !t.completed_at);
    const doneTasks = filteredTasks.filter(t => t.completed_at);

    col.innerHTML = `
      <div class="bucket-header">
        <span class="bucket-title" dir="auto" title="${escHtml(bucket.title)}">${escHtml(bucket.title)}</span>
        <span class="text-muted text-sm">${activeTasks.length}</span>
        ${readOnly ? '' : `<button class="bucket-menu-btn" title="Bucket options">&#8942;</button>`}
      </div>

      <div class="bucket-storyboard">
        <button type="button" class="btn btn-secondary btn-sm bucket-storyboard-btn ${bucket.storyboard ? 'has-content' : ''}" title="Open storyboard">Storyboard</button>
      </div>

      <div class="bucket-section tasks-section">
        <div class="bucket-section-label">Tasks</div>
        <div class="bucket-items" id="tasks-${bucket.id}">
          ${activeTasks.map(t => taskCardHtml(t)).join('')}
        </div>
        ${doneTasks.length > 0 ? `
          <details class="done-tasks-section">
            <summary class="done-tasks-toggle">&#10003; ${doneTasks.length} Done</summary>
            <div class="bucket-items done-tasks-list">
              ${doneTasks.map(t => taskCardHtml(t)).join('')}
            </div>
          </details>
        ` : ''}
        ${readOnly ? '' : `<button class="bucket-add-btn add-task" data-bucket="${bucket.id}">+ Task</button>`}
      </div>
    `;

    // Apply bucket color to header — only allow validated hex colors
    if (bucket.color && /^#[0-9a-fA-F]{6}$/.test(bucket.color)) {
      const header = col.querySelector('.bucket-header');
      header.style.background = bucket.color;
      header.style.borderRadius = 'var(--radius) var(--radius) 0 0';
      header.querySelector('.bucket-title').style.color = '#2a2a2a';
      // .bucket-menu-btn is omitted for viewers — guard the lookup
      const menuBtnEl = header.querySelector('.bucket-menu-btn');
      if (menuBtnEl) menuBtnEl.style.color = 'rgba(0,0,0,0.55)';
      col.querySelector('.text-muted').style.color = 'rgba(0,0,0,0.45)';
    }

    // Storyboard: click opens modal
    col.querySelector('.bucket-storyboard-btn').onclick = (e) => {
      e.stopPropagation();
      showStoryboardModal(bucket);
    };

    // Bucket menu (omitted for viewers)
    const menuBtn = col.querySelector('.bucket-menu-btn');
    if (menuBtn) {
      menuBtn.onclick = (e) => {
        e.stopPropagation();
        showBucketMenu(e.currentTarget, bucket);
      };
    }

    // Bucket title click to edit — viewers can't edit
    if (!readOnly) {
      col.querySelector('.bucket-title').onclick = () => showBucketModal(bucket);
    }

    // Task cards (active + done). Viewers can see the card but not open the edit modal.
    col.querySelectorAll('.task-card').forEach(card => {
      if (readOnly) {
        card.style.cursor = 'default';
      } else {
        card.onclick = async () => {
          const cached = tasks.find(t => t.id == card.dataset.id);
          if (!cached || cached.completed_at) return;
          try {
            const freshTask = await api.getTask(card.dataset.id);
            if (!freshTask.completed_at) showTaskModal(bucket.id, freshTask);
          } catch {
            showTaskModal(bucket.id, cached);
          }
        };
      }
      card.querySelector('.card-edit-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const freshTask = await api.getTask(card.dataset.id);
          showTaskModal(bucket.id, freshTask);
        } catch {
          const task = tasks.find(t => t.id == card.dataset.id);
          if (task) showTaskModal(bucket.id, task);
        }
      });
      card.querySelector('.card-duplicate-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const task = tasks.find(t => t.id == card.dataset.id);
        if (!task) return;
        try {
          const checklists = await api.getChecklists(task.id);
          showTaskModal(bucket.id, null, {
            description: task.description + '-Copy',
            tags: task.tags || [],
            checklists,
          });
        } catch {
          toast('Failed to duplicate task', 'error');
        }
      });
      card.querySelector('.card-delete-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this task?')) return;
        await api.deleteTask(card.dataset.id);
        toast('Task deleted', 'success');
        await loadAll();
      });
      card.querySelector('.card-menu-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const task = tasks.find(t => t.id == card.dataset.id);
        if (task) showTaskMenu(e.currentTarget, task, bucket.id);
      });
      card.querySelector('.task-check-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const task = tasks.find(t => t.id == card.dataset.id);
        if (!task) return;
        const nowDone = !task.completed_at;
        if (nowDone) {
          playDing();
          e.currentTarget.classList.add('task-check-shine');
        }
        try {
          await api.updateTask(task.id, { completed: nowDone });
          if (nowDone && checkConfettiMilestone()) showConfetti();
          await loadAll();
        } catch (err) {
          toast(err.message, 'error');
        }
      });

      // Mount inline checklists for this card
      const task = tasks.find(t => t.id == card.dataset.id);
      if (task && task.checklistItems) mountCardChecklists(card, task);
    });

    const addTaskBtn = col.querySelector('.add-task');
    if (addTaskBtn) addTaskBtn.onclick = () => showTaskModal(bucket.id);

    return col;
  }

  function mountCardChecklists(card, task) {
    const details = card.querySelector('.card-checklist-section');
    if (!details) return;
    const body = details.querySelector('.card-checklist-body');

    // Prevent summary click from opening the task modal
    details.querySelector('.card-checklist-summary')
      .addEventListener('click', e => e.stopPropagation());

    function renderBody() {
      const active = task.checklistItems.filter(i => !i.checked);
      const done = task.checklistItems.filter(i => i.checked);
      body.innerHTML = '';

      if (!active.length && !done.length) return;

      if (active.length) {
        const wrap = document.createElement('div');
        wrap.className = 'card-cl-active';
        active.forEach(item => wrap.appendChild(makeRow(item)));
        body.appendChild(wrap);
      }

      if (done.length) {
        const doneDetails = document.createElement('details');
        doneDetails.className = 'card-cl-done-section';
        const summary = document.createElement('summary');
        summary.className = 'card-cl-done-summary';
        summary.textContent = `\u2713 ${done.length} Done`;
        summary.addEventListener('click', e => e.stopPropagation());
        doneDetails.appendChild(summary);
        const wrap = document.createElement('div');
        wrap.className = 'card-cl-done-items';
        done.forEach(item => wrap.appendChild(makeRow(item)));
        doneDetails.appendChild(wrap);
        body.appendChild(doneDetails);
      }
    }

    function makeRow(item) {
      const row = document.createElement('div');
      row.className = `card-cl-item${item.checked ? ' done' : ''}`;
      const checkEl = readOnly
        ? `<span class="card-cl-check-btn read-only${item.checked ? ' checked' : ''}" aria-hidden="true" style="pointer-events:none;cursor:default">${item.checked ? '&#10003;' : ''}</span>`
        : `<button class="card-cl-check-btn${item.checked ? ' checked' : ''}" title="${item.checked ? 'Mark incomplete' : 'Mark done'}">${item.checked ? '&#10003;' : ''}</button>`;
      row.innerHTML = `
        ${checkEl}
        <span class="card-cl-text" dir="auto">${escHtml(item.text)}</span>
      `;
      if (readOnly) return row;
      row.querySelector('.card-cl-check-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const newChecked = !item.checked;
        try {
          await api.updateChecklist(item.id, { checked: newChecked });
          item.checked = newChecked;
          task.checklist_done = task.checklistItems.filter(i => i.checked).length;
          const badge = details.querySelector('.checklist-progress');
          if (badge) {
            badge.textContent = `${task.checklist_done}/${task.checklist_total}`;
            badge.className = `checklist-progress${task.checklist_done === task.checklist_total ? ' all-done' : ''}`;
          }
          renderBody();
        } catch { toast('Failed to update checklist', 'error'); }
      });
      return row;
    }

    renderBody();
  }

  function createProjectRiskCol(risks) {
    const col = document.createElement('div');
    col.className = 'bucket-col risk-col';

    const bodyContent = risks.length > 0
      ? risks.map(r => riskCardHtml(r)).join('')
      : `<div class="col-empty-state">No risks yet.<br>Click <b>+ Risk</b> to track one.</div>`;

    col.innerHTML = `
      <div class="bucket-header risk-col-header">
        <span class="bucket-title">Risks</span>
        <span class="risk-col-count">${risks.length}</span>
      </div>
      <div class="bucket-items" id="project-risks">
        ${bodyContent}
      </div>
      ${readOnly ? '' : `<button class="bucket-add-btn add-risk">+ Risk</button>`}
    `;

    col.querySelectorAll('#project-risks .risk-card').forEach(card => {
      if (readOnly) {
        card.style.cursor = 'default';
      } else {
        card.onclick = () => {
          const risk = projectRisks.find(r => r.id == card.dataset.id);
          if (risk) showRiskModal(risk);
        };
        card.querySelector('.card-edit-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const risk = projectRisks.find(r => r.id == card.dataset.id);
          if (risk) showRiskModal(risk);
        });
        card.querySelector('.card-delete-btn')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Delete this risk?')) return;
          await api.deleteRisk(card.dataset.id);
          toast('Risk deleted', 'success');
          await loadAll();
        });
      }
    });

    const addRiskBtn = col.querySelector('.add-risk');
    if (addRiskBtn) addRiskBtn.onclick = () => showRiskModal();
    return col;
  }

  function taskCardHtml(t) {
    const doneDate = t.completed_at
      ? formatDate(new Date(t.completed_at * 1000).toISOString().split('T')[0])
      : null;
    const ddClass = t.completed_at ? '' : dueDateClass(t.due_date);
    // On touch devices, render a single ⋮ menu instead of the 3-button cluster — the
    // cluster sits in the corner where RTL text starts and covers the description.
    const actionsHtml = readOnly ? '' : (isTouchDevice ? `
      <div class="card-actions card-actions-touch">
        <button class="card-menu-btn" title="More">&#8942;</button>
      </div>
    ` : `
      <div class="card-actions">
        ${!t.completed_at ? `<button class="card-action-btn card-duplicate-btn" title="Duplicate">&#10697;</button>` : ''}
        ${!t.completed_at ? `<button class="card-action-btn card-edit-btn" title="Edit">&#9998;</button>` : ''}
        <button class="card-action-btn card-delete-btn" title="Delete">&#128465;</button>
      </div>
    `);
    const checkBtnHtml = readOnly ? `
      <span class="task-check-btn read-only ${t.completed_at ? 'checked' : ''}" aria-hidden="true" style="pointer-events:none;cursor:default">${t.completed_at ? '&#10003;' : ''}</span>
    ` : `
      <button class="task-check-btn ${t.completed_at ? 'checked' : ''}" title="${t.completed_at ? 'Mark as incomplete' : 'Mark as done'}">
        ${t.completed_at ? '&#10003;' : ''}
      </button>
    `;
    return `
      <div class="card task-card ${t.completed_at ? 'task-done' : ''}" data-id="${t.id}">
        ${t.picture ? `<img class="card-thumb" src="${escHtml(t.picture)}" />` : ''}
        ${actionsHtml}
        <div class="task-body">
          ${checkBtnHtml}
          <div class="card-description" dir="auto">${escHtml(t.description)}</div>
        </div>
        ${t.checklist_total > 0 ? `
          <details class="card-checklist-section" data-task-id="${t.id}">
            <summary class="card-checklist-summary">
              <span class="checklist-progress ${t.checklist_done === t.checklist_total ? 'all-done' : ''}">${t.checklist_done}/${t.checklist_total}</span>
            </summary>
            <div class="card-checklist-body"></div>
          </details>
        ` : ''}
        <div class="card-footer">
          ${doneDate ? `<span class="task-done-date">&#10003; Done ${doneDate}</span>` : `<span class="priority ${escHtml(t.priority)}">${escHtml(t.priority)}</span>`}
          ${t.due_date ? `<span class="due-date ${ddClass}">${formatDate(t.due_date)}</span>` : ''}
          ${tagsHtml(t.tags)}
        </div>
      </div>
    `;
  }

  function riskCardHtml(r) {
    const cls = rpnClass(r.rpn);
    return `
      <div class="card risk-card" data-id="${r.id}">
        ${readOnly ? '' : `
        <div class="card-actions">
          <button class="card-action-btn card-edit-btn" title="Edit">&#9998;</button>
          <button class="card-action-btn card-delete-btn" title="Delete">&#128465;</button>
        </div>`}
        <div class="card-type-badge risk">Risk</div>
        ${r.photos?.length ? `<img src="${escHtml(r.photos[0])}" style="width:100%;height:80px;object-fit:cover;border-radius:4px;margin-bottom:6px" />` : ''}
        <div class="card-description" dir="auto">${escHtml(r.description)}</div>
        <div class="card-footer">
          <span class="rpn-badge ${cls}" title="RPN = Severity × Probability × Detectability">RPN ${r.rpn}</span>
          <span class="status-badge ${escHtml(r.status)}">${escHtml(r.status)}</span>
          ${tagsHtml(r.tags)}
        </div>
      </div>
    `;
  }

  // ---- Storyboard Modal ----
  function showStoryboardModal(bucket) {
    showModal(`
      <h2>Storyboard</h2>
      <p class="text-sm text-muted" style="margin:-8px 0 12px">${escHtml(bucket.title)}</p>
      <form id="storyboard-form">
        <div class="form-group">
          <textarea class="form-control" id="sb-text" rows="8" placeholder="Storyboard…" dir="auto" ${readOnly ? 'readonly' : ''}>${escHtml(bucket.storyboard || '')}</textarea>
        </div>
        <div id="sb-err" class="text-sm" style="color:var(--red);display:none;margin-bottom:8px;"></div>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="button" class="btn btn-secondary" id="sb-cancel">${readOnly ? 'Close' : 'Cancel'}</button>
          ${readOnly ? '' : `
            <span style="flex:1"></span>
            <button type="button" class="btn btn-secondary danger" id="sb-clear">Clear Storyboard</button>
            <button type="submit" class="btn btn-primary">Save</button>
          `}
        </div>
      </form>
    `);
    document.getElementById('sb-cancel').onclick = hideModal;
    if (readOnly) return;
    document.getElementById('sb-clear').onclick = () => {
      document.getElementById('sb-text').value = '';
      document.getElementById('sb-text').focus();
    };
    document.getElementById('storyboard-form').onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('sb-err');
      const btn = e.target.querySelector('[type=submit]');
      btn.disabled = true;
      const val = document.getElementById('sb-text').value;
      try {
        await api.updateBucket(bucket.id, { storyboard: val });
        bucket.storyboard = val;
        toast('Storyboard saved', 'success');
        hideModal();
        await loadAll();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
        btn.disabled = false;
      }
    };
  }

  // ---- Bucket Modal ----
  const BUCKET_COLORS = [
    // Row 1 — red → yellow → green
    { label: 'None',     value: '' },
    { label: 'Red',      value: '#F2A3A3' },
    { label: 'Coral',    value: '#F5B8AA' },
    { label: 'Orange',   value: '#F9C99A' },
    { label: 'Peach',    value: '#FDCFAA' },
    { label: 'Gold',     value: '#F0D8A0' },
    { label: 'Yellow',   value: '#F5E08A' },
    { label: 'Sage',     value: '#B8D8B0' },
    { label: 'Green',    value: '#9DD4A0' },
    { label: 'Mint',     value: '#A8EDD8' },
    // Row 2 — teal → blue → purple → pink
    { label: 'Teal',     value: '#7DC9B8' },
    { label: 'Cyan',     value: '#90D5E8' },
    { label: 'Sky',      value: '#A8D8F0' },
    { label: 'Blue',     value: '#9BB5E0' },
    { label: 'Lavender', value: '#C8B8F0' },
    { label: 'Purple',   value: '#BBA8E8' },
    { label: 'Lilac',    value: '#E0B8F5' },
    { label: 'Mauve',    value: '#E0B8D0' },
    { label: 'Pink',     value: '#F5A8C8' },
    { label: 'Rose',     value: '#F0B8C0' },
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
      <h2>${isEdit ? 'Edit Bucket' : 'New Bucket'}</h2>
      <form id="bucket-form">
        <div class="form-group">
          <label>Title *</label>
          <input class="form-control" id="b-title" value="${escHtml(bucket?.title || '')}" required dir="auto" />
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea class="form-control" id="b-desc" dir="auto">${escHtml(bucket?.description || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Color</label>
          <div class="color-swatches">${swatchesHtml}</div>
        </div>
        <div id="b-err" class="text-sm" style="color:var(--red);display:none;margin-bottom:8px;"></div>
        <div style="display:flex;gap:8px;justify-content:space-between">
          <button type="button" class="btn btn-secondary" id="b-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Create Bucket'}</button>
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
          toast('Bucket created', 'success');
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
  function showTaskModal(bucketId, task = null, prefill = {}) {
    const isEdit = !!task;
    showModal(`
      <h2>${isEdit ? 'Edit Task' : 'New Task'}</h2>
      <form id="task-form">
        <div class="form-group">
          <label>Description *</label>
          <input type="text" class="form-control" id="t-desc" required value="${escHtml(task?.description || prefill.description || '')}" dir="auto" />
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
          <div class="form-group form-group--reminder">
            <label class="reminder-label">
              <input type="checkbox" id="t-reminder" ${task?.reminder ? 'checked' : ''} />
              Reminder
            </label>
          </div>
        </div>
        <div class="form-group">
          <label>Image</label>
          ${task?.picture ? `<div style="margin-bottom:8px"><img src="${escHtml(task.picture)}" style="max-width:100%;max-height:140px;border-radius:4px;object-fit:cover" /></div>` : ''}
          <input type="file" id="t-picture" accept="image/*" class="form-control" style="padding:4px" />
        </div>
        <div class="form-group">
          <label>Tags</label>
          <div id="t-tags-input"></div>
        </div>
        <div class="form-group checklist-section">
          <label>Checklist</label>
          <div id="t-checklists">${isEdit ? '<div class="spinner" style="width:16px;height:16px;margin:4px 0"></div>' : ''}</div>
          <div class="checklist-add-row">
            <input type="text" id="t-new-checklist" class="form-control" placeholder="Add an item…" maxlength="500" dir="auto" />
            <button type="button" id="t-add-checklist" class="btn btn-secondary btn-sm">Add</button>
          </div>
        </div>
        <div id="t-err" class="text-sm" style="color:var(--red);display:none;margin-bottom:8px;"></div>
        <div style="display:flex;gap:8px;justify-content:space-between">
          <button type="button" class="btn btn-secondary" id="t-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Create Task'}</button>
        </div>
      </form>
    `);
    const projectTags = [...new Set([
      ...Object.values(itemsByBucket).flatMap(({ tasks }) => tasks.flatMap(t => t.tags || [])),
      ...projectRisks.flatMap(r => r.tags || []),
    ])];
    const tagsWidget = tagsInput(document.getElementById('t-tags-input'), task?.tags || prefill.tags || [], projectTags);
    document.getElementById('t-cancel').onclick = hideModal;

    // ---- Checklist logic ----
    const checklistContainer = document.getElementById('t-checklists');
    // Each entry: { id?: number, text: string, checked: boolean }
    let checklistItems = prefill.checklists ? prefill.checklists.map(c => ({ text: c.text, checked: false })) : [];

    function renderChecklistItems() {
      if (!checklistItems.length) {
        checklistContainer.innerHTML = '<p class="text-sm text-muted" style="margin:4px 0 8px">No items yet.</p>';
        return;
      }
      checklistContainer.innerHTML = checklistItems.map((item, idx) => `
        <div class="checklist-item" data-idx="${idx}">
          <button type="button" class="checklist-check-btn ${item.checked ? 'checked' : ''}" title="${item.checked ? 'Mark incomplete' : 'Mark done'}">
            ${item.checked ? '&#10003;' : ''}
          </button>
          <span class="checklist-text ${item.checked ? 'done' : ''}" dir="auto">${escHtml(item.text)}</span>
          <button type="button" class="checklist-delete-btn" title="Delete">&#10005;</button>
        </div>
      `).join('');

      checklistContainer.querySelectorAll('.checklist-item').forEach(row => {
        const idx = parseInt(row.dataset.idx, 10);
        row.querySelector('.checklist-check-btn').onclick = async () => {
          const item = checklistItems[idx];
          if (!item) return;
          if (isEdit && item.id) {
            try { await api.updateChecklist(item.id, { checked: !item.checked }); }
            catch { toast('Failed to update item', 'error'); return; }
          }
          item.checked = !item.checked;
          renderChecklistItems();
        };
        row.querySelector('.checklist-delete-btn').onclick = async () => {
          const item = checklistItems[idx];
          if (!item) return;
          if (isEdit && item.id) {
            try { await api.deleteChecklist(item.id); }
            catch { toast('Failed to delete item', 'error'); return; }
          }
          checklistItems.splice(idx, 1);
          renderChecklistItems();
        };
      });
    }

    // In edit mode, load existing items from API
    if (isEdit) {
      api.getChecklists(task.id).then(items => {
        checklistItems = items.map(i => ({ id: i.id, text: i.text, checked: !!i.checked }));
        renderChecklistItems();
      }).catch(() => {
        checklistContainer.innerHTML = '<p class="text-sm" style="color:var(--red)">Failed to load checklist.</p>';
      });
    } else if (checklistItems.length) {
      renderChecklistItems();
    }

    async function addChecklistItem() {
      const input = document.getElementById('t-new-checklist');
      const text = input.value.trim();
      if (!text) return;
      if (isEdit) {
        // Save immediately when editing an existing task
        try {
          const item = await api.createChecklist(task.id, text);
          checklistItems.push({ id: item.id, text: item.text, checked: !!item.checked });
          renderChecklistItems();
          input.value = '';
          input.focus();
        } catch (err) { toast(err.message, 'error'); }
      } else {
        // Queue locally — will be saved after the task is created
        checklistItems.push({ text, checked: false });
        renderChecklistItems();
        input.value = '';
        input.focus();
      }
    }

    document.getElementById('t-add-checklist').onclick = addChecklistItem;
    document.getElementById('t-new-checklist').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); }
    });

    document.getElementById('task-form').onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('t-err');
      const btn = e.target.querySelector('[type=submit]');
      btn.disabled = true;
      const fd = new FormData();
      fd.append('description', document.getElementById('t-desc').value);
      fd.append('priority', document.getElementById('t-priority').value);
      fd.append('due_date', document.getElementById('t-due').value || '');
      fd.append('reminder', document.getElementById('t-reminder').checked ? 'true' : 'false');
      fd.append('tags', JSON.stringify(tagsWidget.getValue()));
      const pic = document.getElementById('t-picture').files[0];
      if (pic) fd.append('picture', pic);
      try {
        if (isEdit) {
          await api.updateTask(task.id, fd);
          toast('Task updated', 'success');
        } else {
          const newTask = await api.createTask(bucketId, fd);
          // Save any queued checklist items
          if (checklistItems.length) {
            await Promise.all(checklistItems.map(item => api.createChecklist(newTask.id, item.text)));
          }
          playTaskCreate();
          toast('Task created', 'success');
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
  function showRiskModal(risk = null) {
    const isEdit = !!risk;
    const sv = risk?.severity || 5, pr = risk?.probability || 5, de = risk?.detectability || 5;
    showModal(`
      <h2>${isEdit ? 'Edit Risk' : 'New Risk'}</h2>
      <form id="risk-form">
        <div class="form-group">
          <label>Description *</label>
          <textarea class="form-control" id="r-desc" required dir="auto">${escHtml(risk?.description || '')}</textarea>
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
          <textarea class="form-control" id="r-solution" dir="auto">${escHtml(risk?.solution_description || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Image</label>
          ${risk?.photos?.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${risk.photos.map(p => `<img src="${escHtml(p)}" style="height:70px;border-radius:4px;object-fit:cover" />`).join('')}</div>` : ''}
          <input type="file" id="r-photo" accept="image/*" class="form-control" style="padding:4px" />
        </div>
        <div class="form-group">
          <label>Tags</label>
          <div id="r-tags-input"></div>
        </div>
        <div id="r-err" class="text-sm" style="color:var(--red);display:none;margin-bottom:8px;"></div>
        <div style="display:flex;gap:8px;justify-content:space-between">
          <button type="button" class="btn btn-secondary" id="r-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Create Risk'}</button>
        </div>
      </form>
    `);

    const projectTags = [...new Set([
      ...Object.values(itemsByBucket).flatMap(({ tasks }) => tasks.flatMap(t => t.tags || [])),
      ...projectRisks.flatMap(r => r.tags || []),
    ])];
    const tagsWidget = tagsInput(document.getElementById('r-tags-input'), risk?.tags || [], projectTags);
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
          await api.createRisk(projectId, fd);
          toast('Risk created', 'success');
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

  // ---- Bucket templates ----
  function showSaveTemplateModal(bucket) {
    showModal(`
      <h2>Save as template</h2>
      <form id="tmpl-form">
        <div class="form-group">
          <label>Template name</label>
          <input class="form-control" id="tmpl-name" required dir="auto" />
        </div>
        <div id="tmpl-err" class="text-sm" style="color:var(--red);display:none;margin-bottom:8px;"></div>
        <div style="display:flex;gap:8px;justify-content:space-between">
          <button type="button" class="btn btn-secondary" id="tmpl-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
    `);
    document.getElementById('tmpl-cancel').onclick = hideModal;
    document.getElementById('tmpl-form').onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById('tmpl-name').value.trim();
      if (!name) return;
      const tasks = (itemsByBucket[bucket.id]?.tasks || []).map(t => ({
        description: t.description,
        priority: t.priority || 'Medium',
        tags: t.tags || [],
        checklists: (t.checklistItems || []).map(c => c.text),
      }));
      const bucket_data = { title: bucket.title, tasks };
      const errEl = document.getElementById('tmpl-err');
      try {
        await api.createTemplate({ name, bucket_data: JSON.stringify(bucket_data) });
        hideModal();
        toast('Template saved', 'success');
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    };
  }

  async function showTemplatePicker(anchorBtn) {
    document.querySelectorAll('.dropdown').forEach(d => d.remove());
    const menu = document.createElement('div');
    menu.className = 'dropdown';
    menu.innerHTML = `<div class="dropdown-item" style="opacity:.6">Loading…</div>`;
    document.body.appendChild(menu);
    const rect = anchorBtn.getBoundingClientRect();
    menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
    menu.style.left = `${rect.left + window.scrollX}px`;

    let templates;
    try { templates = await api.getTemplates(); }
    catch (err) {
      menu.innerHTML = `<div class="dropdown-item" style="color:var(--red)">${escHtml(err.message)}</div>`;
      setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
      return;
    }
    if (!templates.length) {
      menu.innerHTML = `<div class="dropdown-item" style="opacity:.6">No templates yet</div>`;
    } else {
      menu.innerHTML = templates.map((t, i) =>
        `<button class="dropdown-item" data-idx="${i}">${escHtml(t.name)}</button>`
      ).join('');
      menu.querySelectorAll('[data-idx]').forEach((btn, i) => {
        btn.onclick = () => { menu.remove(); applyTemplate(templates[i]); };
      });
    }
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
  }

  async function applyTemplate(template) {
    const data = typeof template.bucket_data === 'string'
      ? JSON.parse(template.bucket_data) : template.bucket_data;
    try {
      const bucket = await api.createBucket(projectId, { title: data.title, description: '', color: '' });
      for (const taskDef of (data.tasks || [])) {
        const task = await api.createTask(bucket.id, {
          description: taskDef.description,
          priority: taskDef.priority || 'Medium',
          tags: taskDef.tags || [],
        });
        for (const text of (taskDef.checklists || [])) {
          await api.createChecklist(task.id, text);
        }
      }
      toast('Template applied', 'success');
      await loadAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---- Task dropdown menu (touch devices) ----
  // Mirrors showBucketMenu — single ⋮ on the card opens this; handler bodies match the
  // inline .card-edit-btn / .card-duplicate-btn / .card-delete-btn handlers above.
  function showTaskMenu(btn, task, bucketId) {
    document.querySelectorAll('.dropdown').forEach(d => d.remove());
    const menu = document.createElement('div');
    menu.className = 'dropdown';
    const editItem = task.completed_at ? '' :
      `<button class="dropdown-item" id="tm-edit">Edit</button>`;
    const dupItem = task.completed_at ? '' :
      `<button class="dropdown-item" id="tm-duplicate">Duplicate</button>`;
    menu.innerHTML = `
      ${editItem}
      ${dupItem}
      <button class="dropdown-item danger" id="tm-delete">Delete</button>
    `;
    document.body.appendChild(menu);
    const rect = btn.getBoundingClientRect();
    menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
    // Right-align so the dropdown doesn't overflow the card on narrow phones
    menu.style.left = `${rect.right + window.scrollX - menu.offsetWidth}px`;

    menu.querySelector('#tm-edit')?.addEventListener('click', async () => {
      menu.remove();
      try {
        const fresh = await api.getTask(task.id);
        showTaskModal(bucketId, fresh);
      } catch { showTaskModal(bucketId, task); }
    });
    menu.querySelector('#tm-duplicate')?.addEventListener('click', async () => {
      menu.remove();
      try {
        const checklists = await api.getChecklists(task.id);
        showTaskModal(bucketId, null, {
          description: task.description + '-Copy',
          tags: task.tags || [],
          checklists,
        });
      } catch { toast('Failed to duplicate task', 'error'); }
    });
    menu.querySelector('#tm-delete').addEventListener('click', async () => {
      menu.remove();
      if (!confirm('Delete this task?')) return;
      await api.deleteTask(task.id);
      toast('Task deleted', 'success');
      await loadAll();
    });

    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
  }

  // ---- Bucket dropdown menu ----
  function showBucketMenu(btn, bucket) {
    document.querySelectorAll('.dropdown').forEach(d => d.remove());
    const menu = document.createElement('div');
    menu.className = 'dropdown';
    menu.innerHTML = `
      <button class="dropdown-item" id="dm-edit">Edit Bucket</button>
      <button class="dropdown-item" id="dm-template">Add to template</button>
      <button class="dropdown-item danger" id="dm-delete">Delete Bucket</button>
    `;
    document.body.appendChild(menu);
    const rect = btn.getBoundingClientRect();
    menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
    menu.style.left = `${rect.left + window.scrollX}px`;

    menu.querySelector('#dm-edit').onclick = () => { menu.remove(); showBucketModal(bucket); };
    menu.querySelector('#dm-template').onclick = () => { menu.remove(); showSaveTemplateModal(bucket); };
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
