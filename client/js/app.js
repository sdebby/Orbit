import { route, startRouter, navigate } from './router.js';
import { renderLogin } from './pages/login.js';
import { renderRegister } from './pages/register.js';
import { renderForgotPassword, renderResetPassword } from './pages/forgot-password.js';
import { renderVerifyEmail } from './pages/verify-email.js';
import { renderProjects } from './pages/projects.js';
import { renderBoard } from './pages/board.js';
import { renderProfile } from './pages/profile.js';
import { renderTemplates } from './pages/templates.js';
// admin.js is dynamically imported below to avoid exposing admin API endpoints to all users

// Apply saved theme before first render
const savedTheme = localStorage.getItem('orbit_theme') || 'light';
document.body.setAttribute('data-theme', savedTheme);

const app = document.getElementById('app');

function requireAuth(handler) {
  return (params) => {
    const user = localStorage.getItem('orbit_user');
    if (!user) {
      navigate('/login');
      return;
    }
    handler(params);
  };
}

route('/login', () => renderLogin(app));
route('/register', () => renderRegister(app));
route('/forgot-password', () => renderForgotPassword(app));
route('/reset-password/:token', (params) => renderResetPassword(app, params));
route('/verify-email/:token', (params) => renderVerifyEmail(app, params));
route('/projects', requireAuth(() => renderProjects(app)));
route('/projects/:id', requireAuth((params) => renderBoard(app, params)));
route('/profile', requireAuth(() => renderProfile(app)));
route('/templates', requireAuth(() => renderTemplates(app)));
route('/admin', requireAuth(async () => {
  const { renderAdmin } = await import('./pages/admin.js');
  renderAdmin(app);
}));
route('/', () => {
  const user = localStorage.getItem('orbit_user');
  navigate(user ? '/projects' : '/login');
});

startRouter();
