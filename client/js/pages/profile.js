import { api } from '../api.js';
import { toast, escHtml, getInitials } from '../utils.js';
import { navigate } from '../router.js';
import { navbarHtml, setupNavbar, breadcrumbHtml } from './projects.js';

async function importFromXml(xmlText, statusEl, opts = { projects: true, templates: true }) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid XML file');

  function child(el, tag) {
    return [...el.children].find(c => c.tagName.toLowerCase() === tag.toLowerCase()) || null;
  }
  function childText(el, tag) {
    return child(el, tag)?.textContent?.trim() || '';
  }
  function childTags(el) {
    const tagsEl = child(el, 'tags');
    return tagsEl ? [...tagsEl.children].map(c => c.textContent.trim()).filter(Boolean) : [];
  }
  function childItems(el, parentTag, itemTag) {
    const parent = child(el, parentTag);
    return parent ? [...parent.children].filter(c => c.tagName.toLowerCase() === itemTag.toLowerCase()).map(c => c.textContent.trim()).filter(Boolean) : [];
  }

  const projectEls   = opts.projects  ? [...(child(doc.documentElement, 'projects')?.children  || [])] : [];
  const templateEls  = opts.templates ? [...(child(doc.documentElement, 'templates')?.children || [])] : [];

  if (!projectEls.length && !templateEls.length) {
    throw new Error('No matching data found in file for the selected options');
  }

  const result = { projects: 0, buckets: 0, tasks: 0, risks: 0, templates: 0 };

  for (let pi = 0; pi < projectEls.length; pi++) {
    const projEl = projectEls[pi];
    statusEl.textContent = `Importing project ${pi + 1} of ${projectEls.length}…`;

    const fd = new FormData();
    fd.append('title', childText(projEl, 'title') || 'Imported Project');
    const desc = childText(projEl, 'description');
    if (desc) fd.append('description', desc);
    const pTags = childTags(projEl);
    if (pTags.length) fd.append('tags', JSON.stringify(pTags));

    const project = await api.createProject(fd);
    result.projects++;

    const bucketsEl = child(projEl, 'buckets');
    for (const bEl of (bucketsEl ? [...bucketsEl.children] : [])) {
      const bucket = await api.createBucket(project.id, {
        title: childText(bEl, 'title') || 'Bucket',
        description: childText(bEl, 'description') || null,
        color: childText(bEl, 'color') || null,
      });
      result.buckets++;

      const tasksEl = child(bEl, 'tasks');
      for (const tEl of (tasksEl ? [...tasksEl.children] : [])) {
        const tDesc = childText(tEl, 'description');
        if (!tDesc) continue;
        const task = await api.createTask(bucket.id, {
          description: tDesc,
          priority: childText(tEl, 'priority') || 'Medium',
          due_date: childText(tEl, 'due-date') || null,
          tags: childTags(tEl),
        });
        if (childText(tEl, 'completed') === 'true') {
          await api.updateTask(task.id, { completed: true });
        }
        result.tasks++;
      }
    }

    const risksEl = child(projEl, 'risks');
    for (const rEl of (risksEl ? [...risksEl.children] : [])) {
      const rDesc = childText(rEl, 'description');
      if (!rDesc) continue;
      await api.createRisk(project.id, {
        description: rDesc,
        severity: parseInt(childText(rEl, 'severity')) || 5,
        probability: parseInt(childText(rEl, 'probability')) || 5,
        detectability: parseInt(childText(rEl, 'detectability')) || 5,
        solution_description: childText(rEl, 'solution-description') || null,
        status: childText(rEl, 'status') || 'Open',
        tags: childTags(rEl),
      });
      result.risks++;
    }
  }

  for (let ti = 0; ti < templateEls.length; ti++) {
    const tmplEl = templateEls[ti];
    statusEl.textContent = `Importing template ${ti + 1} of ${templateEls.length}…`;

    const name = childText(tmplEl, 'name');
    if (!name) continue;
    const bucketTitle = childText(tmplEl, 'bucket-title');
    const tasksEl = child(tmplEl, 'tasks');
    const tasks = [];
    for (const tEl of (tasksEl ? [...tasksEl.children] : [])) {
      const description = childText(tEl, 'description');
      if (!description) continue;
      tasks.push({
        description,
        priority: childText(tEl, 'priority') || 'Medium',
        tags: childTags(tEl),
        checklists: childItems(tEl, 'checklists', 'item'),
      });
    }
    try {
      await api.createTemplate({ name, bucket_data: JSON.stringify({ title: bucketTitle, tasks }) });
      result.templates++;
    } catch (err) {
      // Skip duplicate templates silently
      if (!err.message?.includes('already exists')) throw err;
    }
  }

  return result;
}

