import { api } from '../api.js';
import { navigate } from '../router.js';

export function renderRegister(app) {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <span class="auth-logo">Orbit</span>
        <h1>Create account</h1>
        <p class="subtitle">Start managing your projects</p>
        <form id="register-form">
          <div class="form-group">
            <label>Email</label>
            <input type="email" class="form-control" id="email" autocomplete="email" required />
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" class="form-control" id="password" autocomplete="new-password" required minlength="8" />
            <div class="form-hint">Min 8 characters, including uppercase, number and special character</div>
          </div>
          <div class="form-group">
            <label>Confirm Password</label>
            <input type="password" class="form-control" id="confirm" autocomplete="new-password" required />
          </div>
          <div id="reg-error" class="text-sm" style="color:var(--red);margin-bottom:10px;display:none;"></div>
          <button type="submit" class="btn btn-primary btn-block">Create Account</button>
        </form>
        <hr class="divider" />
        <div class="text-center text-sm">
          Already have an account? <a href="#/login">Sign in</a>
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
      errEl.style.display = 'block';
      return;
    }

    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Creating account…';

    try {
      const data = await api.register(email, password);
      localStorage.setItem('orbit_token', data.token);
      localStorage.setItem('orbit_user', JSON.stringify({ userId: data.userId, email: data.email, username: data.username }));
      navigate('/projects');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Create Account';
    }
  });
}
