import { api } from '../api.js';
import { toast } from '../utils.js';
import { navigate } from '../router.js';

export function renderLogin(app) {
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
            <h2 class="login-form-title">Welcome back</h2>
            <p class="login-form-sub">Sign in to your Orbit workspace</p>
            <form id="login-form">
              <div class="login-field-group">
                <label class="login-field-label">Email</label>
                <input type="text" class="login-field-input" id="email" placeholder="you@example.com" autocomplete="email" inputmode="email" />
              </div>
              <div class="login-field-group">
                <label class="login-field-label">Password</label>
                <div class="login-field-pw-wrap">
                  <input type="password" class="login-field-input" id="password" placeholder="••••••••••" autocomplete="current-password" />
                  <button type="button" class="login-pw-eye" id="pw-toggle" aria-label="Show password" tabindex="-1">
                    <svg id="pw-eye-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>
                </div>
              </div>
              <div class="login-forgot-row">
                <a class="login-forgot-link" href="#/forgot-password">Forgot password?</a>
              </div>
              <div id="login-error" class="login-error"></div>
              <button type="submit" class="login-btn">Sign in to Orbit</button>
            </form>
            <div class="login-divider">
              <div class="login-divider-line"></div>
              <span class="login-divider-text">new here?</span>
              <div class="login-divider-line"></div>
            </div>
            <div class="login-register-row">
              Don't have an account? <a href="#/register">Create one</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('pw-toggle').addEventListener('click', () => {
    const pwInput = document.getElementById('password');
    const icon = document.getElementById('pw-eye-icon');
    const show = pwInput.type === 'password';
    pwInput.type = show ? 'text' : 'password';
    icon.innerHTML = show
      ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  });

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const errEl = document.getElementById('login-error');
    const btn = e.target.querySelector('button');

    if (!email) { toast('Please enter your email address.', 'error'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Please enter a valid email address.', 'error'); return; }
    if (!password) { toast('Please enter your password.', 'error'); return; }

    btn.disabled = true;
    btn.textContent = 'Signing in…';
    errEl.style.display = 'none';

    try {
      const data = await api.login(email, password);
      localStorage.setItem('orbit_user', JSON.stringify({ userId: data.userId, email: data.email, username: data.username, profilePicture: data.profilePicture, isAdmin: data.isAdmin }));
      navigate('/projects');
    } catch (err) {
      errEl.textContent = err.message === 'EMAIL_NOT_VERIFIED'
        ? 'Please verify your email address before signing in. Check your inbox for the verification link.'
        : err.message;
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Sign in to Orbit';
    }
  });
}
