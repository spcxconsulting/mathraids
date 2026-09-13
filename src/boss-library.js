import { BOSS_DEFINITIONS, getBossDefinition } from './bosses.js';

const DEFINITION_PREFIX = 'bosses/definitions/';
const ASSET_PREFIX = 'bosses/assets/';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp']
]);

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

function publicSummary(definition) {
  return {
    id: definition.id,
    name: definition.name,
    encounter: definition.encounter || '',
    custom: Boolean(definition.custom),
    art: definition.art || null
  };
}

function validateImage(file, label) {
  if (!(file instanceof File) || !file.size) throw new Error(`${label} image is required.`);
  const extension = ALLOWED_IMAGE_TYPES.get(file.type);
  if (!extension) throw new Error(`${label} must be a PNG, JPEG or WebP image.`);
  if (file.size > MAX_IMAGE_BYTES) throw new Error(`${label} must be smaller than 8 MB.`);
  return extension;
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
  const idle = form.get('idle');
  const attack = form.get('attack');
  const idleExt = validateImage(idle, 'Idle');
  const attackExt = validateImage(attack, 'Attack');
  const attackFaces = form.get('attackFaces') === 'right' ? 'right' : 'left';
  const id = `custom-${slugify(name)}-${randomSuffix()}`;

  const idleKey = `${ASSET_PREFIX}${id}/idle.${idleExt}`;
  const attackKey = `${ASSET_PREFIX}${id}/attack.${attackExt}`;

  await Promise.all([
    env.BOSS_ASSETS.put(idleKey, idle.stream(), { httpMetadata: { contentType: idle.type } }),
    env.BOSS_ASSETS.put(attackKey, attack.stream(), { httpMetadata: { contentType: attack.type } })
  ]);

  const definition = {
    id,
    name,
    encounter,
    custom: true,
    attacks: ['left_slam', 'right_slam', 'shockwave'],
    art: {
      bossIdle: `/api/boss-assets/${id}/idle.${idleExt}`,
      bossAttack: `/api/boss-assets/${id}/attack.${attackExt}`,
      attackFaces,
      backgroundBack: '/art/city-back.svg',
      backgroundFront: '/art/city-front.svg'
    },
    defaults: {
      minHealth: 300,
      healthPerPlayer: 100,
      aggression: 4,
      attackPower: 3,
      warningMs: 1650
    },
    presentation: {
      width: 560,
      height: 490,
      top: -92,
      idleSway: 5,
      idleBob: 2.5,
      idleBreath: 0.007,
      hitRecoil: 17,
      defeatSink: 230,
      defeatDrift: -8,
      defeatTilt: 0.055
    },
    victory: {
      bossFallMs: 7000,
      celebrationMs: 8200
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

  // Remove the template from the selectable library, but retain its immutable
  // artwork so raid rooms that already snapshotted this definition continue to
  // render correctly. Orphan cleanup can be added later with raid retention.
  await env.BOSS_ASSETS.delete(definitionKey);
  return true;
}

export async function serveBossAsset(env, path) {
  if (!env.BOSS_ASSETS || !/^custom-[a-z0-9-]+\/(?:idle|attack)\.(?:png|jpg|webp)$/.test(path)) {
    return new Response('Not found', { status: 404 });
  }

  const object = await env.BOSS_ASSETS.get(`${ASSET_PREFIX}${path}`);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
}
