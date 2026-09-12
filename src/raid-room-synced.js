import { RaidRoom as PoweredRaidRoom } from './raid-room-powered.js';

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

export class RaidRoom extends PoweredRaidRoom {
  async webSocketMessage(ws, message) {
    const event = decodeMessage(message);
    const attachment = ws.deserializeAttachment();

    if (!event || !attachment || attachment.role !== 'student') {
      return super.webSocketMessage(ws, message);
    }

    const player = this.room?.players?.[attachment.playerId];
    if (!player) return super.webSocketMessage(ws, message);

    if (event.type === 'position') {
      if (this.room.status === 'complete') return;
      const requestedX = Number(event.x);
      if (!Number.isFinite(requestedX)) return;

      const now = Date.now();
      const elapsed = clamp(now - (player.lastPositionAt || now), 16, 500);
      const maxDelta = Math.max(1.2, elapsed * 0.032);
      const targetX = clamp(requestedX, 4, 96);
      const delta = clamp(targetX - player.x, -maxDelta, maxDelta);

      player.x = clamp(player.x + delta, 4, 96);
      player.facing = event.facing === 'left' ? 'left' : 'right';
      player.lastPositionAt = now;

      this.broadcast({
        type: 'player_move',
        playerId: player.id,
        x: player.x,
        facing: player.facing,
        airborneUntil: player.airborneUntil || 0
      });
      return;
    }

    if (event.type === 'move') {
      const direction = event.direction === 'left' ? -1 : event.direction === 'right' ? 1 : 0;
      if (!direction || this.room.status === 'complete') return;
      player.x = clamp(player.x + direction * 2.4, 4, 96);
      player.facing = direction < 0 ? 'left' : 'right';
      player.lastPositionAt = Date.now();
      this.broadcast({
        type: 'player_move',
        playerId: player.id,
        x: player.x,
        facing: player.facing,
        airborneUntil: player.airborneUntil || 0
      });
      return;
    }

    if (event.type === 'jump') {
      const now = Date.now();
      if (this.room.status === 'complete' || now < (player.jumpReadyAt || 0)) return;

      // Match the local client jump more closely and persist the short-lived
      // airborne state so a hibernated room / late state snapshot can recover it.
      player.airborneUntil = now + 720;
      player.jumpReadyAt = now + 780;
      await this.saveRoom();

      this.broadcast({
        type: 'player_jump',
        playerId: player.id,
        airborneUntil: player.airborneUntil
      });
      return;
    }

    return super.webSocketMessage(ws, message);
  }

  publicState() {
    const state = super.publicState();
    if (!state) return state;

    state.players = state.players.map((publicPlayer) => {
      const player = this.room?.players?.[publicPlayer.id];
      return {
        ...publicPlayer,
        airborneUntil: player?.airborneUntil || 0
      };
    });

    return state;
  }
}
