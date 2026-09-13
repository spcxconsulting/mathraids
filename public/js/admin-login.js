const form = document.querySelector('#admin-login-form');
const password = document.querySelector('#admin-password');
const message = document.querySelector('#admin-login-message');
const button = document.querySelector('#admin-login-button');
const localHint = document.querySelector('#admin-local-hint');

if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
  localHint.hidden = false;
}

checkSession();
form.addEventListener('submit', signIn);

async function checkSession() {
  try {
    const response = await fetch('/api/admin/session', { cache: 'no-store' });
    const data = await response.json();
    if (data.authenticated) window.location.replace('/admin/bosses/');
  } catch {
    // Login form remains available if the session check cannot be completed.
  }
}

async function signIn(event) {
  event.preventDefault();
  button.disabled = true;
  button.textContent = 'Signing in...';
  message.innerHTML = '';

  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: password.value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not sign in');
    window.location.assign('/admin/bosses/');
  } catch (error) {
    message.innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
    button.disabled = false;
    button.textContent = 'Sign in';
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'\"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}
