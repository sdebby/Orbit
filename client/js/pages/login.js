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
                <input type="email" class="login-field-input" id="email" placeholder="you@example.com" autocomplete="email" required />
              </div>
              <div class="login-field-group">
                <label class="login-field-label">Password</label>
                <input type="password" class="login-field-input" id="password" placeholder="••••••••••" autocomplete="current-password" required />
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
            <div class="login-status-bar">
              <div class="login-status-dot"></div>
              All systems operational
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errEl = document.getElementById('login-error');
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    errEl.style.display = 'none';

    try {
      const data = await api.login(email, password);
      localStorage.setItem('orbit_token', data.token);
      localStorage.setItem('orbit_user', JSON.stringify({ userId: data.userId, email: data.email, username: data.username, profilePicture: data.profilePicture }));
      navigate('/projects');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Sign in to Orbit';
    }
  });
}
