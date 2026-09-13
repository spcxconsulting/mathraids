const form = document.querySelector('#create-raid-form');
const button = document.querySelector('#create-button');
const message = document.querySelector('#create-message');
const bossSelect = document.querySelector('#boss');
const customRulesPanel = document.querySelector('#custom-rules');
const customHealthMode = document.querySelector('#custom-health-mode');
const customKnockouts = document.querySelector('#custom-knockouts');

loadBosses();
updateCustomRulesVisibility();

for (const input of form.querySelectorAll('input[name="mode"]')) {
  input.addEventListener('change', updateCustomRulesVisibility);
}
customHealthMode?.addEventListener('change', updateCustomRuleDependencies);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  button.textContent = 'Creating raid...';
  message.innerHTML = '';

  const formData = new FormData(form);
  const mode = formData.get('mode');
  const payload = {
    topic: formData.get('topic'),
    difficulty: Number(formData.get('difficulty')),
    mode,
    boss: formData.get('boss')
  };

  if (mode === 'custom') {
    payload.customRules = {
      healthMode: formData.get('customHealthMode') === 'individual' ? 'individual' : 'shared',
      knockouts: formData.get('customKnockouts') === 'on',
      tankGuard: formData.get('customTankGuard') === 'on',
      fortify: formData.get('customFortify') === 'on',
      jumpFatigue: formData.get('customJumpFatigue') === 'on',
      airborneMitigation: formData.get('customAirborneMitigation') === 'on'
    };
  }

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

function updateCustomRulesVisibility() {
  const mode = form.querySelector('input[name="mode"]:checked')?.value;
  if (customRulesPanel) customRulesPanel.hidden = mode !== 'custom';
  updateCustomRuleDependencies();
}

function updateCustomRuleDependencies() {
  if (!customHealthMode || !customKnockouts) return;
  const individual = customHealthMode.value === 'individual';
  customKnockouts.disabled = !individual;
  if (!individual) customKnockouts.checked = false;
  if (individual && !customKnockouts.dataset.touched) customKnockouts.checked = true;
}

customKnockouts?.addEventListener('change', () => {
  customKnockouts.dataset.touched = 'true';
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
