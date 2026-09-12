import * as Phaser from '/vendor/phaser.esm.js';

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 400;
const GROUND_Y = 330;
const PLAYER_SPEED = 220;
const PLAYER_ACCELERATION = 1650;
const PLAYER_DRAG = 2200;
const JUMP_VELOCITY = -390;
const POSITION_SEND_INTERVAL = 120;
const LABEL_LIMIT = 20;

function pctToWorld(value) {
  return (Number(value) / 100) * WORLD_WIDTH;
}

function worldToPct(value) {
  return (Number(value) / WORLD_WIDTH) * 100;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createRaidBattlefield({
  parent = 'phaser-game',
  onPosition = () => {},
  onJump = () => {}
} = {}) {
  const bridge = {
    scene: null,
    localPlayerId: null,
    pendingState: null,
    mode: 'lobby'
  };

  class RaidScene extends Phaser.Scene {
    constructor() {
      super('RaidScene');
      this.players = new Map();
      this.externalInput = { left: false, right: false, jumpPulse: false };
      this.lastPositionSentAt = 0;
      this.lastSentPct = null;
      this.jumpWasDown = false;
      this.mode = 'lobby';
      this.activeTelegraphId = null;
      this.telegraphTween = null;
      this.remoteLabelsEnabled = true;
    }

    create() {
      bridge.scene = this;
      this.physics.world.setBounds(28, 0, WORLD_WIDTH - 56, WORLD_HEIGHT);

      this.createGeneratedTextures();
      this.createBackdrop();
      this.createLobbySet();
      this.createBoss();
      this.createTelegraphLayer();
      this.createGroundCollider();

      this.cursors = this.input.keyboard.createCursorKeys();
      this.keys = this.input.keyboard.addKeys({ left: 'A', right: 'D', jump: 'W' });

      this.cameras.main.setBackgroundColor('#08111f');
      this.cameras.main.setRoundPixels(true);

      this.setMode(bridge.mode, true);
      if (bridge.pendingState) this.syncState(bridge.pendingState);
    }

    createGeneratedTextures() {
      const g = this.make.graphics({ x: 0, y: 0, add: false });

      // Static arena background and faux-3D floor are flattened into one texture.
      g.fillStyle(0x08162b, 1);
      g.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      g.fillStyle(0x102a4a, 1);
      g.fillRect(0, 0, WORLD_WIDTH, 245);
      g.fillStyle(0xfff1bd, 0.85);
      g.fillCircle(812, 70, 31);

      for (let i = 0; i < 26; i += 1) {
        const x = (i * 71 + 29) % WORLD_WIDTH;
        const y = 18 + ((i * 43) % 145);
        g.fillStyle(0xffffff, i % 4 === 0 ? 0.65 : 0.32);
        g.fillCircle(x, y, i % 5 === 0 ? 1.5 : 1);
      }

      // Far skyline, intentionally blocky and cheap.
      let x = 0;
      let i = 0;
      while (x < WORLD_WIDTH) {
        const w = 38 + ((i * 19) % 46);
        const h = 48 + ((i * 31) % 90);
        g.fillStyle(i % 3 === 0 ? 0x17253a : 0x121e31, 1);
        g.fillRect(x, 282 - h, w, h);
        if (i % 2 === 0) {
          g.fillStyle(0xffcf72, 0.22);
          g.fillRect(x + 10, 260 - Math.min(40, h / 2), 4, 6);
        }
        x += w + 5;
        i += 1;
      }

      // Near skyline.
      g.fillStyle(0x0c1522, 1);
      const silhouettes = [
        [25, 222, 88, 78], [132, 238, 66, 62], [218, 210, 96, 100],
        [335, 236, 74, 64], [610, 230, 84, 70], [708, 198, 98, 116],
        [826, 236, 68, 64], [904, 214, 62, 92]
      ];
      for (const [sx, sy, sw, sh] of silhouettes) g.fillRect(sx, sy, sw, sh);

      // Perspective platform.
      g.fillStyle(0x263442, 1);
      g.fillPoints([
        new Phaser.Geom.Point(92, 278), new Phaser.Geom.Point(868, 278),
        new Phaser.Geom.Point(960, 400), new Phaser.Geom.Point(0, 400)
      ], true);
      g.lineStyle(1, 0xc9e2ef, 0.09);
      for (let n = 0; n <= 8; n += 1) {
        const topX = 92 + (776 / 8) * n;
        const bottomX = (WORLD_WIDTH / 8) * n;
        g.lineBetween(topX, 278, bottomX, 400);
      }
      for (let n = 1; n <= 4; n += 1) {
        const t = n / 4;
        const y = 278 + Math.pow(t, 1.5) * 122;
        const left = 92 * (1 - t);
        const right = 868 + 92 * t;
        g.lineBetween(left, y, right, y);
      }
      g.fillStyle(0x101820, 0.85);
      g.fillRect(0, 360, WORLD_WIDTH, 40);
      g.generateTexture('mr-background', WORLD_WIDTH, WORLD_HEIGHT);
      g.clear();

      // DPS player texture.
      this.drawPlayerTexture(g, 0x547eb3, 0x2d4568, false);
      g.generateTexture('mr-player-dps', 54, 70);
      g.clear();

      // Healer player texture.
      this.drawPlayerTexture(g, 0x4fa07f, 0x255a4b, true);
      g.generateTexture('mr-player-healer', 54, 70);
      g.clear();

      // Boss flattened to one texture.
      g.fillStyle(0x24483d, 1);
      g.fillEllipse(86, 126, 128, 142);
      g.fillStyle(0x407b63, 1);
      g.fillEllipse(86, 121, 116, 132);
      g.fillStyle(0x77a874, 1);
      g.fillEllipse(91, 136, 58, 78);
      g.fillStyle(0x4b8d70, 1);
      g.fillCircle(93, 61, 49);
      g.fillStyle(0x5a9877, 1);
      g.fillEllipse(101, 80, 65, 34);
      g.fillStyle(0xffe083, 1);
      g.fillCircle(76, 53, 6);
      g.fillCircle(106, 53, 6);
      g.fillStyle(0x15201d, 1);
      g.fillCircle(78, 53, 2.5);
      g.fillCircle(108, 53, 2.5);
      g.fillStyle(0x376b59, 1);
      g.fillRect(25, 99, 23, 62);
      g.fillRect(126, 99, 23, 62);
      g.fillTriangle(40, 132, 2, 157, 48, 153);
      g.fillStyle(0x9ad19a, 1);
      g.fillTriangle(50, 25, 61, 1, 70, 27);
      g.fillTriangle(88, 19, 98, 0, 108, 23);
      g.fillTriangle(122, 29, 130, 7, 140, 34);
      g.generateTexture('mr-boss', 172, 198);
      g.clear();

      // Lobby staging art flattened into one texture.
      g.fillStyle(0x000000, 0.28);
      g.fillEllipse(210, 300, 100, 18);
      g.fillStyle(0x6a4a2a, 1);
      g.fillRect(70, 277, 55, 42);
      g.fillStyle(0x5d432b, 1);
      g.fillRect(820, 282, 58, 38);
      g.lineStyle(7, 0x7a79ff, 0.95);
      g.strokeEllipse(735, 205, 104, 160);
      g.lineStyle(3, 0x7ee7ff, 0.8);
      g.strokeEllipse(735, 205, 72, 126);
      g.fillStyle(0x73dfff, 0.16);
      g.fillEllipse(735, 205, 56, 112);
      g.generateTexture('mr-lobby', WORLD_WIDTH, WORLD_HEIGHT);
      g.destroy();
    }

    drawPlayerTexture(g, roleColor, roleDark, healer) {
      g.fillStyle(roleDark, 1);
      g.fillTriangle(12, 28, 42, 28, 46, 63);
      g.fillStyle(0x27354a, 1);
      g.fillRect(18, 43, 18, 22);
      g.fillStyle(roleColor, 1);
      g.fillRect(12, 22, 30, 31);
      g.fillStyle(0xe0b58a, 1);
      g.fillCircle(27, 15, 12);
      g.fillStyle(0x3a2c2a, 1);
      g.fillRect(16, 4, 22, 7);
      g.fillStyle(0xffffff, 0.9);
      if (healer) {
        g.fillCircle(27, 36, 4);
        g.fillStyle(0xaadcc5, 1);
        g.fillRect(44, 15, 3, 42);
      } else {
        g.fillTriangle(24, 32, 31, 28, 31, 36);
        g.lineStyle(2, 0xd8bc75, 1);
        g.strokeCircle(43, 33, 9);
      }
    }

    createBackdrop() {
      this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'mr-background').setDepth(-20);
    }

    createLobbySet() {
      this.lobbyGroup = this.add.container(0, 0).setDepth(4);
      const image = this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'mr-lobby');
      const title = this.add.text(WORLD_WIDTH / 2, 40, 'RAID STAGING AREA', {
        fontFamily: 'system-ui, sans-serif', fontSize: '20px', fontStyle: 'bold', color: '#eaf7ff'
      }).setOrigin(0.5);
      const sub = this.add.text(WORLD_WIDTH / 2, 66, 'Move around while the raid assembles', {
        fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#a9c7d8'
      }).setOrigin(0.5);
      const portal = this.add.text(735, 295, 'CITY UNDER SIEGE', {
        fontFamily: 'system-ui, sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#cbeeff'
      }).setOrigin(0.5);
      const camp = this.add.text(210, 284, '🔥', { fontSize: '36px' }).setOrigin(0.5);
      this.lobbyGroup.add([image, title, sub, portal, camp]);
    }

    createBoss() {
      this.bossShadow = this.add.ellipse(WORLD_WIDTH / 2, GROUND_Y + 4, 150, 25, 0x000000, 0.35).setDepth(6);
      this.boss = this.add.image(WORLD_WIDTH / 2, 215, 'mr-boss').setDepth(8).setScale(1.03);
      this.bossName = this.add.text(WORLD_WIDTH / 2, 91, 'NUMBERZILLA', {
        fontFamily: 'system-ui, sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#effff0'
      }).setOrigin(0.5).setDepth(9);
    }

    createTelegraphLayer() {
      this.telegraphGraphics = this.add.graphics().setDepth(5);
      this.warningText = this.add.text(WORLD_WIDTH / 2, 28, '', {
        fontFamily: 'system-ui, sans-serif', fontSize: '17px', fontStyle: 'bold', color: '#fff1b2'
      }).setOrigin(0.5).setDepth(20).setVisible(false);
    }

    createGroundCollider() {
      this.groundCollider = this.add.rectangle(WORLD_WIDTH / 2, 362, WORLD_WIDTH, 70, 0x000000, 0);
      this.physics.add.existing(this.groundCollider, true);
    }

    createPlayer(player) {
      const isLocal = player.id === bridge.localPlayerId;
      const x = pctToWorld(player.x);
      const texture = player.class === 'healer' ? 'mr-player-healer' : 'mr-player-dps';
      const sprite = isLocal
        ? this.physics.add.image(x, GROUND_Y - 28, texture)
        : this.add.image(x, GROUND_Y - 28, texture);

      sprite.setDepth(isLocal ? 13 : 11);
      sprite.setFlipX((player.facing || 'right') === 'left');

      if (isLocal) {
        sprite.body.setCollideWorldBounds(true);
        sprite.body.setSize(30, 58);
        sprite.body.setOffset(12, 8);
        sprite.body.setMaxVelocity(PLAYER_SPEED, 650);
        sprite.body.setDragX(PLAYER_DRAG);
        this.physics.add.collider(sprite, this.groundCollider);
      }

      const shadow = this.add.ellipse(x, GROUND_Y + 6, 42, 11, 0x000000, isLocal ? 0.38 : 0.25).setDepth(10);
      const label = this.add.text(x, GROUND_Y + 24, isLocal ? `${player.name} (you)` : player.name, {
        fontFamily: 'system-ui, sans-serif', fontSize: '10px', color: isLocal ? '#aaff9c' : '#dcecff'
      }).setOrigin(0.5, 0).setDepth(14);

      const entry = {
        id: player.id,
        sprite,
        shadow,
        label,
        class: player.class,
        facing: player.facing || 'right',
        targetX: x,
        isLocal,
        jumpingTween: null,
        dazedUntil: 0
      };

      this.players.set(player.id, entry);
      return entry;
    }

    removePlayer(id) {
      const entry = this.players.get(id);
      if (!entry) return;
      entry.sprite.destroy();
      entry.shadow.destroy();
      entry.label.destroy();
      this.players.delete(id);
    }

    syncState(state) {
      if (!state) return;
      this.remoteLabelsEnabled = state.players.length <= LABEL_LIMIT;
      const activeIds = new Set(state.players.map((player) => player.id));
      for (const id of this.players.keys()) {
        if (!activeIds.has(id)) this.removePlayer(id);
      }

      for (const player of state.players) {
        let entry = this.players.get(player.id);
        if (!entry) entry = this.createPlayer(player);
        entry.targetX = pctToWorld(player.x);
        this.applyFacing(entry, player.facing || 'right');
        entry.label.setVisible(entry.isLocal || this.remoteLabelsEnabled);

        if (entry.isLocal && entry.sprite.body) {
          const delta = entry.targetX - entry.sprite.x;
          if (Math.abs(delta) > 75) entry.sprite.x += delta * 0.28;
        }
      }

      this.setMode(state.status === 'lobby' ? 'lobby' : 'raid');
      if (state.pendingAttack && state.pendingAttack.executeAt > Date.now()) this.showTelegraph(state.pendingAttack);
    }

    setMode(mode, immediate = false) {
      const next = mode === 'lobby' ? 'lobby' : 'raid';
      if (!immediate && this.mode === next) return;
      this.mode = next;
      const raidVisible = next === 'raid';
      this.lobbyGroup.setVisible(!raidVisible);
      this.boss.setVisible(raidVisible);
      this.bossShadow.setVisible(raidVisible);
      this.bossName.setVisible(raidVisible);
      if (raidVisible && !immediate) this.cameras.main.flash(180, 120, 190, 230, false);
      if (!raidVisible) this.clearTelegraph();
    }

    movePlayer(id, xPct, facing) {
      const entry = this.players.get(id);
      if (!entry) return;
      entry.targetX = pctToWorld(xPct);
      this.applyFacing(entry, facing);
      if (entry.isLocal && entry.sprite.body) {
        const delta = entry.targetX - entry.sprite.x;
        if (Math.abs(delta) > 85) entry.sprite.x += delta * 0.22;
      }
    }

    jumpPlayer(id) {
      const entry = this.players.get(id);
      if (!entry || entry.isLocal) return;
      entry.jumpingTween?.stop();
      entry.jumpingTween = this.tweens.add({
        targets: entry.sprite,
        y: GROUND_Y - 92,
        duration: 275,
        yoyo: true,
        ease: 'Quad.easeOut',
        onComplete: () => {
          entry.sprite.y = GROUND_Y - 28;
          entry.jumpingTween = null;
        }
      });
    }

    applyFacing(entry, facing) {
      entry.facing = facing === 'left' ? 'left' : 'right';
      entry.sprite.setFlipX(entry.facing === 'left');
    }

    playerAction(action) {
      const entry = this.players.get(action.playerId);
      if (!entry || !this.boss.visible) return;
      const healer = action.action === 'heal';
      const projectile = healer
        ? this.add.circle(entry.sprite.x, entry.sprite.y - 12, 6, 0x8aff80, 1)
        : this.add.rectangle(entry.sprite.x, entry.sprite.y - 12, 18, 5, 0xffc46a, 1);
      projectile.setDepth(18);

      if (healer && action.playerId === bridge.localPlayerId) {
        this.floatText(entry.sprite.x, entry.sprite.y - 52, `+${action.healing}`, '#9dff91');
      }

      this.tweens.add({
        targets: projectile,
        x: this.boss.x,
        y: this.boss.y - 20,
        duration: healer ? 360 : 270,
        ease: 'Quad.easeIn',
        onComplete: () => {
          projectile.destroy();
          this.bossHit(action.damage, healer);
        }
      });
    }

    bossHit(damage, healer) {
      this.boss.setTintFill(healer ? 0xb8ffa9 : 0xffd080);
      this.time.delayedCall(75, () => this.boss.clearTint());
      this.floatText(this.boss.x + 28, this.boss.y - 70, `-${damage}`, healer ? '#b8ffa9' : '#ffd080', 15);
    }

    showTelegraph(attack) {
      if (!attack || this.activeTelegraphId === attack.id || this.mode !== 'raid') return;
      this.clearTelegraph();
      this.activeTelegraphId = attack.id;

      if (attack.type === 'left_slam') {
        this.telegraphGraphics.fillStyle(0xff4b56, 0.30);
        this.telegraphGraphics.fillRect(0, 278, WORLD_WIDTH / 2, WORLD_HEIGHT - 278);
        this.warningText.setText('LEFT SIDE DANGER  •  MOVE RIGHT');
      } else if (attack.type === 'right_slam') {
        this.telegraphGraphics.fillStyle(0xff4b56, 0.30);
        this.telegraphGraphics.fillRect(WORLD_WIDTH / 2, 278, WORLD_WIDTH / 2, WORLD_HEIGHT - 278);
        this.warningText.setText('RIGHT SIDE DANGER  •  MOVE LEFT');
      } else {
        this.telegraphGraphics.lineStyle(5, 0xffc857, 0.8);
        this.telegraphGraphics.strokeEllipse(WORLD_WIDTH / 2, GROUND_Y, 100, 24);
        this.warningText.setText('SHOCKWAVE INCOMING  •  JUMP');
      }

      this.warningText.setVisible(true);
      this.telegraphGraphics.setAlpha(0.58);
      this.telegraphTween = this.tweens.add({
        targets: this.telegraphGraphics, alpha: 0.82, duration: 300, yoyo: true, repeat: -1
      });
    }

    clearTelegraph() {
      this.telegraphTween?.stop();
      this.telegraphTween = null;
      this.activeTelegraphId = null;
      this.telegraphGraphics?.clear();
      this.warningText?.setVisible(false);
    }

    resolveBossAttack(payload) {
      this.clearTelegraph();
      if (payload.damage > 0) this.cameras.main.shake(130, 0.004);

      if (payload.attackType === 'shockwave') {
        const wave = this.add.ellipse(WORLD_WIDTH / 2, GROUND_Y + 5, 70, 12, 0xffd36a, 0.16)
          .setStrokeStyle(3, 0xffd36a, 0.75).setDepth(17);
        this.tweens.add({
          targets: wave, scaleX: 10, alpha: 0, duration: 300,
          onComplete: () => wave.destroy()
        });
      }

      for (const id of payload.hitPlayerIds || []) {
        const entry = this.players.get(id);
        if (!entry) continue;
        entry.sprite.setTintFill(0xff8c8c);
        this.time.delayedCall(120, () => entry.sprite.clearTint());
      }

      if ((payload.dodgedPlayerIds || []).includes(bridge.localPlayerId)) {
        const local = this.players.get(bridge.localPlayerId);
        if (local) this.floatText(local.sprite.x, local.sprite.y - 58, 'DODGE!', '#72ddff', 12);
      }
    }

    setDazed(id, until) {
      const entry = this.players.get(id);
      if (!entry) return;
      entry.dazedUntil = until;
      entry.sprite.setAlpha(0.55).setTint(0xffdd77);
      this.time.delayedCall(Math.max(0, until - Date.now()), () => {
        if (!entry.sprite.active) return;
        entry.sprite.setAlpha(1).clearTint();
      });
    }

    complete(outcome) {
      this.clearTelegraph();
      if (outcome === 'victory') {
        this.cameras.main.flash(220, 180, 255, 205, false);
        this.tweens.add({ targets: this.boss, y: WORLD_HEIGHT + 80, alpha: 0, duration: 650 });
      } else {
        this.cameras.main.fade(400, 95, 18, 22, false);
      }
    }

    floatText(x, y, text, color, fontSize = 15) {
      const node = this.add.text(x, y, text, {
        fontFamily: 'system-ui, sans-serif', fontSize: `${fontSize}px`, fontStyle: 'bold', color
      }).setOrigin(0.5).setDepth(19);
      this.tweens.add({
        targets: node, y: y - 35, alpha: 0, duration: 520,
        onComplete: () => node.destroy()
      });
    }

    update(time) {
      const local = this.players.get(bridge.localPlayerId);
      if (local?.sprite?.body) this.updateLocalPlayer(local, time);

      for (const entry of this.players.values()) {
        if (entry.isLocal && entry.sprite.body) {
          entry.shadow.x = entry.sprite.x;
          entry.label.x = entry.sprite.x;
          entry.label.y = entry.sprite.y + 50;
          const airborne = Math.max(0, GROUND_Y - 28 - entry.sprite.y);
          const shadowScale = clamp(1 - airborne / 180, 0.62, 1);
          entry.shadow.setScale(shadowScale, shadowScale);
        } else {
          const delta = entry.targetX - entry.sprite.x;
          if (Math.abs(delta) > 0.2) entry.sprite.x += delta * 0.24;
          else entry.sprite.x = entry.targetX;
          entry.shadow.x = entry.sprite.x;
          entry.label.x = entry.sprite.x;
          if (!entry.jumpingTween) entry.sprite.y = GROUND_Y - 28;
          entry.label.y = entry.sprite.y + 50;
        }
      }
    }

    updateLocalPlayer(entry, time) {
      const body = entry.sprite.body;
      const left = this.externalInput.left || this.cursors.left.isDown || this.keys.left.isDown;
      const right = this.externalInput.right || this.cursors.right.isDown || this.keys.right.isDown;
      const direction = left === right ? 0 : left ? -1 : 1;

      if (direction !== 0) {
        body.setAccelerationX(direction * PLAYER_ACCELERATION);
        body.setDragX(0);
        this.applyFacing(entry, direction < 0 ? 'left' : 'right');
      } else {
        body.setAccelerationX(0);
        body.setDragX(PLAYER_DRAG);
      }

      const keyboardJump = this.cursors.up.isDown || this.cursors.space.isDown || this.keys.jump.isDown;
      const wantsJump = keyboardJump || this.externalInput.jumpPulse;
      const grounded = body.blocked.down || body.touching.down;

      if (wantsJump && !this.jumpWasDown && grounded) {
        body.setVelocityY(JUMP_VELOCITY);
        onJump();
      }
      this.jumpWasDown = wantsJump;
      this.externalInput.jumpPulse = false;

      if (time - this.lastPositionSentAt >= POSITION_SEND_INTERVAL) {
        const pct = clamp(worldToPct(entry.sprite.x), 4, 96);
        if (this.lastSentPct === null || Math.abs(pct - this.lastSentPct) > 0.1 || direction !== 0) {
          onPosition({ x: pct, facing: entry.facing });
          this.lastSentPct = pct;
        }
        this.lastPositionSentAt = time;
      }
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    resolution: 1,
    backgroundColor: '#08111f',
    transparent: false,
    antialias: false,
    pixelArt: true,
    roundPixels: true,
    fps: {
      target: 60,
      min: 30,
      forceSetTimeOut: false
    },
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { y: 900 },
        debug: false
      }
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT
    },
    scene: RaidScene
  });

  return {
    game,
    setLocalPlayerId(id) {
      bridge.localPlayerId = id;
    },
    syncState(state) {
      bridge.pendingState = state;
      bridge.mode = state?.status === 'lobby' ? 'lobby' : 'raid';
      bridge.scene?.syncState(state);
    },
    setMode(mode) {
      bridge.mode = mode === 'lobby' ? 'lobby' : 'raid';
      bridge.scene?.setMode(bridge.mode);
    },
    movePlayer(id, x, facing) {
      bridge.scene?.movePlayer(id, x, facing);
    },
    jumpPlayer(id) {
      bridge.scene?.jumpPlayer(id);
    },
    playerAction(action) {
      bridge.scene?.playerAction(action);
    },
    showTelegraph(attack) {
      bridge.scene?.showTelegraph(attack);
    },
    resolveBossAttack(payload) {
      bridge.scene?.resolveBossAttack(payload);
    },
    setDazed(id, until) {
      bridge.scene?.setDazed(id, until);
    },
    complete(outcome) {
      bridge.scene?.complete(outcome);
    },
    setMoveButton(direction, active) {
      const scene = bridge.scene;
      if (!scene) return;
      if (direction === 'left') scene.externalInput.left = active;
      if (direction === 'right') scene.externalInput.right = active;
    },
    jump() {
      const scene = bridge.scene;
      if (!scene) return;
      scene.externalInput.jumpPulse = true;
    },
    resetInput() {
      const scene = bridge.scene;
      if (!scene) return;
      scene.externalInput.left = false;
      scene.externalInput.right = false;
      scene.externalInput.jumpPulse = false;
    }
  };
}
