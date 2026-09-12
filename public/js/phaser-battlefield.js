import * as Phaser from '/vendor/phaser.esm.js';

const WORLD_WIDTH = 1200;
const WORLD_HEIGHT = 500;
const GROUND_Y = 405;
const PLAYER_SPEED = 235;
const PLAYER_ACCELERATION = 1550;
const PLAYER_DRAG = 1900;
const JUMP_VELOCITY = -430;
const POSITION_SEND_INTERVAL = 110;

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
    }

    create() {
      bridge.scene = this;
      this.physics.world.setBounds(42, 0, WORLD_WIDTH - 84, WORLD_HEIGHT);
      this.createBackdrop();
      this.createPerspectiveFloor();
      this.createLobbySet();
      this.createBoss();
      this.createTelegraphLayer();
      this.createGroundCollider();

      this.cursors = this.input.keyboard.createCursorKeys();
      this.keys = this.input.keyboard.addKeys({
        left: 'A',
        right: 'D',
        jump: 'W'
      });

      this.cameras.main.setBackgroundColor('#08111f');
      this.cameras.main.setRoundPixels(false);

      this.setMode(bridge.mode, true);
      if (bridge.pendingState) this.syncState(bridge.pendingState);

      this.scale.on('resize', () => {
        this.cameras.main.setViewport(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      });
    }

    createBackdrop() {
      this.add.rectangle(600, 250, 1200, 500, 0x08162b).setDepth(-20);
      this.add.rectangle(600, 205, 1200, 310, 0x102a4a, 0.95).setDepth(-19);
      this.add.rectangle(600, 345, 1200, 210, 0x18293c, 1).setDepth(-18);

      this.moon = this.add.circle(1010, 92, 48, 0xfff1bd, 0.94).setDepth(-17);
      this.add.circle(1000, 82, 60, 0xfff4cb, 0.07).setDepth(-18);

      this.starLayer = this.add.container(0, 0).setDepth(-16);
      for (let i = 0; i < 52; i += 1) {
        const x = (i * 137 + 43) % 1200;
        const y = 22 + ((i * 67) % 205);
        const radius = i % 7 === 0 ? 1.8 : 1;
        const star = this.add.circle(x, y, radius, 0xffffff, i % 4 === 0 ? 0.75 : 0.42);
        this.starLayer.add(star);
      }

      this.farCity = this.add.container(0, 0).setDepth(-12);
      for (let x = -10, i = 0; x < 1220; i += 1) {
        const width = 44 + ((i * 23) % 58);
        const height = 65 + ((i * 41) % 115);
        const building = this.add.rectangle(x + width / 2, 326 - height / 2, width, height, i % 3 === 0 ? 0x17253a : 0x121e31, 0.95);
        this.farCity.add(building);
        if (i % 2 === 0) {
          for (let wy = 0; wy < Math.min(4, Math.floor(height / 28)); wy += 1) {
            const windowDot = this.add.rectangle(x + 12 + ((wy * 17) % Math.max(16, width - 20)), 306 - wy * 26, 5, 7, 0xffcf72, 0.35);
            this.farCity.add(windowDot);
          }
        }
        x += width + 5;
      }

      this.nearCity = this.add.container(0, 0).setDepth(-8);
      const silhouettes = [
        [40, 287, 108, 115], [168, 308, 78, 74], [266, 271, 120, 148],
        [414, 310, 94, 72], [760, 300, 105, 90], [885, 258, 120, 174],
        [1035, 302, 84, 84], [1138, 276, 78, 134]
      ];
      for (const [x, y, w, h] of silhouettes) {
        this.nearCity.add(this.add.rectangle(x, y, w, h, 0x0c1522, 0.98));
      }

      this.haze = this.add.rectangle(600, 315, 1200, 90, 0x7ca2be, 0.06).setDepth(-7);
    }

    createPerspectiveFloor() {
      this.floor = this.add.polygon(600, 420, [
        125, -66,
        1075, -66,
        1200, 82,
        0, 82
      ], 0x263442, 1).setDepth(0);

      const grid = this.add.graphics().setDepth(1);
      grid.lineStyle(2, 0xc9e2ef, 0.09);
      for (let i = 0; i <= 12; i += 1) {
        const topX = 125 + (950 / 12) * i;
        const bottomX = (1200 / 12) * i;
        grid.lineBetween(topX, 354, bottomX, 500);
      }
      for (let i = 0; i < 6; i += 1) {
        const t = i / 5;
        const y = 354 + Math.pow(t, 1.6) * 146;
        const left = 125 * (1 - t);
        const right = 1075 + 125 * t;
        grid.lineBetween(left, y, right, y);
      }

      this.add.rectangle(600, 473, 1200, 54, 0x101820, 0.72).setDepth(2);
      this.add.rectangle(600, 447, 1200, 3, 0x91b4c7, 0.13).setDepth(3);

      this.foreground = this.add.container(0, 0).setDepth(30);
      this.foreground.add(this.add.polygon(72, 462, [-90, 45, 40, -18, 138, 42], 0x0a1119, 0.92));
      this.foreground.add(this.add.polygon(1130, 466, [-95, 42, -20, -22, 108, 44], 0x0a1119, 0.92));
    }

    createGroundCollider() {
      this.groundCollider = this.add.rectangle(600, 451, 1200, 80, 0x000000, 0).setDepth(-30);
      this.physics.add.existing(this.groundCollider, true);
    }

    createLobbySet() {
      this.lobbyGroup = this.add.container(0, 0).setDepth(6);

      const portalGlow = this.add.ellipse(925, 280, 170, 245, 0x66d7ff, 0.10);
      const portalOuter = this.add.ellipse(925, 280, 132, 206, 0x111a2c, 0.92).setStrokeStyle(10, 0x7a79ff, 0.9);
      const portalInner = this.add.ellipse(925, 280, 94, 162, 0x3a5aff, 0.28).setStrokeStyle(4, 0x7ee7ff, 0.78);
      const portalCore = this.add.ellipse(925, 280, 66, 132, 0x73dfff, 0.22);
      const portalLabel = this.add.text(925, 408, 'CITY UNDER SIEGE', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#cbeeff',
        letterSpacing: 2
      }).setOrigin(0.5);

      const campShadow = this.add.ellipse(250, 405, 120, 24, 0x000000, 0.32);
      const camp = this.add.text(250, 371, '🔥', { fontSize: '48px' }).setOrigin(0.5);
      const crateA = this.add.rectangle(118, 390, 72, 56, 0x6a4a2a, 1).setStrokeStyle(4, 0x9b7041, 1).setRotation(-0.04);
      const crateB = this.add.rectangle(1035, 398, 78, 52, 0x5d432b, 1).setStrokeStyle(4, 0x92704d, 1).setRotation(0.05);
      const title = this.add.text(600, 62, 'RAID STAGING AREA', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '24px',
        fontStyle: '900',
        color: '#eaf7ff',
        stroke: '#07101c',
        strokeThickness: 6
      }).setOrigin(0.5);
      const sub = this.add.text(600, 92, 'Move around while the rest of the raid assembles', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#a9c7d8'
      }).setOrigin(0.5);

      this.lobbyGroup.add([portalGlow, portalOuter, portalInner, portalCore, portalLabel, campShadow, camp, crateA, crateB, title, sub]);

      this.tweens.add({ targets: portalInner, scaleX: 1.08, scaleY: 1.04, alpha: 0.92, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.tweens.add({ targets: portalGlow, scale: 1.18, alpha: 0.18, duration: 1250, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.tweens.add({ targets: camp, y: 365, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    createBoss() {
      this.boss = this.add.container(600, 280).setDepth(8);
      const shadow = this.add.ellipse(0, 128, 220, 42, 0x000000, 0.42);
      const tail = this.add.polygon(-82, 54, [-20, -12, -92, 25, -8, 30], 0x376b59, 1).setRotation(-0.12);
      const body = this.add.ellipse(0, 38, 156, 176, 0x407b63, 1).setStrokeStyle(7, 0x24483d, 1);
      const belly = this.add.ellipse(8, 58, 82, 108, 0x77a874, 0.92);
      const head = this.add.circle(10, -60, 72, 0x4b8d70, 1).setStrokeStyle(7, 0x24483d, 1);
      const jaw = this.add.ellipse(20, -34, 88, 48, 0x5a9877, 1);
      const eyeL = this.add.circle(-15, -79, 8, 0xffe083, 1);
      const eyeR = this.add.circle(30, -79, 8, 0xffe083, 1);
      const pupilL = this.add.circle(-13, -79, 3.5, 0x15201d, 1);
      const pupilR = this.add.circle(32, -79, 3.5, 0x15201d, 1);
      const armL = this.add.rectangle(-79, 5, 34, 88, 0x376b59, 1).setRotation(0.42);
      const armR = this.add.rectangle(82, 8, 34, 88, 0x376b59, 1).setRotation(-0.42);
      const spike1 = this.add.triangle(-54, -119, 0, 26, 15, 0, 29, 26, 0x9ad19a, 1).setRotation(-0.34);
      const spike2 = this.add.triangle(3, -139, 0, 30, 16, 0, 32, 30, 0x9ad19a, 1);
      const spike3 = this.add.triangle(55, -116, 0, 26, 15, 0, 29, 26, 0x9ad19a, 1).setRotation(0.34);
      const name = this.add.text(0, -166, 'NUMBERZILLA', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        fontStyle: '900',
        color: '#effff0',
        stroke: '#08111f',
        strokeThickness: 6
      }).setOrigin(0.5);

      this.boss.add([shadow, tail, body, belly, armL, armR, head, jaw, eyeL, eyeR, pupilL, pupilR, spike1, spike2, spike3, name]);
      this.boss.setScale(1.1);
      this.tweens.add({ targets: this.boss, y: 274, angle: 0.8, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    createTelegraphLayer() {
      this.telegraphGraphics = this.add.graphics().setDepth(4);
      this.warningText = this.add.text(600, 36, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '22px',
        fontStyle: '900',
        align: 'center',
        color: '#fff1b2',
        stroke: '#401615',
        strokeThickness: 8
      }).setOrigin(0.5).setDepth(40).setVisible(false);
    }

    createPlayer(player) {
      const isLocal = player.id === bridge.localPlayerId;
      const x = pctToWorld(player.x);
      const shadow = this.add.ellipse(x, GROUND_Y + 25, 48, 15, 0x000000, isLocal ? 0.46 : 0.32).setDepth(11);
      const root = this.add.container(x, GROUND_Y - 4).setDepth(isLocal ? 18 : 14);
      const actor = this.add.container(0, 0);

      const roleColor = player.class === 'healer' ? 0x4fa07f : 0x547eb3;
      const roleDark = player.class === 'healer' ? 0x255a4b : 0x2d4568;
      const cape = this.add.polygon(-6, -10, [-17, -18, 15, -18, 22, 25, -20, 25], roleDark, 1);
      const legs = this.add.rectangle(0, 13, 24, 26, 0x27354a, 1).setStrokeStyle(3, 0x172233, 1);
      const torso = this.add.rectangle(0, -10, 38, 42, roleColor, 1).setStrokeStyle(4, roleDark, 1);
      const head = this.add.circle(0, -43, 17, 0xe0b58a, 1).setStrokeStyle(4, 0x3c2d2a, 1);
      const hair = this.add.arc(0, -49, 17, 190, 350, false, 0x3a2c2a, 1);
      const weapon = player.class === 'healer'
        ? this.add.rectangle(25, -17, 5, 56, 0xaadcc5, 1).setRotation(0.22)
        : this.add.arc(24, -11, 19, -75, 75, false, 0xd8bc75, 1).setStrokeStyle(4, 0xd8bc75, 1);
      const roleGlyph = this.add.text(0, -11, player.class === 'healer' ? '✦' : '➶', {
        fontSize: '16px', color: '#ffffff', fontStyle: 'bold'
      }).setOrigin(0.5);

      actor.add([cape, legs, torso, head, hair, weapon, roleGlyph]);
      root.add(actor);

      if (isLocal) {
        const localRing = this.add.ellipse(0, 25, 58, 18, 0x8aff80, 0.12).setStrokeStyle(2, 0x8aff80, 0.7);
        root.addAt(localRing, 0);
      }

      const label = this.add.text(0, 38, isLocal ? `${player.name} (you)` : player.name, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color: isLocal ? '#aaff9c' : '#eef6ff',
        stroke: '#07101c',
        strokeThickness: 4
      }).setOrigin(0.5, 0);
      root.add(label);

      const entry = {
        id: player.id,
        root,
        actor,
        shadow,
        label,
        class: player.class,
        facing: player.facing || 'right',
        targetX: x,
        isLocal,
        bodyObject: null,
        jumpingTween: null,
        dazedUntil: 0
      };

      if (isLocal) {
        const bodyObject = this.add.rectangle(x, GROUND_Y - 23, 30, 54, 0xffffff, 0);
        this.physics.add.existing(bodyObject);
        bodyObject.body.setCollideWorldBounds(true);
        bodyObject.body.setMaxVelocity(PLAYER_SPEED, 700);
        bodyObject.body.setDragX(PLAYER_DRAG);
        this.physics.add.collider(bodyObject, this.groundCollider);
        entry.bodyObject = bodyObject;
      }

      this.players.set(player.id, entry);
      this.applyFacing(entry, entry.facing);
      return entry;
    }

    removePlayer(id) {
      const entry = this.players.get(id);
      if (!entry) return;
      entry.root.destroy(true);
      entry.shadow.destroy();
      entry.bodyObject?.destroy();
      this.players.delete(id);
    }

    syncState(state) {
      if (!state) return;
      const activeIds = new Set(state.players.map((player) => player.id));
      for (const id of this.players.keys()) {
        if (!activeIds.has(id)) this.removePlayer(id);
      }

      for (const player of state.players) {
        let entry = this.players.get(player.id);
        if (!entry) entry = this.createPlayer(player);
        entry.targetX = pctToWorld(player.x);
        this.applyFacing(entry, player.facing || 'right');

        if (entry.isLocal && entry.bodyObject) {
          const delta = entry.targetX - entry.bodyObject.x;
          if (Math.abs(delta) > 95) entry.bodyObject.x += delta * 0.32;
        }
      }

      this.setMode(state.status === 'lobby' ? 'lobby' : 'raid');
      if (state.pendingAttack && state.pendingAttack.executeAt > Date.now()) this.showTelegraph(state.pendingAttack);
    }

    setMode(mode, immediate = false) {
      const next = mode === 'lobby' ? 'lobby' : 'raid';
      if (!immediate && this.mode === next) return;
      const previous = this.mode;
      this.mode = next;

      if (next === 'lobby') {
        this.lobbyGroup.setVisible(true).setAlpha(1);
        this.boss.setVisible(false).setAlpha(0);
        this.warningText.setVisible(false);
      } else {
        this.lobbyGroup.setVisible(false);
        this.boss.setVisible(true);
        if (immediate || previous === 'raid') {
          this.boss.setAlpha(1).setScale(1.1);
        } else {
          this.cameras.main.flash(420, 126, 210, 255, false);
          this.boss.setAlpha(0).setScale(0.75);
          this.tweens.add({ targets: this.boss, alpha: 1, scale: 1.1, duration: 650, ease: 'Back.easeOut' });
        }
      }
    }

    movePlayer(id, xPct, facing) {
      const entry = this.players.get(id);
      if (!entry) return;
      entry.targetX = pctToWorld(xPct);
      this.applyFacing(entry, facing);
      if (entry.isLocal && entry.bodyObject) {
        const delta = entry.targetX - entry.bodyObject.x;
        if (Math.abs(delta) > 110) entry.bodyObject.x += delta * 0.25;
      }
    }

    jumpPlayer(id) {
      const entry = this.players.get(id);
      if (!entry || entry.isLocal) return;
      entry.jumpingTween?.stop();
      entry.jumpingTween = this.tweens.add({
        targets: entry.root,
        y: GROUND_Y - 82,
        duration: 300,
        yoyo: true,
        ease: 'Sine.easeOut',
        onComplete: () => { entry.root.y = GROUND_Y - 4; }
      });
      this.tweens.add({ targets: entry.shadow, scaleX: 0.65, alpha: 0.18, duration: 300, yoyo: true, ease: 'Sine.easeOut' });
    }

    applyFacing(entry, facing) {
      entry.facing = facing === 'left' ? 'left' : 'right';
      entry.actor.scaleX = entry.facing === 'left' ? -1 : 1;
    }

    playerAction(action) {
      const entry = this.players.get(action.playerId);
      if (!entry || !this.boss.visible) return;
      const startX = entry.root.x + (entry.facing === 'left' ? -12 : 12);
      const startY = entry.root.y - 28;
      const endX = this.boss.x;
      const endY = this.boss.y - 58;
      const healer = action.action === 'heal';

      entry.actor.setScale(1.06);
      this.tweens.add({ targets: entry.actor, scaleY: 0.96, duration: 90, yoyo: true, onComplete: () => entry.actor.setScale(entry.facing === 'left' ? -1 : 1, 1) });

      const projectile = healer
        ? this.add.circle(startX, startY, 10, 0x8aff80, 1).setStrokeStyle(3, 0xeaffdf, 0.9)
        : this.add.rectangle(startX, startY, 24, 7, 0xffc46a, 1);
      projectile.setDepth(24);

      if (healer) {
        const pulse = this.add.circle(entry.root.x, GROUND_Y - 15, 22, 0x8aff80, 0.12).setStrokeStyle(3, 0x8aff80, 0.7).setDepth(13);
        this.tweens.add({ targets: pulse, scale: 3, alpha: 0, duration: 520, onComplete: () => pulse.destroy() });
        this.floatText(entry.root.x, entry.root.y - 72, `+${action.healing}`, '#9dff91');
      }

      this.tweens.add({
        targets: projectile,
        x: endX,
        y: endY,
        angle: healer ? 0 : -12,
        scale: healer ? 0.72 : 1.15,
        duration: healer ? 520 : 360,
        ease: 'Quad.easeIn',
        onComplete: () => {
          projectile.destroy();
          this.bossHit(action.damage, healer);
        }
      });
    }

    bossHit(damage, healer) {
      const ring = this.add.circle(this.boss.x, this.boss.y - 58, 18, healer ? 0x8aff80 : 0xffbd68, 0.08)
        .setStrokeStyle(5, healer ? 0x8aff80 : 0xffbd68, 0.95)
        .setDepth(25);
      this.tweens.add({ targets: ring, scale: 3.2, alpha: 0, duration: 320, onComplete: () => ring.destroy() });
      this.floatText(this.boss.x + 38, this.boss.y - 100, `-${damage}`, healer ? '#b8ffa9' : '#ffd080');
      this.tweens.add({ targets: this.boss, x: this.boss.x + 10, duration: 45, yoyo: true, repeat: 2, ease: 'Sine.easeInOut' });
      this.cameras.main.shake(90, 0.0025);
    }

    showTelegraph(attack) {
      if (!attack || this.activeTelegraphId === attack.id || this.mode !== 'raid') return;
      this.clearTelegraph();
      this.activeTelegraphId = attack.id;
      this.telegraphGraphics.clear();

      if (attack.type === 'left_slam') {
        this.telegraphGraphics.fillStyle(0xff4b56, 0.34);
        this.telegraphGraphics.fillPoints([{ x: 0, y: 354 }, { x: 600, y: 354 }, { x: 600, y: 500 }, { x: 0, y: 500 }], true);
        this.warningText.setText('LEFT SIDE DANGER  •  MOVE RIGHT');
      } else if (attack.type === 'right_slam') {
        this.telegraphGraphics.fillStyle(0xff4b56, 0.34);
        this.telegraphGraphics.fillPoints([{ x: 600, y: 354 }, { x: 1200, y: 354 }, { x: 1200, y: 500 }, { x: 600, y: 500 }], true);
        this.warningText.setText('RIGHT SIDE DANGER  •  MOVE LEFT');
      } else {
        this.telegraphGraphics.lineStyle(8, 0xffc857, 0.85);
        this.telegraphGraphics.strokeEllipse(600, 405, 130, 32);
        this.warningText.setText('SHOCKWAVE INCOMING  •  JUMP');
      }

      this.warningText.setVisible(true).setAlpha(1);
      this.telegraphGraphics.setAlpha(0.45);
      this.telegraphTween = this.tweens.add({ targets: this.telegraphGraphics, alpha: 0.9, duration: 230, yoyo: true, repeat: -1 });
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
      this.cameras.main.shake(payload.damage > 0 ? 260 : 120, payload.damage > 0 ? 0.009 : 0.003);
      this.tweens.add({ targets: this.boss, scaleX: 1.22, scaleY: 0.96, duration: 100, yoyo: true, ease: 'Back.easeOut' });

      if (payload.attackType === 'shockwave') {
        const wave = this.add.ellipse(600, GROUND_Y + 14, 90, 18, 0xffd36a, 0.12).setStrokeStyle(6, 0xffd36a, 0.88).setDepth(20);
        this.tweens.add({ targets: wave, scaleX: 14, scaleY: 3.2, alpha: 0, duration: 430, ease: 'Quad.easeOut', onComplete: () => wave.destroy() });
      }

      for (const id of payload.hitPlayerIds || []) {
        const entry = this.players.get(id);
        if (!entry) continue;
        this.tweens.add({ targets: entry.actor, angle: -10, x: -8, duration: 70, yoyo: true, repeat: 1 });
      }

      for (const id of payload.dodgedPlayerIds || []) {
        const entry = this.players.get(id);
        if (!entry) continue;
        this.floatText(entry.root.x, entry.root.y - 78, 'DODGE!', '#72ddff', 13);
      }
    }

    setDazed(id, until) {
      const entry = this.players.get(id);
      if (!entry) return;
      entry.dazedUntil = until;
      entry.actor.setAlpha(0.58);
      const stars = this.add.text(entry.root.x, entry.root.y - 88, '✦  ✦  ✦', { fontSize: '16px', color: '#ffd86b' }).setOrigin(0.5).setDepth(26);
      this.tweens.add({ targets: stars, angle: 18, y: stars.y - 9, duration: 260, yoyo: true, repeat: -1 });
      this.time.delayedCall(Math.max(0, until - Date.now()), () => {
        entry.actor.setAlpha(1);
        stars.destroy();
      });
    }

    complete(outcome) {
      this.clearTelegraph();
      if (outcome === 'victory') {
        this.cameras.main.flash(350, 180, 255, 205, false);
        this.tweens.add({
          targets: this.boss,
          angle: 17,
          y: 440,
          alpha: 0,
          duration: 1000,
          ease: 'Back.easeIn'
        });
      } else {
        this.cameras.main.fade(650, 95, 18, 22, false);
      }
    }

    floatText(x, y, text, color, fontSize = 18) {
      const node = this.add.text(x, y, text, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: `${fontSize}px`,
        fontStyle: '900',
        color,
        stroke: '#07101c',
        strokeThickness: 5
      }).setOrigin(0.5).setDepth(28);
      this.tweens.add({ targets: node, y: y - 54, alpha: 0, duration: 820, ease: 'Quad.easeOut', onComplete: () => node.destroy() });
    }

    update(time) {
      const local = this.players.get(bridge.localPlayerId);
      if (local?.bodyObject) this.updateLocalPlayer(local, time);

      for (const entry of this.players.values()) {
        if (entry.isLocal && entry.bodyObject) {
          entry.root.x = entry.bodyObject.x;
          entry.root.y = entry.bodyObject.y + 23;
          entry.shadow.x = entry.bodyObject.x;
          const height = Math.max(0, GROUND_Y - entry.root.y);
          const shadowScale = clamp(1 - height / 260, 0.55, 1);
          entry.shadow.setScale(shadowScale, shadowScale);
          entry.shadow.setAlpha(0.18 + shadowScale * 0.25);
        } else {
          entry.root.x += (entry.targetX - entry.root.x) * 0.18;
          entry.shadow.x = entry.root.x;
        }

        const moving = entry.isLocal
          ? Math.abs(entry.bodyObject?.body?.velocity?.x || 0) > 18
          : Math.abs(entry.targetX - entry.root.x) > 1.2;
        const bob = moving ? Math.sin(time / 72) * 2.2 : Math.sin(time / 520 + entry.root.x) * 0.9;
        if (!entry.jumpingTween && (!entry.isLocal || entry.bodyObject?.body?.blocked?.down)) entry.actor.y = bob;
        entry.actor.rotation = moving ? Math.sin(time / 95) * 0.025 : 0;
      }

      if (local) {
        const normalized = (local.root.x - 600) / 600;
        this.farCity.x += ((-normalized * 8) - this.farCity.x) * 0.025;
        this.nearCity.x += ((-normalized * 17) - this.nearCity.x) * 0.025;
        this.starLayer.x += ((-normalized * 3) - this.starLayer.x) * 0.02;
      }
    }

    updateLocalPlayer(entry, time) {
      const body = entry.bodyObject.body;
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
        const pct = clamp(worldToPct(entry.bodyObject.x), 4, 96);
        if (this.lastSentPct === null || Math.abs(pct - this.lastSentPct) > 0.08 || direction !== 0) {
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
    backgroundColor: '#08111f',
    transparent: false,
    antialias: true,
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { y: 980 },
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
