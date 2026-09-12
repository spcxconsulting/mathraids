import { RaidRoom as HostRaidRoom } from './raid-room-host.js';
import {
  attackDamageForPower,
  attackEveryForAggression,
  bossHealthForPlayers,
  chooseAttack,
  getBossDefinition,
  normaliseBossTuning
} from './bosses.js';
import { publicQuestion } from './questions.js';

function decodeMessage(message) {
  try {
    return JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
  } catch {
    return null;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class RaidRoom extends HostRaidRoom {
  bossDefinition() {
    return getBossDefinition(this.room?.config?.boss || this.room?.boss?.id || 'numberzilla');
  }

  bossTuning() {
    const definition = this.bossDefinition();
    return normaliseBossTuning(this.room?.boss?.tuning || {}, definition);
  }

  async createRoom(request) {
    const response = await super.createRoom(request);
    if (!response.ok || !this.room) return response;

    const definition = this.bossDefinition();
    this.room.version = Math.max(Number(this.room.version) || 0, 4);
    this.room.boss.name = definition.name;
    this.room.boss.tuning = normaliseBossTuning({}, definition);
    await this.saveRoom();
    return response;
  }

  async webSocketMessage(ws, message) {
    const event = decodeMessage(message);
    const attachment = ws.deserializeAttachment();

    if (event?.type === 'update_boss_tuning' && attachment?.role === 'teacher') {
      if (!this.room || this.room.status !== 'lobby') {
        this.safeSend(ws, { type: 'error', message: 'Boss tuning can only be changed before the raid starts.' });
        return;
      }

      const definition = this.bossDefinition();
      this.room.boss.tuning = normaliseBossTuning(event.tuning || {}, definition);
      await this.saveRoom();
      this.safeSend(ws, { type: 'boss_tuning_saved', tuning: this.room.boss.tuning });
      this.broadcastPublic();
      this.sendTeacherState();
      return;
    }

    return super.webSocketMessage(ws, message);
  }

  async startRaid() {
    const result = await super.startRaid();
    if (!result?.ok || !this.room) return result;

    const players = Object.values(this.room.players);
    const tuning = this.bossTuning();
    const health = bossHealthForPlayers(players.length, tuning);
    this.room.boss.maxHealth = health;
    this.room.boss.health = health;
    await this.saveRoom();

    // Super.startRaid has already started the room. Broadcast the tuned health
    // immediately so every client and the host sees the configured encounter.
    this.broadcastPublic();
    this.sendTeacherState();
    return result;
  }

  async handleAnswer(ws, player, event) {
    if (this.room.status !== 'running' || !player.currentQuestion) return;

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

    if (correct) {
      player.correct += 1;
      player.wrongTimestamps = [];
      this.room.team.correct += 1;

      if (player.class === 'healer') {
        damage = 6;
        healing = 4;
        this.room.raidHealth = Math.min(this.room.maxRaidHealth, this.room.raidHealth + healing);
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
        bossHealth: this.room.boss.health,
        raidHealth: this.room.raidHealth
      });

      const playerCount = Object.keys(this.room.players).length;
      const attackEvery = attackEveryForAggression(playerCount, this.bossTuning().aggression);
      if (!this.room.pendingAttack && this.room.boss.health > 0 && this.room.team.correct % attackEvery === 0) {
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
    } else {
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
      nextQuestion: this.room.status === 'running' ? publicQuestion(player.currentQuestion) : null
    });

    this.broadcastPublic();
    this.sendTeacherState();

    if (this.room.status === 'complete') {
      this.broadcast({ type: 'raid_complete', outcome: this.room.outcome, state: this.publicState() });
    }
  }

  async scheduleBossAttack() {
    const now = Date.now();
    const tuning = this.bossTuning();
    const pending = {
      id: crypto.randomUUID(),
      type: chooseAttack(this.bossDefinition()),
      warnedAt: now,
      executeAt: now + tuning.warningMs
    };

    this.room.pendingAttack = pending;
    await this.ctx.storage.setAlarm(pending.executeAt);
    this.broadcast({ type: 'boss_telegraph', attack: pending });
  }

  async alarm() {
    if (!this.room || this.room.status !== 'running' || !this.room.pendingAttack) return;

    const attack = this.room.pendingAttack;
    const players = Object.values(this.room.players);
    const hitPlayerIds = [];
    const dodgedPlayerIds = [];

    for (const player of players) {
      let hit = false;
      if (attack.type === 'left_slam') hit = player.x < 50;
      if (attack.type === 'right_slam') hit = player.x >= 50;
      if (attack.type === 'shockwave') hit = (player.airborneUntil || 0) < attack.executeAt;

      if (hit) hitPlayerIds.push(player.id);
      else dodgedPlayerIds.push(player.id);
    }

    const damage = attackDamageForPower(
      hitPlayerIds.length,
      Math.max(1, players.length),
      this.bossTuning().attackPower
    );

    this.room.pendingAttack = null;
    this.room.team.bossAttacks += 1;
    this.room.team.bossHits += hitPlayerIds.length;
    this.room.team.dodges += dodgedPlayerIds.length;
    this.room.raidHealth = Math.max(0, this.room.raidHealth - damage);

    if (this.room.raidHealth <= 0) {
      await this.finishRaid('defeat');
    }

    await this.saveRoom();

    this.broadcast({
      type: 'boss_attack',
      attackType: attack.type,
      damage,
      hitPlayerIds,
      dodgedPlayerIds,
      raidHealth: this.room.raidHealth
    });
    this.broadcastPublic();
    this.sendTeacherState();

    if (this.room.status === 'complete') {
      this.broadcast({ type: 'raid_complete', outcome: this.room.outcome, state: this.publicState() });
    }
  }

  publicState() {
    const state = super.publicState();
    if (!state) return state;

    const definition = this.bossDefinition();
    state.boss = {
      ...state.boss,
      tuning: this.bossTuning(),
      encounter: definition.encounter,
      art: definition.art,
      victory: definition.victory
    };
    return state;
  }
}
