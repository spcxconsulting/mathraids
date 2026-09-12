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
const LABEL_LIMIT = 14;
const BOSS_X = WIDTH / 2;

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
    telegraph: null,
    complete: null,
    bossHitUntil: 0,
    bossHitFromX: BOSS_X,
    bossAttackUntil: 0,
    bossAttackType: null,
    projectiles: [],
    specials: [],
    floaters: [],
    running: true,
    remoteLabelsEnabled: true,
    assetsReady: false,
    rawAssets: null,
    cache: null,
    renderScale: 1
  };

  function localPlayer() {
    return state.localPlayerId ? state.players.get(state.localPlayerId) : null;
  }

  function faceBoss(entry) {
    if (state.mode !== 'raid') return;
    entry.facing = entry.x < BOSS_X ? 'right' : 'left';
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
    state.assetsReady = true;
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
        class: player.class === 'healer' ? 'healer' : 'dps',
        x: pctToX(player.x),
        targetX: pctToX(player.x),
        y: GROUND_Y,
        vy: 0,
        grounded: true,
        facing: player.facing === 'left' ? 'left' : 'right',
        remoteJumpStart: 0,
        remoteJumpDuration: 540,
        dazedUntil: 0,
        powerReady: false
      };
      state.players.set(player.id, entry);
    }
    entry.name = player.name || entry.name;
    entry.class = player.class === 'healer' ? 'healer' : 'dps';
    faceBoss(entry);
    return entry;
  }

  function syncState(serverState) {
    if (!serverState) return;
    state.mode = serverState.status === 'lobby' ? 'lobby' : 'raid';
    state.remoteLabelsEnabled = (serverState.players?.length || 0) <= LABEL_LIMIT;

    const ids = new Set((serverState.players || []).map((player) => player.id));
    for (const id of state.players.keys()) if (!ids.has(id)) state.players.delete(id);

    for (const player of serverState.players || []) {
      const entry = ensurePlayer(player);
      if (player.id !== state.localPlayerId) {
        entry.targetX = pctToX(player.x);
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

  function movePlayer(id, xPct) {
    const entry = state.players.get(id);
    if (!entry) return;
    if (id === state.localPlayerId) return;
    entry.targetX = pctToX(xPct);
    faceBoss(entry);
  }

  function jumpPlayer(id) {
    if (id === state.localPlayerId) return;
    const entry = state.players.get(id);
    if (entry) entry.remoteJumpStart = performance.now();
  }

  function jumpLocal() {
    const player = localPlayer();
    if (!player || !player.grounded || player.dazedUntil > Date.now()) return false;
    player.grounded = false;
    player.vy = -JUMP_SPEED;
    player.y -= 2;
    onJump();
    draw(performance.now());
    return true;
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
    state.telegraph = null;
    state.bossAttackUntil = performance.now() + 430;
    state.bossAttackType = payload.attackType;
    if ((payload.dodgedPlayerIds || []).includes(state.localPlayerId)) {
      const local = localPlayer();
      if (local) {
        state.floaters.push({ x: local.x, y: local.y - 42, text: 'DODGE!', color: '#71ddff', start: performance.now(), duration: 550 });
      }
    }
  }

  function setDazed(id, until) {
    const entry = state.players.get(id);
    if (entry) entry.dazedUntil = until;
  }

  function complete(outcome) {
    state.complete = outcome;
    state.input.left = false;
    state.input.right = false;
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
      if (state.lastSentX === null || Math.abs(pct - state.lastSentX) > 0.08 || axis !== 0) {
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
        entry.y = GROUND_Y;
      } else {
        entry.y = GROUND_Y - Math.sin(Math.PI * t) * 68;
      }
    }
  }

  function registerBossHit(fromX, damage, color = '#ffd080') {
    const now = performance.now();
    state.bossHitUntil = now + 165;
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
    const idleSway = Math.sin(now / 1700) * 4.5;
    const idleBob = Math.sin(now / 1250) * 2.4;
    const idleScale = 1 + Math.sin(now / 1050) * 0.006;
    let x = idleSway;
    let y = idleBob;
    let scaleX = idleScale;
    let scaleY = idleScale;
    let rotation = Math.sin(now / 2400) * 0.004;
    let aura = 0;

    if (state.telegraph) {
      const start = state.telegraph.warnedAt || (state.telegraph.executeAt - 1650);
      const duration = Math.max(1, state.telegraph.executeAt - start);
      const progress = clamp((Date.now() - start) / duration, 0, 1);
      const pulse = (Math.sin(now / 70) + 1) / 2;
      aura = 0.12 + progress * 0.24 + pulse * 0.08;
      scaleX += progress * 0.026;
      scaleY += progress * 0.026;
      y += progress * 7;

      if (state.telegraph.type === 'left_slam') rotation -= progress * 0.028;
      if (state.telegraph.type === 'right_slam') rotation += progress * 0.028;
      if (state.telegraph.type === 'shockwave') {
        scaleX += progress * 0.018;
        scaleY -= progress * 0.025;
        y += progress * 7;
      }

      if (progress > 0.75) x += Math.sin(now / 25) * 3 * ((progress - 0.75) / 0.25);
    }

    if (now < state.bossAttackUntil) {
      const remaining = (state.bossAttackUntil - now) / 430;
      const force = Math.sin((1 - remaining) * Math.PI);
      if (state.bossAttackType === 'left_slam') {
        x -= force * 25;
        rotation -= force * 0.05;
      } else if (state.bossAttackType === 'right_slam') {
        x += force * 25;
        rotation += force * 0.05;
      } else {
        y += force * 18;
        scaleX += force * 0.035;
        scaleY -= force * 0.04;
      }
    }

    if (now < state.bossHitUntil) {
      const remaining = (state.bossHitUntil - now) / 165;
      const away = state.bossHitFromX < BOSS_X ? 1 : -1;
      x += away * remaining * 12 + Math.sin(now / 14) * remaining * 4;
      rotation += away * remaining * 0.018;
      scaleX -= remaining * 0.012;
      scaleY += remaining * 0.008;
    }

    return { x, y, scaleX, scaleY, rotation, aura };
  }

  function drawBoss(now) {
    if (state.mode !== 'raid' || state.complete === 'defeat' || !state.cache?.boss) return;

    const pose = bossPose(now);
    const victoryDrop = state.complete === 'victory' ? Math.min(250, (now % 1500) * 0.15) : 0;

    if (pose.aura > 0) {
      const gradient = ctx.createRadialGradient(BOSS_X, 118, 40, BOSS_X, 118, 230);
      gradient.addColorStop(0, `rgba(255,92,74,${pose.aura})`);
      gradient.addColorStop(1, 'rgba(255,80,64,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(70, 0, 500, 300);
    }

    ctx.save();
    ctx.translate(BOSS_X + pose.x, BOSS_TOP + BOSS_H / 2 + pose.y + victoryDrop);
    ctx.rotate(pose.rotation);
    ctx.scale(pose.scaleX, pose.scaleY);
    ctx.translate(-BOSS_W / 2, -BOSS_H / 2);

    if (now < state.bossHitUntil) {
      ctx.filter = 'brightness(1.75) saturate(1.25)';
    }
    ctx.drawImage(state.cache.boss, 0, 0, BOSS_W, BOSS_H);
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

  function drawTelegraph(now) {
    const attack = state.telegraph;
    if (!attack || state.mode !== 'raid') return;
    const pulse = 0.16 + (Math.sin(now / 90) + 1) * 0.07;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ff4058';
    if (attack.type === 'left_slam') ctx.fillRect(0, 274, WIDTH / 2, HEIGHT - 274);
    if (attack.type === 'right_slam') ctx.fillRect(WIDTH / 2, 274, WIDTH / 2, HEIGHT - 274);
    if (attack.type === 'shockwave') {
      ctx.strokeStyle = '#ffd05d';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.ellipse(BOSS_X, GROUND_Y + 2, 70, 10, 0, 0, Math.PI * 2);
      ctx.stroke();
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

    drawRaster(state.cache?.cityBack, 0, 0, WIDTH, HEIGHT);
    drawBoss(now);
    drawRaster(state.cache?.cityFront, 0, 0, WIDTH, HEIGHT);
    if (state.mode === 'lobby') drawRaster(state.cache?.staging, 0, 0, WIDTH, HEIGHT);
    drawTelegraph(now);

    const entries = [...state.players.values()];
    entries.sort((a, b) => a.id === state.localPlayerId ? 1 : b.id === state.localPlayerId ? -1 : a.x - b.x);
    for (const entry of entries) drawPlayer(entry, entry.id === state.localPlayerId, now);

    drawProjectiles(now);
    drawSpecials(now);
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
    complete,
    setMoveButton(direction, active) {
      if (direction === 'left' || direction === 'right') setHorizontal(direction, Boolean(active));
    },
    jump() { jumpLocal(); },
    resetInput() {
      state.input.left = false;
      state.input.right = false;
    },
    destroy() {
      state.running = false;
      resizeObserver.disconnect();
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      canvas.remove();
    }
  };
}
