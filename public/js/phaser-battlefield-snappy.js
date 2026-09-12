import { createRaidBattlefield as createBaseBattlefield } from './phaser-battlefield-fast.js';

const WORLD_WIDTH = 960;
const PLAYER_SPEED = 220;
const JUMP_VELOCITY = -390;
const POSITION_SEND_INTERVAL = 120;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function findLocal(scene) {
  if (!scene?.players) return null;
  for (const entry of scene.players.values()) {
    if (entry.isLocal) return entry;
  }
  return null;
}

function directionFor(scene) {
  const left = Boolean(scene.externalInput?.left || scene.cursors?.left?.isDown || scene.keys?.left?.isDown);
  const right = Boolean(scene.externalInput?.right || scene.cursors?.right?.isDown || scene.keys?.right?.isDown);
  return left === right ? 0 : left ? -1 : 1;
}

export function createRaidBattlefield(options = {}) {
  const battlefield = createBaseBattlefield(options);
  const { onPosition = () => {}, onJump = () => {} } = options;
  let patched = false;

  function applyHorizontalNow(scene) {
    const local = findLocal(scene);
    const body = local?.sprite?.body;
    if (!body) return;

    const direction = directionFor(scene);
    body.setAccelerationX(0);
    body.setDragX(0);
    body.setVelocityX(direction * PLAYER_SPEED);

    if (direction !== 0) {
      scene.applyFacing(local, direction < 0 ? 'left' : 'right');
    }
  }

  function jumpNow(scene) {
    const local = findLocal(scene);
    const body = local?.sprite?.body;
    if (!body) return false;

    const grounded = body.blocked.down || body.touching.down;
    if (!grounded) return false;

    body.setVelocityY(JUMP_VELOCITY);
    scene.jumpWasDown = true;
    onJump();
    return true;
  }

  function patchScene(scene) {
    if (!scene || scene.__mathRaidsInstantInput) return false;
    scene.__mathRaidsInstantInput = true;

    // Use direct velocity for the local player. Networking is only a snapshot
    // of the already-applied local movement, never a prerequisite for it.
    scene.updateLocalPlayer = function updateLocalPlayerInstant(entry, time) {
      const body = entry.sprite.body;
      const direction = directionFor(this);

      body.setAccelerationX(0);
      body.setDragX(0);
      body.setVelocityX(direction * PLAYER_SPEED);

      if (direction !== 0) {
        this.applyFacing(entry, direction < 0 ? 'left' : 'right');
      }

      const keyboardJump = Boolean(this.cursors?.up?.isDown || this.cursors?.space?.isDown || this.keys?.jump?.isDown);
      const wantsJump = keyboardJump || this.externalInput.jumpPulse;
      const grounded = body.blocked.down || body.touching.down;

      if (wantsJump && !this.jumpWasDown && grounded) {
        body.setVelocityY(JUMP_VELOCITY);
        onJump();
      }

      this.jumpWasDown = wantsJump;
      this.externalInput.jumpPulse = false;

      if (time - this.lastPositionSentAt >= POSITION_SEND_INTERVAL) {
        const pct = clamp((entry.sprite.x / WORLD_WIDTH) * 100, 4, 96);
        if (this.lastSentPct === null || Math.abs(pct - this.lastSentPct) > 0.1 || direction !== 0) {
          onPosition({ x: pct, facing: entry.facing });
          this.lastSentPct = pct;
        }
        this.lastPositionSentAt = time;
      }
    };

    // Keyboard jump should also start on the actual key event rather than
    // waiting for the next scene update to notice the held key.
    const keyboard = scene.input?.keyboard;
    if (keyboard) {
      const immediateJump = (event) => {
        if (event?.repeat) return;
        jumpNow(scene);
      };
      keyboard.on('keydown-UP', immediateJump);
      keyboard.on('keydown-W', immediateJump);
      keyboard.on('keydown-SPACE', immediateJump);
    }

    patched = true;
    return true;
  }

  function ensurePatched() {
    const scene = battlefield.game?.scene?.getScene?.('RaidScene');
    if (patchScene(scene)) return;
    requestAnimationFrame(ensurePatched);
  }
  requestAnimationFrame(ensurePatched);

  const originalSetMoveButton = battlefield.setMoveButton.bind(battlefield);
  battlefield.setMoveButton = (direction, active) => {
    originalSetMoveButton(direction, active);
    const scene = battlefield.game?.scene?.getScene?.('RaidScene');
    if (scene) {
      if (!patched) patchScene(scene);
      applyHorizontalNow(scene);
    }
  };

  battlefield.jump = () => {
    const scene = battlefield.game?.scene?.getScene?.('RaidScene');
    if (!scene) return;
    if (!patched) patchScene(scene);

    // Touch / pointer jump is applied right here in the input handler.
    if (!jumpNow(scene)) {
      // Small input buffer: if the button was pressed a fraction before the
      // player lands, let the normal scene update consume it on landing.
      scene.externalInput.jumpPulse = true;
    }
  };

  const originalResetInput = battlefield.resetInput.bind(battlefield);
  battlefield.resetInput = () => {
    originalResetInput();
    const scene = battlefield.game?.scene?.getScene?.('RaidScene');
    const local = findLocal(scene);
    if (local?.sprite?.body) {
      local.sprite.body.setAccelerationX(0);
      local.sprite.body.setDragX(0);
      local.sprite.body.setVelocityX(0);
    }
  };

  return battlefield;
}
