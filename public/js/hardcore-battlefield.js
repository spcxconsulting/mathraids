import { createRaidBattlefield as createBaseBattlefield } from './vector-battlefield-reusable.js';

const WIDTH = 640;
const HEIGHT = 360;
const GROUND_Y = 312;
const MIN_X = 28;
const MAX_X = WIDTH - 28;
const RUN_SPEED = 270;
const JUMP_SPEED = 520;
const GRAVITY = 1500;
const REMOTE_LERP = 18;
const REMOTE_JUMP_MS = 720;
const FORTIFY_RADIUS_PCT = 12;
const DEATH_FALL_MS = 680;
const PLAYER_W = 24;
const PLAYER_H = 30;
const MOVEMENT_KEYS = new Set(['a', 'd', 'w', 'arrowleft', 'arrowright', 'arrowup', ' ']);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pctToX(value) {
  return clamp((Number(value) / 100) * WIDTH, MIN_X, MAX_X);
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

export function createRaidBattlefield(options = {}) {
  const host = document.getElementById(options.parent || 'phaser-game');
  if (!host) throw new Error('Battlefield mount was not found');

  let localPlayerId = null;
  let hardcore = false;
  let localKnockedOut = false;
  let running = true;
  let lastFrameAt = performance.now();
  const input = { left: false, right: false };
  const players = new Map();
  const deathArt = { dps: null, healer: null };

  Promise.all([
    loadImage('/art/player-dps.svg'),
    loadImage('/art/player-healer.svg')
  ]).then(([dps, healer]) => {
    deathArt.dps = dps;
    deathArt.healer = healer;
  }).catch(() => {
    // The normal battlefield art remains authoritative. If these optional
    // copies fail to load, the knockout animation falls back to a silhouette.
  });

  const base = createBaseBattlefield({
    ...options,
    onPosition(position) {
      const local = players.get(localPlayerId);
      if (local && Number.isFinite(Number(position.x))) {
        local.serverX = pctToX(position.x);
      }
      options.onPosition?.(position);
    },
    onJump() {
      if (!localKnockedOut) options.onJump?.();
    }
  });

  const overlay = document.createElement('canvas');
  overlay.className = 'hardcore-canvas-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  Object.assign(overlay.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '5',
    display: 'none',
    background: 'transparent'
  });
  host.append(overlay);

  // Keep this overlay on the normal compositing path. A transparent
  // desynchronised canvas can be promoted to an opaque low-latency surface on
  // some Chromium/GPU combinations, which hides the battlefield underneath.
  const ctx = overlay.getContext('2d', { alpha: true });

  const koBanner = document.createElement('div');
  koBanner.textContent = 'KNOCKED OUT';
  Object.assign(koBanner.style, {
    position: 'absolute',
    zIndex: '6',
    left: '50%',
    top: '68%',
    transform: 'translate(-50%, -50%)',
    padding: '8px 14px',
    borderRadius: '999px',
    background: 'rgba(42,7,13,.9)',
    border: '1px solid rgba(255,106,124,.7)',
    color: '#ffd7dd',
    font: '800 12px system-ui, sans-serif',
    letterSpacing: '.12em',
    display: 'none',
    pointerEvents: 'none'
  });
  host.append(koBanner);

  function dispatch(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function ensurePlayer(player) {
    let entry = players.get(player.id);
    if (!entry) {
      const x = pctToX(player.x ?? 50);
      const startsOut = Boolean(player.knockedOut);
      entry = {
        id: player.id,
        name: player.name || 'Raider',
        class: player.class || 'dps',
        facing: player.facing === 'left' ? 'left' : 'right',
        x,
        targetX: x,
        serverX: x,
        y: GROUND_Y,
        vy: 0,
        grounded: true,
        remoteJumpStart: 0,
        remoteJumpDuration: REMOTE_JUMP_MS,
        health: Number(player.health) || 100,
        maxHealth: Number(player.maxHealth) || 100,
        knockedOut: startsOut,
        knockedOutAt: startsOut ? performance.now() - DEATH_FALL_MS : 0,
        fortifyUntil: Number(player.fortifyUntil) || 0,
        guardFlashUntil: 0,
        dazedUntil: 0,
        initialised: false
      };
      players.set(player.id, entry);
    }

    const wasKnockedOut = entry.knockedOut;
    entry.name = player.name || entry.name;
    entry.class = player.class || entry.class;
    entry.facing = player.facing === 'left' ? 'left' : player.facing === 'right' ? 'right' : entry.facing;
    entry.health = Number.isFinite(Number(player.health)) ? Number(player.health) : entry.health;
    entry.maxHealth = Number.isFinite(Number(player.maxHealth)) ? Number(player.maxHealth) : entry.maxHealth;
    entry.knockedOut = Boolean(player.knockedOut);
    if (!wasKnockedOut && entry.knockedOut) entry.knockedOutAt = performance.now();
    if (wasKnockedOut && !entry.knockedOut) entry.knockedOutAt = 0;
    entry.fortifyUntil = Number(player.fortifyUntil) || entry.fortifyUntil || 0;
    return entry;
  }

  function applyRemoteAirborne(entry, airborneUntil) {
    if (!entry || entry.id === localPlayerId || entry.knockedOut) return;
    const until = Number(airborneUntil) || 0;
    const remaining = until - Date.now();
    if (remaining <= 0) {
      entry.remoteJumpStart = 0;
      entry.y = GROUND_Y;
      return;
    }
    const elapsed = clamp(REMOTE_JUMP_MS - remaining, 0, REMOTE_JUMP_MS);
    entry.remoteJumpStart = performance.now() - elapsed;
    entry.remoteJumpDuration = REMOTE_JUMP_MS;
  }

  function syncOverlayState(serverState) {
    hardcore = Boolean(serverState?.hardcore || serverState?.config?.mode === 'hardcore');
    overlay.style.display = hardcore ? 'block' : 'none';

    const ids = new Set((serverState?.players || []).map((player) => player.id));
    for (const id of players.keys()) if (!ids.has(id)) players.delete(id);

    for (const player of serverState?.players || []) {
      const entry = ensurePlayer(player);
      const targetX = pctToX(player.x);
      entry.serverX = targetX;
      if (player.id === localPlayerId) {
        if (!entry.initialised) {
          entry.x = targetX;
          entry.targetX = targetX;
          entry.initialised = true;
        }
      } else {
        entry.targetX = targetX;
        applyRemoteAirborne(entry, player.airborneUntil);
      }
    }

    const local = (serverState?.players || []).find((player) => player.id === localPlayerId);
    localKnockedOut = Boolean(local?.knockedOut);
    koBanner.style.display = hardcore && localKnockedOut ? 'block' : 'none';
    dispatch('mathraids:hardcorestate', { state: serverState, localPlayer: local || null });
  }

  function baseVisibleState(serverState) {
    if (!serverState || !hardcore) return serverState;
    return {
      ...serverState,
      players: (serverState.players || []).filter((player) => !player.knockedOut)
    };
  }

  function resizeOverlay() {
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    overlay.width = Math.max(1, Math.round(rect.width * dpr));
    overlay.height = Math.max(1, Math.round(rect.height * dpr));
  }

  const resizeObserver = new ResizeObserver(resizeOverlay);
  resizeObserver.observe(host);
  resizeOverlay();

  function jumpLocalOverlay() {
    const player = players.get(localPlayerId);
    if (!player || localKnockedOut || !player.grounded || player.dazedUntil > Date.now()) return;
    player.grounded = false;
    player.vy = -JUMP_SPEED;
    player.y -= 2;
  }

  function nudgeLocal(direction) {
    const player = players.get(localPlayerId);
    if (!player || localKnockedOut || player.dazedUntil > Date.now()) return;
    const axis = direction === 'left' ? -1 : 1;
    player.x = clamp(player.x + axis * 3, MIN_X, MAX_X);
  }

  function updateLocal(entry, dt) {
    if (!entry || localKnockedOut || entry.knockedOut || entry.dazedUntil > Date.now()) return;
    const axis = input.left === input.right ? 0 : input.left ? -1 : 1;
    if (axis) entry.x = clamp(entry.x + axis * RUN_SPEED * dt, MIN_X, MAX_X);

    if (!entry.grounded) {
      entry.vy += GRAVITY * dt;
      entry.y += entry.vy * dt;
      if (entry.y >= GROUND_Y) {
        entry.y = GROUND_Y;
        entry.vy = 0;
        entry.grounded = true;
      }
    }
  }

  function updateRemote(entry, dt, now) {
    if (entry.knockedOut) return;
    entry.x += (entry.targetX - entry.x) * Math.min(1, REMOTE_LERP * dt);
    if (!entry.remoteJumpStart) return;
    const t = (now - entry.remoteJumpStart) / entry.remoteJumpDuration;
    if (t >= 1) {
      entry.remoteJumpStart = 0;
      entry.y = GROUND_Y;
    } else {
      entry.y = GROUND_Y - Math.sin(Math.PI * t) * 72;
    }
  }

  function drawFortify(entry, now) {
    if (entry.class !== 'tank' || entry.fortifyUntil <= Date.now() || entry.knockedOut) return;
    const radius = (FORTIFY_RADIUS_PCT / 100) * WIDTH;
    const pulse = 0.5 + (Math.sin(now / 110) + 1) * 0.16;
    const cx = entry.x;
    const cy = entry.y - 13;

    const gradient = ctx.createRadialGradient(cx, cy, radius * 0.15, cx, cy, radius);
    gradient.addColorStop(0, `rgba(104,209,255,${0.10 + pulse * 0.08})`);
    gradient.addColorStop(0.72, `rgba(80,174,255,${0.08 + pulse * 0.06})`);
    gradient.addColorStop(1, 'rgba(74,166,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(157,226,255,${0.48 + pulse * 0.32})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  function healthBarOffsets() {
    const entries = [...players.values()];
    const local = entries.find((entry) => entry.id === localPlayerId);
    const placementOrder = local
      ? [local, ...entries.filter((entry) => entry.id !== localPlayerId).sort((a, b) => a.x - b.x)]
      : entries.sort((a, b) => a.x - b.x);
    const placed = [];
    const offsets = new Map();

    for (const entry of placementOrder) {
      let offset = 0;
      while (placed.some((item) => Math.abs(item.x - entry.x) < 34 && Math.abs(item.y - (entry.y - 40 - offset)) < 7)) {
        offset += 7;
      }
      offsets.set(entry.id, offset);
      placed.push({ x: entry.x, y: entry.y - 40 - offset });
    }
    return offsets;
  }

  function drawHealth(entry, now, offset = 0, isLocal = false) {
    if (!hardcore) return;
    const barWidth = entry.class === 'tank' ? 34 : 30;
    const barHeight = 3;
    const x = entry.x - barWidth / 2;
    const y = entry.y - 40 - offset;
    const ratio = clamp(entry.health / Math.max(1, entry.maxHealth), 0, 1);

    if (entry.guardFlashUntil > now) {
      ctx.save();
      ctx.shadowColor = entry.class === 'tank' ? '#9de4ff' : '#70caff';
      ctx.shadowBlur = 8;
      ctx.strokeStyle = '#d7f5ff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 2, y - 2, barWidth + 4, barHeight + 4);
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(4,9,16,.92)';
    ctx.fillRect(x - 1, y - 1, barWidth + 2, barHeight + 2);

    if (ratio > 0) {
      const gradient = ctx.createLinearGradient(x, y, x + barWidth, y);
      gradient.addColorStop(0, '#ef4f62');
      gradient.addColorStop(0.52, '#ffcf58');
      gradient.addColorStop(1, '#71e38a');
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, barWidth * ratio, barHeight);
    }

    ctx.strokeStyle = isLocal
      ? '#f4fbff'
      : entry.class === 'tank'
        ? '#8ed7ff'
        : 'rgba(255,255,255,.55)';
    ctx.lineWidth = isLocal ? 1.35 : 0.8;
    ctx.strokeRect(x - 1, y - 1, barWidth + 2, barHeight + 2);

    if (isLocal) {
      ctx.font = '800 6.5px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(4,9,16,.95)';
      ctx.lineWidth = 2;
      ctx.strokeText(entry.knockedOut ? 'YOU · OUT' : 'YOU', entry.x, y - 3);
      ctx.fillText(entry.knockedOut ? 'YOU · OUT' : 'YOU', entry.x, y - 3);
    }
  }

  function drawKnockedOut(entry, now) {
    if (!entry.knockedOut) return;
    const startedAt = entry.knockedOutAt || (now - DEATH_FALL_MS);
    const raw = clamp((now - startedAt) / DEATH_FALL_MS, 0, 1);
    const eased = 1 - Math.pow(1 - raw, 3);
    const direction = entry.x < WIDTH / 2 ? -1 : 1;
    const angle = direction * (Math.PI / 2) * eased;
    const x = entry.x + direction * 7 * eased;
    const y = Math.min(GROUND_Y + 4, entry.y + 10 * eased);
    const image = entry.class === 'healer' ? deathArt.healer : deathArt.dps;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (entry.facing === 'left') ctx.scale(-1, 1);
    ctx.globalAlpha = 1 - eased * 0.18;

    if (image) {
      ctx.drawImage(image, -PLAYER_W / 2, -PLAYER_H, PLAYER_W, PLAYER_H);
    } else {
      ctx.fillStyle = entry.class === 'healer' ? '#65d78f' : entry.class === 'tank' ? '#78bfff' : '#6da9ff';
      ctx.fillRect(-5, -23, 10, 20);
      ctx.beginPath();
      ctx.arc(0, -26, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawOverlay(now) {
    if (!hardcore || !overlay.width || !overlay.height) return;
    const scaleX = overlay.width / WIDTH;
    const scaleY = overlay.height / HEIGHT;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);

    for (const entry of players.values()) drawFortify(entry, now);
    for (const entry of players.values()) drawKnockedOut(entry, now);

    const offsets = healthBarOffsets();
    const remotes = [...players.values()].filter((entry) => entry.id !== localPlayerId);
    for (const entry of remotes) drawHealth(entry, now, offsets.get(entry.id) || 0, false);
    const local = players.get(localPlayerId);
    if (local) drawHealth(local, now, offsets.get(local.id) || 0, true);
  }

  function frame(now) {
    if (!running) return;
    const dt = clamp((now - lastFrameAt) / 1000, 0, 0.034);
    lastFrameAt = now;
    const local = players.get(localPlayerId);
    if (local) updateLocal(local, dt);
    for (const entry of players.values()) if (entry.id !== localPlayerId) updateRemote(entry, dt, now);
    drawOverlay(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function blockKnockedOutKeyboard(event) {
    if (!hardcore || !localKnockedOut) return;
    const key = event.key?.toLowerCase?.() || '';
    if (!MOVEMENT_KEYS.has(key) && event.code !== 'Space') return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function trackKeyDown(event) {
    if (event.repeat || localKnockedOut) return;
    const key = event.key?.toLowerCase?.() || '';
    if (key === 'a' || event.key === 'ArrowLeft') {
      input.left = true;
      nudgeLocal('left');
    } else if (key === 'd' || event.key === 'ArrowRight') {
      input.right = true;
      nudgeLocal('right');
    } else if (key === 'w' || event.key === 'ArrowUp' || event.code === 'Space') {
      jumpLocalOverlay();
    }
  }

  function trackKeyUp(event) {
    const key = event.key?.toLowerCase?.() || '';
    if (key === 'a' || event.key === 'ArrowLeft') input.left = false;
    if (key === 'd' || event.key === 'ArrowRight') input.right = false;
  }

  window.addEventListener('keydown', blockKnockedOutKeyboard, true);
  window.addEventListener('keyup', blockKnockedOutKeyboard, true);
  window.addEventListener('keydown', trackKeyDown);
  window.addEventListener('keyup', trackKeyUp);

  return {
    ...base,
    setLocalPlayerId(id) {
      localPlayerId = id;
      base.setLocalPlayerId(id);
    },
    syncState(serverState) {
      syncOverlayState(serverState);
      base.syncState(baseVisibleState(serverState));
    },
    movePlayer(id, x, facing, airborneUntil) {
      const entry = players.get(id);
      if (entry) entry.facing = facing === 'left' ? 'left' : facing === 'right' ? 'right' : entry.facing;
      if (!entry?.knockedOut) base.movePlayer(id, x, facing, airborneUntil);
      if (entry && id !== localPlayerId && !entry.knockedOut) {
        entry.targetX = pctToX(x);
        applyRemoteAirborne(entry, airborneUntil);
      }
    },
    jumpPlayer(id, airborneUntil) {
      const entry = players.get(id);
      if (!entry?.knockedOut) base.jumpPlayer(id, airborneUntil);
      if (entry && id !== localPlayerId && !entry.knockedOut) applyRemoteAirborne(entry, airborneUntil);
    },
    playerSpecial(payload) {
      base.playerSpecial(payload);
      if (payload?.ability === 'fortify') {
        const entry = players.get(payload.playerId);
        if (entry) entry.fortifyUntil = Number(payload.fortifyUntil) || (Date.now() + 5000);
      }
    },
    launchBossAttack(payload) {
      base.resolveBossAttack({ attackType: payload.attackType, damage: 0, dodgedPlayerIds: [] });
    },
    resolveBossAttack(payload) {
      const now = performance.now();
      for (const id of [...(payload.protectedPlayerIds || []), ...(payload.guardTankIds || []), ...(payload.fortifyTankIds || [])]) {
        const entry = players.get(id);
        if (entry) entry.guardFlashUntil = now + 700;
      }
      if (payload?.hardcore) dispatch('mathraids:hardcoreattack', { payload, localPlayerId });
    },
    setMoveButton(direction, active) {
      if (direction === 'left' || direction === 'right') {
        input[direction] = Boolean(active) && !localKnockedOut;
        if (active && !localKnockedOut) nudgeLocal(direction);
      }
      if (hardcore && localKnockedOut) {
        base.setMoveButton(direction, false);
        return;
      }
      base.setMoveButton(direction, active);
    },
    jump() {
      if (hardcore && localKnockedOut) return false;
      jumpLocalOverlay();
      return base.jump();
    },
    setDazed(id, until) {
      const entry = players.get(id);
      if (entry) entry.dazedUntil = until;
      base.setDazed(id, until);
    },
    resetInput() {
      input.left = false;
      input.right = false;
      base.resetInput();
    },
    complete(outcome) {
      input.left = false;
      input.right = false;
      base.complete(outcome);
      if (outcome === 'wipe') dispatch('mathraids:raidwipe', {});
    },
    destroy() {
      running = false;
      resizeObserver.disconnect();
      window.removeEventListener('keydown', blockKnockedOutKeyboard, true);
      window.removeEventListener('keyup', blockKnockedOutKeyboard, true);
      window.removeEventListener('keydown', trackKeyDown);
      window.removeEventListener('keyup', trackKeyUp);
      overlay.remove();
      koBanner.remove();
      base.destroy();
    }
  };
}
