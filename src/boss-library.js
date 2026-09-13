import { BOSS_DEFINITIONS, getBossDefinition } from './bosses.js';

const DEFINITION_PREFIX = 'bosses/definitions/';
const ASSET_PREFIX = 'bosses/assets/';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp']
]);
const ATTACK_TYPES = new Set(['beam', 'smash', 'fireball']);
const ATTACK_FACES = new Set(['left', 'right', 'front']);
const ATTACK_MECHANICS = new Set(['left_slam', 'right_slam', 'shockwave']);
const BEAM_SWEEP_DIRECTIONS = new Set(['left_to_right', 'right_to_left']);
const CUSTOM_ID = /^custom-[a-z0-9-]+$/;

function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'boss';
}

function randomSuffix() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function revisionToken() {
  return `${Date.now().toString(36)}-${randomSuffix().slice(0, 4)}`;
}

function safeText(value, fallback, max = 60) {
  const text = String(value || '').trim().replace(/[<>]/g, '').slice(0, max);
  return text || fallback;
}

function safeNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function defaultAttackSize(type) {
  if (type === 'beam') return 48;
  if (type === 'smash') return 90;
  return 34;
}

function normaliseBeamSweepDirection(value) {
  return BEAM_SWEEP_DIRECTIONS.has(value) ? value : 'left_to_right';
}

function attackGeometry(type, rawSize, rawSweepDirection = null) {
  const size = Math.round(safeNumber(rawSize, 4, 640, defaultAttackSize(type)));
  if (type === 'beam') {
    return {
      beamWidth: size,
      sweepDirection: normaliseBeamSweepDirection(rawSweepDirection)
    };
  }
  return { radius: size };
}

function publicSummary(definition) {
  return {
    id: definition.id,
    name: definition.name,
    encounter: definition.encounter || '',
    custom: Boolean(definition.custom),
    schemaVersion: Number(definition.schemaVersion) || 1,
    attackCount: Array.isArray(definition.attackDefinitions)
      ? definition.attackDefinitions.length
      : Array.isArray(definition.attacks)
        ? definition.attacks.length
        : 0,
    enrageMs: Number(definition.enrage?.timerMs) || 0,
    canvas: definition.canvas || { width: 640, height: 360 },
    art: definition.art || null
  };
}

function validateImage(file, label, required = true) {
  if (!(file instanceof File) || !file.size) {
    if (required) throw new Error(`${label} image is required.`);
    return null;
  }
  const extension = ALLOWED_IMAGE_TYPES.get(file.type);
  if (!extension) throw new Error(`${label} must be a PNG, JPEG or WebP image.`);
  if (file.size > MAX_IMAGE_BYTES) throw new Error(`${label} must be smaller than 8 MB.`);
  return extension;
}

function validExistingAsset(url, id) {
  if (!url || !CUSTOM_ID.test(id)) return null;
  const value = String(url);
  const prefix = `/api/boss-assets/${id}/`;
  if (!value.startsWith(prefix)) return null;
  const path = value.slice(prefix.length);
  if (!/^(?:idle|attack|background|foreground|neutral|death|attack-\d+)(?:-[a-z0-9-]+)?\.(?:png|jpg|webp)$/.test(path)) return null;
  return value;
}

function parseAttackDefinitions(value) {
  let raw;
  try {
    raw = JSON.parse(String(value || '[]'));
  } catch {
    throw new Error('Boss attack configuration is invalid.');
  }
  if (!Array.isArray(raw) || raw.length < 1) throw new Error('At least one boss attack is required.');
  if (raw.length > 12) throw new Error('An encounter can currently have at most 12 boss attacks.');

  return raw.map((attack, index) => {
    const type = ATTACK_TYPES.has(attack?.type) ? attack.type : 'fireball';
    const faces = ATTACK_FACES.has(attack?.faces) ? attack.faces : 'left';
    const mechanic = ATTACK_MECHANICS.has(attack?.mechanic) ? attack.mechanic : 'shockwave';
    const baseDamage = Math.round(safeNumber(attack?.baseDamage, 1, 500, 24));
    const critDamage = Math.round(safeNumber(attack?.critDamage, baseDamage, 1000, Math.max(baseDamage, 40)));
    const sweepDirection = type === 'beam'
      ? normaliseBeamSweepDirection(attack?.sweepDirection ?? attack?.geometry?.sweepDirection)
      : null;

    return {
      id: `attack-${index + 1}`,
      name: safeText(attack?.name, `Attack ${index + 1}`, 50),
      type,
      faces,
      mechanic,
      origin: {
        x: safeNumber(attack?.originX ?? attack?.origin?.x, 0, 100, 50),
        y: safeNumber(attack?.originY ?? attack?.origin?.y, 0, 100, 24)
      },
      geometry: attackGeometry(
        type,
        attack?.size ?? attack?.geometry?.beamWidth ?? attack?.geometry?.radius,
        sweepDirection
      ),
      baseDamage,
      critDamage,
      warningMs: Math.round(safeNumber(attack?.warningMs, 500, 10000, 1650)),
      travelMs: Math.round(safeNumber(attack?.travelMs, 0, 10000, 720)),
      existingImage: String(attack?.existingImage || attack?.image || '')
    };
  });
}

