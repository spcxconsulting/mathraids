const WIDTH = 320;
const HEIGHT = 180;
const GROUND_Y = 143;
const MIN_X = 16;
const MAX_X = WIDTH - 16;
const RUN_SPEED = 118;
const JUMP_SPEED = 220;
const GRAVITY = 690;
const POSITION_SEND_MS = 100;
const REMOTE_LERP = 18;
const LABEL_LIMIT = 16;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pctToX(value) {
  return clamp((Number(value) / 100) * WIDTH, MIN_X, MAX_X);
}

function xToPct(value) {
  return clamp((Number(value) / WIDTH) * 100, 4, 96);
}

function makeCanvas(width = WIDTH, height = HEIGHT) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function pixelRect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function buildBackground(mode) {
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  pixelRect(ctx, 0, 0, WIDTH, HEIGHT, mode === 'lobby' ? '#111b32' : '#0b1730');
  pixelRect(ctx, 0, 0, WIDTH, 102, mode === 'lobby' ? '#17294a' : '#102b4e');

  // Moon and stars.
  pixelRect(ctx, 272, 17, 10, 10, '#f6e6a8');
  const stars = [[14,19],[31,13],[51,28],[76,16],[99,31],[125,20],[149,10],[171,27],[196,17],[225,34],[249,12],[299,28]];
  for (const [x, y] of stars) pixelRect(ctx, x, y, 1, 1, '#d9eeff');

  // Two cheap skyline layers.
  const far = [[0,72,18,30],[20,61,24,41],[47,68,16,34],[65,55,28,47],[96,70,18,32],[116,64,26,38],[145,58,21,44],[169,69,18,33],[191,51,30,51],[224,66,17,36],[244,57,28,45],[275,69,18,33],[296,60,24,42]];
  for (const [x,y,w,h] of far) pixelRect(ctx,x,y,w,h,'#152239');
  const near = [[0,88,35,28],[38,82,24,34],[66,90,39,26],[110,77,27,39],[142,86,34,30],[181,79,32,37],[218,88,28,28],[251,74,31,42],[287,85,33,31]];
  for (const [x,y,w,h] of near) pixelRect(ctx,x,y,w,h,'#0c1424');

  // Flat platform with a slight faux-depth lip only.
  pixelRect(ctx, 0, 116, WIDTH, 31, mode === 'lobby' ? '#394052' : '#333b49');
  pixelRect(ctx, 0, 116, WIDTH, 2, '#647184');
  pixelRect(ctx, 0, 147, WIDTH, 33, '#171b23');
  for (let x = 0; x < WIDTH; x += 24) pixelRect(ctx, x, 147, 1, 33, '#202733');

  if (mode === 'lobby') {
    // Portal.
    pixelRect(ctx, 250, 70, 4, 46, '#6b62e5');
    pixelRect(ctx, 278, 70, 4, 46, '#6b62e5');
    pixelRect(ctx, 254, 66, 24, 4, '#6b62e5');
    pixelRect(ctx, 257, 73, 18, 40, '#245b9a');
    pixelRect(ctx, 260, 76, 12, 34, '#4ec8e8');
    // Campfire and crates.
    pixelRect(ctx, 55, 126, 24, 12, '#5c3b23');
    pixelRect(ctx, 63, 119, 8, 9, '#f18b2b');
    pixelRect(ctx, 65, 114, 4, 8, '#ffd05a');
    pixelRect(ctx, 18, 125, 18, 16, '#73502d');
    pixelRect(ctx, 284, 126, 17, 15, '#664629');
  }

  return canvas;
}

