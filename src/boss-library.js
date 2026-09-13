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

function safeText(value, fallback, max = 60) {
  const text = String(value || '').trim().replace(/[<>]/g, '').slice(0, max);
  return text || fallback;
}

function safeNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
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
    return {
      id: `attack-${index + 1}`,
      name: safeText(attack?.name, `Attack ${index + 1}`, 50),
      type,
      faces,
      mechanic,
      baseDamage,
      critDamage,
      warningMs: Math.round(safeNumber(attack?.warningMs, 500, 10000, 1650)),
      travelMs: Math.round(safeNumber(attack?.travelMs, 0, 10000, 720))
    };
  });
}

async function putImage(env, key, file) {
  await env.BOSS_ASSETS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type }
  });
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
  if (!env.BOSS_ASSETS || !/^custom-[a-z0-9-]+$/.test(id)) return null;

  const stored = await env.BOSS_ASSETS.get(`${DEFINITION_PREFIX}${id}.json`);
  if (!stored) return null;
  try {
    return await stored.json();
  } catch {
    return null;
  }
}

export async function createBossTemplate(request, env) {
  if (!env.BOSS_ASSETS) throw new Error('Boss asset storage is not configured.');

  const form = await request.formData();
  const name = safeText(form.get('name'), 'Custom Boss');
  const encounter = safeText(form.get('encounter'), 'Custom Encounter', 80);
  const id = `custom-${slugify(name)}-${randomSuffix()}`;

  const canvas = {
    width: Math.round(safeNumber(form.get('canvasWidth'), 640, 640, 640)),
    height: Math.round(safeNumber(form.get('canvasHeight'), 360, 360, 360))
  };

  const background = form.get('background');
  const foreground = form.get('foreground');
  const idle = form.get('idle');
  const death = form.get('death');
  const backgroundExt = validateImage(background, 'Background');
  const foregroundExt = validateImage(foreground, 'Foreground', false);
  const idleExt = validateImage(idle, 'Neutral');
  const deathExt = validateImage(death, 'Death');

  const attackDefinitions = parseAttackDefinitions(form.get('attackDefinitions'));
  const attackUploads = attackDefinitions.map((attack, index) => {
    const file = form.get(`attackImage_${index}`);
    const extension = validateImage(file, `${attack.name} attack`);
    return { ...attack, file, extension };
  });

  const backgroundKey = `${ASSET_PREFIX}${id}/background.${backgroundExt}`;
  const foregroundKey = foregroundExt ? `${ASSET_PREFIX}${id}/foreground.${foregroundExt}` : null;
  const neutralKey = `${ASSET_PREFIX}${id}/neutral.${idleExt}`;
  const deathKey = `${ASSET_PREFIX}${id}/death.${deathExt}`;

  const uploadJobs = [
    putImage(env, backgroundKey, background),
    putImage(env, neutralKey, idle),
    putImage(env, deathKey, death)
  ];
  if (foregroundKey) uploadJobs.push(putImage(env, foregroundKey, foreground));

  const storedAttacks = attackUploads.map((attack, index) => {
    const key = `${ASSET_PREFIX}${id}/attack-${index}.${attack.extension}`;
    uploadJobs.push(putImage(env, key, attack.file));
    return {
      id: attack.id,
      name: attack.name,
      type: attack.type,
      faces: attack.faces,
      mechanic: attack.mechanic,
      baseDamage: attack.baseDamage,
      critDamage: attack.critDamage,
      warningMs: attack.warningMs,
      travelMs: attack.travelMs,
      image: `/api/boss-assets/${id}/attack-${index}.${attack.extension}`
    };
  });

  await Promise.all(uploadJobs);

  const firstAttack = storedAttacks[0];
  const bossWidth = Math.round(safeNumber(form.get('bossWidth'), 64, 900, 560));
  const bossHeight = Math.round(safeNumber(form.get('bossHeight'), 64, 900, 490));
  const bossTop = Math.round(safeNumber(form.get('bossTop'), -500, 360, -92));
  const enrageSeconds = safeNumber(form.get('enrageSeconds'), 0, 3600, 120);
  const enrageDamageMultiplier = safeNumber(form.get('enrageDamageMultiplier'), 1, 5, 1.5);

  const definition = {
    schemaVersion: 2,
    id,
    name,
    encounter,
    custom: true,
    canvas,

    // Keep the existing engine-compatible mechanic list while richer attack
    // definitions are introduced incrementally into the runtime.
    attacks: storedAttacks.map((attack) => attack.mechanic),
    attackDefinitions: storedAttacks,

    art: {
      boss: `/api/boss-assets/${id}/neutral.${idleExt}`,
      bossIdle: `/api/boss-assets/${id}/neutral.${idleExt}`,
      bossNeutral: `/api/boss-assets/${id}/neutral.${idleExt}`,
      bossDeath: `/api/boss-assets/${id}/death.${deathExt}`,
      bossAttack: firstAttack.image,
      attackFaces: firstAttack.faces,
      backgroundBack: `/api/boss-assets/${id}/background.${backgroundExt}`,
      backgroundFront: foregroundKey ? `/api/boss-assets/${id}/foreground.${foregroundExt}` : null
    },

    defaults: {
      minHealth: 300,
      healthPerPlayer: 100,
      aggression: 4,
      attackPower: 3,
      warningMs: firstAttack.warningMs
    },

    presentation: {
      width: bossWidth,
      height: bossHeight,
      top: bossTop,
      idleSway: 5,
      idleBob: 2.5,
      idleBreath: 0.007,
      hitRecoil: 17,
      defeatSink: 230,
      defeatDrift: -8,
      defeatTilt: 0.055
    },

    enrage: {
      timerMs: Math.round(enrageSeconds * 1000),
      damageMultiplier: enrageDamageMultiplier
    },

    victory: {
      bossFallMs: 7000,
      celebrationMs: 8200
    },

    lootTable: {
      version: 1,
      entries: []
    },

    createdAt: Date.now()
  };

  await env.BOSS_ASSETS.put(
    `${DEFINITION_PREFIX}${id}.json`,
    JSON.stringify(definition),
    { httpMetadata: { contentType: 'application/json; charset=utf-8' } }
  );

  return publicSummary(definition);
}

export async function deleteBossTemplate(env, id) {
  if (!env.BOSS_ASSETS || !/^custom-[a-z0-9-]+$/.test(id)) return false;
  const definitionKey = `${DEFINITION_PREFIX}${id}.json`;
  const existing = await env.BOSS_ASSETS.get(definitionKey);
  if (!existing) return false;

  // Remove the encounter from new raid creation, but retain immutable artwork
  // so existing raid snapshots continue to render correctly.
  await env.BOSS_ASSETS.delete(definitionKey);
  return true;
}

export async function serveBossAsset(env, path) {
  const valid = /^custom-[a-z0-9-]+\/(?:idle|attack|background|foreground|neutral|death|attack-\d+)\.(?:png|jpg|webp)$/.test(path);
  if (!env.BOSS_ASSETS || !valid) return new Response('Not found', { status: 404 });

  const object = await env.BOSS_ASSETS.get(`${ASSET_PREFIX}${path}`);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
}
