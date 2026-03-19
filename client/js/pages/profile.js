import { api } from '../api.js';
import { toast, escHtml, getInitials } from '../utils.js';
import { navigate } from '../router.js';
import { navbarHtml, setupNavbar } from './projects.js';

export async function renderProfile(app) {
  const user = JSON.parse(localStorage.getItem('orbit_user') || '{}');
  const displayName = user.username || user.email || '';

  app.innerHTML = `
    <div class="app-layout">
      ${navbarHtml({ hideProfile: true })}
      <div class="page-content" style="overflow-y:auto">
        <div class="profile-page">

          <button class="back-link" id="profile-back-btn">&#8592; Back to Projects</button>

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
  document.getElementById('profile-back-btn').onclick = () => navigate('/projects');

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
      localStorage.removeItem('orbit_token');
      localStorage.removeItem('orbit_user');
      navigate('/login');
    } catch (err) {
      toast(err.message, 'error');
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
