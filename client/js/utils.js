export function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// SECURITY: all user-controlled values in `html` MUST be escaped with escHtml() before passing in.
export function showModal(html, onClose) {
  const content = document.getElementById('modal-content');
  content.innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
  const closeBtn = document.getElementById('modal-close');
  const overlay = document.getElementById('modal-overlay');
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Enter' && e.ctrlKey) {
      const submit = content.querySelector('button[type="submit"]');
      if (submit) submit.click();
    }
  };
  const close = () => {
    overlay.classList.add('hidden');
    document.removeEventListener('keydown', onKeyDown);
    if (onClose) onClose();
  };
  closeBtn.onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  document.addEventListener('keydown', onKeyDown);
  const hasCancel = Array.from(content.querySelectorAll('button'))
    .some(b => b.textContent.trim() === 'Cancel');
  closeBtn.style.display = hasCancel ? 'none' : '';
  const firstField = content.querySelector('input:not([type=hidden]):not([type=file]), textarea, select');
  if (firstField) requestAnimationFrame(() => firstField.focus());
}

export function hideModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function isOverdue(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

export function dueDateClass(dateStr) {
  if (!dateStr) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = dateStr.split('-').map(Number);
  const due = new Date(y, m - 1, d);
  if (due < today) return 'overdue';
  if ((due - today) / 86400000 <= 2) return 'due-soon';
  return '';
}

export function rpnClass(rpn) {
  if (rpn <= 100) return 'low';
  if (rpn <= 500) return 'medium';
  return '';
}

export function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

export function tagsHtml(tags) {
  if (!tags || !tags.length) return '';
  return tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join('');
}

// Tags input widget — returns { getValue, setValue }
export function tagsInput(container, initial = [], suggestions = []) {
  let tags = [...initial];
  let dropdown = null;

  function removeDropdown() {
    if (dropdown) { dropdown.remove(); dropdown = null; }
  }

  function render() {
    removeDropdown();
    container.innerHTML = '';
    container.className = 'tags-input-box';
    const wrap = document.createElement('div');
    wrap.className = 'tags-input-wrap';
    tags.forEach((tag, i) => {
      const span = document.createElement('span');
      span.className = 'tag removable';
      span.textContent = tag;
      span.onclick = () => { tags.splice(i, 1); render(); };
      wrap.appendChild(span);
    });
    const inp = document.createElement('input');
    inp.placeholder = 'Add tag, press Enter';

    function addTag(val) {
      const v = val.trim().replace(',', '');
      if (v && !tags.includes(v)) tags.push(v);
      inp.value = '';
      render();
    }

    function showDropdown() {
      removeDropdown();
      const q = inp.value.trim().toLowerCase();
      if (!q || !suggestions.length) return;
      const matches = suggestions.filter(s =>
        s.toLowerCase().includes(q) && !tags.includes(s)
      );
      if (!matches.length) return;
      dropdown = document.createElement('div');
      dropdown.className = 'tags-suggest';
      matches.forEach(s => {
        const item = document.createElement('div');
        item.className = 'tags-suggest-item';
        item.textContent = s;
        item.onmousedown = (e) => { e.preventDefault(); addTag(s); };
        dropdown.appendChild(item);
      });
      container.appendChild(dropdown);
    }

    inp.onkeydown = (e) => {
      if ((e.key === 'Enter' || e.key === ',') && inp.value.trim()) {
        e.preventDefault();
        addTag(inp.value);
      } else if (e.key === 'Backspace' && !inp.value && tags.length) {
        tags.pop();
        render();
      } else if (e.key === 'Escape') {
        removeDropdown();
      }
    };
    inp.oninput = showDropdown;
    inp.onblur = () => setTimeout(removeDropdown, 150);

    wrap.appendChild(inp);
    container.appendChild(wrap);
    container.onclick = () => inp.focus();
  }

  render();
  return {
    getValue: () => [...tags],
    setValue: (t) => { tags = [...t]; render(); },
  };
}

export function getInitials(email) {
  if (!email) return '?';
  return email.charAt(0).toUpperCase();
}
