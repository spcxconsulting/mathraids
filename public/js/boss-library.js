const form = document.querySelector('#boss-template-form');
const formTitle = form.querySelector('h2');
const formEyebrow = form.querySelector('.eyebrow');
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

const cancelEditButton = document.createElement('button');
cancelEditButton.className = 'btn';
cancelEditButton.type = 'button';
cancelEditButton.textContent = 'Cancel editing';
cancelEditButton.hidden = true;
saveButton.insertAdjacentElement('afterend', cancelEditButton);

const previewUrls = new Map();
let attackSequence = 0;
let activeAttackId = null;
let editingEncounterId = null;

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
cancelEditButton.addEventListener('click', () => {
  resetBuilder();
  message.innerHTML = '<div class="notice">Editing cancelled. Ready to create a new encounter.</div>';
});

addAttack({ name: 'Meteor Blast', type: 'fireball', mechanic: 'left_slam', originX: 50, originY: 24, size: 34 });
updateSceneBossPlacement();
updateBuilderModeUi();
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
      const existing = input.dataset.existingSrc || '';
      if (existing) image.src = existing;
      else image.removeAttribute('src');
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

function releaseAllPreviewUrls() {
  for (const key of [...previewUrls.keys()]) releasePreviewUrl(key);
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

function attackSizeFromDefinition(attack) {
  if (attack?.type === 'beam') return Number(attack.geometry?.beamWidth) || 48;
  return Number(attack?.geometry?.radius) || defaultSizeForType(attack?.type);
}

function normaliseSweepDirection(value) {
  return value === 'right_to_left' ? 'right_to_left' : 'left_to_right';
}

function ensureBeamSweepField(card) {
  let row = card.querySelector('[data-beam-sweep-row]');
  if (row) return row.querySelector('[data-field="sweepDirection"]');

  row = document.createElement('div');
  row.className = 'form-row';
  row.dataset.beamSweepRow = '';
  row.innerHTML = `
    <label>Beam sweep direction</label>
    <select data-field="sweepDirection">
      <option value="left_to_right">Left to right</option>
      <option value="right_to_left">Right to left</option>
    </select>
    <div class="form-hint">Direction the beam sweeps across the battlefield after it starts firing.</div>
  `;

  const originBox = card.querySelector('.attack-origin-fields');
  originBox?.append(row);
  return row.querySelector('[data-field="sweepDirection"]');
}

function ensureBeamSweepIndicator() {
  let indicator = attackShapePreview.querySelector('[data-beam-sweep-indicator]');
  if (indicator) return indicator;

  indicator = document.createElement('div');
  indicator.dataset.beamSweepIndicator = '';
  Object.assign(indicator.style, {
    position: 'absolute',
    zIndex: '8',
    padding: '4px 8px',
    borderRadius: '999px',
    background: 'rgba(3,14,24,.82)',
    border: '1px solid rgba(124,239,255,.75)',
    color: '#c9f8ff',
    font: '800 11px system-ui, sans-serif',
    letterSpacing: '.04em',
    boxShadow: '0 0 12px rgba(89,222,255,.28)'
  });
  attackShapePreview.append(indicator);
  return indicator;
}

function addAttack(initial = {}) {
  const fragment = attackTemplate.content.cloneNode(true);
  const card = fragment.querySelector('.boss-attack-card');
  card.dataset.attackId = `attack-${++attackSequence}`;
  card.dataset.existingImage = initial.imageUrl || '';

  const sweepField = ensureBeamSweepField(card);
  const fields = getAttackFields(card);
  fields.name.value = initial.name || `Attack ${attacksHost.children.length + 1}`;
  fields.type.value = initial.type || 'fireball';
  fields.faces.value = initial.faces || 'left';
  fields.mechanic.value = initial.mechanic || 'left_slam';
  fields.originX.value = initial.originX ?? 50;
  fields.originY.value = initial.originY ?? 24;
  fields.size.value = initial.size ?? defaultSizeForType(fields.type.value);
  fields.sweepDirection.value = normaliseSweepDirection(initial.sweepDirection);
  fields.baseDamage.value = initial.baseDamage ?? 24;
  fields.critDamage.value = initial.critDamage ?? 40;
  fields.warningMs.value = initial.warningMs ?? 1650;
  fields.travelMs.value = initial.travelMs ?? 720;
  fields.image.required = !card.dataset.existingImage;
  updateAttackTypeFields(card);

  const preview = card.querySelector('[data-preview="attack"]');
  if (card.dataset.existingImage) preview.src = card.dataset.existingImage;

  fields.image.addEventListener('change', () => {
    const key = `${card.dataset.attackId}:preview`;
    releasePreviewUrl(key);
    const file = fields.image.files?.[0];
    if (!file) {
      if (card.dataset.existingImage) preview.src = card.dataset.existingImage;
      else preview.removeAttribute('src');
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

  for (const input of [fields.name, fields.faces, fields.originX, fields.originY, fields.size, sweepField]) {
    input?.addEventListener('input', () => {
      if (activeAttackId === card.dataset.attackId) updateActiveAttackPreview();
    });
    input?.addEventListener('change', () => {
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
    sweepDirection: card.querySelector('[data-field="sweepDirection"]'),
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
  const sweepRow = card.querySelector('[data-beam-sweep-row]');
  if (sweepRow) sweepRow.hidden = fields.type.value !== 'beam';
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
  const indicator = attackShapePreview.querySelector('[data-beam-sweep-indicator]');
  if (indicator) indicator.hidden = true;
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
  const sweepDirection = normaliseSweepDirection(fields.sweepDirection?.value);
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

  const indicator = ensureBeamSweepIndicator();
  indicator.hidden = type !== 'beam';
  if (type === 'beam') {
    indicator.textContent = sweepDirection === 'right_to_left' ? 'R → L  ←' : '→  L → R';
    indicator.style.top = `${Math.min(88, Math.max(8, originY + 6))}%`;
    indicator.style.left = sweepDirection === 'right_to_left' ? '12px' : 'auto';
    indicator.style.right = sweepDirection === 'right_to_left' ? 'auto' : '12px';
  }

  const sizeName = type === 'beam' ? 'width' : 'radius';
  const sweepCopy = type === 'beam'
    ? ` · sweep ${sweepDirection === 'right_to_left' ? 'right → left' : 'left → right'}`
    : '';
  attackPreviewReadout.textContent = `${typeLabel(type)} · origin ${Math.round(originX)}%, ${Math.round(originY)}% · ${sizeName} ${Math.round(size)}px${sweepCopy}`;
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
      const actions = document.createElement('div');
      Object.assign(actions.style, { display: 'flex', gap: '6px', padding: '0 12px 12px' });

      const edit = document.createElement('button');
      edit.className = 'btn';
      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => editBoss(boss, edit));

      const remove = document.createElement('button');
      remove.className = 'btn';
      remove.type = 'button';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => deleteBoss(boss, remove));

      actions.append(edit, remove);
      card.append(actions);
    }

    list.append(card);
  }
}

async function editBoss(boss, button) {
  button.disabled = true;
  message.innerHTML = '';
  try {
    const response = await fetch(`/api/bosses/${encodeURIComponent(boss.id)}`, { cache: 'no-store' });
    const data = await response.json();
    if (response.status === 403) {
      window.location.replace('/admin/');
      return;
    }
    if (!response.ok) throw new Error(data.error || 'Could not load encounter for editing');
    populateBuilder(data.boss);
    message.innerHTML = `<div class="notice success">Editing ${escapeHtml(data.boss.encounter || data.boss.name)}. Existing images will be kept unless you upload replacements.</div>`;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    message.innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
  } finally {
    button.disabled = false;
  }
}

function setExistingAsset(input, preview, src = '') {
  input.value = '';
  input.dataset.existingSrc = src || '';
  input.required = false;
  if (preview) {
    if (src) preview.src = src;
    else preview.removeAttribute('src');
  }
}

function populateBuilder(definition) {
  releaseAllPreviewUrls();
  form.reset();
  editingEncounterId = definition.id;
  attackSequence = 0;
  activeAttackId = null;

  document.querySelector('#boss-name').value = definition.name || '';
  document.querySelector('#boss-encounter').value = definition.encounter || '';
  document.querySelector('#canvas-width').value = definition.canvas?.width || 640;
  document.querySelector('#canvas-height').value = definition.canvas?.height || 360;
  bossWidthInput.value = definition.presentation?.width || 560;
  bossHeightInput.value = definition.presentation?.height || 490;
  bossTopInput.value = definition.presentation?.top ?? -92;
  document.querySelector('#enrage-seconds').value = Math.round((Number(definition.enrage?.timerMs) || 0) / 1000);
  document.querySelector('#enrage-multiplier').value = Number(definition.enrage?.damageMultiplier) || 1.5;

  setExistingAsset(backgroundInput, backgroundPreview, definition.art?.backgroundBack || '');
  setExistingAsset(foregroundInput, foregroundPreview, definition.art?.backgroundFront || '');
  setExistingAsset(neutralInput, neutralPreview, definition.art?.bossNeutral || definition.art?.bossIdle || definition.art?.boss || '');
  setExistingAsset(deathInput, null, definition.art?.bossDeath || definition.art?.bossNeutral || definition.art?.bossIdle || definition.art?.boss || '');

  attacksHost.replaceChildren();
  const definitions = Array.isArray(definition.attackDefinitions) && definition.attackDefinitions.length
    ? definition.attackDefinitions
    : (definition.attacks || ['shockwave']).map((mechanic, index) => ({
        id: `attack-${index + 1}`,
        name: `Attack ${index + 1}`,
        type: 'fireball',
        faces: definition.art?.attackFaces || 'left',
        mechanic,
        origin: { x: 50, y: 24 },
        geometry: { radius: 34 },
        baseDamage: 24,
        critDamage: 40,
        warningMs: definition.defaults?.warningMs || 1650,
        travelMs: 720,
        image: definition.art?.bossAttack || definition.art?.bossNeutral || definition.art?.bossIdle || definition.art?.boss || ''
      }));

  for (const attack of definitions) {
    addAttack({
      name: attack.name,
      type: attack.type,
      faces: attack.faces,
      mechanic: attack.mechanic,
      originX: attack.origin?.x ?? 50,
      originY: attack.origin?.y ?? 24,
      size: attackSizeFromDefinition(attack),
      sweepDirection: attack.geometry?.sweepDirection || attack.sweepDirection || 'left_to_right',
      baseDamage: attack.baseDamage,
      critDamage: attack.critDamage,
      warningMs: attack.warningMs,
      travelMs: attack.travelMs,
      imageUrl: attack.image || ''
    });
  }

  updateSceneBossPlacement();
  updateSceneEmptyState();
  updateBuilderModeUi(definition);
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
      sweepDirection: fields.type.value === 'beam'
        ? normaliseSweepDirection(fields.sweepDirection?.value)
        : null,
      baseDamage: Number(fields.baseDamage.value),
      critDamage: Number(fields.critDamage.value),
      warningMs: Number(fields.warningMs.value),
      travelMs: Number(fields.travelMs.value),
      existingImage: card.dataset.existingImage || '',
      file: fields.image.files?.[0] || null
    };
  });
}

