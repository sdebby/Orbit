import { route, startRouter, navigate } from './router.js';
import { renderLogin } from './pages/login.js';
import { renderRegister } from './pages/register.js';
import { renderForgotPassword, renderResetPassword } from './pages/forgot-password.js';
import { renderProjects } from './pages/projects.js';
import { renderBoard } from './pages/board.js';
import { renderProfile } from './pages/profile.js';

// Apply saved theme before first render
const savedTheme = localStorage.getItem('orbit_theme') || 'light';
document.body.setAttribute('data-theme', savedTheme);

const app = document.getElementById('app');

function requireAuth(handler) {
  return (params) => {
    const token = localStorage.getItem('orbit_token');
    if (!token) {
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
route('/projects', requireAuth(() => renderProjects(app)));
route('/projects/:id', requireAuth((params) => renderBoard(app, params)));
route('/profile', requireAuth(() => renderProfile(app)));
route('/', () => {
  const token = localStorage.getItem('orbit_token');
  navigate(token ? '/projects' : '/login');
});

startRouter();
