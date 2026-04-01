import { api } from '../api.js';
import { toast, escHtml, getInitials } from '../utils.js';
import { navigate } from '../router.js';
import { navbarHtml, setupNavbar, breadcrumbHtml } from './projects.js';

async function importFromXml(xmlText, statusEl) {
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

  const projectEls = [...(child(doc.documentElement, 'projects')?.children || [])];
  if (!projectEls.length) throw new Error('No projects found in file');

  const result = { projects: 0, buckets: 0, tasks: 0, risks: 0 };

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

  return result;
}

export async function renderProfile(app) {
  const user = JSON.parse(localStorage.getItem('orbit_user') || '{}');
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
            </div>
          </div>

          <!-- Data card -->
          <div class="settings-card">
            <div class="settings-card-header">Data</div>
            <div class="settings-card-body">
              <div class="settings-row">
                <div>
                  <div class="settings-row-title">Export Projects</div>
                  <div class="settings-row-desc">Download all your projects, buckets, tasks and risks as an XML file.</div>
                </div>
                <button class="btn btn-outline" id="export-btn" style="flex-shrink:0">Export XML</button>
              </div>
              <div class="settings-divider"></div>
              <div class="settings-row" style="flex-wrap:wrap;gap:12px">
                <div style="flex:1;min-width:200px">
                  <div class="settings-row-title">Import Projects</div>
                  <div class="settings-row-desc">Restore projects from a previously exported Orbit XML file. Existing projects are not affected.</div>
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

  document.getElementById('dark-mode-toggle').addEventListener('change', (e) => {
    const theme = e.target.checked ? 'dark' : 'light';
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('orbit_theme', theme);
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
    const btn = document.getElementById('export-btn');
    btn.disabled = true;
    btn.textContent = 'Exporting…';
    try {
      await api.exportProjects();
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
    const btn = document.getElementById('import-btn');
    const statusEl = document.getElementById('import-status');
    btn.disabled = true;
    statusEl.textContent = 'Reading file…';
    try {
      const xmlText = await file.text();
      const result = await importFromXml(xmlText, statusEl);
      statusEl.textContent = '';
      toast(`Imported ${result.projects} project(s), ${result.buckets} bucket(s), ${result.tasks} task(s), ${result.risks} risk(s)`, 'success');
      document.getElementById('import-file').value = '';
      document.getElementById('import-filename').textContent = 'No file chosen';
    } catch (err) {
      statusEl.textContent = '';
      toast(err.message, 'error');
    } finally {
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
