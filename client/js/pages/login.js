import { api } from '../api.js';
import { toast } from '../utils.js';
import { navigate } from '../router.js';

export function renderLogin(app) {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <span class="auth-logo">Orbit</span>
        <h1>Welcome back</h1>
        <p class="subtitle">Sign in to your account</p>
        <form id="login-form">
          <div class="form-group">
            <label>Email</label>
            <input type="email" class="form-control" id="email" autocomplete="email" required />
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" class="form-control" id="password" autocomplete="current-password" required />
          </div>
          <div id="login-error" class="text-sm" style="color:var(--red);margin-bottom:10px;display:none;"></div>
          <button type="submit" class="btn btn-primary btn-block">Sign In</button>
        </form>
        <hr class="divider" />
        <div class="text-center text-sm">
          Don't have an account? <a href="#/register">Sign up</a>
        </div>
        <div class="text-center text-sm mt-2">
          <a href="#/forgot-password">Forgot password?</a>
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
      localStorage.setItem('orbit_user', JSON.stringify({ userId: data.userId, email: data.email, profilePicture: data.profilePicture }));
      navigate('/projects');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
}
