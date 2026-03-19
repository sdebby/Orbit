import { api } from '../api.js';
import { navigate } from '../router.js';
import { escHtml } from '../utils.js';

export function renderRegister(app) {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-inner">
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
        </div>
        <div class="login-right">
          <div class="login-form-card">
            <h2 class="login-form-title">Create account</h2>
            <p class="login-form-sub">Start managing your projects</p>
            <form id="register-form">
              <div class="login-field-group">
                <label class="login-field-label">Email</label>
                <input type="email" class="login-field-input" id="email" placeholder="you@example.com" autocomplete="email" required />
              </div>
              <div class="login-field-group">
                <label class="login-field-label">Password</label>
                <input type="password" class="login-field-input" id="password" placeholder="••••••••••" autocomplete="new-password" required minlength="8" />
                <div style="font-size:11px;color:#3a4060;margin-top:5px;">Min 8 characters, including uppercase, number and special character</div>
              </div>
              <div class="login-field-group">
                <label class="login-field-label">Confirm Password</label>
                <input type="password" class="login-field-input" id="confirm" placeholder="••••••••••" autocomplete="new-password" required />
              </div>
              <div id="reg-error" class="login-error"></div>
              <button type="submit" class="login-btn">Create Account</button>
            </form>
            <div class="login-divider">
              <div class="login-divider-line"></div>
              <span class="login-divider-text">have an account?</span>
              <div class="login-divider-line"></div>
            </div>
            <div class="login-register-row">
              Already have an account? <a href="#/login">Sign in</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const confirm = document.getElementById('confirm').value;
    const errEl = document.getElementById('reg-error');
    errEl.style.display = 'none';

    if (password !== confirm) {
      errEl.textContent = 'Passwords do not match';
      errEl.style.color = '#ff6b6b';
      errEl.style.display = 'block';
      return;
    }

    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Creating account…';

    try {
      await api.register(email, password);
      // Replace form with verification notice
      document.querySelector('.login-form-card').innerHTML = `
        <div style="text-align:center;padding:12px 0">
          <div style="font-size:36px;margin-bottom:16px">✉️</div>
          <h2 class="login-form-title" style="margin-bottom:8px">Check your email</h2>
          <p class="login-form-sub" style="margin-bottom:24px">
            We sent a verification link to <strong style="color:#e8eaf2">${escHtml(email)}</strong>.<br/>
            Your account will not be active until you verify your email address.
          </p>
          <a href="#/login" class="login-btn" style="display:block;text-decoration:none;text-align:center">Back to Sign In</a>
        </div>
      `;
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.color = '#ff6b6b';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Create Account';
    }
  });
}
