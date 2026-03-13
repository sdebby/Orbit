import { api } from '../api.js';
import { toast } from '../utils.js';
import { navigate } from '../router.js';

export function renderForgotPassword(app) {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <span class="auth-logo">Orbit</span>
        <h1>Reset password</h1>
        <p class="subtitle">Enter your email to receive a reset link</p>
        <form id="forgot-form">
          <div class="form-group">
            <label>Email</label>
            <input type="email" class="form-control" id="email" required />
          </div>
          <div id="forgot-msg" class="text-sm" style="display:none;margin-bottom:10px;"></div>
          <button type="submit" class="btn btn-primary btn-block">Send Reset Link</button>
        </form>
        <hr class="divider" />
        <div class="text-center text-sm">
          <a href="#/login">Back to sign in</a>
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
      msgEl.style.color = 'var(--green)';
      msgEl.style.display = 'block';
      btn.textContent = 'Sent!';
    } catch (err) {
      msgEl.textContent = err.message;
      msgEl.style.color = 'var(--red)';
      msgEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Send Reset Link';
    }
  });
}

export function renderResetPassword(app, params) {
  const token = params.token;
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <span class="auth-logo">Orbit</span>
        <h1>Set new password</h1>
        <form id="reset-form">
          <div class="form-group">
            <label>New Password</label>
            <input type="password" class="form-control" id="password" required minlength="6" />
          </div>
          <div class="form-group">
            <label>Confirm Password</label>
            <input type="password" class="form-control" id="confirm" required />
          </div>
          <div id="reset-msg" class="text-sm" style="display:none;margin-bottom:10px;"></div>
          <button type="submit" class="btn btn-primary btn-block">Update Password</button>
        </form>
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
      msgEl.style.color = 'var(--red)';
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
      msgEl.style.color = 'var(--red)';
      msgEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Update Password';
    }
  });
}
