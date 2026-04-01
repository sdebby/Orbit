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
  const close = () => {
    overlay.classList.add('hidden');
    if (onClose) onClose();
  };
  closeBtn.onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
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

// Tags input widget — returns { getValue, setValue, mount }
export function tagsInput(container, initial = []) {
  let tags = [...initial];

  function render() {
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
    inp.onkeydown = (e) => {
      if ((e.key === 'Enter' || e.key === ',') && inp.value.trim()) {
        e.preventDefault();
        const val = inp.value.trim().replace(',', '');
        if (val && !tags.includes(val)) tags.push(val);
        inp.value = '';
        render();
      } else if (e.key === 'Backspace' && !inp.value && tags.length) {
        tags.pop();
        render();
      }
    };
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
