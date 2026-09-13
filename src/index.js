import { RaidRoom } from './raid-room-library.js';
import {
  adminAuthorised,
  adminConfigured,
  loginAdmin,
  logoutAdmin
} from './admin-auth.js';
import {
  bossLibraryAvailable,
  createBossTemplate,
  deleteBossTemplate,
  getBossFromLibrary,
  listBosses,
  serveBossAsset,
  updateBossTemplate
} from './boss-library.js';

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
      return json({
        ok: true,
        service: 'mathraids',
        version: '0.1.0',
        bossLibrary: bossLibraryAvailable(env)
      });
    }

    if (url.pathname === '/api/admin/session' && request.method === 'GET') {
      return json({
        configured: adminConfigured(request, env),
        authenticated: await adminAuthorised(request, env)
      });
    }

    if (url.pathname === '/api/admin/login' && request.method === 'POST') {
      return loginAdmin(request, env);
    }

    if (url.pathname === '/api/admin/logout' && request.method === 'POST') {
      return logoutAdmin(request);
    }

    if (url.pathname === '/host/bosses' || url.pathname === '/host/bosses/') {
      return Response.redirect(`${url.origin}/admin/bosses/`, 302);
    }

    if ((url.pathname === '/admin/bosses' || url.pathname === '/admin/bosses/') && !(await adminAuthorised(request, env))) {
      return Response.redirect(`${url.origin}/admin/`, 302);
    }

    if (url.pathname === '/api/bosses' && request.method === 'GET') {
      return json({ bosses: await listBosses(env) });
    }

    if (url.pathname === '/api/bosses' && request.method === 'POST') {
      if (!bossLibraryAvailable(env)) return json({ error: 'Boss asset storage is not configured.' }, 503);
      if (!(await adminAuthorised(request, env))) return json({ error: 'Super admin sign-in is required.' }, 403);
      try {
        const boss = await createBossTemplate(request, env);
        return json({ boss }, 201);
      } catch (error) {
        return json({ error: error.message || 'Could not create boss encounter.' }, 400);
      }
    }

    const bossMatch = url.pathname.match(/^\/api\/bosses\/(custom-[a-z0-9-]+)$/);
    if (bossMatch && request.method === 'GET') {
      if (!(await adminAuthorised(request, env))) return json({ error: 'Super admin sign-in is required.' }, 403);
      const boss = await getBossFromLibrary(env, bossMatch[1]);
      return boss ? json({ boss }) : json({ error: 'Boss encounter not found.' }, 404);
    }

    if (bossMatch && request.method === 'PUT') {
      if (!bossLibraryAvailable(env)) return json({ error: 'Boss asset storage is not configured.' }, 503);
      if (!(await adminAuthorised(request, env))) return json({ error: 'Super admin sign-in is required.' }, 403);
      try {
        const boss = await updateBossTemplate(request, env, bossMatch[1]);
        return boss ? json({ boss }) : json({ error: 'Boss encounter not found.' }, 404);
      } catch (error) {
        return json({ error: error.message || 'Could not update boss encounter.' }, 400);
      }
    }

    if (bossMatch && request.method === 'DELETE') {
      if (!(await adminAuthorised(request, env))) return json({ error: 'Super admin sign-in is required.' }, 403);
      const deleted = await deleteBossTemplate(env, bossMatch[1]);
      return deleted ? json({ ok: true }) : json({ error: 'Boss encounter not found.' }, 404);
    }

    const bossAssetMatch = url.pathname.match(/^\/api\/boss-assets\/(custom-[a-z0-9-]+\/(?:idle|attack|background|foreground|neutral|death|attack-\d+)(?:-[a-z0-9-]+)?\.(?:png|jpg|webp))$/);
    if (bossAssetMatch && request.method === 'GET') {
      return serveBossAsset(env, bossAssetMatch[1]);
    }

    if (url.pathname === '/api/raids' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const bossId = String(body.boss || 'numberzilla');
      const bossDefinition = await getBossFromLibrary(env, bossId);
      if (!bossDefinition) return json({ error: 'Selected boss was not found.' }, 400);

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = createCode();
        const room = roomFor(env, code);
        const response = await room.fetch('https://raid.internal/create', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code,
            mode: body.mode || 'ranked',
            customRules: body.customRules || null,
            boss: bossId,
            bossDefinition,
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
