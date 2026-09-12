import { RaidRoom } from './raid-room.js';

export { RaidRoom };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function normaliseCode(value = '') {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function createCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return code;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'mathraids', version: '0.1.0' });
    }

    if (url.pathname === '/api/raids' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const code = createCode();
      const id = env.RAID_ROOMS.idFromName(code);
      const room = env.RAID_ROOMS.get(id);
      const response = await room.fetch('https://raid.internal/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          boss: body.boss || 'numberzilla',
          topic: body.topic || 'multiplication',
          difficulty: body.difficulty || 'standard'
        })
      });
      if (!response.ok) return response;
      return json({ code, joinUrl: `${url.origin}/join/?code=${code}` }, 201);
    }

    const raidMatch = url.pathname.match(/^\/api\/raids\/([A-Z0-9]{6})$/i);
    if (raidMatch && request.method === 'GET') {
      const code = normaliseCode(raidMatch[1]);
      const id = env.RAID_ROOMS.idFromName(code);
      return env.RAID_ROOMS.get(id).fetch('https://raid.internal/state');
    }

    const wsMatch = url.pathname.match(/^\/ws\/([A-Z0-9]{6})$/i);
    if (wsMatch) {
      const code = normaliseCode(wsMatch[1]);
      const id = env.RAID_ROOMS.idFromName(code);
      return env.RAID_ROOMS.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};