async function saveEncounter(event) {
  event.preventDefault();
  message.innerHTML = '';
  if (!form.reportValidity()) return;

  const attacks = collectAttacks();
  if (!attacks.length || attacks.some((attack) => !attack.file && !attack.existingImage)) {
    message.innerHTML = '<div class="notice error">Every boss attack needs an attack image.</div>';
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = editingEncounterId ? 'Saving changes...' : 'Uploading encounter...';

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
  if (backgroundInput.files?.[0]) payload.append('background', backgroundInput.files[0]);
  if (foregroundInput.files?.[0]) payload.append('foreground', foregroundInput.files[0]);
  if (neutralInput.files?.[0]) payload.append('idle', neutralInput.files[0]);
  if (deathInput.files?.[0]) payload.append('death', deathInput.files[0]);

  payload.append('attackDefinitions', JSON.stringify(attacks.map(({ file, ...attack }) => attack)));
  attacks.forEach((attack, index) => {
    if (attack.file) payload.append(`attackImage_${index}`, attack.file);
  });

  const endpoint = editingEncounterId
    ? `/api/bosses/${encodeURIComponent(editingEncounterId)}`
    : '/api/bosses';
  const method = editingEncounterId ? 'PUT' : 'POST';

  try {
    const response = await fetch(endpoint, { method, body: payload });
    const data = await response.json();
    if (response.status === 403) {
      window.location.replace('/admin/');
      return;
    }
    if (!response.ok) throw new Error(data.error || 'Could not save encounter');

    const label = data.boss.encounter || data.boss.name;
    message.innerHTML = `<div class="notice success">${escapeHtml(label)} ${method === 'PUT' ? 'was updated.' : 'is now available when creating a raid.'}</div>`;
    resetBuilder({ keepMessage: true });
    await loadBosses();
  } catch (error) {
    message.innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
  } finally {
    saveButton.disabled = false;
    updateBuilderModeUi();
  }
}

function clearExistingAssetState() {
  for (const input of [backgroundInput, foregroundInput, neutralInput, deathInput]) {
    input.dataset.existingSrc = '';
  }
}

function updateBuilderModeUi(definition = null) {
  const editing = Boolean(editingEncounterId);
  formEyebrow.textContent = editing ? 'Editing encounter definition v4' : 'Encounter definition v4';
  formTitle.textContent = editing
    ? `Edit ${definition?.encounter || document.querySelector('#boss-encounter').value || 'encounter'}`
    : 'New boss encounter';
  saveButton.textContent = editing ? 'Save encounter changes' : 'Save encounter';
  cancelEditButton.hidden = !editing;
  backgroundInput.required = !editing;
  neutralInput.required = !editing;
  deathInput.required = !editing;

  for (const card of attacksHost.querySelectorAll('.boss-attack-card')) {
    const fields = getAttackFields(card);
    fields.image.required = !card.dataset.existingImage;
  }
}

function resetBuilder({ keepMessage = false } = {}) {
  releaseAllPreviewUrls();
  form.reset();
  editingEncounterId = null;
  attackSequence = 0;
  activeAttackId = null;
  clearExistingAssetState();

  document.querySelector('#canvas-width').value = 640;
  document.querySelector('#canvas-height').value = 360;
  bossWidthInput.value = 560;
  bossHeightInput.value = 490;
  bossTopInput.value = -92;
  document.querySelector('#enrage-seconds').value = 120;
  document.querySelector('#enrage-multiplier').value = 1.5;

  [backgroundPreview, foregroundPreview, neutralPreview, attackPosePreview].forEach((image) => image.removeAttribute('src'));
  attacksHost.replaceChildren();
  addAttack({ name: 'Meteor Blast', type: 'fireball', mechanic: 'left_slam', originX: 50, originY: 24, size: 34 });
  updateSceneBossPlacement();
  updateSceneEmptyState();
  updateBuilderModeUi();
  if (!keepMessage) message.innerHTML = '';
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
    if (editingEncounterId === boss.id) resetBuilder();
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