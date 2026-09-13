const form = document.querySelector('#boss-template-form');
const idleInput = document.querySelector('#boss-idle');
const attackInput = document.querySelector('#boss-attack');
const idlePreview = document.querySelector('#idle-preview');
const attackPreview = document.querySelector('#attack-preview');
const message = document.querySelector('#boss-template-message');
const saveButton = document.querySelector('#save-boss-template');
const list = document.querySelector('#boss-library-list');
const refreshButton = document.querySelector('#refresh-bosses');
const logoutButton = document.querySelector('#admin-logout');

bindPreview(idleInput, idlePreview);
bindPreview(attackInput, attackPreview);
refreshButton.addEventListener('click', loadBosses);
form.addEventListener('submit', saveBoss);
logoutButton?.addEventListener('click', signOut);

boot();

async function boot() {
  try {
    const response = await fetch('/api/admin/session', { cache: 'no-store' });
    const data = await response.json();
    if (!data.authenticated) {
      window.location.replace('/admin/');
      return;
    }
    await loadBosses();
  } catch {
    window.location.replace('/admin/');
  }
}

function bindPreview(input, image) {
  let objectUrl = null;
  input.addEventListener('change', () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const file = input.files?.[0];
    if (!file) {
      image.removeAttribute('src');
      return;
    }
    objectUrl = URL.createObjectURL(file);
    image.src = objectUrl;
  });
}

async function loadBosses() {
  list.innerHTML = '<div class="form-hint">Loading bosses...</div>';
  try {
    const response = await fetch('/api/bosses', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load boss library');
    renderBosses(data.bosses || []);
  } catch (error) {
    list.innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
  }
}

function renderBosses(bosses) {
  list.replaceChildren();
  for (const boss of bosses) {
    const card = document.createElement('article');
    card.className = 'boss-library-item';

    const art = document.createElement('div');
    art.className = 'boss-library-item-art';
    const image = document.createElement('img');
    image.alt = `${boss.name} idle artwork`;
    image.src = boss.art?.bossIdle || boss.art?.boss || '/art/numberzilla.svg';
    art.append(image);

    const copy = document.createElement('div');
    copy.className = 'boss-library-item-copy';
    const title = document.createElement('strong');
    title.textContent = boss.name;
    const encounter = document.createElement('span');
    encounter.textContent = boss.encounter || 'Raid boss';
    const tag = document.createElement('span');
    tag.className = `boss-library-tag ${boss.custom ? 'custom' : ''}`;
    tag.textContent = boss.custom ? 'Custom' : 'Built in';
    copy.append(title, encounter, tag);

    card.append(art, copy);

    if (boss.custom) {
      const remove = document.createElement('button');
      remove.className = 'btn boss-delete';
      remove.type = 'button';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => deleteBoss(boss, remove));
      card.append(remove);
    }

    list.append(card);
  }
}

async function saveBoss(event) {
  event.preventDefault();
  saveButton.disabled = true;
  saveButton.textContent = 'Uploading boss...';
  message.innerHTML = '';

  const formData = new FormData(form);

  try {
    const response = await fetch('/api/bosses', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();
    if (response.status === 403) {
      window.location.replace('/admin/');
      return;
    }
    if (!response.ok) throw new Error(data.error || 'Could not save boss template');

    message.innerHTML = `<div class="notice success">${escapeHtml(data.boss.name)} is now available when creating a raid.</div>`;
    form.reset();
    idlePreview.removeAttribute('src');
    attackPreview.removeAttribute('src');
    await loadBosses();
  } catch (error) {
    message.innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'Save boss template';
  }
}

async function deleteBoss(boss, button) {
  if (!window.confirm(`Delete ${boss.name} from the Boss Library? Existing raids will keep their saved copy.`)) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/bosses/${encodeURIComponent(boss.id)}`, { method: 'DELETE' });
    const data = await response.json();
    if (response.status === 403) {
      window.location.replace('/admin/');
      return;
    }
    if (!response.ok) throw new Error(data.error || 'Could not delete boss');
    await loadBosses();
  } catch (error) {
    message.innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
    button.disabled = false;
  }
}

async function signOut() {
  logoutButton.disabled = true;
  try {
    await fetch('/api/admin/logout', { method: 'POST' });
  } finally {
    window.location.replace('/admin/');
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'\"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}
