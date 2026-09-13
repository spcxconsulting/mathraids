import { BossPresentation } from './boss-presentation.js';

const WIDTH = 640;
const HEIGHT = 360;
const GROUND_Y = 312;
const MIN_X = 28;
const MAX_X = WIDTH - 28;
const RUN_SPEED = 270;
const JUMP_SPEED = 520;
const GRAVITY = 1500;
const POSITION_SEND_MS = 100;
const REMOTE_LERP = 18;
const REMOTE_JUMP_MS = 650;
const LABEL_LIMIT = 14;
const BOSS_X = WIDTH / 2;
const JUMP_CHAIN_WINDOW_MS = 2200;
const JUMP_LOCK_MS = 5000;
const JUMP_BASE_READY_MS = 780;
const JUMP_HEIGHT_STRENGTHS = [1, 0.5, 0.25];

const PLAYER_W = 24;
const PLAYER_H = 30;
const BOSS_W = 560;
const BOSS_H = 490;
const BOSS_TOP = -92;

const ART = {
  cityBack: '/art/city-back.svg',
  cityFront: '/art/city-front.svg',
  staging: '/art/staging-overlay.svg',
  dps: '/art/player-dps.svg',
  healer: '/art/player-healer.svg',
  boss: '/art/numberzilla.svg'
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pctToX(value) {
  return clamp((Number(value) / 100) * WIDTH, MIN_X, MAX_X);
}

function xToPct(value) {
  return clamp((Number(value) / WIDTH) * 100, 4, 96);
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function makeRaster(image, logicalWidth, logicalHeight, scale) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(logicalWidth * scale));
  canvas.height = Math.max(1, Math.ceil(logicalHeight * scale));
  const context = canvas.getContext('2d', { alpha: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function safePlayerClass(value) {
  return ['dps', 'healer', 'tank'].includes(value) ? value : 'dps';
}

function jumpTiming(strength) {
  const velocityScale = Math.sqrt(clamp(Number(strength) || 1, 0.2, 1));
  return {
    velocityScale,
    airborneMs: Math.max(260, Math.round(REMOTE_JUMP_MS * velocityScale)),
    readyMs: Math.max(420, Math.round(JUMP_BASE_READY_MS * velocityScale))
  };
}

export function createRaidBattlefield({
  parent = 'phaser-game',
  onPosition = () => {},
  onJump = () => {}
} = {}) {
  const host = document.getElementById(parent);
  if (!host) throw new Error(`Battlefield mount #${parent} was not found`);

  host.replaceChildren();
  host.style.display = 'grid';
  host.style.placeItems = 'center';
  host.style.overflow = 'hidden';

  const canvas = document.createElement('canvas');
  canvas.className = 'vector-battlefield-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.touchAction = 'none';
  host.append(canvas);

  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const state = {
    mode: 'lobby',
    localPlayerId: null,
    players: new Map(),
    input: { left: false, right: false },
    lastFrameAt: performance.now(),
    lastPositionSentAt: 0,
    lastSentX: null,
    jumpFatigueEnabled: true,
    telegraph: null,
    complete: null,
    completedAt: 0,
    bossHitUntil: 0,
    bossHitFromX: BOSS_X,
    bossAttackUntil: 0,
    bossAttackType: null,
    bossAttackEffect: null,
    bossPresentation: new BossPresentation({
      presentation: {
        idleSway: 5,
        idleBob: 2.5,
        idleBreath: 0.007,
        hitRecoil: 17,
        defeatSink: 430,
        defeatDrift: -12,
        defeatTilt: 0.085
      },
      victory: { bossFallMs: 4800 }
    }),
    projectiles: [],
    specials: [],
    floaters: [],
    running: true,
    remoteLabelsEnabled: true,
    assetsReady: false,
    rawAssets: null,
    cache: null,
    renderScale: 1,
    encounterScene: null,
    encounterCache: null,
    encounterSignature: '',
    encounterLoadToken: 0
  };

  function localPlayer() {
    return state.localPlayerId ? state.players.get(state.localPlayerId) : null;
  }

  function faceBoss(entry) {
    if (state.mode !== 'raid') return;
    entry.facing = entry.x < BOSS_X ? 'right' : 'left';
  }

  function rebuildEncounterCache() {
    const scene = state.encounterScene;
    if (!scene?.raw) {
      state.encounterCache = null;
      return;
    }

    const scale = state.renderScale;
    const presentation = scene.presentation;
    state.encounterCache = {
      back: makeRaster(scene.raw.back, WIDTH, HEIGHT, scale),
      front: scene.raw.front ? makeRaster(scene.raw.front, WIDTH, HEIGHT, scale) : null,
      neutral: makeRaster(scene.raw.neutral, presentation.width, presentation.height, scale),
      attack: scene.raw.attack ? makeRaster(scene.raw.attack, presentation.width, presentation.height, scale) : null,
      death: scene.raw.death ? makeRaster(scene.raw.death, presentation.width, presentation.height, scale) : null
    };
  }

  function rebuildCache() {
    if (!state.rawAssets) return;
    const scale = state.renderScale;
    state.cache = {
      cityBack: makeRaster(state.rawAssets.cityBack, WIDTH, HEIGHT, scale),
      cityFront: makeRaster(state.rawAssets.cityFront, WIDTH, HEIGHT, scale),
      staging: makeRaster(state.rawAssets.staging, WIDTH, HEIGHT, scale),
      dps: makeRaster(state.rawAssets.dps, PLAYER_W, PLAYER_H, scale),
      healer: makeRaster(state.rawAssets.healer, PLAYER_W, PLAYER_H, scale),
      boss: makeRaster(state.rawAssets.boss, BOSS_W, BOSS_H, scale)
    };
    rebuildEncounterCache();
    state.assetsReady = true;
  }

  async function setEncounterScene(serverState) {
    const boss = serverState?.boss || {};
    const art = boss.art || {};
    const id = String(boss.id || '');
    const custom = id.startsWith('custom-') && (art.bossNeutral || art.bossIdle || art.boss) && art.backgroundBack;

    if (!custom) {
      state.encounterScene = null;
      state.encounterCache = null;
      state.encounterSignature = '';
      state.encounterLoadToken += 1;
      return;
    }

    const presentation = {
      width: Math.max(1, Number(boss.presentation?.width) || BOSS_W),
      height: Math.max(1, Number(boss.presentation?.height) || BOSS_H),
      top: Number.isFinite(Number(boss.presentation?.top)) ? Number(boss.presentation.top) : BOSS_TOP
    };
    const neutralSrc = art.bossNeutral || art.bossIdle || art.boss;
    const attackSrc = art.bossAttack || neutralSrc;
    const deathSrc = art.bossDeath || neutralSrc;
    const signature = [
      id,
      art.backgroundBack,
      art.backgroundFront || '',
      neutralSrc,
      attackSrc,
      deathSrc,
      presentation.width,
      presentation.height,
      presentation.top,
      art.attackFaces || 'left'
    ].join('|');

    if (state.encounterScene && state.encounterSignature === signature) {
      state.encounterScene.presentation = presentation;
      state.encounterScene.attackFaces = art.attackFaces || 'left';
      return;
    }

    const token = ++state.encounterLoadToken;
    const [back, front, neutral, attack, death] = await Promise.all([
      loadImage(art.backgroundBack),
      art.backgroundFront ? loadImage(art.backgroundFront) : Promise.resolve(null),
      loadImage(neutralSrc),
      attackSrc ? loadImage(attackSrc) : Promise.resolve(null),
      deathSrc ? loadImage(deathSrc) : Promise.resolve(null)
    ]);
    if (token !== state.encounterLoadToken) return;

    state.encounterSignature = signature;
    state.encounterScene = {
      id,
      presentation,
      attackFaces: art.attackFaces || 'left',
      raw: { back, front, neutral, attack, death }
    };
    rebuildEncounterCache();
  }

  function resize() {
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const aspect = WIDTH / HEIGHT;
    let cssWidth = rect.width;
    let cssHeight = cssWidth / aspect;
    if (cssHeight > rect.height) {
      cssHeight = rect.height;
      cssWidth = cssHeight * aspect;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.style.width = `${Math.floor(cssWidth)}px`;
    canvas.style.height = `${Math.floor(cssHeight)}px`;
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    state.renderScale = canvas.width / WIDTH;
    rebuildCache();
    draw(performance.now());
  }

  Promise.all(Object.entries(ART).map(async ([key, src]) => [key, await loadImage(src)]))
    .then((entries) => {
      state.rawAssets = Object.fromEntries(entries);
      rebuildCache();
      draw(performance.now());
    })
    .catch((error) => console.error('Could not load MathRaids vector art', error));

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  resize();

  function ensurePlayer(player) {
    let entry = state.players.get(player.id);
    if (!entry) {
      entry = {
        id: player.id,
        name: player.name || 'Raider',
        class: safePlayerClass(player.class),
        x: pctToX(player.x),
        targetX: pctToX(player.x),
        y: GROUND_Y,
        vy: 0,
        grounded: true,
        facing: player.facing === 'left' ? 'left' : 'right',
        remoteJumpStart: 0,
        remoteJumpDuration: REMOTE_JUMP_MS,
        remoteJumpStrength: 1,
        dazedUntil: 0,
        powerReady: false,
        jumpFatigue: Math.max(0, Number(player.jumpFatigue) || 0),
        lastJumpAt: Number(player.lastJumpAt) || 0,
        jumpReadyAt: Number(player.jumpReadyAt) || 0,
        jumpLockedUntil: Number(player.jumpLockedUntil) || 0
      };
      state.players.set(player.id, entry);
    }
    entry.name = player.name || entry.name;
    entry.class = safePlayerClass(player.class || entry.class);
    if (Number.isFinite(Number(player.jumpFatigue))) entry.jumpFatigue = Math.max(0, Number(player.jumpFatigue));
    if (Number.isFinite(Number(player.lastJumpAt))) entry.lastJumpAt = Number(player.lastJumpAt);
    if (Number.isFinite(Number(player.jumpReadyAt))) entry.jumpReadyAt = Number(player.jumpReadyAt);
    if (Number.isFinite(Number(player.jumpLockedUntil))) entry.jumpLockedUntil = Number(player.jumpLockedUntil);
    faceBoss(entry);
    return entry;
  }

  function applyRemoteAirborne(entry, airborneUntil, jumpStrength = 1) {
    if (!entry || entry.id === state.localPlayerId) return;
    const until = Number(airborneUntil) || 0;
    const remaining = until - Date.now();
    if (remaining <= 0) {
      entry.remoteJumpStart = 0;
      entry.remoteJumpStrength = 1;
      entry.y = GROUND_Y;
      return;
    }

    const strength = clamp(Number(jumpStrength) || 1, 0.2, 1);
    const timing = jumpTiming(strength);
    entry.remoteJumpDuration = timing.airborneMs;
    entry.remoteJumpStrength = strength;
    const elapsed = clamp(timing.airborneMs - remaining, 0, timing.airborneMs);
    entry.remoteJumpStart = performance.now() - elapsed;
  }

  function syncState(serverState) {
    if (!serverState) return;
    state.mode = serverState.status === 'lobby' ? 'lobby' : 'raid';
    state.remoteLabelsEnabled = (serverState.players?.length || 0) <= LABEL_LIMIT;
    state.jumpFatigueEnabled = serverState.jumpFatigue?.enabled !== false;

    if (!state.jumpFatigueEnabled) {
      const local = localPlayer();
      if (local) {
        local.jumpFatigue = 0;
        local.jumpLockedUntil = 0;
      }
    }

    if (serverState.boss) {
      state.bossPresentation.configure({
        presentation: serverState.boss.presentation || {},
        victory: serverState.boss.victory || {}
      });
      setEncounterScene(serverState).catch((error) => {
        console.error('Could not load encounter scene artwork', error);
        state.encounterScene = null;
        state.encounterCache = null;
        state.encounterSignature = '';
      });
    }

    const ids = new Set((serverState.players || []).map((player) => player.id));
    for (const id of state.players.keys()) if (!ids.has(id)) state.players.delete(id);

    for (const player of serverState.players || []) {
      const entry = ensurePlayer(player);
      if (player.id !== state.localPlayerId) {
        entry.targetX = pctToX(player.x);
        applyRemoteAirborne(entry, player.airborneUntil, player.jumpStrength || 1);
      } else if (state.lastSentX === null) {
        entry.x = pctToX(player.x);
        entry.targetX = entry.x;
      }
      faceBoss(entry);
    }

    if (serverState.pendingAttack?.executeAt > Date.now()) showTelegraph(serverState.pendingAttack);
  }

  function setLocalPlayerId(id) {
    state.localPlayerId = id;
    const entry = state.players.get(id);
    if (entry) {
      entry.targetX = entry.x;
      faceBoss(entry);
    }
  }

  function setLocalPowerReady(ready) {
    const local = localPlayer();
    if (local) local.powerReady = Boolean(ready);
  }

  function movePlayer(id, xPct, facing, airborneUntil) {
    const entry = state.players.get(id);
    if (!entry) return;
    if (id === state.localPlayerId) return;
    entry.targetX = pctToX(xPct);
    applyRemoteAirborne(entry, airborneUntil, entry.remoteJumpStrength);
    faceBoss(entry);
  }

  function jumpPlayer(id, airborneUntil, jumpStrength = 1, jumpLockedUntil = 0, jumpFatigue = null) {
    const entry = state.players.get(id);
    if (!entry) return;

    if (Number.isFinite(Number(jumpLockedUntil))) entry.jumpLockedUntil = Number(jumpLockedUntil) || 0;
    if (jumpFatigue !== null && Number.isFinite(Number(jumpFatigue))) entry.jumpFatigue = Math.max(0, Number(jumpFatigue));

    if (id === state.localPlayerId) return;
    applyRemoteAirborne(entry, airborneUntil || (Date.now() + REMOTE_JUMP_MS), jumpStrength);
  }

  function jumpLocal() {
    const player = localPlayer();
    const now = Date.now();
    if (!player || !player.grounded || player.dazedUntil > now) return false;

    if (!state.jumpFatigueEnabled) {
      const timing = jumpTiming(1);
      player.grounded = false;
      player.vy = -JUMP_SPEED;
      player.y -= 2;
      player.jumpFatigue = 0;
      player.jumpLockedUntil = 0;
      player.jumpReadyAt = now + timing.readyMs;
      onJump({ jumpStrength: 1, jumpFatigue: 0, jumpLockedUntil: 0 });
      draw(performance.now());
      return true;
    }

    if (now < (player.jumpLockedUntil || 0) || now < (player.jumpReadyAt || 0)) return false;

    if (!player.lastJumpAt || now - player.lastJumpAt > JUMP_CHAIN_WINDOW_MS) {
      player.jumpFatigue = 0;
    }

    const fatigueIndex = clamp(Math.round(player.jumpFatigue || 0), 0, JUMP_HEIGHT_STRENGTHS.length - 1);
    const strength = JUMP_HEIGHT_STRENGTHS[fatigueIndex];
    const timing = jumpTiming(strength);

    player.grounded = false;
    player.vy = -JUMP_SPEED * timing.velocityScale;
    player.y -= 2;
    player.lastJumpAt = now;
    player.jumpFatigue = fatigueIndex + 1;
    player.jumpReadyAt = now + timing.readyMs;
    player.jumpLockedUntil = player.jumpFatigue >= JUMP_HEIGHT_STRENGTHS.length
      ? now + JUMP_LOCK_MS
      : 0;

    onJump({
      jumpStrength: strength,
      jumpFatigue: player.jumpFatigue,
      jumpLockedUntil: player.jumpLockedUntil
    });
    draw(performance.now());
    return true;
  }

  function setJumpLock(until) {
    const player = localPlayer();
    if (!player || !state.jumpFatigueEnabled) return;
    player.jumpLockedUntil = Math.max(player.jumpLockedUntil || 0, Number(until) || 0);
  }

  function getPlayerVisualState(id) {
    const entry = state.players.get(id);
    if (!entry) return null;
    return {
      x: entry.x,
      y: entry.y,
      facing: entry.facing,
      grounded: entry.grounded,
      jumpLockedUntil: entry.jumpLockedUntil || 0,
      jumpFatigue: entry.jumpFatigue || 0
    };
  }

  function setHorizontal(direction, active) {
    state.input[direction] = active;
    const player = localPlayer();
    if (!player || player.dazedUntil > Date.now()) return;
    const axis = state.input.left === state.input.right ? 0 : state.input.left ? -1 : 1;
    if (axis !== 0) {
      player.x = clamp(player.x + axis * 3, MIN_X, MAX_X);
      if (state.mode === 'lobby') player.facing = axis < 0 ? 'left' : 'right';
      faceBoss(player);
      draw(performance.now());
    }
  }

  function playerAction(action) {
    const entry = state.players.get(action.playerId);
    if (!entry || state.mode !== 'raid') return;
    state.projectiles.push({
      x0: entry.x,
      y0: entry.y - 22,
      x1: BOSS_X + (entry.x - BOSS_X) * 0.035,
      y1: 88,
      start: performance.now(),
      duration: action.action === 'heal' ? 410 : 310,
      heal: action.action === 'heal',
      damage: action.damage || 0
    });
  }

  function playerSpecial(action) {
    const entry = state.players.get(action.playerId);
    if (!entry || state.mode !== 'raid') return;
    const now = performance.now();
    state.specials.push({
      playerId: action.playerId,
      ability: action.ability,
      x0: entry.x,
      y0: entry.y - 24,
      start: now,
      duration: action.ability === 'renewal_burst' ? 720 : 620,
      damage: action.damage || 0,
      healing: action.healing || 0
    });
    entry.powerReady = false;
  }

  function showTelegraph(attack) {
    if (attack) state.telegraph = { ...attack };
  }

  function resolveBossAttack(payload) {
    const now = performance.now();
    state.telegraph = null;
    state.bossAttackUntil = now + 650;
    state.bossAttackType = payload.attackType;
    state.bossAttackEffect = {
      type: payload.attackType,
      start: now,
      duration: 720,
      damage: payload.damage || 0
    };

    if ((payload.dodgedPlayerIds || []).includes(state.localPlayerId)) {
      const local = localPlayer();
      if (local) {
        state.floaters.push({ x: local.x, y: local.y - 42, text: 'DODGE!', color: '#71ddff', start: now, duration: 550 });
      }
    }
  }

  function setDazed(id, until) {
    const entry = state.players.get(id);
    if (entry) entry.dazedUntil = until;
  }

  function complete(outcome) {
    if (!state.complete) state.completedAt = performance.now();
    state.complete = outcome;
    state.input.left = false;
    state.input.right = false;
    state.telegraph = null;
  }

  function updateLocal(player, dt, now) {
    if (player.dazedUntil <= Date.now()) {
      const axis = state.input.left === state.input.right ? 0 : state.input.left ? -1 : 1;
      if (axis !== 0) {
        player.x = clamp(player.x + axis * RUN_SPEED * dt, MIN_X, MAX_X);
        if (state.mode === 'lobby') player.facing = axis < 0 ? 'left' : 'right';
      }

      if (!player.grounded) {
        player.vy += GRAVITY * dt;
        player.y += player.vy * dt;
        if (player.y >= GROUND_Y) {
          player.y = GROUND_Y;
          player.vy = 0;
          player.grounded = true;
        }
      }
    }

    faceBoss(player);

    if (now - state.lastPositionSentAt >= POSITION_SEND_MS) {
      const pct = xToPct(player.x);
      const axis = state.input.left === state.input.right ? 0 : state.input.left ? -1 : 1;
      if (state.lastSentX === null || Math.abs(pct - state.lastSentX) > 0.08 || axis !== 0 || !player.grounded) {
        onPosition({ x: pct, facing: player.facing });
        state.lastSentX = pct;
      }
      state.lastPositionSentAt = now;
    }
  }

  function updateRemote(entry, dt, now) {
    entry.x += (entry.targetX - entry.x) * Math.min(1, REMOTE_LERP * dt);
    faceBoss(entry);
    if (entry.remoteJumpStart) {
      const t = (now - entry.remoteJumpStart) / entry.remoteJumpDuration;
      if (t >= 1) {
        entry.remoteJumpStart = 0;
        entry.remoteJumpStrength = 1;
        entry.y = GROUND_Y;
      } else {
        entry.y = GROUND_Y - Math.sin(Math.PI * t) * 72 * entry.remoteJumpStrength;
      }
    }
  }

  function registerBossHit(fromX, damage, color = '#ffd080') {
    const now = performance.now();
    state.bossHitUntil = now + 230;
    state.bossHitFromX = fromX;
    state.floaters.push({ x: BOSS_X + 54, y: 80, text: `-${damage}`, color, start: now, duration: 520 });
  }

  function updateEffects(now) {
    state.projectiles = state.projectiles.filter((projectile) => {
      const t = (now - projectile.start) / projectile.duration;
      if (t >= 1) {
        registerBossHit(projectile.x0, projectile.damage, projectile.heal ? '#b8ffa9' : '#ffd080');
        return false;
      }
      return true;
    });

    state.specials = state.specials.filter((special) => {
      const t = (now - special.start) / special.duration;
      if (t >= 1) {
        registerBossHit(special.x0, special.damage, special.ability === 'renewal_burst' ? '#9dff91' : '#fff0a0');
        return false;
      }
      return true;
    });

    if (state.bossAttackEffect && now - state.bossAttackEffect.start > state.bossAttackEffect.duration) {
      state.bossAttackEffect = null;
    }

    state.floaters = state.floaters.filter((floater) => now - floater.start < floater.duration);
  }

  function drawRaster(cacheCanvas, x, y, w, h, flip = false, alpha = 1) {
    if (!cacheCanvas) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (flip) {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(cacheCanvas, 0, 0, w, h);
    } else {
      ctx.drawImage(cacheCanvas, x, y, w, h);
    }
    ctx.restore();
  }

  function bossPose(now) {
    return state.bossPresentation.pose({
      now,
      telegraph: state.telegraph,
      bossAttackUntil: state.bossAttackUntil,
      bossAttackType: state.bossAttackType,
      bossHitUntil: state.bossHitUntil,
      bossHitFromX: state.bossHitFromX,
      bossX: BOSS_X,
      complete: state.complete,
      completedAt: state.completedAt
    });
  }

  function customBossFrame(now) {
    const scene = state.encounterScene;
    const cache = state.encounterCache;
    if (!scene || !cache?.neutral) return null;

    if (state.complete === 'victory' && cache.death) {
      return { image: cache.death, flip: false };
    }

    const attackType = state.telegraph?.type || (now < state.bossAttackUntil ? state.bossAttackType : null);
    if (attackType && cache.attack) {
      if (scene.attackFaces === 'front') return { image: cache.attack, flip: false };
      if (attackType === 'left_slam' || attackType === 'right_slam') {
        const targetFaces = attackType === 'left_slam' ? 'left' : 'right';
        return { image: cache.attack, flip: scene.attackFaces !== targetFaces };
      }
      return { image: cache.attack, flip: false };
    }

    return { image: cache.neutral, flip: false };
  }

  function drawBoss(now) {
    if (state.mode !== 'raid' || state.complete === 'defeat') return;

    const customFrame = customBossFrame(now);
    const useCustom = Boolean(customFrame);
    const bossImage = useCustom ? customFrame.image : state.cache?.boss;
    if (!bossImage) return;

    const pose = bossPose(now);
    const presentation = useCustom
      ? state.encounterScene.presentation
      : { width: BOSS_W, height: BOSS_H, top: BOSS_TOP };
    const width = presentation.width;
    const height = presentation.height;
    const top = presentation.top;

    if (pose.aura > 0) {
      const gradient = ctx.createRadialGradient(BOSS_X, 118, 40, BOSS_X, 118, 230);
      gradient.addColorStop(0, `rgba(255,92,74,${pose.aura})`);
      gradient.addColorStop(1, 'rgba(255,80,64,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(70, 0, 500, 300);
    }

    ctx.save();
    ctx.translate(BOSS_X + pose.x, top + height / 2 + pose.y);
    ctx.rotate(pose.rotation);
    ctx.scale(pose.scaleX, pose.scaleY);
    if (customFrame?.flip) ctx.scale(-1, 1);
    ctx.translate(-width / 2, -height / 2);

    if (now < state.bossHitUntil && state.complete !== 'victory') {
      ctx.filter = 'brightness(1.75) saturate(1.25)';
    }
    ctx.drawImage(bossImage, 0, 0, width, height);
    ctx.restore();
    ctx.filter = 'none';
  }

  function drawPlayer(entry, isLocal, now) {
    const x = entry.x;
    const y = entry.y;
    const jumpHeight = Math.max(0, GROUND_Y - y);

    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, GROUND_Y + 3, Math.max(4, 9 - jumpHeight / 12), 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (entry.powerReady) {
      const pulse = 0.5 + (Math.sin(now / 90) + 1) * 0.18;
      ctx.save();
      ctx.strokeStyle = entry.class === 'healer' ? `rgba(118,255,157,${pulse})` : `rgba(255,216,92,${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y - PLAYER_H / 2, 18 + Math.sin(now / 120) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const cache = entry.class === 'healer' ? state.cache?.healer : state.cache?.dps;
    drawRaster(cache, x - PLAYER_W / 2, y - PLAYER_H, PLAYER_W, PLAYER_H, entry.facing === 'left', entry.dazedUntil > Date.now() ? 0.5 : 1);

    if (isLocal || state.remoteLabelsEnabled) {
      ctx.font = '600 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = isLocal ? '#a7ff9e' : '#eef6ff';
      ctx.strokeStyle = 'rgba(5,12,20,.9)';
      ctx.lineWidth = 2.5;
      const labelY = Math.min(354, y + 14);
      const label = isLocal ? `${entry.name} (you)` : entry.name;
      ctx.strokeText(label, x, labelY);
      ctx.fillText(label, x, labelY);
    }
  }

  function attackTargetX(type) {
    if (type === 'left_slam') return WIDTH * 0.24;
    if (type === 'right_slam') return WIDTH * 0.76;
    return BOSS_X;
  }

  function drawTelegraph(now) {
    const attack = state.telegraph;
    if (!attack || state.mode !== 'raid') return;

    const start = attack.warnedAt || (attack.executeAt - 1650);
    const duration = Math.max(1, attack.executeAt - start);
    const progress = clamp((Date.now() - start) / duration, 0, 1);
    const pulse = 0.55 + (Math.sin(now / 80) + 1) * 0.18;
    const targetX = attackTargetX(attack.type);
    const sourceX = BOSS_X;
    const sourceY = 92;

    ctx.save();
    ctx.globalAlpha = 0.08 + progress * 0.08;
    ctx.fillStyle = '#ff4058';
    if (attack.type === 'left_slam') ctx.fillRect(0, 270, WIDTH / 2, HEIGHT - 270);
    if (attack.type === 'right_slam') ctx.fillRect(WIDTH / 2, 270, WIDTH / 2, HEIGHT - 270);
    if (attack.type === 'shockwave') ctx.fillRect(0, 286, WIDTH, HEIGHT - 286);

    const chargeRadius = 10 + progress * 31 + Math.sin(now / 55) * 2;
    const gradient = ctx.createRadialGradient(sourceX, sourceY, 2, sourceX, sourceY, chargeRadius * 1.8);
    gradient.addColorStop(0, `rgba(255,245,190,${pulse})`);
    gradient.addColorStop(0.35, `rgba(255,116,75,${0.75 * pulse})`);
    gradient.addColorStop(1, 'rgba(255,55,45,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(sourceX, sourceY, chargeRadius * 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff0b0';
    ctx.beginPath();
    ctx.arc(sourceX, sourceY, Math.max(5, chargeRadius * 0.46), 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.14 + progress * 0.26;
    ctx.strokeStyle = '#ff8b64';
    ctx.lineWidth = 3 + progress * 5;
    ctx.setLineDash([9, 11]);
    ctx.beginPath();
    ctx.moveTo(sourceX, sourceY + chargeRadius);
    ctx.lineTo(targetX, GROUND_Y - 3);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 0.28 + progress * 0.38;
    ctx.strokeStyle = attack.type === 'shockwave' ? '#ffd76b' : '#ff6d5f';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(targetX, GROUND_Y + 2, 34 + progress * (attack.type === 'shockwave' ? 110 : 72), 9 + progress * 8, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawBossAttackEffect(now) {
    const effect = state.bossAttackEffect;
    if (!effect) return;

    const t = clamp((now - effect.start) / effect.duration, 0, 1);
    const targetX = attackTargetX(effect.type);
    const sourceX = BOSS_X;
    const sourceY = 92;
    const flightEnd = 0.56;

    if (t < flightEnd) {
      const flight = t / flightEnd;
      const eased = flight * flight * (3 - 2 * flight);
      const x = lerp(sourceX, targetX, eased);
      const y = lerp(sourceY, GROUND_Y - 10, eased) - Math.sin(Math.PI * flight) * 28;
      const radius = 16 + flight * 28;

      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.strokeStyle = '#ff6c52';
      ctx.lineWidth = 18 + flight * 18;
      ctx.beginPath();
      ctx.moveTo(sourceX, sourceY);
      ctx.lineTo(x, y);
      ctx.stroke();

      const gradient = ctx.createRadialGradient(x, y, 4, x, y, radius * 1.8);
      gradient.addColorStop(0, '#fff3bc');
      gradient.addColorStop(0.24, '#ffbb63');
      gradient.addColorStop(0.58, '#ff5d48');
      gradient.addColorStop(1, 'rgba(255,62,45,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    const impact = clamp((t - flightEnd) / (1 - flightEnd), 0, 1);
    const fade = 1 - impact;
    const fullArena = effect.type === 'shockwave';
    const radiusX = (fullArena ? 110 : 52) + impact * (fullArena ? 420 : 180);
    const radiusY = 14 + impact * 54;

    ctx.save();
    ctx.globalAlpha = fade * 0.58;
    ctx.fillStyle = fullArena ? '#ffd45e' : '#ff654e';
    ctx.beginPath();
    ctx.ellipse(targetX, GROUND_Y + 1, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = fade * 0.86;
    ctx.strokeStyle = '#fff3bd';
    ctx.lineWidth = 8 - impact * 5;
    ctx.beginPath();
    ctx.ellipse(targetX, GROUND_Y + 1, radiusX * 0.82, radiusY * 0.72, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (!fullArena) {
      ctx.globalAlpha = fade * 0.18;
      ctx.fillStyle = '#ff3f35';
      if (effect.type === 'left_slam') ctx.fillRect(0, 265, WIDTH / 2, HEIGHT - 265);
      if (effect.type === 'right_slam') ctx.fillRect(WIDTH / 2, 265, WIDTH / 2, HEIGHT - 265);
    } else {
      ctx.globalAlpha = fade * 0.22;
      ctx.fillStyle = '#ffd45e';
      ctx.fillRect(0, 288, WIDTH, HEIGHT - 288);
    }
    ctx.restore();
  }

  function drawProjectiles(now) {
    for (const projectile of state.projectiles) {
      const t = clamp((now - projectile.start) / projectile.duration, 0, 1);
      const x = projectile.x0 + (projectile.x1 - projectile.x0) * t;
      const y = projectile.y0 + (projectile.y1 - projectile.y0) * t - Math.sin(Math.PI * t) * 74;
      ctx.save();
      ctx.translate(x, y);
      const angle = Math.atan2(projectile.y1 - projectile.y0, projectile.x1 - projectile.x0);
      ctx.rotate(angle);
      if (projectile.heal) {
        ctx.fillStyle = '#8aff99';
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = '#ffd27a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-10, 0);
        ctx.lineTo(8, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawSpecials(now) {
    for (const special of state.specials) {
      const t = clamp((now - special.start) / special.duration, 0, 1);
      if (special.ability === 'renewal_burst') {
        const radius = 18 + t * 105;
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.55;
        ctx.strokeStyle = '#8affaa';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(special.x0, GROUND_Y - 12, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        const boltT = clamp(t * 1.2, 0, 1);
        const bx = special.x0 + (BOSS_X - special.x0) * boltT;
        const by = special.y0 + (82 - special.y0) * boltT - Math.sin(Math.PI * boltT) * 90;
        ctx.fillStyle = '#9dff91';
        ctx.beginPath();
        ctx.arc(bx, by, 7, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const x = special.x0 + (BOSS_X - special.x0) * t;
        const y = special.y0 + (76 - special.y0) * t - Math.sin(Math.PI * t) * 105;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,218,88,.32)';
        ctx.lineWidth = 12;
        ctx.beginPath();
        ctx.moveTo(special.x0, special.y0);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.strokeStyle = '#fff0a0';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(special.x0, special.y0);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawFloaters(now) {
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const floater of state.floaters) {
      const t = clamp((now - floater.start) / floater.duration, 0, 1);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = floater.color;
      ctx.fillText(floater.text, floater.x, floater.y - t * 28);
    }
    ctx.globalAlpha = 1;
  }

  function draw(now) {
    if (!canvas.width || !canvas.height) return;
    const scaleX = canvas.width / WIDTH;
    const scaleY = canvas.height / HEIGHT;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#071426';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const customScene = state.mode === 'raid' && state.encounterScene && state.encounterCache;
    if (customScene) {
      drawRaster(state.encounterCache.back, 0, 0, WIDTH, HEIGHT);
      drawBoss(now);
      if (state.encounterCache.front) drawRaster(state.encounterCache.front, 0, 0, WIDTH, HEIGHT);
    } else {
      drawRaster(state.cache?.cityBack, 0, 0, WIDTH, HEIGHT);
      drawBoss(now);
      drawRaster(state.cache?.cityFront, 0, 0, WIDTH, HEIGHT);
    }

    if (state.mode === 'lobby') drawRaster(state.cache?.staging, 0, 0, WIDTH, HEIGHT);
    drawTelegraph(now);

    const entries = [...state.players.values()];
    entries.sort((a, b) => a.id === state.localPlayerId ? 1 : b.id === state.localPlayerId ? -1 : a.x - b.x);
    for (const entry of entries) drawPlayer(entry, entry.id === state.localPlayerId, now);

    drawProjectiles(now);
    drawSpecials(now);
    drawBossAttackEffect(now);
    drawFloaters(now);

    if (!state.assetsReady) {
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#dcefff';
      ctx.fillText('Loading raid art…', BOSS_X, HEIGHT / 2);
    }

    if (state.mode === 'lobby') {
      ctx.font = '800 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f0fbff';
      ctx.fillText('RAID STAGING AREA', BOSS_X, 30);
      ctx.font = '500 12px system-ui, sans-serif';
      ctx.fillStyle = '#b9d8e8';
      ctx.fillText('Move around while the raid assembles', BOSS_X, 50);
    }
  }

  function frame(now) {
    if (!state.running) return;
    const dt = clamp((now - state.lastFrameAt) / 1000, 0, 0.034);
    state.lastFrameAt = now;

    const local = localPlayer();
    if (local) updateLocal(local, dt, now);
    for (const entry of state.players.values()) if (entry.id !== state.localPlayerId) updateRemote(entry, dt, now);
    updateEffects(now);
    draw(now);
    requestAnimationFrame(frame);
  }

  function keyDown(event) {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === 'a' || event.key === 'ArrowLeft') {
      event.preventDefault();
      setHorizontal('left', true);
    } else if (key === 'd' || event.key === 'ArrowRight') {
      event.preventDefault();
      setHorizontal('right', true);
    } else if (key === 'w' || event.key === 'ArrowUp' || event.code === 'Space') {
      event.preventDefault();
      jumpLocal();
    }
  }

  function keyUp(event) {
    const key = event.key.toLowerCase();
    if (key === 'a' || event.key === 'ArrowLeft') {
      event.preventDefault();
      setHorizontal('left', false);
    } else if (key === 'd' || event.key === 'ArrowRight') {
      event.preventDefault();
      setHorizontal('right', false);
    }
  }

  window.addEventListener('keydown', keyDown, { passive: false });
  window.addEventListener('keyup', keyUp, { passive: false });
  requestAnimationFrame(frame);

  return {
    game: null,
    setLocalPlayerId,
    setLocalPowerReady,
    syncState,
    setMode(mode) { state.mode = mode === 'lobby' ? 'lobby' : 'raid'; },
    movePlayer,
    jumpPlayer,
    playerAction,
    playerSpecial,
    showTelegraph,
    resolveBossAttack,
    setDazed,
    setJumpLock,
    getPlayerVisualState,
    complete,
    setMoveButton(direction, active) {
      if (direction === 'left' || direction === 'right') setHorizontal(direction, Boolean(active));
    },
    jump() { return jumpLocal(); },
    resetInput() {
      state.input.left = false;
      state.input.right = false;
    },
    destroy() {
      state.running = false;
      state.encounterLoadToken += 1;
      resizeObserver.disconnect();
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      canvas.remove();
    }
  };
}
