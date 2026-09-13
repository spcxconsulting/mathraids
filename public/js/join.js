const params = new URLSearchParams(window.location.search);
const form = document.querySelector('#join-form');
const codeInput = document.querySelector('#code');
const nameInput = document.querySelector('#name');
const button = document.querySelector('#join-button');
const message = document.querySelector('#join-message');

const queryCode = normaliseCode(params.get('code') || '');
if (queryCode) codeInput.value = queryCode;

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = normaliseCode(codeInput.value);
  const name = nameInput.value.trim().slice(0, 20);
  const requestedClass = String(form.querySelector('input[name="class"]:checked')?.value || 'dps');
  const playerClass = ['dps', 'healer', 'tank'].includes(requestedClass) ? requestedClass : 'dps';

  if (code.length !== 6 || !name) return;

  button.disabled = true;
  button.textContent = 'Joining...';
  message.innerHTML = '';

  try {
    const response = await fetch(`/api/raids/${encodeURIComponent(code)}`, { cache: 'no-store' });
    const state = await response.json();
    if (!response.ok) throw new Error(state.error || 'Raid not found');
    if (state.status === 'complete') throw new Error('That raid has already finished.');

    let clientId = localStorage.getItem('mathraids:clientId');
    if (!clientId) {
      clientId = crypto.randomUUID();
      localStorage.setItem('mathraids:clientId', clientId);
    }

    sessionStorage.setItem(`mathraids:join:${code}`, JSON.stringify({ name, class: playerClass, clientId }));
    window.location.assign(`/play/?code=${encodeURIComponent(code)}`);
  } catch (error) {
    message.innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
    button.disabled = false;
    button.textContent = 'Join raid';
  }
});

codeInput.addEventListener('input', () => {
  codeInput.value = normaliseCode(codeInput.value);
});

function normaliseCode(value) {
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'\"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}
