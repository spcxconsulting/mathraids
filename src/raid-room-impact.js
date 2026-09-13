import { RaidRoom as HardcoreRaidRoom } from './raid-room-hardcore.js';
import {
  attackDamageForPower,
  chooseAttack,
  hardcorePlayerDamageForPower
} from './bosses.js';

const ATTACK_TRAVEL_MS = 720;
const PASSIVE_GUARD_RADIUS = 9;
const PASSIVE_GUARD_MULTIPLIER = 0.30;
const FORTIFY_RADIUS = 12;
const FORTIFY_MULTIPLIER = 0.10;
const FORTIFY_DURATION_MS = 5000;
const FORTIFY_SELF_HEAL = 35;
const SPECIAL_STREAK = 5;
const TARGETED_HEAL_AMOUNT = 45;
const TARGETED_HEAL_DAMAGE = 10;

const JUMP_CHAIN_WINDOW_MS = 2200;
const JUMP_LOCK_MS = 5000;
const JUMP_BASE_AIRBORNE_MS = 650;
const JUMP_BASE_READY_MS = 780;
const JUMP_HEIGHT_STRENGTHS = [1, 0.5, 0.25];
const AIRBORNE_DAMAGE_MULTIPLIER = 0.65;

function decodeMessage(message) {
  try {
    return JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
  } catch {
    return null;
  }
}

