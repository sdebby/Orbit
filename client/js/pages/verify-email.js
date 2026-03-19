import { api } from '../api.js';
import { navigate } from '../router.js';

export async function renderVerifyEmail(app, params) {
  const { token } = params;

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
          <div class="login-form-card" id="verify-content">
            <div style="text-align:center;padding:12px 0">
              <div style="font-size:36px;margin-bottom:16px">⏳</div>
              <h2 class="login-form-title">Verifying your email…</h2>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  try {
    const data = await api.verifyEmail(token);
    document.getElementById('verify-content').innerHTML = `
      <div style="text-align:center;padding:12px 0">
        <div style="font-size:36px;margin-bottom:16px">✅</div>
        <h2 class="login-form-title" style="margin-bottom:8px">Email verified!</h2>
        <p class="login-form-sub" style="margin-bottom:24px">${data.message}</p>
        <button class="login-btn" id="go-login">Sign in to Orbit</button>
      </div>
    `;
    document.getElementById('go-login').onclick = () => navigate('/login');
  } catch (err) {
    document.getElementById('verify-content').innerHTML = `
      <div style="text-align:center;padding:12px 0">
        <div style="font-size:36px;margin-bottom:16px">❌</div>
        <h2 class="login-form-title" style="margin-bottom:8px">Verification failed</h2>
        <p class="login-form-sub" style="margin-bottom:24px">${err.message}</p>
        <a href="#/register" class="login-btn" style="display:block;text-decoration:none;text-align:center">Register again</a>
      </div>
    `;
  }
}
