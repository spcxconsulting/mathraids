const form = document.querySelector('#boss-template-form');
const message = document.querySelector('#boss-template-message');
const saveButton = document.querySelector('#save-boss-template');
const list = document.querySelector('#boss-library-list');
const refreshButton = document.querySelector('#refresh-bosses');
const logoutButton = document.querySelector('#admin-logout');
const attacksHost = document.querySelector('#boss-attacks');
const attackTemplate = document.querySelector('#boss-attack-template');
const addAttackButton = document.querySelector('#add-boss-attack');

const backgroundInput = document.querySelector('#encounter-background');
const foregroundInput = document.querySelector('#encounter-foreground');
const neutralInput = document.querySelector('#boss-idle');
const deathInput = document.querySelector('#boss-death');
const backgroundPreview = document.querySelector('#background-preview');
const foregroundPreview = document.querySelector('#foreground-preview');
const neutralPreview = document.querySelector('#neutral-preview');
const attackPosePreview = document.querySelector('#attack-pose-preview');
const scenePreview = document.querySelector('#encounter-scene-preview');
const attackShapePreview = document.querySelector('#attack-shape-preview');
const attackPreviewReadout = document.querySelector('#attack-preview-readout');
const previewAttackLabel = document.querySelector('#preview-attack-label');
const previewNeutralButton = document.querySelector('#preview-neutral');
const bossWidthInput = document.querySelector('#boss-width');
const bossHeightInput = document.querySelector('#boss-height');
const bossTopInput = document.querySelector('#boss-top');

const previewUrls = new Map();
let attackSequence = 0;
let activeAttackId = null;

bindPreview(backgroundInput, backgroundPreview, 'background');
bindPreview(foregroundInput, foregroundPreview, 'foreground');
bindPreview(neutralInput, neutralPreview, 'neutral');
deathInput.addEventListener('change', () => {});

[bossWidthInput, bossHeightInput, bossTopInput].forEach((input) => {
  input.addEventListener('input', updateSceneBossPlacement);
});

refreshButton.addEventListener('click', loadBosses);
form.addEventListener('submit', saveEncounter);
logoutButton?.addEventListener('click', signOut);
addAttackButton.addEventListener('click', () => addAttack());
previewNeutralButton.addEventListener('click', showNeutralPreview);

addAttack({ name: 'Meteor Blast', type: 'fireball', mechanic: 'left_slam', originX: 50, originY: 24, size: 34 });
updateSceneBossPlacement();
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

