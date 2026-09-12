const WIDTH = 640;
const HEIGHT = 360;
const GROUND_Y = 310;
const MIN_X = 30;
const MAX_X = WIDTH - 30;
const RUN_SPEED = 270;
const JUMP_SPEED = 520;
const GRAVITY = 1500;
const POSITION_SEND_MS = 100;
const REMOTE_LERP = 18;
const LABEL_LIMIT = 16;
const PLAYER_WIDTH = 32;
const PLAYER_HEIGHT = 40;
const BOSS_WIDTH = 430;
const BOSS_HEIGHT = 376;
const BOSS_CENTER_X = WIDTH / 2;
const BOSS_TOP = -34;

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
  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
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
    bossFlashUntil: 0,
    projectiles: [],
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

  function faceTowardBoss(entry) {
    if (!entry || state.mode !== 'raid') return;
    if (entry.x < BOSS_CENTER_X - 1) entry.facing = 'right';
    else if (entry.x > BOSS_CENTER_X + 1) entry.facing = 'left';
  }

  function rebuildCache() {
    if (!state.rawAssets) return;
    const scale = state.renderScale;
    state.cache = {
      cityBack: makeRaster(state.rawAssets.cityBack, WIDTH, HEIGHT, scale),
      cityFront: makeRaster(state.rawAssets.cityFront, WIDTH, HEIGHT, scale),
      staging: makeRaster(state.rawAssets.staging, WIDTH, HEIGHT, scale),
      dps: makeRaster(state.rawAssets.dps, PLAYER_WIDTH, PLAYER_HEIGHT, scale),
      healer: makeRaster(state.rawAssets.healer, PLAYER_WIDTH, PLAYER_HEIGHT, scale),
      boss: makeRaster(state.rawAssets.boss, BOSS_WIDTH, BOSS_HEIGHT, scale)
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
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
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
        dazedUntil: 0
      };
      state.players.set(player.id, entry);
    }
    entry.name = player.name || entry.name;
    entry.class = player.class === 'healer' ? 'healer' : 'dps';
    faceTowardBoss(entry);
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
      if (state.mode === 'lobby') entry.facing = player.facing === 'left' ? 'left' : 'right';
      if (player.id !== state.localPlayerId) {
        entry.targetX = pctToX(player.x);
      } else if (state.lastSentX === null) {
        entry.x = pctToX(player.x);
        entry.targetX = entry.x;
      }
      faceTowardBoss(entry);
    }

    if (serverState.pendingAttack?.executeAt > Date.now()) showTelegraph(serverState.pendingAttack);
  }

  function setLocalPlayerId(id) {
    state.localPlayerId = id;
    const entry = state.players.get(id);
    if (entry) {
      entry.targetX = entry.x;
      faceTowardBoss(entry);
    }
  }

  function movePlayer(id, xPct, facing) {
    const entry = state.players.get(id);
    if (!entry) return;
    if (state.mode === 'lobby' && facing) entry.facing = facing === 'left' ? 'left' : 'right';
    if (id === state.localPlayerId) return;
    entry.targetX = pctToX(xPct);
    faceTowardBoss(entry);
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
    faceTowardBoss(player);
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
      if (state.mode === 'raid') faceTowardBoss(player);
      else player.facing = axis < 0 ? 'left' : 'right';
      draw(performance.now());
    }
  }

  function playerAction(action) {
    const entry = state.players.get(action.playerId);
    if (!entry || state.mode !== 'raid') return;
    faceTowardBoss(entry);
    state.projectiles.push({
      x0: entry.x,
      y0: entry.y - 30,
      x1: BOSS_CENTER_X + (entry.x - BOSS_CENTER_X) * 0.045,
      y1: 82,
      start: performance.now(),
      duration: action.action === 'heal' ? 440 : 330,
      heal: action.action === 'heal',
      damage: action.damage || 0
    });
    if (action.action === 'heal' && action.playerId === state.localPlayerId) {
      state.floaters.push({ x: entry.x, y: entry.y - 52, text: `+${action.healing || 0}`, color: '#9dff91', start: performance.now(), duration: 550 });
    }
  }

  function showTelegraph(attack) {
    if (attack) state.telegraph = { ...attack };
  }

  function resolveBossAttack(payload) {
    state.telegraph = null;
    state.bossFlashUntil = performance.now() + 120;
    if ((payload.dodgedPlayerIds || []).includes(state.localPlayerId)) {
      const local = localPlayer();
      if (local) state.floaters.push({ x: local.x, y: local.y - 50, text: 'DODGE!', color: '#71ddff', start: performance.now(), duration: 550 });
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
    if (player.dazedUntil > Date.now()) return;
    const axis = state.input.left === state.input.right ? 0 : state.input.left ? -1 : 1;
    if (axis !== 0) {
      player.x = clamp(player.x + axis * RUN_SPEED * dt, MIN_X, MAX_X);
      if (state.mode === 'lobby') player.facing = axis < 0 ? 'left' : 'right';
    }
    faceTowardBoss(player);

    if (!player.grounded) {
      player.vy += GRAVITY * dt;
      player.y += player.vy * dt;
      if (player.y >= GROUND_Y) {
        player.y = GROUND_Y;
        player.vy = 0;
        player.grounded = true;
      }
    }

    if (now - state.lastPositionSentAt >= POSITION_SEND_MS) {
      const pct = xToPct(player.x);
      if (state.lastSentX === null || Math.abs(pct - state.lastSentX) > 0.08 || axis !== 0) {
        onPosition({ x: pct, facing: player.facing });
        state.lastSentX = pct;
      }
      state.lastPositionSentAt = now;
    }
  }

  function updateRemote(entry, dt, now) {
    entry.x += (entry.targetX - entry.x) * Math.min(1, REMOTE_LERP * dt);
    faceTowardBoss(entry);
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

  function updateEffects(now) {
    state.projectiles = state.projectiles.filter((p) => {
      const t = (now - p.start) / p.duration;
      if (t >= 1) {
        state.bossFlashUntil = now + 75;
        state.floaters.push({ x: BOSS_CENTER_X + 66, y: 72, text: `-${p.damage}`, color: p.heal ? '#b8ffa9' : '#ffd080', start: now, duration: 500 });
        return false;
      }
      return true;
    });
    state.floaters = state.floaters.filter((f) => now - f.start < f.duration);
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

  function drawPlayer(entry, isLocal) {
    const x = entry.x;
    const y = entry.y;
    const jumpHeight = Math.max(0, GROUND_Y - y);
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, GROUND_Y + 3, Math.max(6, 12 - jumpHeight / 11), 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const cache = entry.class === 'healer' ? state.cache?.healer : state.cache?.dps;
    drawRaster(
      cache,
      x - PLAYER_WIDTH / 2,
      y - PLAYER_HEIGHT,
      PLAYER_WIDTH,
      PLAYER_HEIGHT,
      entry.facing === 'left',
      entry.dazedUntil > Date.now() ? 0.5 : 1
    );

    if (isLocal || state.remoteLabelsEnabled) {
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = isLocal ? '#a7ff9e' : '#eef6ff';
      ctx.strokeStyle = 'rgba(5,12,20,.85)';
      ctx.lineWidth = 3;
      const labelY = Math.min(352, y + 15);
      ctx.strokeText(isLocal ? `${entry.name} (you)` : entry.name, x, labelY);
      ctx.fillText(isLocal ? `${entry.name} (you)` : entry.name, x, labelY);
    }
  }

  function drawBoss(now) {
    if (state.mode !== 'raid' || state.complete === 'defeat') return;
    const drop = state.complete === 'victory' ? Math.min(210, (now % 1400) * 0.13) : 0;
    const alpha = now < state.bossFlashUntil ? 0.55 : 0.94;
    drawRaster(
      state.cache?.boss,
      BOSS_CENTER_X - BOSS_WIDTH / 2,
      BOSS_TOP + drop,
      BOSS_WIDTH,
      BOSS_HEIGHT,
      false,
      alpha
    );
  }

  function drawTelegraph(now) {
    const attack = state.telegraph;
    if (!attack || state.mode !== 'raid') return;
    const pulse = 0.18 + (Math.sin(now / 90) + 1) * 0.08;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ff4058';
    if (attack.type === 'left_slam') ctx.fillRect(0, 270, WIDTH / 2, HEIGHT - 270);
    if (attack.type === 'right_slam') ctx.fillRect(WIDTH / 2, 270, WIDTH / 2, HEIGHT - 270);
    if (attack.type === 'shockwave') {
      ctx.strokeStyle = '#ffd05d';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.ellipse(WIDTH / 2, GROUND_Y + 2, 70, 11, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawEffects(now) {
    for (const p of state.projectiles) {
      const t = clamp((now - p.start) / p.duration, 0, 1);
      const x = p.x0 + (p.x1 - p.x0) * t;
      const y = p.y0 + (p.y1 - p.y0) * t - Math.sin(Math.PI * t) * 74;
      ctx.save();
      ctx.translate(x, y);
      const angle = Math.atan2(p.y1 - p.y0, p.x1 - p.x0);
      ctx.rotate(angle);
      if (p.heal) {
        ctx.fillStyle = '#8aff99';
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#e8ffef';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.moveTo(0, -8); ctx.lineTo(0, 8); ctx.stroke();
      } else {
        ctx.strokeStyle = '#ffd27a';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(-13, 0); ctx.lineTo(10, 0); ctx.stroke();
        ctx.fillStyle = '#fff0b4';
        ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(5, -4); ctx.lineTo(5, 4); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }

    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const f of state.floaters) {
      const t = clamp((now - f.start) / f.duration, 0, 1);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - t * 28);
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
    for (const entry of entries) drawPlayer(entry, entry.id === state.localPlayerId);
    drawEffects(now);

    if (!state.assetsReady) {
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#dcefff';
      ctx.fillText('Loading raid art…', WIDTH / 2, HEIGHT / 2);
    }

    if (state.mode === 'lobby') {
      ctx.font = '800 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f0fbff';
      ctx.fillText('RAID STAGING AREA', WIDTH / 2, 30);
      ctx.font = '500 12px system-ui, sans-serif';
      ctx.fillStyle = '#b9d8e8';
      ctx.fillText('Move around while the raid assembles', WIDTH / 2, 50);
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
      event.preventDefault(); setHorizontal('left', true);
    } else if (key === 'd' || event.key === 'ArrowRight') {
      event.preventDefault(); setHorizontal('right', true);
    } else if (key === 'w' || event.key === 'ArrowUp' || event.code === 'Space') {
      event.preventDefault(); jumpLocal();
    }
  }

  function keyUp(event) {
    const key = event.key.toLowerCase();
    if (key === 'a' || event.key === 'ArrowLeft') {
      event.preventDefault(); setHorizontal('left', false);
    } else if (key === 'd' || event.key === 'ArrowRight') {
      event.preventDefault(); setHorizontal('right', false);
    }
  }

  window.addEventListener('keydown', keyDown, { passive: false });
  window.addEventListener('keyup', keyUp, { passive: false });
  requestAnimationFrame(frame);

  return {
    game: null,
    setLocalPlayerId,
    syncState,
    setMode(mode) {
      state.mode = mode === 'lobby' ? 'lobby' : 'raid';
      for (const entry of state.players.values()) faceTowardBoss(entry);
    },
    movePlayer,
    jumpPlayer,
    playerAction,
    showTelegraph,
    resolveBossAttack,
    setDazed,
    complete,
    setMoveButton(direction, active) {
      if (direction === 'left' || direction === 'right') setHorizontal(direction, Boolean(active));
    },
    jump() { jumpLocal(); },
    resetInput() { state.input.left = false; state.input.right = false; },
    destroy() {
      state.running = false;
      resizeObserver.disconnect();
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      canvas.remove();
    }
  };
}
