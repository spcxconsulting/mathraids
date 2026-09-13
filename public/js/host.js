const form = document.querySelector('#create-raid-form');
const button = document.querySelector('#create-button');
const message = document.querySelector('#create-message');
const bossSelect = document.querySelector('#boss');

loadBosses();

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

async function loadBosses() {
  if (!bossSelect) return;
  const selected = bossSelect.value || 'numberzilla';
  try {
    const response = await fetch('/api/bosses', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load bosses');

    bossSelect.replaceChildren();
    for (const boss of data.bosses || []) {
      const option = document.createElement('option');
      option.value = boss.id;
      option.textContent = `${boss.name}${boss.encounter ? ` - ${boss.encounter}` : ''}${boss.custom ? ' · Custom' : ''}`;
      bossSelect.append(option);
    }
    bossSelect.value = [...bossSelect.options].some((option) => option.value === selected) ? selected : 'numberzilla';
  } catch {
    // Keep the built-in Numberzilla option if the library cannot be loaded.
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'\"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}
