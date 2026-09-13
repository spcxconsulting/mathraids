import { RaidRoom as ConfigurableRaidRoom } from './raid-room-configurable.js';
import {
  attackEveryForAggression,
  chooseAttack,
  hardcorePlayerDamageForPower
} from './bosses.js';
import { publicQuestion } from './questions.js';

const HARDCORE_PLAYER_HEALTH = 100;
const HEALER_ANSWER_HEAL = 8;
const RENEWAL_BURST_HEAL = 20;

function decodeMessage(message) {
  try {
    return JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
  } catch {
    return null;
  }
}

export class RaidRoom extends ConfigurableRaidRoom {
  isHardcore() {
    return this.room?.config?.mode === 'hardcore';
  }

  ensureHardcorePlayer(player) {
    if (!player || !this.isHardcore()) return player;
    player.maxHealth = Math.max(1, Number(player.maxHealth) || HARDCORE_PLAYER_HEALTH);
    player.health = Math.min(player.maxHealth, Math.max(0, Number.isFinite(Number(player.health)) ? Number(player.health) : player.maxHealth));
    player.knockedOut = Boolean(player.knockedOut || player.health <= 0);
    if (player.knockedOut) player.health = 0;
    return player;
  }

  livingPlayers() {
    return Object.values(this.room?.players || {})
      .map((player) => this.ensureHardcorePlayer(player))
      .filter((player) => !player.knockedOut && player.health > 0);
  }

  async createRoom(request) {
    const body = await request.clone().json().catch(() => ({}));
    const response = await super.createRoom(request);
    if (!response.ok || !this.room) return response;

    if (body.mode === 'hardcore') {
      this.room.config.mode = 'hardcore';
      this.room.version = Math.max(Number(this.room.version) || 0, 6);
      await this.saveRoom();
    }
    return response;
  }

  async startRaid() {
    const result = await super.startRaid();
    if (!result?.ok || !this.room || !this.isHardcore()) return result;

    for (const player of Object.values(this.room.players)) {
      player.maxHealth = HARDCORE_PLAYER_HEALTH;
      player.health = HARDCORE_PLAYER_HEALTH;
      player.knockedOut = false;
    }

    await this.saveRoom();
    this.broadcastPublic();
    this.sendTeacherState();
    return result;
  }

  async webSocketMessage(ws, message) {
    const event = decodeMessage(message);
    const attachment = ws.deserializeAttachment();

    if (this.isHardcore() && event && attachment?.role === 'student') {
      const player = this.room?.players?.[attachment.playerId];
      this.ensureHardcorePlayer(player);

      if (player?.knockedOut && ['answer', 'special', 'position', 'move', 'jump'].includes(event.type)) {
        this.safeSend(ws, { type: 'player_knocked_out', playerId: player.id });
        return;
      }

      if (event.type === 'special' && player) {
        await this.handleHardcoreSpecial(ws, player);
        return;
      }
    }

    return super.webSocketMessage(ws, message);
  }

  healMostInjured(amount) {
    const targets = this.livingPlayers()
      .filter((player) => player.health < player.maxHealth)
      .sort((a, b) => (a.health / a.maxHealth) - (b.health / b.maxHealth));
    const target = targets[0];
    if (!target) return { healing: 0, healedPlayerIds: [] };

    const before = target.health;
    target.health = Math.min(target.maxHealth, target.health + amount);
    return {
      healing: target.health - before,
      healedPlayerIds: [target.id]
    };
  }

  healLivingGroup(amount) {
    let healing = 0;
    const healedPlayerIds = [];
    for (const player of this.livingPlayers()) {
      if (player.health >= player.maxHealth) continue;
      const before = player.health;
      player.health = Math.min(player.maxHealth, player.health + amount);
      const restored = player.health - before;
      if (restored > 0) {
        healing += restored;
        healedPlayerIds.push(player.id);
      }
    }
    return { healing, healedPlayerIds };
  }