function bindPreview(input, image, key) {
  input.addEventListener('change', () => {
    releasePreviewUrl(key);
    const file = input.files?.[0];
    if (!file) {
      image.removeAttribute('src');
      updateSceneEmptyState();
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    previewUrls.set(key, objectUrl);
    image.src = objectUrl;
    updateSceneEmptyState();
  });
}

function releasePreviewUrl(key) {
  const current = previewUrls.get(key);
  if (current) URL.revokeObjectURL(current);
  previewUrls.delete(key);
}

function updateSceneEmptyState() {
  scenePreview.classList.toggle('has-preview', Boolean(backgroundPreview.src || neutralPreview.src || foregroundPreview.src));
}

function updateSceneBossPlacement() {
  const width = clampNumber(bossWidthInput.value, 64, 900, 560);
  const height = clampNumber(bossHeightInput.value, 64, 900, 490);
  const top = clampNumber(bossTopInput.value, -500, 360, -92);

  for (const image of [neutralPreview, attackPosePreview]) {
    image.style.width = `${(width / 640) * 100}%`;
    image.style.height = `${(height / 360) * 100}%`;
    image.style.top = `${(top / 360) * 100}%`;
  }
}

function defaultSizeForType(type) {
  if (type === 'beam') return 48;
  if (type === 'smash') return 90;
  return 34;
}

function attackSizeCopy(type) {
  if (type === 'beam') {
    return {
      label: 'Beam width',
      hint: 'Width of the beam on the logical 640 × 360 canvas.'
    };
  }
  if (type === 'smash') {
    return {
      label: 'Smash radius',
      hint: 'Radius of the smash / impact area on the logical canvas.'
    };
  }
  return {
    label: 'Fireball radius',
    hint: 'Radius of the projectile on the logical 640 × 360 canvas.'
  };
}

function addAttack(initial = {}) {
  const fragment = attackTemplate.content.cloneNode(true);
  const card = fragment.querySelector('.boss-attack-card');
  card.dataset.attackId = `attack-${++attackSequence}`;

  const fields = getAttackFields(card);
  fields.name.value = initial.name || `Attack ${attacksHost.children.length + 1}`;
  fields.type.value = initial.type || 'fireball';
  fields.faces.value = initial.faces || 'left';
  fields.mechanic.value = initial.mechanic || 'left_slam';
  fields.originX.value = initial.originX ?? 50;
  fields.originY.value = initial.originY ?? 24;
  fields.size.value = initial.size ?? defaultSizeForType(fields.type.value);
  fields.baseDamage.value = initial.baseDamage ?? 24;
  fields.critDamage.value = initial.critDamage ?? 40;
  fields.warningMs.value = initial.warningMs ?? 1650;
  fields.travelMs.value = initial.travelMs ?? 720;
  updateAttackTypeFields(card);

  fields.image.addEventListener('change', () => {
    const key = `${card.dataset.attackId}:preview`;
    releasePreviewUrl(key);
    const file = fields.image.files?.[0];
    const preview = card.querySelector('[data-preview="attack"]');
    if (!file) {
      preview.removeAttribute('src');
      if (activeAttackId === card.dataset.attackId) updateActiveAttackPreview();
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    previewUrls.set(key, objectUrl);
    preview.src = objectUrl;
    if (activeAttackId === card.dataset.attackId) updateActiveAttackPreview();
  });

  fields.type.addEventListener('change', () => {
    updateAttackTypeFields(card);
    if (activeAttackId === card.dataset.attackId) updateActiveAttackPreview();
  });

  for (const input of [fields.name, fields.faces, fields.originX, fields.originY, fields.size]) {
    input.addEventListener('input', () => {
      if (activeAttackId === card.dataset.attackId) updateActiveAttackPreview();
    });
    input.addEventListener('change', () => {
      if (activeAttackId === card.dataset.attackId) updateActiveAttackPreview();
    });
  }

  card.addEventListener('focusin', () => setActiveAttack(card));
  card.querySelector('.boss-attack-preview-button').addEventListener('click', () => setActiveAttack(card));

  card.querySelector('.boss-attack-remove').addEventListener('click', () => {
    if (attacksHost.children.length <= 1) {
      message.innerHTML = '<div class="notice error">An encounter needs at least one boss attack.</div>';
      return;
    }
    const removingActive = activeAttackId === card.dataset.attackId;
    releasePreviewUrl(`${card.dataset.attackId}:preview`);
    card.remove();
    renumberAttacks();
    if (removingActive) {
      const first = attacksHost.querySelector('.boss-attack-card');
      if (first) setActiveAttack(first);
      else showNeutralPreview();
    }
  });

  attacksHost.append(fragment);
  renumberAttacks();

  if (!activeAttackId) setActiveAttack(attacksHost.lastElementChild);
}

function getAttackFields(card) {
  return {
    name: card.querySelector('[data-field="name"]'),
    type: card.querySelector('[data-field="type"]'),
    image: card.querySelector('[data-field="image"]'),
    faces: card.querySelector('[data-field="faces"]'),
    mechanic: card.querySelector('[data-field="mechanic"]'),
    originX: card.querySelector('[data-field="originX"]'),
    originY: card.querySelector('[data-field="originY"]'),
    size: card.querySelector('[data-field="size"]'),
    baseDamage: card.querySelector('[data-field="baseDamage"]'),
    critDamage: card.querySelector('[data-field="critDamage"]'),
    warningMs: card.querySelector('[data-field="warningMs"]'),
    travelMs: card.querySelector('[data-field="travelMs"]')
  };
}

function updateAttackTypeFields(card) {
  const fields = getAttackFields(card);
  const copy = attackSizeCopy(fields.type.value);
  card.querySelector('[data-size-label]').textContent = copy.label;
  card.querySelector('[data-size-hint]').textContent = copy.hint;
}

function renumberAttacks() {
  [...attacksHost.children].forEach((card, index) => {
    card.querySelector('.boss-attack-number').textContent = `Attack ${index + 1}`;
    card.querySelector('.boss-attack-remove').hidden = attacksHost.children.length <= 1;
  });
}

function setActiveAttack(card) {
  if (!card) return;
  activeAttackId = card.dataset.attackId;
  for (const candidate of attacksHost.querySelectorAll('.boss-attack-card')) {
    candidate.classList.toggle('preview-active', candidate === card);
  }
  updateActiveAttackPreview();
}

function activeAttackCard() {
  if (!activeAttackId) return null;
  return attacksHost.querySelector(`[data-attack-id="${CSS.escape(activeAttackId)}"]`);
}

function showNeutralPreview() {
  activeAttackId = null;
  for (const card of attacksHost.querySelectorAll('.boss-attack-card')) card.classList.remove('preview-active');
  attackPosePreview.removeAttribute('src');
  neutralPreview.classList.remove('suppressed');
  attackShapePreview.classList.remove('active', 'beam', 'fireball', 'smash');
  previewAttackLabel.textContent = 'Neutral pose';
  attackPreviewReadout.textContent = 'Choose an attack to preview its origin and size.';
}

function updateActiveAttackPreview() {
  const card = activeAttackCard();
  if (!card) {
    showNeutralPreview();
    return;
  }

  const fields = getAttackFields(card);
  const type = fields.type.value;
  const originX = clampNumber(fields.originX.value, 0, 100, 50);
  const originY = clampNumber(fields.originY.value, 0, 100, 24);
  const size = clampNumber(fields.size.value, 4, 640, defaultSizeForType(type));
  const localPreview = card.querySelector('[data-preview="attack"]');

  previewAttackLabel.textContent = fields.name.value.trim() || card.querySelector('.boss-attack-number').textContent;
  attackPosePreview.src = localPreview.src || '';
  if (!localPreview.src) attackPosePreview.removeAttribute('src');
  neutralPreview.classList.toggle('suppressed', Boolean(localPreview.src));

  attackShapePreview.className = `attack-shape-preview active ${type}`;
  attackShapePreview.style.setProperty('--origin-x', `${originX}%`);
  attackShapePreview.style.setProperty('--origin-y', `${originY}%`);
  attackShapePreview.style.setProperty('--fireball-w', `${(size * 2 / 640) * 100}%`);
  attackShapePreview.style.setProperty('--fireball-h', `${(size * 2 / 360) * 100}%`);
  attackShapePreview.style.setProperty('--beam-w', `${(size / 640) * 100}%`);
  attackShapePreview.style.setProperty('--beam-h', `${Math.max(0, 100 - originY)}%`);
  attackShapePreview.style.setProperty('--smash-w', `${(size * 2 / 640) * 100}%`);
  attackShapePreview.style.setProperty('--smash-h', `${(size * 2 / 360) * 100}%`);

  const sizeName = type === 'beam' ? 'width' : 'radius';
  attackPreviewReadout.textContent = `${typeLabel(type)} · origin ${Math.round(originX)}%, ${Math.round(originY)}% · ${sizeName} ${Math.round(size)}px`;
  updateSceneEmptyState();
}

function typeLabel(type) {
  if (type === 'beam') return 'Beam';
  if (type === 'smash') return 'Smash';
  return 'Fireball';
}

async function loadBosses() {
  list.innerHTML = '<div class="form-hint">Loading encounters...</div>';
  try {
    const response = await fetch('/api/bosses', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load encounter library');
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
    image.alt = `${boss.name} neutral artwork`;
    image.src = boss.art?.bossNeutral || boss.art?.bossIdle || boss.art?.boss || '/art/numberzilla.svg';
    art.append(image);

    const copy = document.createElement('div');
    copy.className = 'boss-library-item-copy';
    const title = document.createElement('strong');
    title.textContent = boss.name;
    const encounter = document.createElement('span');
    encounter.textContent = boss.encounter || 'Raid encounter';
    const details = document.createElement('span');
    const attackCount = Number(boss.attackCount) || (boss.custom ? 1 : 3);
    const enrage = Number(boss.enrageMs) > 0 ? ` • Enrage ${Math.round(boss.enrageMs / 1000)}s` : '';
    details.textContent = `${attackCount} attack${attackCount === 1 ? '' : 's'}${enrage}`;
    const tag = document.createElement('span');
    tag.className = `boss-library-tag ${boss.custom ? 'custom' : ''}`;
    tag.textContent = boss.custom ? 'Custom encounter' : 'Built in';
    copy.append(title, encounter, details, tag);

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

function collectAttacks() {
  return [...attacksHost.children].map((card, index) => {
    const fields = getAttackFields(card);
    return {
      id: `attack-${index + 1}`,
      name: fields.name.value.trim(),
      type: fields.type.value,
      faces: fields.faces.value,
      mechanic: fields.mechanic.value,
      originX: Number(fields.originX.value),
      originY: Number(fields.originY.value),
      size: Number(fields.size.value),
      baseDamage: Number(fields.baseDamage.value),
      critDamage: Number(fields.critDamage.value),
      warningMs: Number(fields.warningMs.value),
      travelMs: Number(fields.travelMs.value),
      file: fields.image.files?.[0] || null
    };
  });
}

async function saveEncounter(event) {
  event.preventDefault();
  message.innerHTML = '';
  if (!form.reportValidity()) return;

  const attacks = collectAttacks();
  if (!attacks.length || attacks.some((attack) => !attack.file)) {
    message.innerHTML = '<div class="notice error">Every boss attack needs an attack image.</div>';
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = 'Uploading encounter...';

  const payload = new FormData();
  payload.append('name', document.querySelector('#boss-name').value.trim());
  payload.append('encounter', document.querySelector('#boss-encounter').value.trim());
  payload.append('canvasWidth', document.querySelector('#canvas-width').value);
  payload.append('canvasHeight', document.querySelector('#canvas-height').value);
  payload.append('bossWidth', bossWidthInput.value);
  payload.append('bossHeight', bossHeightInput.value);
  payload.append('bossTop', bossTopInput.value);
  payload.append('enrageSeconds', document.querySelector('#enrage-seconds').value);
  payload.append('enrageDamageMultiplier', document.querySelector('#enrage-multiplier').value);
  payload.append('background', backgroundInput.files[0]);
  if (foregroundInput.files?.[0]) payload.append('foreground', foregroundInput.files[0]);
  payload.append('idle', neutralInput.files[0]);
  payload.append('death', deathInput.files[0]);

  payload.append('attackDefinitions', JSON.stringify(attacks.map(({ file, ...attack }) => attack)));
  attacks.forEach((attack, index) => payload.append(`attackImage_${index}`, attack.file));

  try {
    const response = await fetch('/api/bosses', {
      method: 'POST',
      body: payload
    });
    const data = await response.json();
    if (response.status === 403) {
      window.location.replace('/admin/');
      return;
    }
    if (!response.ok) throw new Error(data.error || 'Could not save encounter');

    message.innerHTML = `<div class="notice success">${escapeHtml(data.boss.encounter || data.boss.name)} is now available when creating a raid.</div>`;
    resetBuilder();
    await loadBosses();
  } catch (error) {
    message.innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'Save encounter';
  }
}

function resetBuilder() {
  form.reset();
  document.querySelector('#canvas-width').value = 640;
  document.querySelector('#canvas-height').value = 360;
  bossWidthInput.value = 560;
  bossHeightInput.value = 490;
  bossTopInput.value = -92;
  document.querySelector('#enrage-seconds').value = 120;
  document.querySelector('#enrage-multiplier').value = 1.5;

  for (const key of [...previewUrls.keys()]) releasePreviewUrl(key);
  [backgroundPreview, foregroundPreview, neutralPreview, attackPosePreview].forEach((image) => image.removeAttribute('src'));
  attacksHost.replaceChildren();
  activeAttackId = null;
  addAttack({ name: 'Meteor Blast', type: 'fireball', mechanic: 'left_slam', originX: 50, originY: 24, size: 34 });
  updateSceneBossPlacement();
  updateSceneEmptyState();
}

async function deleteBoss(boss, button) {
  if (!window.confirm(`Delete ${boss.encounter || boss.name} from the platform encounter library? Existing raids keep their saved copy.`)) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/bosses/${encodeURIComponent(boss.id)}`, { method: 'DELETE' });
    const data = await response.json();
    if (response.status === 403) {
      window.location.replace('/admin/');
      return;
    }
    if (!response.ok) throw new Error(data.error || 'Could not delete encounter');
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

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'\"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}