function buildPlayerSprite(healer = false) {
  const canvas = makeCanvas(16, 24);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const primary = healer ? '#4c9c79' : '#4f79b2';
  const dark = healer ? '#285944' : '#2b456f';

  pixelRect(ctx, 5, 1, 6, 3, '#3a2b28');
  pixelRect(ctx, 4, 4, 8, 6, '#ddb487');
  pixelRect(ctx, 3, 10, 10, 8, primary);
  pixelRect(ctx, 2, 12, 2, 6, dark);
  pixelRect(ctx, 12, 12, 2, 6, dark);
  pixelRect(ctx, 4, 18, 3, 5, '#28364a');
  pixelRect(ctx, 9, 18, 3, 5, '#28364a');
  pixelRect(ctx, 5, 12, 6, 2, '#edf5ff');

  if (healer) {
    pixelRect(ctx, 14, 7, 1, 14, '#b7ead3');
    pixelRect(ctx, 12, 7, 5, 1, '#b7ead3');
  } else {
    pixelRect(ctx, 13, 10, 2, 8, '#d8b96b');
    pixelRect(ctx, 14, 9, 1, 1, '#fff0a6');
  }
  return canvas;
}

function buildBossSprite() {
  const canvas = makeCanvas(48, 52);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  pixelRect(ctx, 18, 1, 5, 5, '#8fd28a');
  pixelRect(ctx, 25, 0, 5, 7, '#8fd28a');
  pixelRect(ctx, 32, 2, 5, 5, '#8fd28a');
  pixelRect(ctx, 13, 7, 27, 18, '#4b8c70');
  pixelRect(ctx, 8, 23, 36, 24, '#3c755f');
  pixelRect(ctx, 16, 28, 20, 17, '#76a873');
  pixelRect(ctx, 4, 26, 7, 18, '#356a56');
  pixelRect(ctx, 41, 26, 6, 18, '#356a56');
  pixelRect(ctx, 2, 40, 13, 5, '#356a56');
  pixelRect(ctx, 19, 13, 4, 3, '#ffe083');
  pixelRect(ctx, 31, 13, 4, 3, '#ffe083');
  pixelRect(ctx, 20, 14, 1, 1, '#102019');
  pixelRect(ctx, 33, 14, 1, 1, '#102019');
  pixelRect(ctx, 22, 20, 12, 3, '#24483d');
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

  const canvas = makeCanvas();
  canvas.className = 'pixel-battlefield-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.objectFit = 'contain';
  canvas.style.imageRendering = 'pixelated';
  canvas.style.touchAction = 'none';
  host.append(canvas);

  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  ctx.imageSmoothingEnabled = false;

  const assets = {
    lobby: buildBackground('lobby'),
    raid: buildBackground('raid'),
    dps: buildPlayerSprite(false),
    healer: buildPlayerSprite(true),
    boss: buildBossSprite()
  };

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
    bossOffsetY: 0,
    projectiles: [],
    floaters: [],
    running: true,
    remoteLabelsEnabled: true
  };

  function localPlayer() {
    return state.localPlayerId ? state.players.get(state.localPlayerId) : null;
  }

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
    return entry;
  }

  function syncState(serverState) {
    if (!serverState) return;
    state.mode = serverState.status === 'lobby' ? 'lobby' : 'raid';
    state.remoteLabelsEnabled = (serverState.players?.length || 0) <= LABEL_LIMIT;

    const ids = new Set((serverState.players || []).map((player) => player.id));
    for (const id of state.players.keys()) {
      if (!ids.has(id)) state.players.delete(id);
    }

    for (const player of serverState.players || []) {
      const entry = ensurePlayer(player);
      entry.facing = player.facing === 'left' ? 'left' : 'right';
      if (player.id !== state.localPlayerId) {
        entry.targetX = pctToX(player.x);
      } else if (state.lastSentX === null) {
        // Initial spawn only. After that local visuals never wait on or follow the server.
        entry.x = pctToX(player.x);
        entry.targetX = entry.x;
      }
    }

    if (serverState.pendingAttack?.executeAt > Date.now()) showTelegraph(serverState.pendingAttack);
  }

  function setLocalPlayerId(id) {
    state.localPlayerId = id;
    const entry = state.players.get(id);
    if (entry) entry.targetX = entry.x;
  }

  function movePlayer(id, xPct, facing) {
    const entry = state.players.get(id);
    if (!entry) return;
    if (facing) entry.facing = facing === 'left' ? 'left' : 'right';
    if (id === state.localPlayerId) return;
    entry.targetX = pctToX(xPct);
  }

  function jumpPlayer(id) {
    if (id === state.localPlayerId) return;
    const entry = state.players.get(id);
    if (!entry) return;
    entry.remoteJumpStart = performance.now();
  }

  function jumpLocal() {
    const player = localPlayer();
    if (!player || !player.grounded || player.dazedUntil > Date.now()) return false;
    player.grounded = false;
    player.vy = -JUMP_SPEED;
    player.y -= 1;
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
      player.facing = axis < 0 ? 'left' : 'right';
      // Tiny immediate nudge so the very input event itself produces a visible response.
      player.x = clamp(player.x + axis * 1.5, MIN_X, MAX_X);
      draw(performance.now());
    }
  }

  function playerAction(action) {
    const entry = state.players.get(action.playerId);
    if (!entry || state.mode !== 'raid') return;
    state.projectiles.push({
      x0: entry.x,
      y0: entry.y - 16,
      x1: WIDTH / 2,
      y1: 66,
      start: performance.now(),
      duration: action.action === 'heal' ? 300 : 220,
      heal: action.action === 'heal',
      damage: action.damage || 0
    });
    if (action.action === 'heal' && action.playerId === state.localPlayerId) {
      state.floaters.push({ x: entry.x, y: entry.y - 30, text: `+${action.healing || 0}`, color: '#9dff91', start: performance.now(), duration: 500 });
    }
  }

  function showTelegraph(attack) {
    if (!attack) return;
    state.telegraph = { ...attack };
  }

  function resolveBossAttack(payload) {
    state.telegraph = null;
    state.bossFlashUntil = performance.now() + 120;
    if ((payload.dodgedPlayerIds || []).includes(state.localPlayerId)) {
      const local = localPlayer();
      if (local) state.floaters.push({ x: local.x, y: local.y - 30, text: 'DODGE!', color: '#71ddff', start: performance.now(), duration: 500 });
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
      player.facing = axis < 0 ? 'left' : 'right';
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
    if (entry.remoteJumpStart) {
      const t = (now - entry.remoteJumpStart) / entry.remoteJumpDuration;
      if (t >= 1) {
        entry.remoteJumpStart = 0;
        entry.y = GROUND_Y;
      } else {
        entry.y = GROUND_Y - Math.sin(Math.PI * t) * 34;
      }
    }
  }

  function updateEffects(now) {
    state.projectiles = state.projectiles.filter((p) => {
      const t = (now - p.start) / p.duration;
      if (t >= 1) {
        state.bossFlashUntil = now + 70;
        state.floaters.push({ x: WIDTH / 2 + 18, y: 56, text: `-${p.damage}`, color: p.heal ? '#b8ffa9' : '#ffd080', start: now, duration: 450 });
        return false;
      }
      return true;
    });
    state.floaters = state.floaters.filter((f) => now - f.start < f.duration);
  }

  function drawPlayer(entry, isLocal, now) {
    const sprite = entry.class === 'healer' ? assets.healer : assets.dps;
    const x = Math.round(entry.x);
    const y = Math.round(entry.y);
    const jumpHeight = Math.max(0, GROUND_Y - y);

    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000000';
    ctx.fillRect(x - Math.max(4, 7 - jumpHeight / 9), GROUND_Y + 2, Math.max(8, 14 - jumpHeight / 5), 3);
    ctx.globalAlpha = entry.dazedUntil > Date.now() ? 0.55 : 1;

    ctx.save();
    ctx.translate(x, y - 24);
    if (entry.facing === 'left') ctx.scale(-1, 1);
    ctx.drawImage(sprite, -8, 0, 16, 24);
    ctx.restore();
    ctx.globalAlpha = 1;

    if (isLocal || state.remoteLabelsEnabled) {
      ctx.font = '6px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = isLocal ? '#9fff94' : '#e9f3ff';
      ctx.fillText(isLocal ? `${entry.name}*` : entry.name, x, Math.min(176, y + 10));
    }

    if (entry.dazedUntil > Date.now()) {
      ctx.fillStyle = '#ffd45c';
      ctx.fillRect(x - 6, y - 31, 2, 2);
      ctx.fillRect(x, y - 35, 2, 2);
      ctx.fillRect(x + 6, y - 31, 2, 2);
    }
  }

  function drawBoss(now) {
    if (state.mode !== 'raid' || state.complete === 'defeat') return;
    const defeated = state.complete === 'victory';
    const y = defeated ? 78 + Math.min(70, (now % 1000) * 0.05) : 52 + state.bossOffsetY;
    if (now < state.bossFlashUntil) ctx.globalAlpha = 0.55;
    ctx.drawImage(assets.boss, WIDTH / 2 - 36, y - 20, 72, 78);
    ctx.globalAlpha = 1;
    ctx.font = '7px monospace';
    ctx.fillStyle = '#eaffed';
    ctx.textAlign = 'center';
    ctx.fillText('NUMBERZILLA', WIDTH / 2, 27);
  }

  function drawTelegraph(now) {
    const attack = state.telegraph;
    if (!attack || state.mode !== 'raid') return;
    const blink = Math.floor(now / 140) % 2 === 0;
    ctx.globalAlpha = blink ? 0.38 : 0.22;
    ctx.fillStyle = '#ff4a57';
    if (attack.type === 'left_slam') ctx.fillRect(0, 116, WIDTH / 2, HEIGHT - 116);
    if (attack.type === 'right_slam') ctx.fillRect(WIDTH / 2, 116, WIDTH / 2, HEIGHT - 116);
    if (attack.type === 'shockwave') {
      ctx.fillStyle = '#ffc95b';
      ctx.fillRect(WIDTH / 2 - 24, GROUND_Y - 2, 48, 3);
    }
    ctx.globalAlpha = 1;
  }

  function drawEffects(now) {
    for (const p of state.projectiles) {
      const t = clamp((now - p.start) / p.duration, 0, 1);
      const x = p.x0 + (p.x1 - p.x0) * t;
      const y = p.y0 + (p.y1 - p.y0) * t - Math.sin(Math.PI * t) * 12;
      ctx.fillStyle = p.heal ? '#86ff86' : '#ffc05b';
      ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 5, p.heal ? 5 : 2);
    }

    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    for (const f of state.floaters) {
      const t = clamp((now - f.start) / f.duration, 0, 1);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - t * 14);
    }
    ctx.globalAlpha = 1;
  }

  function draw(now) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.mode === 'lobby' ? assets.lobby : assets.raid, 0, 0);
    drawTelegraph(now);
    drawBoss(now);

    const entries = [...state.players.values()];
    entries.sort((a, b) => a.id === state.localPlayerId ? 1 : b.id === state.localPlayerId ? -1 : a.x - b.x);
    for (const entry of entries) drawPlayer(entry, entry.id === state.localPlayerId, now);
    drawEffects(now);

    if (state.mode === 'lobby') {
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e9f7ff';
      ctx.fillText('RAID STAGING AREA', WIDTH / 2, 14);
      ctx.font = '6px monospace';
      ctx.fillStyle = '#a9c9da';
      ctx.fillText('MOVE AROUND WHILE THE RAID ASSEMBLES', WIDTH / 2, 23);
    }
  }

  function frame(now) {
    if (!state.running) return;
    const dt = clamp((now - state.lastFrameAt) / 1000, 0, 0.034);
    state.lastFrameAt = now;

    const local = localPlayer();
    if (local) updateLocal(local, dt, now);
    for (const entry of state.players.values()) {
      if (entry.id !== state.localPlayerId) updateRemote(entry, dt, now);
    }
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
    syncState,
    setMode(mode) {
      state.mode = mode === 'lobby' ? 'lobby' : 'raid';
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
    jump() {
      jumpLocal();
    },
    resetInput() {
      state.input.left = false;
      state.input.right = false;
    },
    destroy() {
      state.running = false;
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      canvas.remove();
    }
  };
}
