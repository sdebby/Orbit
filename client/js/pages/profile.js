import { api } from '../api.js';
import { toast, escHtml, getInitials } from '../utils.js';
import { navigate } from '../router.js';
import { navbarHtml, setupNavbar } from './projects.js';

export async function renderProfile(app) {
  const user = JSON.parse(localStorage.getItem('orbit_user') || '{}');

  app.innerHTML = `
    <div class="app-layout">
      ${navbarHtml()}
      <div class="page-content" style="overflow-y:auto">
        <div class="profile-page">
          <button class="back-link" id="profile-back-btn" style="margin-bottom:16px">&#8592; Back to Projects</button>
          <h2>Profile Settings</h2>

          <div class="avatar-section">
            <div class="avatar-lg" id="profile-avatar">
              ${user.profilePicture
                ? `<img src="${escHtml(user.profilePicture)}" alt="Avatar" />`
                : getInitials(user.email)
              }
            </div>
            <div>
              <div style="font-weight:600">${escHtml(user.email || '')}</div>
              <label class="btn btn-ghost btn-sm" style="margin-top:8px;cursor:pointer">
                Change Photo
                <input type="file" id="avatar-file" accept="image/*" style="display:none" />
              </label>
            </div>
          </div>

          <hr class="divider" />
          <h3 style="margin-bottom:16px;font-size:16px">Appearance</h3>
          <label class="theme-toggle">
            <input type="checkbox" id="dark-mode-toggle" ${localStorage.getItem('orbit_theme') === 'dark' ? 'checked' : ''} />
            <span class="theme-toggle-track"><span class="theme-toggle-thumb"></span></span>
            Dark Mode
          </label>

          <hr class="divider" style="margin-top:20px" />
          <h3 style="margin-bottom:16px;font-size:16px">Change Password</h3>
          <form id="password-form">
            <div class="form-group">
              <label>Current Password</label>
              <input type="password" class="form-control" id="cur-pass" autocomplete="current-password" />
            </div>
            <div class="form-group">
              <label>New Password</label>
              <input type="password" class="form-control" id="new-pass" autocomplete="new-password" minlength="6" />
              <div class="form-hint">At least 6 characters</div>
            </div>
            <div class="form-group">
              <label>Confirm New Password</label>
              <input type="password" class="form-control" id="conf-pass" autocomplete="new-password" />
            </div>
            <div id="pw-err" class="text-sm" style="color:var(--red);display:none;margin-bottom:8px;"></div>
            <button type="submit" class="btn btn-primary">Update Password</button>
          </form>
        </div>
      </div>
    </div>
  `;

  setupNavbar();
  document.getElementById('profile-back-btn').onclick = () => navigate('/projects');

  document.getElementById('dark-mode-toggle').addEventListener('change', (e) => {
    if (e.target.checked) {
      document.body.classList.add('dark');
      localStorage.setItem('orbit_theme', 'dark');
    } else {
      document.body.classList.remove('dark');
      localStorage.setItem('orbit_theme', 'light');
    }
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
