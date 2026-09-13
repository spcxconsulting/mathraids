const COOKIE_NAME = 'mathraids_admin';
const SESSION_MS = 12 * 60 * 60 * 1000;
const LOCAL_DEV_PASSWORD = 'mathraids-local-admin';

function isLocal(request) {
  const hostname = new URL(request.url).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function configuredPassword(request, env) {
  const configured = String(env.SUPER_ADMIN_PASSWORD || '');
  if (configured) return configured;
  return isLocal(request) ? LOCAL_DEV_PASSWORD : '';
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hmac(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let mismatch = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let index = 0; index < max; index += 1) {
    mismatch |= (a[index % Math.max(1, a.length)] || 0) ^ (b[index % Math.max(1, b.length)] || 0);
  }
  return mismatch === 0;
}

function cookieValue(request) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE_NAME) return value.join('=');
  }
  return '';
}

async function issueToken(request, env) {
  const secret = configuredPassword(request, env);
  if (!secret) return null;
  const expires = Date.now() + SESSION_MS;
  const nonce = crypto.randomUUID();
  const payload = `${expires}.${nonce}`;
  const signature = await hmac(secret, payload);
  return `${payload}.${signature}`;
}

export function adminConfigured(request, env) {
  return Boolean(configuredPassword(request, env));
}

export async function adminAuthorised(request, env) {
  const secret = configuredPassword(request, env);
  if (!secret) return false;

  const token = cookieValue(request);
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [expiresText, nonce, suppliedSignature] = parts;
  const expires = Number(expiresText);
  if (!Number.isFinite(expires) || expires <= Date.now() || !nonce || !suppliedSignature) return false;

  const payload = `${expiresText}.${nonce}`;
  const expectedSignature = await hmac(secret, payload);
  return constantTimeEqual(suppliedSignature, expectedSignature);
}

export async function loginAdmin(request, env) {
  const expected = configuredPassword(request, env);
  if (!expected) {
    return new Response(JSON.stringify({ error: 'Super admin login is not configured.' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  const body = await request.json().catch(() => ({}));
  const supplied = String(body.password || '');
  if (!supplied || !constantTimeEqual(supplied, expected)) {
    return new Response(JSON.stringify({ error: 'Incorrect super admin password.' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  const token = await issueToken(request, env);
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'set-cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_MS / 1000)}${secure}`
    }
  });
}

export function logoutAdmin(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'set-cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`
    }
  });
}

export function localDevAdminPassword(request) {
  return isLocal(request) ? LOCAL_DEV_PASSWORD : null;
}