async function putImage(env, key, file) {
  await env.BOSS_ASSETS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type }
  });
}

async function storedCustomDefinition(env, id) {
  if (!env.BOSS_ASSETS || !CUSTOM_ID.test(id)) return null;
  const stored = await env.BOSS_ASSETS.get(`${DEFINITION_PREFIX}${id}.json`);
  if (!stored) return null;
  try {
    return await stored.json();
  } catch {
    return null;
  }
}

function queueImage({ env, uploadJobs, id, revision, name, file, label, existing, required = true }) {
  const extension = validateImage(file, label, false);
  if (extension) {
    const key = `${ASSET_PREFIX}${id}/${name}-${revision}.${extension}`;
    uploadJobs.push(putImage(env, key, file));
    return `/api/boss-assets/${id}/${name}-${revision}.${extension}`;
  }

  const preserved = validExistingAsset(existing, id);
  if (preserved) return preserved;
  if (required) throw new Error(`${label} image is required.`);
  return null;
}

async function buildEncounterDefinition(form, env, { id, existing = null }) {
  const revision = revisionToken();
  const uploadJobs = [];
  const name = safeText(form.get('name'), existing?.name || 'Custom Boss');
  const encounter = safeText(form.get('encounter'), existing?.encounter || 'Custom Encounter', 80);

  const canvas = {
    width: Math.round(safeNumber(form.get('canvasWidth'), 640, 640, 640)),
    height: Math.round(safeNumber(form.get('canvasHeight'), 360, 360, 360))
  };

  const backgroundUrl = queueImage({
    env, uploadJobs, id, revision, name: 'background',
    file: form.get('background'), label: 'Background', existing: existing?.art?.backgroundBack
  });

  const neutralUrl = queueImage({
    env, uploadJobs, id, revision, name: 'neutral',
    file: form.get('idle'), label: 'Neutral',
    existing: existing?.art?.bossNeutral || existing?.art?.bossIdle || existing?.art?.boss
  });

  const deathUrl = queueImage({
    env, uploadJobs, id, revision, name: 'death',
    file: form.get('death'), label: 'Death',
    existing: existing?.art?.bossDeath || existing?.art?.bossNeutral || existing?.art?.bossIdle || existing?.art?.boss
  });

  const foregroundUrl = queueImage({
    env, uploadJobs, id, revision, name: 'foreground',
    file: form.get('foreground'), label: 'Foreground',
    existing: existing?.art?.backgroundFront, required: false
  });

  const attackDefinitions = parseAttackDefinitions(form.get('attackDefinitions'));
  const storedAttacks = attackDefinitions.map((attack, index) => {
    const file = form.get(`attackImage_${index}`);
    const extension = validateImage(file, `${attack.name} attack`, false);
    let image;

    if (extension) {
      const key = `${ASSET_PREFIX}${id}/attack-${index}-${revision}.${extension}`;
      uploadJobs.push(putImage(env, key, file));
      image = `/api/boss-assets/${id}/attack-${index}-${revision}.${extension}`;
    } else {
      image = validExistingAsset(attack.existingImage, id);
      if (!image) throw new Error(`${attack.name} attack image is required.`);
    }

    return {
      id: attack.id,
      name: attack.name,
      type: attack.type,
      faces: attack.faces,
      mechanic: attack.mechanic,
      origin: attack.origin,
      geometry: attack.geometry,
      baseDamage: attack.baseDamage,
      critDamage: attack.critDamage,
      warningMs: attack.warningMs,
      travelMs: attack.travelMs,
      image
    };
  });

  await Promise.all(uploadJobs);

  const firstAttack = storedAttacks[0];
  const bossWidth = Math.round(safeNumber(form.get('bossWidth'), 64, 900, existing?.presentation?.width || 560));
  const bossHeight = Math.round(safeNumber(form.get('bossHeight'), 64, 900, existing?.presentation?.height || 490));
  const bossTop = Math.round(safeNumber(form.get('bossTop'), -500, 360, existing?.presentation?.top ?? -92));
  const enrageSeconds = safeNumber(form.get('enrageSeconds'), 0, 3600, (existing?.enrage?.timerMs || 120000) / 1000);
  const enrageDamageMultiplier = safeNumber(form.get('enrageDamageMultiplier'), 1, 5, existing?.enrage?.damageMultiplier || 1.5);

  return {
    schemaVersion: 4,
    id,
    name,
    encounter,
    custom: true,
    canvas,
    attacks: storedAttacks.map((attack) => attack.mechanic),
    attackDefinitions: storedAttacks,
    art: {
      boss: neutralUrl,
      bossIdle: neutralUrl,
      bossNeutral: neutralUrl,
      bossDeath: deathUrl,
      bossAttack: firstAttack.image,
      attackFaces: firstAttack.faces,
      backgroundBack: backgroundUrl,
      backgroundFront: foregroundUrl
    },
    defaults: {
      ...(existing?.defaults || {}),
      minHealth: existing?.defaults?.minHealth || 300,
      healthPerPlayer: existing?.defaults?.healthPerPlayer || 100,
      aggression: existing?.defaults?.aggression || 4,
      attackPower: existing?.defaults?.attackPower || 3,
      warningMs: firstAttack.warningMs
    },
    presentation: {
      ...(existing?.presentation || {}),
      width: bossWidth,
      height: bossHeight,
      top: bossTop,
      idleSway: existing?.presentation?.idleSway ?? 5,
      idleBob: existing?.presentation?.idleBob ?? 2.5,
      idleBreath: existing?.presentation?.idleBreath ?? 0.007,
      hitRecoil: existing?.presentation?.hitRecoil ?? 17,
      defeatSink: existing?.presentation?.defeatSink ?? 230,
      defeatDrift: existing?.presentation?.defeatDrift ?? -8,
      defeatTilt: existing?.presentation?.defeatTilt ?? 0.055
    },
    enrage: {
      timerMs: Math.round(enrageSeconds * 1000),
      damageMultiplier: enrageDamageMultiplier
    },
    victory: existing?.victory || {
      bossFallMs: 7000,
      celebrationMs: 8200
    },
    lootTable: existing?.lootTable || {
      version: 1,
      entries: []
    },
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
}

export function bossLibraryAvailable(env) {
  return Boolean(env.BOSS_ASSETS);
}

export async function listBosses(env) {
  const builtIns = Object.values(BOSS_DEFINITIONS).map(publicSummary);
  if (!env.BOSS_ASSETS) return builtIns;

  const listed = await env.BOSS_ASSETS.list({ prefix: DEFINITION_PREFIX, limit: 1000 });
  const custom = await Promise.all(listed.objects.map(async (object) => {
    try {
      const stored = await env.BOSS_ASSETS.get(object.key);
      if (!stored) return null;
      const definition = await stored.json();
      return publicSummary(definition);
    } catch {
      return null;
    }
  }));

  return [...builtIns, ...custom.filter(Boolean)].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getBossFromLibrary(env, id = 'numberzilla') {
  if (BOSS_DEFINITIONS[id]) return getBossDefinition(id);
  return storedCustomDefinition(env, id);
}

export async function createBossTemplate(request, env) {
  if (!env.BOSS_ASSETS) throw new Error('Boss asset storage is not configured.');
  const form = await request.formData();
  const name = safeText(form.get('name'), 'Custom Boss');
  const id = `custom-${slugify(name)}-${randomSuffix()}`;
  const definition = await buildEncounterDefinition(form, env, { id });

  await env.BOSS_ASSETS.put(
    `${DEFINITION_PREFIX}${id}.json`,
    JSON.stringify(definition),
    { httpMetadata: { contentType: 'application/json; charset=utf-8' } }
  );

  return publicSummary(definition);
}

export async function updateBossTemplate(request, env, id) {
  if (!env.BOSS_ASSETS) throw new Error('Boss asset storage is not configured.');
  if (!CUSTOM_ID.test(id)) throw new Error('Boss encounter ID is invalid.');
  const existing = await storedCustomDefinition(env, id);
  if (!existing) return null;

  const form = await request.formData();
  const definition = await buildEncounterDefinition(form, env, { id, existing });
  await env.BOSS_ASSETS.put(
    `${DEFINITION_PREFIX}${id}.json`,
    JSON.stringify(definition),
    { httpMetadata: { contentType: 'application/json; charset=utf-8' } }
  );
  return definition;
}

export async function deleteBossTemplate(env, id) {
  if (!env.BOSS_ASSETS || !CUSTOM_ID.test(id)) return false;
  const definitionKey = `${DEFINITION_PREFIX}${id}.json`;
  const existing = await env.BOSS_ASSETS.get(definitionKey);
  if (!existing) return false;

  // Remove the encounter from new raid creation, but retain immutable artwork
  // so existing raid snapshots continue to render correctly.
  await env.BOSS_ASSETS.delete(definitionKey);
  return true;
}

export async function serveBossAsset(env, path) {
  const valid = /^custom-[a-z0-9-]+\/(?:idle|attack|background|foreground|neutral|death|attack-\d+)(?:-[a-z0-9-]+)?\.(?:png|jpg|webp)$/.test(path);
  if (!env.BOSS_ASSETS || !valid) return new Response('Not found', { status: 404 });

  const object = await env.BOSS_ASSETS.get(`${ASSET_PREFIX}${path}`);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
}