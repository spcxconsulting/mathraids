import { createRaidBattlefield as createBaseBattlefield } from './hardcore-battlefield.js';

const WIDTH = 640;
const HEIGHT = 360;
const MASK_BOTTOM = 278;
const DEFAULT_BOSS = { width: 560, height: 490, top: -92 };

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

  const base = createBaseBattlefield(options);
  let running = true;
  let custom = null;
  let attackType = null;
  let attackUntil = 0;
  let complete = null;
  let completedAt = 0;
  let lastSignature = '';

  const canvas = document.createElement('canvas');
  canvas.className = 'custom-boss-canvas-overlay';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '4',
    display: 'none',
    background: 'transparent'
  });
  host.append(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });

  function resize() {
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  resize();

  async function setCustomBoss(state) {
    const art = state?.boss?.art || {};
    const id = String(state?.boss?.id || '');
    const isCustom = id.startsWith('custom-') && art.bossIdle;
    if (!isCustom) {
      custom = null;
      lastSignature = '';
      canvas.style.display = 'none';
      return;
    }

    const signature = [id, art.bossIdle, art.bossAttack, art.backgroundBack, art.backgroundFront].join('|');
    canvas.style.display = 'block';

    const presentation = {
      ...DEFAULT_BOSS,
      ...(state.boss.presentation || {})
    };

    if (custom && signature === lastSignature) {
      custom.presentation = presentation;
      custom.attackFaces = art.attackFaces === 'right' ? 'right' : 'left';
      custom.status = state.status;
      return;
    }

    lastSignature = signature;
    const [idle, attack, back, front] = await Promise.all([
      loadImage(art.bossIdle),
      loadImage(art.bossAttack || art.bossIdle),
      loadImage(art.backgroundBack || '/art/city-back.svg'),
      loadImage(art.backgroundFront || '/art/city-front.svg')
    ]);

    custom = {
      id,
      idle,
      attack,
      back,
      front,
      presentation,
      attackFaces: art.attackFaces === 'right' ? 'right' : 'left',
      status: state.status
    };
  }

  function attackSpriteState() {
    const type = attackType;
    if (!type || Date.now() > attackUntil || !['left_slam', 'right_slam'].includes(type)) {
      return { image: custom?.idle, flip: false };
    }

    const targetFaces = type === 'left_slam' ? 'left' : 'right';
    return {
      image: custom?.attack || custom?.idle,
      flip: custom?.attackFaces !== targetFaces
    };
  }

  function drawContained(image, centerX, top, width, height, flip = false, yOffset = 0, rotation = 0) {
    if (!image) return;
    const sourceWidth = image.naturalWidth || image.width || width;
    const sourceHeight = image.naturalHeight || image.height || height;
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;

    ctx.save();
    ctx.translate(centerX, top + height + yOffset);
    ctx.rotate(rotation);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(image, -drawWidth / 2, -drawHeight, drawWidth, drawHeight);
    ctx.restore();
  }

  function draw(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!custom || custom.status === 'lobby' || !canvas.width || !canvas.height) return;

    const scaleX = canvas.width / WIDTH;
    const scaleY = canvas.height / HEIGHT;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, WIDTH, MASK_BOTTOM);
    ctx.clip();

    ctx.drawImage(custom.back, 0, 0, WIDTH, HEIGHT);

    let yOffset = 0;
    let rotation = 0;
    if (complete === 'victory') {
      const elapsed = Math.max(0, now - completedAt);
      const progress = clamp(elapsed / 7000, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      yOffset = eased * 230;
      rotation = eased * 0.055;
    } else {
      yOffset = Math.sin(now / 620) * 2.5;
    }

    const sprite = attackSpriteState();
    drawContained(
      sprite.image,
      WIDTH / 2,
      Number(custom.presentation.top) || DEFAULT_BOSS.top,
      Number(custom.presentation.width) || DEFAULT_BOSS.width,
      Number(custom.presentation.height) || DEFAULT_BOSS.height,
      sprite.flip,
      yOffset,
      rotation
    );

    ctx.drawImage(custom.front, 0, 0, WIDTH, HEIGHT);
    ctx.restore();
  }

  function frame(now) {
    if (!running) return;
    draw(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    ...base,
    syncState(state) {
      base.syncState(state);
      setCustomBoss(state).catch((error) => {
        console.error('Could not load custom boss artwork', error);
        custom = null;
        canvas.style.display = 'none';
      });
      if (state?.pendingAttack?.type) {
        attackType = state.pendingAttack.type;
        attackUntil = Number(state.pendingAttack.impactAt || state.pendingAttack.executeAt || Date.now() + 2000) + 500;
      }
    },
    showTelegraph(attack) {
      base.showTelegraph(attack);
      attackType = attack?.type || null;
      attackUntil = Number(attack?.impactAt || attack?.executeAt || Date.now() + 2000) + 500;
    },
    launchBossAttack(payload) {
      attackType = payload?.attackType || attackType;
      attackUntil = Number(payload?.impactAt || Date.now() + 720) + 450;
      base.launchBossAttack(payload);
    },
    resolveBossAttack(payload) {
      attackType = payload?.attackType || attackType;
      attackUntil = Date.now() + 500;
      base.resolveBossAttack(payload);
    },
    complete(outcome) {
      complete = outcome;
      completedAt = performance.now();
      base.complete(outcome);
    },
    destroy() {
      running = false;
      resizeObserver.disconnect();
      canvas.remove();
      base.destroy();
    }
  };
}
