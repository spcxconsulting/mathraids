import { RaidRoom } from './raid-room-configurable.js';

export { RaidRoom };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function normaliseCode(value = '') {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function createCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function roomFor(env, code) {
  return env.RAID_ROOMS.get(env.RAID_ROOMS.idFromName(code));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'mathraids', version: '0.1.0' });
    }

    if (url.pathname === '/api/raids' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = createCode();
        const room = roomFor(env, code);
        const response = await room.fetch('https://raid.internal/create', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code,
            mode: body.mode || 'ranked',
            boss: body.boss || 'numberzilla',
            topic: body.topic || 'multiplication',
            difficulty: body.difficulty || 2
          })
        });

        if (response.status === 409) continue;
        if (!response.ok) return response;

        const created = await response.json();
        const hostKey = created.hostKey || created.teacherKey;
        const hostUrl = `${url.origin}/host/raid.html?code=${code}&key=${hostKey}`;
        return json({
          code,
          hostKey,
          joinUrl: `${url.origin}/join/?code=${code}`,
          hostUrl,
          teacherKey: hostKey,
          teacherUrl: hostUrl
        }, 201);
      }

      return json({ error: 'Could not allocate a raid code. Please try again.' }, 503);
    }

    const reportMatch = url.pathname.match(/^\/api\/raids\/([A-Z0-9]{6})\/report$/i);
    if (reportMatch && request.method === 'GET') {
      const code = normaliseCode(reportMatch[1]);
      const key = url.searchParams.get('key') || '';
      return roomFor(env, code).fetch(`https://raid.internal/report?key=${encodeURIComponent(key)}`);
    }

    const startMatch = url.pathname.match(/^\/api\/raids\/([A-Z0-9]{6})\/start$/i);
    if (startMatch && request.method === 'POST') {
      const code = normaliseCode(startMatch[1]);
      const key = url.searchParams.get('key') || '';
      return roomFor(env, code).fetch(`https://raid.internal/start?key=${encodeURIComponent(key)}`, {
        method: 'POST'
      });
    }

    const raidMatch = url.pathname.match(/^\/api\/raids\/([A-Z0-9]{6})$/i);
    if (raidMatch && request.method === 'GET') {
      const code = normaliseCode(raidMatch[1]);
      return roomFor(env, code).fetch('https://raid.internal/state');
    }

    const wsMatch = url.pathname.match(/^\/ws\/([A-Z0-9]{6})$/i);
    if (wsMatch) {
      const code = normaliseCode(wsMatch[1]);
      return roomFor(env, code).fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};