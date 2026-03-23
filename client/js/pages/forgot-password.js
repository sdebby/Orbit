import { api } from '../api.js';
import { toast } from '../utils.js';
import { navigate } from '../router.js';

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
        <h1 class="login-headline">Your projects.<br><span>Your orbit.</span></h1>
        <p class="login-sub">Track tasks, manage risks, and keep every project in alignment — all in one place.</p>
      </div>
    </div>`;
}

export function renderForgotPassword(app) {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-inner">
        ${leftPanel()}
        <div class="login-right">
          <div class="login-form-card">
            <h2 class="login-form-title">Reset password</h2>
            <p class="login-form-sub">Enter your email to receive a reset link</p>
            <form id="forgot-form">
              <div class="login-field-group">
                <label class="login-field-label">Email</label>
                <input type="email" class="login-field-input" id="email" placeholder="you@example.com" autocomplete="email" required />
              </div>
              <div id="forgot-msg" class="login-error" style="display:none;"></div>
              <button type="submit" class="login-btn">Send Reset Link</button>
            </form>
            <div class="login-divider">
              <div class="login-divider-line"></div>
              <span class="login-divider-text">remember it?</span>
              <div class="login-divider-line"></div>
            </div>
            <div class="login-register-row">
              <a href="#/login">Back to sign in</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const msgEl = document.getElementById('forgot-msg');
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    msgEl.style.display = 'none';

    try {
      const data = await api.forgotPassword(email);
      msgEl.textContent = data.message;
      msgEl.style.color = '#2a8a5a';
      msgEl.style.display = 'block';
      btn.textContent = 'Sent!';
    } catch (err) {
      msgEl.textContent = err.message;
      msgEl.style.color = '#ff6b6b';
      msgEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Send Reset Link';
    }
  });
}

export async function renderResetPassword(app, params) {
  const token = params.token;

  // Show loading state while validating token
  app.innerHTML = `
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

  // Validate token before showing the form
  try {
    await api.validateResetToken(token);
  } catch (err) {
    app.innerHTML = `
      <div class="login-wrap">
        <div class="login-inner">
          ${leftPanel()}
          <div class="login-right">
            <div class="login-form-card">
              <h2 class="login-form-title">Link unavailable</h2>
              <p class="login-form-sub" style="color:var(--red)">${err.message}</p>
              <a href="#/forgot-password" class="login-btn" style="display:block;text-align:center;text-decoration:none;margin-top:16px">Request a new link</a>
              <div class="login-register-row" style="margin-top:16px;">
                <a href="#/login">Back to sign in</a>
              </div>
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
            <h2 class="login-form-title">Set new password</h2>
            <p class="login-form-sub">Choose a strong password for your account</p>
            <form id="reset-form">
              <div class="login-field-group">
                <label class="login-field-label">New Password</label>
                <input type="password" class="login-field-input" id="password" placeholder="••••••••••" required minlength="8" />
              </div>
              <div class="login-field-group">
                <label class="login-field-label">Confirm Password</label>
                <input type="password" class="login-field-input" id="confirm" placeholder="••••••••••" required />
              </div>
              <div id="reset-msg" class="login-error" style="display:none;"></div>
              <button type="submit" class="login-btn">Update Password</button>
            </form>
            <div class="login-register-row" style="margin-top:16px;">
              <a href="#/login">Back to sign in</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('password').value;
    const confirm = document.getElementById('confirm').value;
    const msgEl = document.getElementById('reset-msg');
    msgEl.style.display = 'none';

    if (password !== confirm) {
      msgEl.textContent = 'Passwords do not match';
      msgEl.style.color = '#ff6b6b';
      msgEl.style.display = 'block';
      return;
    }

    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Updating…';

    try {
      await api.resetPassword(token, password);
      toast('Password updated! Please sign in.', 'success');
      navigate('/login');
    } catch (err) {
      msgEl.textContent = err.message;
      msgEl.style.color = '#ff6b6b';
      msgEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Update Password';
    }
  });
}
