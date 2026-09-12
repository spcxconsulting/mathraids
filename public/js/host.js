const form = document.querySelector('#create-raid-form');
const button = document.querySelector('#create-button');
const message = document.querySelector('#create-message');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  button.textContent = 'Creating raid...';
  message.innerHTML = '';

  const formData = new FormData(form);
  const payload = {
    topic: formData.get('topic'),
    difficulty: Number(formData.get('difficulty')),
    mode: formData.get('mode'),
    boss: formData.get('boss')
  };

  try {
    const response = await fetch('/api/raids', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not create raid');

    const hostKey = data.hostKey || data.teacherKey;
    sessionStorage.setItem(`mathraids:host:${data.code}`, hostKey);

    const hostPath = `/host/raid.html?code=${encodeURIComponent(data.code)}&key=${encodeURIComponent(hostKey)}`;
    window.location.assign(hostPath);
  } catch (error) {
    message.innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
    button.disabled = false;
    button.textContent = 'Create raid';
  }
});

function escapeHtml(value) {
  return String(value).replace(/[&<>'\"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}
