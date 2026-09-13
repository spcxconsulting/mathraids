import { RaidRoom as ImpactRaidRoom } from './raid-room-impact.js';
import { normaliseBossTuning } from './bosses.js';

export class RaidRoom extends ImpactRaidRoom {
  bossDefinition() {
    return this.room?.config?.bossDefinition || super.bossDefinition();
  }

  async createRoom(request) {
    const body = await request.clone().json().catch(() => ({}));
    const response = await super.createRoom(request);
    if (!response.ok || !this.room) return response;

    const definition = body.bossDefinition;
    if (definition?.id && definition.id === this.room.config.boss) {
      this.room.config.bossDefinition = definition;
      this.room.boss.name = definition.name || this.room.boss.name;
      this.room.boss.tuning = normaliseBossTuning({}, definition);
      this.room.version = Math.max(Number(this.room.version) || 0, 10);
      await this.saveRoom();
    }

    return response;
  }

  publicState() {
    const state = super.publicState();
    if (!state) return state;

    const definition = this.bossDefinition();
    state.boss = {
      ...state.boss,
      canvas: definition.canvas || { width: 640, height: 360 },
      attackDefinitions: Array.isArray(definition.attackDefinitions) ? definition.attackDefinitions : [],
      enrage: definition.enrage || null
    };
    return state;
  }
}