  async handleAnswer(ws, player, event) {
    if (!this.isHardcore()) return super.handleAnswer(ws, player, event);
    this.ensureHardcorePlayer(player);
    if (player.knockedOut || this.room.status !== 'running' || !player.currentQuestion) return;

    const now = Date.now();
    if (player.stunnedUntil > now) {
      this.safeSend(ws, { type: 'stunned', until: player.stunnedUntil });
      return;
    }

    const question = player.currentQuestion;
    if (event.questionId !== question.id) return;

    const answer = Number(event.answer);
    const correct = answer === question.correctAnswer;
    const responseMs = Math.max(0, now - question.issuedAt);

    player.attempted += 1;
    player.totalResponseMs += responseMs;
    this.room.team.questions += 1;

    let damage = 0;
    let healing = 0;
    let healedPlayerIds = [];

    if (correct) {
      player.correct += 1;
      player.wrongTimestamps = [];
      this.room.team.correct += 1;

      if (player.class === 'healer') {
        damage = 6;
        const healed = this.healMostInjured(HEALER_ANSWER_HEAL);
        healing = healed.healing;
        healedPlayerIds = healed.healedPlayerIds;
      } else {
        damage = 10;
      }

      this.room.boss.health = Math.max(0, this.room.boss.health - damage);

      this.broadcast({
        type: 'player_action',
        action: player.class === 'healer' ? 'heal' : 'attack',
        playerId: player.id,
        damage,
        healing,
        healedPlayerIds,
        bossHealth: this.room.boss.health
      });

      const playerCount = Object.keys(this.room.players).length;
      const attackEvery = attackEveryForAggression(playerCount, this.bossTuning().aggression);
      if (!this.room.pendingAttack && this.room.boss.health > 0 && this.room.team.correct % attackEvery === 0) {
        this.room.boss.nextAttackAt = null;
        await this.scheduleBossAttack();
      }
    } else {
      player.wrong += 1;
      player.wrongTimestamps = player.wrongTimestamps.filter((timestamp) => timestamp >= now - 6000);
      player.wrongTimestamps.push(now);

      if (player.wrongTimestamps.length >= 3) {
        player.stunnedUntil = now + 2000;
        player.wrongTimestamps = [];
      }
    }

    if (this.room.boss.health <= 0) {
      await this.finishRaid('victory');
    } else if (!player.knockedOut) {
      player.currentQuestion = this.newQuestion();
    }

    await this.saveRoom();

    this.safeSend(ws, {
      type: 'answer_result',
      correct,
      correctAnswer: question.correctAnswer,
      damage,
      healing,
      stunnedUntil: player.stunnedUntil > now ? player.stunnedUntil : null,
      nextQuestion: this.room.status === 'running' && !player.knockedOut ? publicQuestion(player.currentQuestion) : null
    });

    this.broadcastPublic();
    this.sendTeacherState();

    if (this.room.status === 'complete') {
      this.broadcast({ type: 'raid_complete', outcome: this.room.outcome, state: this.publicState() });
    }
  }

  async handleHardcoreSpecial(ws, player) {
    if (this.room.status !== 'running' || player.knockedOut) return;

    const now = Date.now();
    if (player.stunnedUntil > now) {
      this.safeSend(ws, { type: 'stunned', until: player.stunnedUntil });
      return;
    }

    player.streak ??= 0;
    player.specialReady ??= false;
    if (!player.specialReady) {
      this.sendPowerStateToPlayer(player);
      return;
    }

    const healer = player.class === 'healer';
    const ability = healer
      ? { id: 'renewal_burst', name: 'Renewal Burst', damage: 15 }
      : { id: 'power_shot', name: 'Power Shot', damage: 35 };

    player.specialReady = false;
    player.streak = 0;
    this.room.boss.health = Math.max(0, this.room.boss.health - ability.damage);

    let healing = 0;
    let healedPlayerIds = [];
    if (healer) {
      const healed = this.healLivingGroup(RENEWAL_BURST_HEAL);
      healing = healed.healing;
      healedPlayerIds = healed.healedPlayerIds;
    }

    this.broadcast({
      type: 'player_special',
      playerId: player.id,
      class: player.class,
      ability: ability.id,
      abilityName: ability.name,
      damage: ability.damage,
      healing,
      healedPlayerIds,
      bossHealth: this.room.boss.health
    });

    if (this.room.boss.health <= 0) await this.finishRaid('victory');

    await this.saveRoom();
    this.sendPowerStateToPlayer(player);
    this.safeSend(ws, {
      type: 'special_result',
      ability: ability.id,
      abilityName: ability.name,
      damage: ability.damage,
      healing
    });
    this.broadcastPublic();
    this.sendTeacherState();

    if (this.room.status === 'complete') {
      this.broadcast({ type: 'raid_complete', outcome: this.room.outcome, state: this.publicState() });
    }
  }

