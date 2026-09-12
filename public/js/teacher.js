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

    sessionStorage.setItem(`mathraids:teacher:${data.code}`, data.teacherKey);

    // Always stay on the browser's current origin. This keeps Wrangler local
    // development on localhost even when the Worker has a production custom domain.
    const teacherPath = `/teacher/raid.html?code=${encodeURIComponent(data.code)}&key=${encodeURIComponent(data.teacherKey)}`;
    window.location.assign(teacherPath);
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