function isTank(player) {
  return player?.class === 'tank';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function jumpTimingForStrength(strength) {
  const velocityScale = Math.sqrt(clamp(Number(strength) || 1, 0.2, 1));
  return {
    airborneMs: Math.max(260, Math.round(JUMP_BASE_AIRBORNE_MS * velocityScale)),
    readyMs: Math.max(420, Math.round(JUMP_BASE_READY_MS * velocityScale))
  };
}

export class RaidRoom extends HardcoreRaidRoom {
  powerState(player) {
    if (!isTank(player)) return super.powerState(player);
    if (!this.fortifyEnabled()) {
      return {
        streak: 0,
        threshold: SPECIAL_STREAK,
        ready: false,
        ability: 'fortify',
        abilityName: 'Fortify disabled'
      };
    }
    return {
      streak: Math.max(0, Number(player.streak) || 0),
      threshold: SPECIAL_STREAK,
      ready: Boolean(player.specialReady),
      ability: 'fortify',
      abilityName: 'Fortify'
    };
  }

  async webSocketMessage(ws, message) {
    const event = decodeMessage(message);
    const attachment = ws.deserializeAttachment();

    if (event?.type === 'jump' && attachment?.role === 'student' && this.jumpFatigueEnabled()) {
      const player = this.room?.players?.[attachment.playerId];
      if (player) await this.handleFatigueJump(ws, player);
      return;
    }

    if (event?.type === 'special' && attachment?.role === 'student') {
      const player = this.room?.players?.[attachment.playerId];
      if (isTank(player)) {
        if (!this.fortifyEnabled()) {
          this.safeSend(ws, { type: 'error', message: 'Tank Fortify is disabled for this Custom raid.' });
          return;
        }
        await this.handleTankFortify(ws, player);
        return;
      }
      if (this.isHardcore() && player?.class === 'healer') {
        await this.handleTargetedHealerSpecial(ws, player, event.targetPlayerId);
        return;
      }
    }

    return super.webSocketMessage(ws, message);
  }

  async handleFatigueJump(ws, player) {
    if (!this.room || this.room.status === 'complete') return;
    if (this.isHardcore()) {
      this.ensureHardcorePlayer(player);
      if (player.knockedOut) {
        this.safeSend(ws, { type: 'player_knocked_out', playerId: player.id });
        return;
      }
    }

    const now = Date.now();
    player.jumpFatigue = Math.max(0, Number(player.jumpFatigue) || 0);
    player.lastJumpAt = Number(player.lastJumpAt) || 0;
    player.jumpLockedUntil = Number(player.jumpLockedUntil) || 0;
    player.jumpReadyAt = Number(player.jumpReadyAt) || 0;

    if (now < player.jumpLockedUntil) {
      this.safeSend(ws, {
        type: 'jump_exhausted',
        until: player.jumpLockedUntil,
        fatigue: player.jumpFatigue
      });
      return;
    }

    if (now < player.jumpReadyAt) return;

    if (!player.lastJumpAt || now - player.lastJumpAt > JUMP_CHAIN_WINDOW_MS) {
      player.jumpFatigue = 0;
    }

    const fatigueIndex = clamp(Math.round(player.jumpFatigue), 0, JUMP_HEIGHT_STRENGTHS.length - 1);
    const jumpStrength = JUMP_HEIGHT_STRENGTHS[fatigueIndex];
    const timing = jumpTimingForStrength(jumpStrength);

    player.lastJumpAt = now;
    player.jumpFatigue = fatigueIndex + 1;
    player.airborneUntil = now + timing.airborneMs;
    player.jumpReadyAt = now + timing.readyMs;
    player.jumpLockedUntil = player.jumpFatigue >= JUMP_HEIGHT_STRENGTHS.length
      ? now + JUMP_LOCK_MS
      : 0;

    await this.saveRoom();

    this.broadcast({
      type: 'player_jump',
      playerId: player.id,
      airborneUntil: player.airborneUntil,
      jumpStrength,
      jumpFatigue: player.jumpFatigue,
      jumpLockedUntil: player.jumpLockedUntil
    });
  }

  async handleTankFortify(ws, player) {
    if (!this.room || this.room.status !== 'running' || !this.fortifyEnabled()) return;
    if (this.isHardcore()) this.ensureHardcorePlayer(player);
    if (player.knockedOut) return;

    const now = Date.now();
    if ((player.stunnedUntil || 0) > now) {
      this.safeSend(ws, { type: 'stunned', until: player.stunnedUntil });
      return;
    }

    player.streak ??= 0;
    player.specialReady ??= false;
    if (!player.specialReady) {
      this.sendPowerStateToPlayer(player);
      return;
    }

    player.specialReady = false;
    player.streak = 0;
    player.fortifyUntil = now + FORTIFY_DURATION_MS;

    let healing = 0;
    if (this.isHardcore()) {
      const before = player.health;
      player.health = Math.min(player.maxHealth, player.health + FORTIFY_SELF_HEAL);
      healing = player.health - before;
    }

    this.broadcast({
      type: 'player_special',
      playerId: player.id,
      class: 'tank',
      ability: 'fortify',
      abilityName: 'Fortify',
      damage: 0,
      healing,
      fortifyUntil: player.fortifyUntil,
      radius: FORTIFY_RADIUS,
      bossHealth: this.room.boss.health
    });

    await this.saveRoom();
    this.sendPowerStateToPlayer(player);
    this.safeSend(ws, {
      type: 'special_result',
      ability: 'fortify',
      abilityName: 'Fortify',
      damage: 0,
      healing,
      fortifyUntil: player.fortifyUntil,
      radius: FORTIFY_RADIUS
    });
    this.broadcastPublic();
    this.sendTeacherState();
  }

  async handleTargetedHealerSpecial(ws, player, targetPlayerId) {
    if (!this.room || this.room.status !== 'running') return;
    this.ensureHardcorePlayer(player);
    if (player.knockedOut) return;

    const now = Date.now();
    if ((player.stunnedUntil || 0) > now) {
      this.safeSend(ws, { type: 'stunned', until: player.stunnedUntil });
      return;
    }

    player.streak ??= 0;
    player.specialReady ??= false;
    if (!player.specialReady) {
      this.sendPowerStateToPlayer(player);
      return;
    }

    const target = this.room.players?.[String(targetPlayerId || '')];
    this.ensureHardcorePlayer(target);
    if (!target || target.knockedOut || target.health <= 0) {
      this.safeSend(ws, { type: 'error', message: 'Choose a living raider to heal.' });
      return;
    }

    player.specialReady = false;
    player.streak = 0;
    const healing = this.healPlayer(target, TARGETED_HEAL_AMOUNT);
    this.room.boss.health = Math.max(0, this.room.boss.health - TARGETED_HEAL_DAMAGE);

    this.broadcast({
      type: 'player_special',
      playerId: player.id,
      class: 'healer',
      ability: 'renewal_burst',
      abilityName: 'Renewal Burst',
      damage: TARGETED_HEAL_DAMAGE,
      healing,
      healedPlayerIds: healing > 0 ? [target.id] : [],
      targetPlayerId: target.id,
      bossHealth: this.room.boss.health
    });

    if (this.room.boss.health <= 0) await this.finishRaid('victory');

    await this.saveRoom();
    this.sendPowerStateToPlayer(player);
    this.safeSend(ws, {
      type: 'special_result',
      ability: 'renewal_burst',
      abilityName: 'Renewal Burst',
      damage: TARGETED_HEAL_DAMAGE,
      healing,
      targetPlayerId: target.id,
      targetName: target.name
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
    const launchAt = now + tuning.warningMs;
    const pending = {
      id: crypto.randomUUID(),
      type: chooseAttack(this.bossDefinition()),
      phase: 'warning',
      warnedAt: now,
      launchAt,
      executeAt: launchAt,
      impactAt: null
    };

    this.room.boss.nextAttackAt = null;
    this.room.pendingAttack = pending;
    await this.saveRoom();
    await this.ctx.storage.setAlarm(launchAt);
    this.broadcast({ type: 'boss_telegraph', attack: pending });
    this.broadcastPublic();
  }

  playerHitAtImpact(player, attack) {
    if (attack.type === 'left_slam') return player.x < 50;
    if (attack.type === 'right_slam') return player.x >= 50;
    if (attack.type === 'shockwave') return (player.airborneUntil || 0) < attack.impactAt;
    return false;
  }

  playerAirborneAtImpact(player, attack) {
    if (!this.airborneMitigationEnabled()) return false;
    return attack.type !== 'shockwave' && (player.airborneUntil || 0) >= attack.impactAt;
  }

  activeFortifyTanks(players, impactAt) {
    if (!this.fortifyEnabled()) return [];
    return players.filter((player) => isTank(player) && (player.fortifyUntil || 0) >= impactAt && !player.knockedOut);
  }

  protectionFor(player, hitById, players, impactAt) {
    if (!hitById.get(player.id) || isTank(player)) return null;

    const fortifiedTank = this.activeFortifyTanks(players, impactAt)
      .find((tank) => Math.abs(tank.x - player.x) <= FORTIFY_RADIUS);
    if (fortifiedTank) return { tank: fortifiedTank, type: 'fortify', multiplier: FORTIFY_MULTIPLIER };

    if (!this.tankGuardEnabled()) return null;
    const passiveTank = players.find((tank) =>
      isTank(tank)
      && !tank.knockedOut
      && hitById.get(tank.id)
      && Math.abs(tank.x - player.x) <= PASSIVE_GUARD_RADIUS
    );
    if (passiveTank) return { tank: passiveTank, type: 'guard', multiplier: PASSIVE_GUARD_MULTIPLIER };

    return null;
  }

  async resolveHardcoreImpact(attack) {
    const living = this.livingPlayers();
    const hitById = new Map();
    const hitPlayerIds = [];
    const dodgedPlayerIds = [];
    const protectedPlayerIds = [];
    const airborneMitigatedPlayerIds = [];
    const guardTankIds = new Set();
    const fortifyTankIds = new Set();
    const knockedOutPlayerIds = [];
    const damageByPlayer = {};
    const baseDamage = hardcorePlayerDamageForPower(this.bossTuning().attackPower);
    const minimumHealth = this.knockoutsEnabled() ? 0 : 1;

    for (const player of living) {
      const hit = this.playerHitAtImpact(player, attack);
      hitById.set(player.id, hit);
      if (hit) hitPlayerIds.push(player.id);
      else dodgedPlayerIds.push(player.id);
    }

    const protectionByPlayer = new Map();
    for (const player of living) {
      const protection = this.protectionFor(player, hitById, living, attack.impactAt);
      if (!protection) continue;
      protectionByPlayer.set(player.id, protection);
      protectedPlayerIds.push(player.id);
      guardTankIds.add(protection.tank.id);
      if (protection.type === 'fortify') fortifyTankIds.add(protection.tank.id);
    }

    const preventedByTank = new Map();
    for (const player of living) {
      if (!hitById.get(player.id) || isTank(player)) continue;
      const protection = protectionByPlayer.get(player.id);
      const airborne = this.playerAirborneAtImpact(player, attack);
      let multiplier = protection ? protection.multiplier : 1;
      if (airborne) {
        multiplier *= AIRBORNE_DAMAGE_MULTIPLIER;
        airborneMitigatedPlayerIds.push(player.id);
      }
      const damage = Math.max(1, Math.round(baseDamage * multiplier));
      damageByPlayer[player.id] = damage;
      player.health = Math.max(minimumHealth, player.health - damage);

      if (protection) {
        const prevented = Math.max(0, baseDamage - damage);
        preventedByTank.set(
          protection.tank.id,
          (preventedByTank.get(protection.tank.id) || 0) + prevented
        );
      }
    }

    for (const tank of living.filter(isTank)) {
      const directlyHit = hitById.get(tank.id);
      const fortified = this.fortifyEnabled() && (tank.fortifyUntil || 0) >= attack.impactAt;
      const airborne = directlyHit && this.playerAirborneAtImpact(tank, attack);
      const prevented = preventedByTank.get(tank.id) || 0;
      if (!directlyHit && prevented <= 0) continue;

      let directMultiplier = fortified ? 0.5 : 1;
      if (airborne) {
        directMultiplier *= AIRBORNE_DAMAGE_MULTIPLIER;
        airborneMitigatedPlayerIds.push(tank.id);
      }
      const baseTankDamage = directlyHit
        ? Math.max(1, Math.round(baseDamage * directMultiplier))
        : 0;
      const absorbShare = fortified ? 0.20 : 0.35;
      const absorbCap = Math.round(baseDamage * (fortified ? 0.50 : 0.75));
      const absorbed = Math.min(absorbCap, Math.round(prevented * absorbShare));
      const tankDamage = baseTankDamage + absorbed;

      if (tankDamage > 0) {
        damageByPlayer[tank.id] = tankDamage;
        tank.health = Math.max(minimumHealth, tank.health - tankDamage);
      }
      if (fortified && prevented > 0) fortifyTankIds.add(tank.id);
    }

    if (this.knockoutsEnabled()) {
      for (const player of living) {
        if (player.health <= 0) {
          player.knockedOut = true;
          player.currentQuestion = null;
          knockedOutPlayerIds.push(player.id);
        }
      }
    }

    this.room.team.bossAttacks += 1;
    this.room.team.bossHits += hitPlayerIds.length;
    this.room.team.dodges += dodgedPlayerIds.length;

    if (this.knockoutsEnabled() && !this.livingPlayers().length && Object.keys(this.room.players).length > 0) {
      await this.finishRaid('wipe');
    }

    return {
      type: 'boss_attack',
      attackType: attack.type,
      damage: baseDamage,
      damageByPlayer,
      hitPlayerIds,
      dodgedPlayerIds,
      protectedPlayerIds,
      airborneMitigatedPlayerIds,
      guardTankIds: [...guardTankIds],
      fortifyTankIds: [...fortifyTankIds],
      knockedOutPlayerIds,
      hardcore: this.room.config?.mode === 'hardcore',
      individualHealth: true,
      impactAt: attack.impactAt
    };
  }

  async resolveNormalImpact(attack) {
    const players = Object.values(this.room.players);
    const hitById = new Map();
    const hitPlayerIds = [];
    const dodgedPlayerIds = [];
    const protectedPlayerIds = [];
    const airborneMitigatedPlayerIds = [];
    const guardTankIds = new Set();
    const fortifyTankIds = new Set();

    for (const player of players) {
      const hit = this.playerHitAtImpact(player, attack);
      hitById.set(player.id, hit);
      if (hit) hitPlayerIds.push(player.id);
      else dodgedPlayerIds.push(player.id);
    }

    let effectiveHits = 0;
    for (const player of players) {
      if (!hitById.get(player.id)) continue;
      const airborneMultiplier = this.playerAirborneAtImpact(player, attack)
        ? AIRBORNE_DAMAGE_MULTIPLIER
        : 1;
      if (airborneMultiplier < 1) airborneMitigatedPlayerIds.push(player.id);

      if (isTank(player)) {
        const fortified = this.fortifyEnabled() && (player.fortifyUntil || 0) >= attack.impactAt;
        effectiveHits += (fortified ? 0.5 : 1) * airborneMultiplier;
        if (fortified) fortifyTankIds.add(player.id);
        continue;
      }

      const protection = this.protectionFor(player, hitById, players, attack.impactAt);
      if (!protection) {
        effectiveHits += airborneMultiplier;
        continue;
      }

      effectiveHits += protection.multiplier * airborneMultiplier;
      protectedPlayerIds.push(player.id);
      guardTankIds.add(protection.tank.id);
      if (protection.type === 'fortify') fortifyTankIds.add(protection.tank.id);
    }

    const damage = attackDamageForPower(
      effectiveHits,
      Math.max(1, players.length),
      this.bossTuning().attackPower
    );

    this.room.team.bossAttacks += 1;
    this.room.team.bossHits += hitPlayerIds.length;
    this.room.team.dodges += dodgedPlayerIds.length;
    this.room.raidHealth = Math.max(0, this.room.raidHealth - damage);

    if (this.room.raidHealth <= 0) await this.finishRaid('defeat');

    return {
      type: 'boss_attack',
      attackType: attack.type,
      damage,
      hitPlayerIds,
      dodgedPlayerIds,
      protectedPlayerIds,
      airborneMitigatedPlayerIds,
      guardTankIds: [...guardTankIds],
      fortifyTankIds: [...fortifyTankIds],
      raidHealth: this.room.raidHealth,
      impactAt: attack.impactAt
    };
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

    if (attack.phase === 'warning') {
      const now = Date.now();
      attack.phase = 'flight';
      attack.launchedAt = now;
      attack.impactAt = now + ATTACK_TRAVEL_MS;
      await this.saveRoom();
      await this.ctx.storage.setAlarm(attack.impactAt);
      this.broadcast({
        type: 'boss_projectile',
        attackType: attack.type,
        attackId: attack.id,
        launchedAt: attack.launchedAt,
        impactAt: attack.impactAt,
        duration: ATTACK_TRAVEL_MS
      });
      this.broadcastPublic();
      return;
    }

    if (attack.phase !== 'flight') return;

    const payload = this.isHardcore()
      ? await this.resolveHardcoreImpact(attack)
      : await this.resolveNormalImpact(attack);

    this.room.pendingAttack = null;
    await this.saveRoom();
    this.broadcast(payload);
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

    state.tankBubbleRadius = FORTIFY_RADIUS;
    state.jumpFatigue = {
      enabled: this.jumpFatigueEnabled(),
      chainWindowMs: JUMP_CHAIN_WINDOW_MS,
      lockMs: JUMP_LOCK_MS,
      strengths: JUMP_HEIGHT_STRENGTHS,
      airborneDamageMultiplier: this.airborneMitigationEnabled() ? AIRBORNE_DAMAGE_MULTIPLIER : 1
    };
    state.players = state.players.map((publicPlayer) => {
      const player = this.room.players?.[publicPlayer.id] || {};
      return {
        ...publicPlayer,
        fortifyUntil: player.fortifyUntil || 0,
        airborneUntil: player.airborneUntil || 0,
        jumpReadyAt: player.jumpReadyAt || 0,
        jumpFatigue: player.jumpFatigue || 0,
        lastJumpAt: player.lastJumpAt || 0,
        jumpLockedUntil: player.jumpLockedUntil || 0
      };
    });
    return state;
  }
}