export async function renderProfile(app) {
  // Fetch fresh user data so reminder_interval is always current
  let user = JSON.parse(localStorage.getItem('orbit_user') || '{}');
  try {
    const fresh = await api.me();
    user = { ...user, ...fresh };
    localStorage.setItem('orbit_user', JSON.stringify(user));
  } catch { /* use cached */ }
  const displayName = user.username || user.email || '';

  app.innerHTML = `
    <div class="app-layout">
      ${navbarHtml({ hideProfile: true })}
      <div class="page-content" style="overflow-y:auto">
        <div class="profile-page">

          ${breadcrumbHtml()}

          <!-- Profile card -->
          <div class="profile-hero">
            <div class="profile-avatar-wrap">
              <div class="avatar-lg" id="profile-avatar">
                ${user.profilePicture
                  ? `<img src="${escHtml(user.profilePicture)}" alt="Avatar" />`
                  : getInitials(user.email)
                }
              </div>
              <label class="avatar-change-btn" title="Change photo">
                &#9998;
                <input type="file" id="avatar-file" accept="image/*" style="display:none" />
              </label>
            </div>
            <div class="profile-hero-info">
              <div class="profile-hero-name">${escHtml(displayName)}</div>
              ${user.username ? `<div class="profile-hero-email">${escHtml(user.email || '')}</div>` : ''}
              <div class="profile-hero-label">Account Settings</div>
            </div>
          </div>

          <!-- Account card -->
          <div class="settings-card">
            <div class="settings-card-header">Account</div>
            <div class="settings-card-body">
              <form id="account-form">
                <div class="form-group" style="margin-bottom:0">
                  <label>Display Name</label>
                  <div style="display:flex;gap:8px">
                    <input class="form-control" id="username-input" value="${escHtml(user.username || '')}" placeholder="Enter a display name" />
                    <button type="submit" class="btn btn-primary" style="flex-shrink:0">Save</button>
                  </div>
                  <div class="form-hint">This name is shown on your profile. Leave blank to use your email.</div>
                </div>
              </form>
            </div>
          </div>

          <!-- Appearance card -->
          <div class="settings-card">
            <div class="settings-card-header">Appearance</div>
            <div class="settings-card-body">
              <div class="settings-row">
                <div>
                  <div class="settings-row-title">Dark Mode</div>
                  <div class="settings-row-desc">Switch between light and dark theme</div>
                </div>
                <label class="theme-toggle">
                  <input type="checkbox" id="dark-mode-toggle" ${localStorage.getItem('orbit_theme') === 'dark' ? 'checked' : ''} />
                  <span class="theme-toggle-track"><span class="theme-toggle-thumb"></span></span>
                </label>
              </div>
              <div class="settings-divider"></div>
              <div class="settings-row">
                <div>
                  <div class="settings-row-title">Sounds</div>
                  <div class="settings-row-desc">Play sounds on task creation and completion</div>
                </div>
                <label class="theme-toggle">
                  <input type="checkbox" id="sounds-toggle" ${localStorage.getItem('orbit_sounds_enabled') !== '0' ? 'checked' : ''} />
                  <span class="theme-toggle-track"><span class="theme-toggle-thumb"></span></span>
                </label>
              </div>
            </div>
          </div>

          <!-- Notifications card -->
          <div class="settings-card">
            <div class="settings-card-header">Notifications</div>
            <div class="settings-card-body">
              <div class="settings-row">
                <div>
                  <div class="settings-row-title">Task Digest Email</div>
                  <div class="settings-row-desc">Receive a summary email of all your pending tasks with due dates. Sent at 8:00 AM on the chosen schedule.</div>
                </div>
                <select class="form-control" id="reminder-interval" style="width:auto;flex-shrink:0">
                  <option value="0" ${!user.reminderInterval ? 'selected' : ''}>Off</option>
                  <option value="1" ${user.reminderInterval === 1 ? 'selected' : ''}>Daily</option>
                  <option value="3" ${user.reminderInterval === 3 ? 'selected' : ''}>Every 3 days</option>
                  <option value="7" ${user.reminderInterval === 7 ? 'selected' : ''}>Weekly</option>
                  <option value="14" ${user.reminderInterval === 14 ? 'selected' : ''}>Every 2 weeks</option>
                </select>
              </div>
              <div class="settings-divider"></div>
              <div style="display:flex;justify-content:flex-end">
                <button class="btn btn-primary btn-sm" id="save-notifications-btn">Save</button>
              </div>
            </div>
          </div>

          <!-- Data card -->
          <div class="settings-card">
            <div class="settings-card-header">Data</div>
            <div class="settings-card-body">
              <div class="settings-row" style="flex-wrap:wrap;gap:8px;align-items:center">
                <div>
                  <div class="settings-row-title">Include</div>
                  <div class="settings-row-desc">Select what to include in exports and imports.</div>
                </div>
                <div class="data-include-checks">
                  <label class="data-check-label">
                    <input type="checkbox" id="include-projects" checked />
                    Projects
                  </label>
                  <label class="data-check-label">
                    <input type="checkbox" id="include-templates" checked />
                    Templates
                  </label>
                </div>
              </div>
              <div class="settings-divider"></div>
              <div class="settings-row">
                <div>
                  <div class="settings-row-title">Export</div>
                  <div class="settings-row-desc">Download your selected data as an XML file.</div>
                </div>
                <button class="btn btn-outline" id="export-btn" style="flex-shrink:0">Export XML</button>
              </div>
              <div class="settings-divider"></div>
              <div class="settings-row" style="flex-wrap:wrap;gap:12px">
                <div style="flex:1;min-width:200px">
                  <div class="settings-row-title">Import</div>
                  <div class="settings-row-desc">Restore data from a previously exported Orbit XML file. Existing data is not affected.</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
                  <div style="display:flex;gap:8px;align-items:center">
                    <label class="btn btn-outline" style="cursor:pointer;margin:0">
                      Choose File
                      <input type="file" id="import-file" accept=".xml" style="display:none" />
                    </label>
                    <span id="import-filename" class="text-muted" style="font-size:13px">No file chosen</span>
                  </div>
                  <button class="btn btn-primary" id="import-btn" disabled>Import</button>
                </div>
              </div>
              <p id="import-status" style="font-size:13px;color:var(--text-secondary);margin:4px 0 0;min-height:18px"></p>
            </div>
          </div>

          <!-- Change Password card -->
          <div class="settings-card">
            <div class="settings-card-header">Change Password</div>
            <div class="settings-card-body">
              <form id="password-form">
                <div class="form-group">
                  <label>Current Password</label>
                  <input type="password" class="form-control" id="cur-pass" autocomplete="current-password" />
                </div>
                <div class="form-group">
                  <label>New Password</label>
                  <input type="password" class="form-control" id="new-pass" autocomplete="new-password" minlength="8" />
                  <div class="form-hint">Min 8 characters, including uppercase, number and special character</div>
                </div>
                <div class="form-group">
                  <label>Confirm New Password</label>
                  <input type="password" class="form-control" id="conf-pass" autocomplete="new-password" />
                </div>
                <div id="pw-err" class="text-sm" style="color:var(--red);display:none;margin-bottom:12px;"></div>
                <button type="submit" class="btn btn-primary">Update Password</button>
              </form>
            </div>
          </div>

          <!-- Danger Zone card -->
          <div class="settings-card danger-zone">
            <div class="settings-card-header">Danger Zone</div>
            <div class="settings-card-body">
              <div class="settings-row">
                <div>
                  <div class="settings-row-title" style="color:var(--red)">Delete Account</div>
                  <div class="settings-row-desc">Permanently delete your account and all associated projects, tasks, and risks. This cannot be undone.</div>
                </div>
                <button class="btn btn-danger" id="delete-account-btn" style="flex-shrink:0">Delete Account</button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  `;

  setupNavbar();

  // Notifications — save reminder interval
  document.getElementById('save-notifications-btn').addEventListener('click', async () => {
    const btn = document.getElementById('save-notifications-btn');
    btn.disabled = true;
    const fd = new FormData();
    fd.append('reminder_interval', document.getElementById('reminder-interval').value);
    try {
      const updated = await api.updateProfile(fd);
      const stored = JSON.parse(localStorage.getItem('orbit_user') || '{}');
      stored.reminderInterval = updated.reminderInterval;
      localStorage.setItem('orbit_user', JSON.stringify(stored));
      toast('Notification settings saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('dark-mode-toggle').addEventListener('change', (e) => {
    const theme = e.target.checked ? 'dark' : 'light';
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('orbit_theme', theme);
  });

  document.getElementById('sounds-toggle').addEventListener('change', (e) => {
    localStorage.setItem('orbit_sounds_enabled', e.target.checked ? '1' : '0');
  });

  // Avatar upload
  document.getElementById('avatar-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('profile_picture', file);
    try {
      const updated = await api.updateProfile(fd);
      const stored = JSON.parse(localStorage.getItem('orbit_user') || '{}');
      stored.profilePicture = updated.profilePicture;
      localStorage.setItem('orbit_user', JSON.stringify(stored));
      toast('Profile picture updated', 'success');
      const avatarEl = document.getElementById('profile-avatar');
      if (updated.profilePicture) {
        avatarEl.innerHTML = `<img src="${escHtml(updated.profilePicture)}" alt="Avatar" />`;
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Username update
  document.getElementById('account-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const fd = new FormData();
    fd.append('username', document.getElementById('username-input').value.trim());
    try {
      const updated = await api.updateProfile(fd);
      const stored = JSON.parse(localStorage.getItem('orbit_user') || '{}');
      stored.username = updated.username;
      localStorage.setItem('orbit_user', JSON.stringify(stored));
      toast('Display name updated', 'success');
      // Refresh hero name
      document.querySelector('.profile-hero-name').textContent = updated.username || updated.email;
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Delete account
  document.getElementById('delete-account-btn').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to delete your account? All your projects, tasks and risks will be permanently deleted. This cannot be undone.')) return;
    try {
      await api.deleteAccount();
      localStorage.removeItem('orbit_user');
      document.cookie = 'orbit_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Strict';
      navigate('/login');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Export
  document.getElementById('export-btn').addEventListener('click', async () => {
    const projects  = document.getElementById('include-projects').checked;
    const templates = document.getElementById('include-templates').checked;
    if (!projects && !templates) {
      toast('Select at least one option to export', 'error');
      return;
    }
    const btn = document.getElementById('export-btn');
    btn.disabled = true;
    btn.textContent = 'Exporting…';
    try {
      await api.exportData({ projects, templates });
      toast('Export downloaded', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Export XML';
    }
  });

  // Import — file picker
  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    document.getElementById('import-filename').textContent = file ? file.name : 'No file chosen';
    document.getElementById('import-btn').disabled = !file;
    document.getElementById('import-status').textContent = '';
  });

  // Import — run
  document.getElementById('import-btn').addEventListener('click', async () => {
    const file = document.getElementById('import-file').files[0];
    if (!file) return;
    const projects  = document.getElementById('include-projects').checked;
    const templates = document.getElementById('include-templates').checked;
    if (!projects && !templates) {
      toast('Select at least one option to import', 'error');
      return;
    }
    const btn = document.getElementById('import-btn');
    const statusEl = document.getElementById('import-status');
    btn.disabled = true;
    statusEl.textContent = 'Reading file…';
    try {
      const xmlText = await file.text();
      const result = await importFromXml(xmlText, statusEl, { projects, templates });
      statusEl.textContent = '';
      const parts = [];
      if (result.projects)  parts.push(`${result.projects} project(s), ${result.buckets} bucket(s), ${result.tasks} task(s), ${result.risks} risk(s)`);
      if (result.templates) parts.push(`${result.templates} template(s)`);
      toast(`Imported ${parts.join(' and ')}`, 'success');
      document.getElementById('import-file').value = '';
      document.getElementById('import-filename').textContent = 'No file chosen';
      btn.disabled = true;
    } catch (err) {
      statusEl.textContent = '';
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });

  // Password change
  document.getElementById('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('pw-err');
    errEl.style.display = 'none';
    const cur = document.getElementById('cur-pass').value;
    const np = document.getElementById('new-pass').value;
    const conf = document.getElementById('conf-pass').value;

    if (!cur || !np) {
      errEl.textContent = 'Both current and new passwords are required';
      errEl.style.display = 'block';
      return;
    }
    if (np !== conf) {
      errEl.textContent = 'New passwords do not match';
      errEl.style.display = 'block';
      return;
    }

    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Updating…';

    const fd = new FormData();
    fd.append('current_password', cur);
    fd.append('new_password', np);

    try {
      await api.updateProfile(fd);
      toast('Password updated', 'success');
      e.target.reset();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Update Password';
    }
  });
}
