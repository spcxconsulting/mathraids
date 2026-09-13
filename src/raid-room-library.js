import { RaidRoom as ImpactRaidRoom } from './raid-room-impact.js';
import { normaliseCustomRules } from './raid-room-configurable.js';
import { normaliseBossTuning } from './bosses.js';

function decodeMessage(message) {
  try {
    return JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
  } catch {
    return null;
  }
}

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
      this.room.version = Math.max(Number(this.room.version) || 0, 13);
      await this.saveRoom();
    }

    return response;
  }

  async webSocketMessage(ws, message) {
    const event = decodeMessage(message);
    const attachment = ws.deserializeAttachment();

    if (event?.type === 'update_custom_rules' && attachment?.role === 'teacher') {
      if (!this.room || this.room.status !== 'lobby') {
        this.safeSend(ws, { type: 'error', message: 'Custom raid rules can only be changed before the raid starts.' });
        return;
      }
      if (this.room.config?.mode !== 'custom') {
        this.safeSend(ws, { type: 'error', message: 'Raid rules can only be changed for Custom raids.' });
        return;
      }

      const rules = normaliseCustomRules(event.rules || {});
      this.room.config.customRules = rules;
      this.room.config.progressionEligible = false;
      this.room.config.rewardsEligible = false;
      await this.saveRoom();

      this.safeSend(ws, { type: 'custom_rules_saved', rules });
      this.broadcastPublic();
      this.sendTeacherState();
      return;
    }

    return super.webSocketMessage(ws, message);
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
