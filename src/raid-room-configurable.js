import { RaidRoom as HostRaidRoom } from './raid-room-host.js';
import {
  attackDamageForPower,
  attackEveryForAggression,
  attackIntervalForAggression,
  bossHealthForPlayers,
  chooseAttack,
  getBossDefinition,
  initialAttackDelayForAggression,
  normaliseBossTuning
} from './bosses.js';
import { publicQuestion } from './questions.js';

const TANK_GUARD_RADIUS = 9;
const TANK_GUARD_DAMAGE_MULTIPLIER = 0.3;

export function normaliseCustomRules(value = {}) {
  const healthMode = value.healthMode === 'individual' ? 'individual' : 'shared';
  return {
    healthMode,
    knockouts: healthMode === 'individual' && value.knockouts !== false,
    tankGuard: value.tankGuard !== false,
    fortify: value.fortify !== false,
    jumpFatigue: value.jumpFatigue !== false,
    airborneMitigation: value.airborneMitigation !== false,
    progressionEligible: false,
    rewardsEligible: false
  };
}

function decodeMessage(message) {
  try {
    return JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
  } catch {
    return null;
  }
}

export class RaidRoom extends HostRaidRoom {
  bossDefinition() {
    return getBossDefinition(this.room?.config?.boss || this.room?.boss?.id || 'numberzilla');
  }

  bossTuning() {
    const definition = this.bossDefinition();
    return normaliseBossTuning(this.room?.boss?.tuning || {}, definition);
  }

  bossAttackDelay(initial = false) {
    const tuning = this.bossTuning();
    const base = initial
      ? initialAttackDelayForAggression(tuning.aggression)
      : attackIntervalForAggression(tuning.aggression);
    const randomByte = crypto.getRandomValues(new Uint8Array(1))[0];
    const jitter = 0.9 + (randomByte / 255) * 0.2;
    return Math.max(tuning.warningMs + 600, Math.round(base * jitter));
  }

  async createRoom(request) {
    const body = await request.clone().json().catch(() => ({}));
    const response = await super.createRoom(request);
    if (!response.ok || !this.room) return response;

    if (body.mode === 'custom') {
      this.room.config.mode = 'custom';
      this.room.config.customRules = normaliseCustomRules(body.customRules || {});
      this.room.config.progressionEligible = false;
      this.room.config.rewardsEligible = false;
    } else {
      this.room.config.progressionEligible = true;
      this.room.config.rewardsEligible = true;
    }

    const definition = this.bossDefinition();
    this.room.version = Math.max(Number(this.room.version) || 0, 11);
    this.room.boss.name = definition.name;
    this.room.boss.tuning = normaliseBossTuning({}, definition);
    this.room.boss.nextAttackAt = null;
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

      if (this.room.config?.mode !== 'custom') {
        this.safeSend(ws, { type: 'error', message: 'Boss tuning is only available for Custom raids.' });
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
    this.room.boss.nextAttackAt = null;
    await this.saveRoom();

    this.broadcastPublic();
    this.sendTeacherState();
    await this.armNextBossAttack(true);
    return result;
  }

  async armNextBossAttack(initial = false) {
    if (!this.room || this.room.status !== 'running') return;
    if (this.room.pendingAttack || this.room.boss.health <= 0) return;

    const executeTelegraphAt = Date.now() + this.bossAttackDelay(initial);
    this.room.boss.nextAttackAt = executeTelegraphAt;
    await this.saveRoom();
    await this.ctx.storage.setAlarm(executeTelegraphAt);
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
      } else if (player.class === 'tank') {
        damage = 6;
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

    const hitPlayers = players.filter((player) => hitPlayerIds.includes(player.id));
    const hitTanks = hitPlayers.filter((player) => player.class === 'tank');
    const protectedPlayerIds = [];
    for (const player of hitPlayers) {
      if (player.class === 'tank') continue;
      const tank = hitTanks.find((candidate) => Math.abs(candidate.x - player.x) <= TANK_GUARD_RADIUS);
      if (tank) protectedPlayerIds.push(player.id);
    }

    const unprotectedHits = Math.max(0, hitPlayerIds.length - protectedPlayerIds.length);
    const effectiveHits = unprotectedHits + protectedPlayerIds.length * TANK_GUARD_DAMAGE_MULTIPLIER;
    const damage = attackDamageForPower(
      effectiveHits,
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
      protectedPlayerIds,
      raidHealth: this.room.raidHealth
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
    if (!state) return state;

    const definition = this.bossDefinition();
    state.boss = {
      ...state.boss,
      tuning: this.bossTuning(),
      encounter: definition.encounter,
      art: definition.art,
      presentation: definition.presentation,
      victory: definition.victory
    };
    state.custom = this.room?.config?.mode === 'custom';
    state.progressionEligible = this.room?.config?.progressionEligible !== false;
    state.rewardsEligible = this.room?.config?.rewardsEligible !== false;
    delete state.boss.nextAttackAt;
    return state;
  }
}
