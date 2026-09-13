import { createRaidBattlefield as createBaseBattlefield } from './vector-battlefield-reusable.js';

const WIDTH = 640;
const HEIGHT = 360;
const GROUND_Y = 338;
const FORTIFY_RADIUS_PCT = 12;
const DEATH_FALL_MS = 680;
const PLAYER_W = 24;
const PLAYER_H = 30;
const MOVEMENT_KEYS = new Set(['a', 'd', 'w', 'arrowleft', 'arrowright', 'arrowup', ' ']);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pctToX(value) {
  return clamp((Number(value) / 100) * WIDTH, 28, WIDTH - 28);
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
  let healTargetCallback = null;
  const players = new Map();
  const deathArt = { dps: null, healer: null };

  Promise.all([
    loadImage('/art/player-dps.svg'),
    loadImage('/art/player-healer.svg')
  ]).then(([dps, healer]) => {
    deathArt.dps = dps;
    deathArt.healer = healer;
  }).catch(() => {});

  const base = createBaseBattlefield({
    ...options,
    onPosition(position) {
      options.onPosition?.(position);
    },
    onJump(detail) {
      if (!localKnockedOut) options.onJump?.(detail);
    }
  });

  const baseCanvas = host.querySelector('.vector-battlefield-canvas');
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const overlay = document.createElement('canvas');
  overlay.className = 'hardcore-canvas-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  Object.assign(overlay.style, {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    zIndex: '5',
    display: 'none',
    background: 'transparent'
  });
  host.append(overlay);
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
        y: GROUND_Y,
        health: Number(player.health) || 100,
        maxHealth: Number(player.maxHealth) || 100,
        knockedOut: startsOut,
        knockedOutAt: startsOut ? performance.now() - DEATH_FALL_MS : 0,
        fortifyUntil: Number(player.fortifyUntil) || 0,
        guardFlashUntil: 0,
        healPulseUntil: 0,
        dazedUntil: 0
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

  function syncOverlayState(serverState) {
    hardcore = Boolean(serverState?.individualHealth || serverState?.hardcore || serverState?.config?.mode === 'hardcore');
    overlay.style.display = hardcore ? 'block' : 'none';

    const ids = new Set((serverState?.players || []).map((player) => player.id));
    for (const id of players.keys()) if (!ids.has(id)) players.delete(id);

    for (const player of serverState?.players || []) {
      const entry = ensurePlayer(player);
      if (!entry.knockedOut && !base.getPlayerVisualState?.(entry.id)) {
        entry.x = pctToX(player.x);
        entry.y = GROUND_Y;
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

  function syncVisualPositions() {
    for (const entry of players.values()) {
      if (entry.knockedOut) continue;
      const visual = base.getPlayerVisualState?.(entry.id);
      if (!visual) continue;
      entry.x = visual.x;
      entry.y = visual.y;
      entry.facing = visual.facing;
    }
  }

  function resizeOverlay() {
    const rect = baseCanvas?.getBoundingClientRect?.() || host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    overlay.style.width = `${Math.floor(rect.width)}px`;
    overlay.style.height = `${Math.floor(rect.height)}px`;
    overlay.width = Math.max(1, Math.round(rect.width * dpr));
    overlay.height = Math.max(1, Math.round(rect.height * dpr));
  }

  const resizeObserver = new ResizeObserver(resizeOverlay);
  resizeObserver.observe(host);
  if (baseCanvas) resizeObserver.observe(baseCanvas);
  resizeOverlay();

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
    const entries = [...players.values()].filter((entry) => !entry.knockedOut);
    const local = entries.find((entry) => entry.id === localPlayerId);
    const placementOrder = local
      ? [local, ...entries.filter((entry) => entry.id !== localPlayerId).sort((a, b) => a.x - b.x)]
      : entries.sort((a, b) => a.x - b.x);
    const placed = [];
    const offsets = new Map();

    for (const entry of placementOrder) {
      let offset = 0;
      while (placed.some((item) => Math.abs(item.x - entry.x) < 28 && Math.abs(item.y - (entry.y - 35 - offset)) < 5.5)) offset += 5.5;
      offsets.set(entry.id, offset);
      placed.push({ x: entry.x, y: entry.y - 35 - offset });
    }
    return offsets;
  }

  function drawHealth(entry, now, offset = 0, isLocal = false) {
    if (!hardcore || entry.knockedOut) return;
    const barWidth = entry.class === 'tank' ? 28 : 24;
    const barHeight = 2.5;
    const x = entry.x - barWidth / 2;
    const y = entry.y - 35 - offset;
    const ratio = clamp(entry.health / Math.max(1, entry.maxHealth), 0, 1);

    if (entry.guardFlashUntil > now) {
      ctx.save();
      ctx.shadowColor = entry.class === 'tank' ? '#9de4ff' : '#70caff';
      ctx.shadowBlur = 6;
      ctx.strokeStyle = '#d7f5ff';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x - 1.5, y - 1.5, barWidth + 3, barHeight + 3);
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(4,9,16,.92)';
    ctx.fillRect(x - 1, y - 1, barWidth + 2, barHeight + 2);

    const gradient = ctx.createLinearGradient(x, y, x + barWidth, y);
    gradient.addColorStop(0, '#ef4f62');
    gradient.addColorStop(0.52, '#ffcf58');
    gradient.addColorStop(1, '#71e38a');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, barWidth * ratio, barHeight);

    ctx.strokeStyle = isLocal ? '#f4fbff' : entry.class === 'tank' ? '#8ed7ff' : 'rgba(255,255,255,.55)';
    ctx.lineWidth = isLocal ? 1 : 0.7;
    ctx.strokeRect(x - 1, y - 1, barWidth + 2, barHeight + 2);

    if (isLocal) {
      ctx.font = '800 5.5px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(4,9,16,.95)';
      ctx.lineWidth = 1.5;
      ctx.strokeText('YOU', entry.x, y - 2.5);
      ctx.fillText('YOU', entry.x, y - 2.5);
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

  function drawHealTargets(now) {
    if (!healTargetCallback) return;
    const pulse = 0.55 + (Math.sin(now / 120) + 1) * 0.18;
    for (const entry of players.values()) {
      if (entry.knockedOut || entry.health <= 0) continue;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = 'rgba(90,255,150,.12)';
      ctx.strokeStyle = '#8affaa';
      ctx.lineWidth = entry.id === localPlayerId ? 3 : 2;
      ctx.beginPath();
      ctx.arc(entry.x, entry.y - 13, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = '800 7px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#dfffe7';
      ctx.fillText(entry.id === localPlayerId ? 'HEAL SELF' : 'HEAL', entry.x, entry.y - 38);
      ctx.restore();
    }
  }

  function drawHealPulses(now) {
    for (const entry of players.values()) {
      if (entry.healPulseUntil <= now) continue;
      const remaining = clamp((entry.healPulseUntil - now) / 700, 0, 1);
      const radius = 18 + (1 - remaining) * 34;
      ctx.save();
      ctx.globalAlpha = remaining * 0.75;
      ctx.strokeStyle = '#8affaa';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(entry.x, entry.y - 14, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawOverlay(now) {
    if (!hardcore || !overlay.width || !overlay.height) return;
    syncVisualPositions();

    const scaleX = overlay.width / WIDTH;
    const scaleY = overlay.height / HEIGHT;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);

    for (const entry of players.values()) drawFortify(entry, now);
    for (const entry of players.values()) drawKnockedOut(entry, now);
    drawHealPulses(now);
    drawHealTargets(now);

    const offsets = healthBarOffsets();
    const remotes = [...players.values()].filter((entry) => entry.id !== localPlayerId && !entry.knockedOut);
    for (const entry of remotes) drawHealth(entry, now, offsets.get(entry.id) || 0, false);
    const local = players.get(localPlayerId);
    if (local && !local.knockedOut) drawHealth(local, now, offsets.get(local.id) || 0, true);
  }

  function frame(now) {
    if (!running) return;
    drawOverlay(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function stopHealTargeting() {
    healTargetCallback = null;
    overlay.style.pointerEvents = 'none';
    overlay.style.cursor = 'default';
  }

  function selectHealTarget(event) {
    if (!healTargetCallback || !hardcore) return;
    const rect = overlay.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * HEIGHT;
    const candidates = [...players.values()]
      .filter((entry) => !entry.knockedOut && entry.health > 0)
      .map((entry) => ({ entry, distance: Math.hypot(entry.x - x, (entry.y - 13) - y) }))
      .sort((a, b) => a.distance - b.distance);
    const choice = candidates[0];
    if (!choice || choice.distance > 30) return;
    const callback = healTargetCallback;
    stopHealTargeting();
    callback(choice.entry.id);
  }
  overlay.addEventListener('pointerdown', selectHealTarget);

  function blockKnockedOutKeyboard(event) {
    if (!hardcore || !localKnockedOut) return;
    const key = event.key?.toLowerCase?.() || '';
    if (!MOVEMENT_KEYS.has(key) && event.code !== 'Space') return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  window.addEventListener('keydown', blockKnockedOutKeyboard, true);
  window.addEventListener('keyup', blockKnockedOutKeyboard, true);

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
    },
    jumpPlayer(id, airborneUntil, jumpStrength, jumpLockedUntil, jumpFatigue) {
      const entry = players.get(id);
      if (!entry?.knockedOut) {
        base.jumpPlayer(id, airborneUntil, jumpStrength, jumpLockedUntil, jumpFatigue);
      }
    },
    playerSpecial(payload) {
      if (payload?.ability === 'fortify') {
        const entry = players.get(payload.playerId);
        if (entry) entry.fortifyUntil = Number(payload.fortifyUntil) || (Date.now() + 5000);
        return;
      }
      base.playerSpecial(payload);
      if (payload?.ability === 'renewal_burst') {
        const target = players.get(payload.targetPlayerId || payload.healedPlayerIds?.[0]);
        if (target) target.healPulseUntil = performance.now() + 700;
      }
    },
    beginHealTargeting(callback) {
      if (!hardcore || typeof callback !== 'function') return false;
      healTargetCallback = callback;
      overlay.style.pointerEvents = 'auto';
      overlay.style.cursor = 'crosshair';
      return true;
    },
    cancelHealTargeting() {
      stopHealTargeting();
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
      if (payload?.hardcore || payload?.individualHealth) {
        dispatch('mathraids:hardcoreattack', { payload, localPlayerId });
      }
    },
    setMoveButton(direction, active) {
      if (hardcore && localKnockedOut) {
        base.setMoveButton(direction, false);
        return;
      }
      base.setMoveButton(direction, active);
    },
    jump() {
      if (hardcore && localKnockedOut) return false;
      return base.jump();
    },
    setDazed(id, until) {
      const entry = players.get(id);
      if (entry) entry.dazedUntil = until;
      base.setDazed(id, until);
    },
    resetInput() {
      base.resetInput();
    },
    complete(outcome) {
      stopHealTargeting();
      base.complete(outcome);
      if (outcome === 'wipe') dispatch('mathraids:raidwipe', {});
    },
    destroy() {
      running = false;
      stopHealTargeting();
      resizeObserver.disconnect();
      overlay.removeEventListener('pointerdown', selectHealTarget);
      window.removeEventListener('keydown', blockKnockedOutKeyboard, true);
      window.removeEventListener('keyup', blockKnockedOutKeyboard, true);
      overlay.remove();
      koBanner.remove();
      base.destroy();
    }
  };
}