  async scheduleBossAttack() {
    if (!this.isHardcore()) return super.scheduleBossAttack();
    if (!this.room || this.room.status !== 'running' || this.room.pendingAttack || this.room.boss.health <= 0) return;

    const now = Date.now();
    const tuning = this.bossTuning();
    const pending = {
      id: crypto.randomUUID(),
      type: chooseAttack(this.bossDefinition()),
      warnedAt: now,
      executeAt: now + tuning.warningMs
    };

    this.room.boss.nextAttackAt = null;
    this.room.pendingAttack = pending;
    await this.saveRoom();
    await this.ctx.storage.setAlarm(pending.executeAt);
    this.broadcast({ type: 'boss_telegraph', attack: pending });
    this.broadcastPublic();
  }

  async alarm() {
    if (!this.isHardcore()) return super.alarm();
    if (!this.room || this.room.status !== 'running') return;

    if (!this.room.pendingAttack) {
      const nextAttackAt = Number(this.room.boss.nextAttackAt) || 0;
      if (!nextAttackAt) {
        await this.armNextBossAttack(false);
        return;
      }
      if (Date.now() + 50 < nextAttackAt) {
        await this.ctx.storage.setAlarm(nextAttackAt);
        return;
      }
      this.room.boss.nextAttackAt = null;
      await this.scheduleBossAttack();
      return;
    }

    const attack = this.room.pendingAttack;
    const living = this.livingPlayers();
    const hitPlayerIds = [];
    const dodgedPlayerIds = [];
    const knockedOutPlayerIds = [];
    const damage = hardcorePlayerDamageForPower(this.bossTuning().attackPower);

    for (const player of living) {
      let hit = false;
      if (attack.type === 'left_slam') hit = player.x < 50;
      if (attack.type === 'right_slam') hit = player.x >= 50;
      if (attack.type === 'shockwave') hit = (player.airborneUntil || 0) < attack.executeAt;

      if (hit) {
        hitPlayerIds.push(player.id);
        player.health = Math.max(0, player.health - damage);
        if (player.health <= 0) {
          player.knockedOut = true;
          player.currentQuestion = null;
          knockedOutPlayerIds.push(player.id);
        }
      } else {
        dodgedPlayerIds.push(player.id);
      }
    }

    this.room.pendingAttack = null;
    this.room.team.bossAttacks += 1;
    this.room.team.bossHits += hitPlayerIds.length;
    this.room.team.dodges += dodgedPlayerIds.length;

    const survivors = this.livingPlayers();
    if (!survivors.length && Object.keys(this.room.players).length > 0) {
      await this.finishRaid('wipe');
    }

    await this.saveRoom();

    this.broadcast({
      type: 'boss_attack',
      attackType: attack.type,
      damage,
      hitPlayerIds,
      dodgedPlayerIds,
      knockedOutPlayerIds,
      hardcore: true
    });
    this.broadcastPublic();
    this.sendTeacherState();

    if (this.room.status === 'complete') {
      this.broadcast({ type: 'raid_complete', outcome: this.room.outcome, state: this.publicState() });
      return;
    }

    await this.armNextBossAttack(false);
  }

  publicState() {
    const state = super.publicState();
    if (!state || !this.isHardcore()) return state;

    const players = Object.values(this.room.players).map((player) => this.ensureHardcorePlayer(player));
    const totalHealth = players.reduce((sum, player) => sum + player.health, 0);
    const totalMaxHealth = players.reduce((sum, player) => sum + player.maxHealth, 0) || HARDCORE_PLAYER_HEALTH;
    const alivePlayers = players.filter((player) => !player.knockedOut && player.health > 0).length;

    state.hardcore = true;
    state.raidHealth = totalHealth;
    state.maxRaidHealth = totalMaxHealth;
    state.alivePlayers = alivePlayers;
    state.players = state.players.map((publicPlayer) => {
      const player = this.ensureHardcorePlayer(this.room.players[publicPlayer.id]);
      return {
        ...publicPlayer,
        health: player.health,
        maxHealth: player.maxHealth,
        knockedOut: player.knockedOut
      };
    });
    return state;
  }
}