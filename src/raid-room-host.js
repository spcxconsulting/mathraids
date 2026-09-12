import { RaidRoom as SyncedRaidRoom } from './raid-room-synced.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

export class RaidRoom extends SyncedRaidRoom {
  hostKey() {
    return this.room?.hostKey || this.room?.teacherKey || '';
  }

  hostReport() {
    const legacyReport = super.teacherReport();
    if (!legacyReport) return null;
    const { students = [], ...report } = legacyReport;
    return {
      ...report,
      players: students
    };
  }

  async acceptSocket(request) {
    const url = new URL(request.url);
    if (url.searchParams.get('role') !== 'host') {
      return super.acceptSocket(request);
    }

    if (!this.room) return json({ error: 'Raid not found' }, 404);
    if (url.searchParams.get('key') !== this.hostKey()) {
      return json({ error: 'Not authorised' }, 403);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server, ['host']);
    // The underlying start-raid handler already understands this control role.
    server.serializeAttachment({ role: 'teacher' });
    this.safeSend(server, { type: 'host_state', report: this.hostReport() });

    return new Response(null, { status: 101, webSocket: client });
  }

  sendTeacherState() {
    const hostPayload = { type: 'host_state', report: this.hostReport() };
    for (const ws of this.ctx.getWebSockets('host')) this.safeSend(ws, hostPayload);

    // Transitional compatibility for older /teacher consoles.
    const teacherPayload = { type: 'teacher_state', report: super.teacherReport() };
    for (const ws of this.ctx.getWebSockets('teacher')) this.safeSend(ws, teacherPayload);
  }
}
