import { createRaidBattlefield as createBaseBattlefield } from './vector-battlefield-reusable.js';

const MOVEMENT_KEYS = new Set(['a', 'd', 'w', 'arrowleft', 'arrowright', 'arrowup', ' ']);

export function createRaidBattlefield(options = {}) {
  const host = document.getElementById(options.parent || 'phaser-game');
  if (!host) throw new Error('Battlefield mount was not found');

  let localPlayerId = null;
  let hardcore = false;
  let localKnockedOut = false;
  const players = new Map();

  const overlay = document.createElement('div');
  overlay.className = 'hardcore-health-overlay';
  Object.assign(overlay.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '5',
    display: 'none'
  });

  const koBanner = document.createElement('div');
  koBanner.textContent = 'KNOCKED OUT';
  Object.assign(koBanner.style, {
    position: 'absolute',
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
    display: 'none'
  });
  overlay.append(koBanner);

  function dispatch(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function healthEntry(player) {
    let entry = players.get(player.id);
    if (!entry) {
      const root = document.createElement('div');
      Object.assign(root.style, {
        position: 'absolute',
        width: '58px',
        transform: 'translate(-50%, -100%)',
        transition: 'left 90ms linear, opacity 120ms ease, filter 120ms ease',
        textAlign: 'center'
      });

      const name = document.createElement('div');
      Object.assign(name.style, {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: '#f4fbff',
        textShadow: '0 1px 2px #000',
        font: '700 8px system-ui, sans-serif',
        marginBottom: '2px'
      });

      const track = document.createElement('div');
      Object.assign(track.style, {
        height: '5px',
        borderRadius: '999px',
        overflow: 'hidden',
        background: 'rgba(5,10,18,.86)',
        border: '1px solid rgba(255,255,255,.35)'
      });

      const fill = document.createElement('div');
      Object.assign(fill.style, {
        height: '100%',
        width: '100%',
        background: 'linear-gradient(90deg,#ef4f62,#ffcf58,#71e38a)',
        transformOrigin: 'left center',
        transition: 'transform 160ms ease'
      });
      track.append(fill);
      root.append(name, track);
      overlay.append(root);
      entry = { root, name, fill, track, x: 50, class: player.class || 'dps' };
      players.set(player.id, entry);
    }
    return entry;
  }

  function updatePlayer(player) {
    const entry = healthEntry(player);
    entry.class = player.class || entry.class;
    entry.x = Number.isFinite(Number(player.x)) ? Number(player.x) : entry.x;
    entry.root.style.left = `${entry.x}%`;
    entry.root.style.top = '79%';
    const role = entry.class === 'tank' ? '🛡 ' : entry.class === 'healer' ? '✦ ' : '';
    entry.name.textContent = player.knockedOut ? `${role}${player.name} · OUT` : `${role}${player.name}`;
    entry.track.style.borderColor = entry.class === 'tank'
      ? 'rgba(113,197,255,.85)'
      : 'rgba(255,255,255,.35)';
    const maxHealth = Math.max(1, Number(player.maxHealth) || 100);
    const health = Math.max(0, Number(player.health) || 0);
    entry.fill.style.transform = `scaleX(${Math.min(1, health / maxHealth)})`;
    entry.root.style.opacity = player.knockedOut ? '.48' : '1';
  }

  function flashGuard(protectedPlayerIds = [], guardTankIds = []) {
    for (const id of protectedPlayerIds) {
      const entry = players.get(id);
      if (!entry) continue;
      entry.root.style.filter = 'drop-shadow(0 0 6px rgba(99,190,255,.95))';
      setTimeout(() => { entry.root.style.filter = ''; }, 650);
    }
    for (const id of guardTankIds) {
      const entry = players.get(id);
      if (!entry) continue;
      entry.root.style.filter = 'drop-shadow(0 0 9px rgba(122,216,255,1))';
      entry.track.style.borderColor = '#bfeeff';
      setTimeout(() => {
        entry.root.style.filter = '';
        entry.track.style.borderColor = 'rgba(113,197,255,.85)';
      }, 750);
    }
  }

  function syncHardcoreState(serverState) {
    hardcore = Boolean(serverState?.hardcore || serverState?.config?.mode === 'hardcore');
    overlay.style.display = hardcore ? 'block' : 'none';
    if (!hardcore) {
      localKnockedOut = false;
      return;
    }

    const activeIds = new Set();
    for (const player of serverState.players || []) {
      activeIds.add(player.id);
      updatePlayer(player);
    }
    for (const [id, entry] of players) {
      if (!activeIds.has(id)) {
        entry.root.remove();
        players.delete(id);
      }
    }

    const local = (serverState.players || []).find((player) => player.id === localPlayerId);
    localKnockedOut = Boolean(local?.knockedOut);
    koBanner.style.display = localKnockedOut ? 'block' : 'none';
    dispatch('mathraids:hardcorestate', { state: serverState, localPlayer: local || null });
  }

  function blockKnockedOutKeyboard(event) {
    if (!hardcore || !localKnockedOut) return;
    const key = event.key?.toLowerCase?.() || '';
    if (!MOVEMENT_KEYS.has(key) && event.code !== 'Space') return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  const base = createBaseBattlefield({
    ...options,
    onPosition(position) {
      const entry = players.get(localPlayerId);
      if (entry && hardcore && !localKnockedOut) {
        entry.x = position.x;
        entry.root.style.left = `${position.x}%`;
      }
      options.onPosition?.(position);
    },
    onJump() {
      if (!localKnockedOut) options.onJump?.();
    }
  });

  host.append(overlay);
  window.addEventListener('keydown', blockKnockedOutKeyboard, true);
  window.addEventListener('keyup', blockKnockedOutKeyboard, true);

  return {
    ...base,
    setLocalPlayerId(id) {
      localPlayerId = id;
      base.setLocalPlayerId(id);
    },
    syncState(serverState) {
      base.syncState(serverState);
      syncHardcoreState(serverState);
    },
    movePlayer(id, x, facing, airborneUntil) {
      base.movePlayer(id, x, facing, airborneUntil);
      const entry = players.get(id);
      if (entry && hardcore) {
        entry.x = Number(x);
        entry.root.style.left = `${x}%`;
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
    resolveBossAttack(payload) {
      base.resolveBossAttack(payload);
      if (payload?.hardcore) {
        flashGuard(payload.protectedPlayerIds, payload.guardTankIds);
        dispatch('mathraids:hardcoreattack', { payload, localPlayerId });
      }
    },
    complete(outcome) {
      base.complete(outcome);
      if (outcome === 'wipe') dispatch('mathraids:raidwipe', {});
    },
    destroy() {
      window.removeEventListener('keydown', blockKnockedOutKeyboard, true);
      window.removeEventListener('keyup', blockKnockedOutKeyboard, true);
      overlay.remove();
      base.destroy();
    }
  };
}
