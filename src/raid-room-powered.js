import { RaidRoom as BaseRaidRoom } from './raid-room.js';

const SPECIAL_STREAK = 5;

function decodeMessage(message) {
  try {
    return JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
  } catch {
    return null;
  }
}

function abilityFor(player) {
  if (player.class === 'healer') {
    return {
      id: 'renewal_burst',
      name: 'Renewal Burst',
      damage: 15,
      healing: 20
    };
  }

  return {
    id: 'power_shot',
    name: 'Power Shot',
    damage: 35,
    healing: 0
  };
}

export class RaidRoom extends BaseRaidRoom {
  powerState(player) {
    const ability = abilityFor(player);
    return {
      streak: Math.max(0, Number(player.streak) || 0),
      threshold: SPECIAL_STREAK,
      ready: Boolean(player.specialReady),
      ability: ability.id,
      abilityName: ability.name
    };
  }

  sendPowerStateToPlayer(player) {
    const payload = { type: 'power_state', power: this.powerState(player) };
    for (const socket of this.ctx.getWebSockets(`player:${player.id}`)) this.safeSend(socket, payload);
  }

  async startRaid() {
    const result = await super.startRaid();
    if (!result?.ok) return result;

    for (const player of Object.values(this.room.players)) {
      player.streak = 0;
      player.specialReady = false;
      this.sendPowerStateToPlayer(player);
    }
    await this.saveRoom();
    return result;
  }

  async webSocketMessage(ws, message) {
    const event = decodeMessage(message);
    const attachment = ws.deserializeAttachment();

    if (!event || !attachment || attachment.role !== 'student') {
      return super.webSocketMessage(ws, message);
    }

    const player = this.room?.players?.[attachment.playerId];
    if (!player) return super.webSocketMessage(ws, message);

    player.streak ??= 0;
    player.specialReady ??= false;

    if (event.type === 'get_power') {
      this.safeSend(ws, { type: 'power_state', power: this.powerState(player) });
      return;
    }

    if (event.type === 'special') {
      await this.handleSpecial(ws, player);
      return;
    }

    if (event.type !== 'answer') {
      return super.webSocketMessage(ws, message);
    }

    const now = Date.now();
    const question = player.currentQuestion;
    const eligible = this.room.status === 'running'
      && question
      && player.stunnedUntil <= now
      && event.questionId === question.id;
    const wasCorrect = eligible && Number(event.answer) === question.correctAnswer;

    await super.webSocketMessage(ws, message);

    if (!eligible || !this.room?.players?.[player.id]) return;

    if (wasCorrect) {
      if (!player.specialReady) {
        player.streak = Math.min(SPECIAL_STREAK, (Number(player.streak) || 0) + 1);
        if (player.streak >= SPECIAL_STREAK) player.specialReady = true;
      }
    } else if (!player.specialReady) {
      player.streak = 0;
    }

    await this.saveRoom();
    this.sendPowerStateToPlayer(player);
  }

  async handleSpecial(ws, player) {
    if (this.room.status !== 'running') return;

    const now = Date.now();
    if (player.stunnedUntil > now) {
      this.safeSend(ws, { type: 'stunned', until: player.stunnedUntil });
      return;
    }

    if (!player.specialReady) {
      this.safeSend(ws, { type: 'power_state', power: this.powerState(player) });
      return;
    }

    const ability = abilityFor(player);
    player.specialReady = false;
    player.streak = 0;

    this.room.boss.health = Math.max(0, this.room.boss.health - ability.damage);
    if (ability.healing > 0) {
      this.room.raidHealth = Math.min(
        this.room.maxRaidHealth,
        this.room.raidHealth + ability.healing
      );
    }

    this.broadcast({
      type: 'player_special',
      playerId: player.id,
      class: player.class,
      ability: ability.id,
      abilityName: ability.name,
      damage: ability.damage,
      healing: ability.healing,
      bossHealth: this.room.boss.health,
      raidHealth: this.room.raidHealth
    });

    if (this.room.boss.health <= 0) {
      await this.finishRaid('victory');
    }

    await this.saveRoom();
    this.sendPowerStateToPlayer(player);
    this.safeSend(ws, {
      type: 'special_result',
      ability: ability.id,
      abilityName: ability.name,
      damage: ability.damage,
      healing: ability.healing
    });
    this.broadcastPublic();
    this.sendTeacherState();

    if (this.room.status === 'complete') {
      this.broadcast({ type: 'raid_complete', outcome: this.room.outcome, state: this.publicState() });
    }
  }
}
