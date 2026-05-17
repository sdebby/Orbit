import { api } from '../api.js';
import { navigate } from '../router.js';
import { escHtml, toast } from '../utils.js';

function leftPanel() {
  return `
    <div class="login-left">
      <div class="login-orbit-ring"><div class="login-orbit-dot"></div></div>
      <div class="login-orbit-ring"><div class="login-orbit-dot"></div></div>
      <div class="login-orbit-ring"><div class="login-orbit-dot"></div></div>
      <div class="login-orbit-ring"><div class="login-orbit-dot"></div></div>
      <div class="login-left-content">
        <div class="login-logo-wrap">
          <img src="/icon-light-512.png" alt="Orbit" class="login-logo-icon" />
          <span class="login-logo-name">Orbit</span>
        </div>
        <p class="login-tagline">Project Management</p>
        <h1 class="login-headline">You're invited.<br><span>Join Orbit.</span></h1>
        <p class="login-sub">A teammate has shared a project with you. Create an account to view it.</p>
      </div>
    </div>`;
}

function loadingShell() {
  return `
    <div class="login-wrap">
      <div class="login-inner">
        ${leftPanel()}
        <div class="login-right">
          <div class="login-form-card">
            <div class="spinner-wrap" style="height:120px"><div class="spinner"></div></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function errorShell(message) {
  return `
    <div class="login-wrap">
      <div class="login-inner">
        ${leftPanel()}
        <div class="login-right">
          <div class="login-form-card">
            <h2 class="login-form-title">Invitation unavailable</h2>
            <p class="login-form-sub" style="color:var(--red)">${escHtml(message)}</p>
            <a href="#/login" class="login-btn" style="display:block;text-align:center;text-decoration:none;margin-top:16px">Back to sign in</a>
          </div>
        </div>
      </div>
    </div>
  `;
}

export async function renderAcceptInvite(app, params) {
  const token = params.token;
  app.innerHTML = loadingShell();

  let info;
  try { info = await api.getInvite(token); }
  catch (err) { app.innerHTML = errorShell(err.message || 'Invitation not found'); return; }

  // Already-registered branch: show a sign-in CTA. Pending invite will be promoted on next login or /me.
  if (info.alreadyRegistered) {
    app.innerHTML = `
      <div class="login-wrap">
        <div class="login-inner">
          ${leftPanel()}
          <div class="login-right">
            <div class="login-form-card">
              <h2 class="login-form-title">You're invited</h2>
              <p class="login-form-sub" style="margin-bottom:16px">
                <strong>${escHtml(info.ownerName)}</strong> invited you to <strong>${escHtml(info.projectTitle)}</strong>
                as <strong>${escHtml(info.role)}</strong>.
              </p>
              <p class="login-form-sub" style="margin-bottom:24px">
                You already have an Orbit account with <strong>${escHtml(info.email)}</strong>. Sign in to view the shared project.
              </p>
              <a href="#/login" class="login-btn" style="display:block;text-align:center;text-decoration:none">Sign in to Orbit</a>
            </div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-inner">
        ${leftPanel()}
        <div class="login-right">
          <div class="login-form-card">
            <h2 class="login-form-title">You're invited</h2>
            <p class="login-form-sub" style="margin-bottom:16px">
              <strong>${escHtml(info.ownerName)}</strong> invited you to <strong>${escHtml(info.projectTitle)}</strong>
              as <strong>${escHtml(info.role)}</strong>.
            </p>
            <p class="login-form-sub" style="margin-bottom:24px">
              Create your free Orbit account to accept the invitation.
            </p>
            <form id="invite-form">
              <div class="login-field-group">
                <label class="login-field-label">Email</label>
                <input type="email" class="login-field-input" id="invite-email" value="${escHtml(info.email)}" disabled />
              </div>
              <div class="login-field-group">
                <label class="login-field-label">Choose a password</label>
                <input type="password" class="login-field-input" id="invite-password" placeholder="••••••••••" autocomplete="new-password" required minlength="8" />
                <div style="font-size:11px;color:#3a4060;margin-top:5px;">Min 8 characters, including uppercase, number and special character</div>
              </div>
              <div class="login-field-group">
                <label class="login-field-label">Confirm password</label>
                <input type="password" class="login-field-input" id="invite-confirm" placeholder="••••••••••" autocomplete="new-password" required />
              </div>
              <div id="invite-error" class="login-error"></div>
              <button type="submit" class="login-btn">Create account &amp; accept</button>
            </form>
            <div class="login-register-row" style="margin-top:16px">
              <a href="#/login">Already have an account? Sign in</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('invite-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('invite-error');
    errEl.style.display = 'none';
    const pw = document.getElementById('invite-password').value;
    const cf = document.getElementById('invite-confirm').value;
    if (pw !== cf) {
      errEl.textContent = 'Passwords do not match';
      errEl.style.color = '#ff6b6b';
      errEl.style.display = 'block';
      return;
    }
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Creating account…';
    try {
      const data = await api.registerWithInvite(token, pw);
      const theme = data.theme || 'light';
      localStorage.setItem('orbit_user', JSON.stringify({
        userId: data.userId, email: data.email, username: data.username,
        profilePicture: data.profilePicture, isAdmin: data.isAdmin,
        workspacesEnabled: data.workspacesEnabled || 0, theme,
      }));
      localStorage.setItem('orbit_theme', theme);
      document.body.setAttribute('data-theme', theme);
      toast('Welcome to Orbit!', 'success');
      navigate('/projects');
    } catch (err) {
      // If account turned out to exist already, redirect to login
      if (err.status === 409) {
        toast('You already have an account — please sign in.', 'info');
        navigate('/login');
        return;
      }
      errEl.textContent = err.message;
      errEl.style.color = '#ff6b6b';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Create account & accept';
    }
  });
}
