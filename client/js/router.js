const routes = {};
let currentRoute = null;

export function route(pattern, handler) {
  routes[pattern] = handler;
}

export function navigate(path) {
  window.location.hash = '#' + path;
}

export function getParam(name) {
  return currentRoute?.params?.[name] ?? null;
}

function matchRoute(hash) {
  const path = hash.replace(/^#/, '') || '/';
  for (const [pattern, handler] of Object.entries(routes)) {
    const keys = [];
    const regex = new RegExp(
      '^' + pattern.replace(/:([a-z_]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'
    );
    const m = path.match(regex);
    if (m) {
      const params = {};
      keys.forEach((k, i) => (params[k] = m[i + 1]));
      return { handler, params };
    }
  }
  return null;
}

export function startRouter() {
  function handleRoute() {
    const hash = window.location.hash || '#/';
    const match = matchRoute(hash);
    if (match) {
      currentRoute = match;
      match.handler(match.params);
    } else {
      navigate('/login');
    }
  }
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}
