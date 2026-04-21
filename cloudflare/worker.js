const SESSION_TTL_SECONDS = 86400;
const USER_COLLECTION = 'vimflowy_users';

const clientMap = new Map();
const sockets = new Set();

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  return new Response(response.body, { status: response.status, headers });
}

function json(data, status = 200) {
  return withCors(new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

async function hashPassword(password) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function directus(env, path, options = {}) {
  const base = (env.DIRECTUS_STATIC_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('DIRECTUS_STATIC_URL not configured');
  const token = env.DIRECTUS_STATIC_TOKEN;
  if (!token) throw new Error('DIRECTUS_STATIC_TOKEN not configured');
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Directus ${response.status}: ${text}`);
  }
  if (response.status === 204) return null;
  const ct = response.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return response.json();
  }
  const text = await response.text();
  return text || null;
}

async function createSession(user, env) {
  const token = crypto.randomUUID();
  await env.SESSION_KV.put(`session:${token}`, JSON.stringify({ user }), { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}

async function getSessionByToken(token, env) {
  if (!token) return null;
  const session = await env.SESSION_KV.get(`session:${token}`, 'json');
  return session?.user || null;
}

function readBearer(request) {
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function getValue(userId, key, env) {
  if (!env.R2_BUCKET) {
    throw new Error('R2_BUCKET binding not configured');
  }
  const objectKey = `vimflowy/${encodeURIComponent(userId)}/${encodeURIComponent(key)}`;
  const object = await env.R2_BUCKET.get(objectKey);
  if (!object) {
    return null;
  }
  return await object.text();
}

async function upsertValue(userId, key, value, env) {
  if (!env.R2_BUCKET) {
    throw new Error('R2_BUCKET binding not configured');
  }
  const objectKey = `vimflowy/${encodeURIComponent(userId)}/${encodeURIComponent(key)}`;
  await env.R2_BUCKET.put(objectKey, value, {
    httpMetadata: {
      contentType: 'text/plain; charset=utf-8',
    },
  });
}

async function handleLogin(body, env) {
  const username = body?.username;
  const password = body?.password;
  if (!username || !password) return err('Username and password required', 400);
  const hash = await hashPassword(password);
  const response = await directus(
    env,
    `/items/${USER_COLLECTION}?filter[username][_eq]=${encodeURIComponent(username)}` +
      `&filter[password_hash][_eq]=${encodeURIComponent(hash)}` +
      '&fields=id,username,display_name,role&limit=1'
  );
  const user = response?.data?.[0];
  if (!user) return err('Invalid credentials', 401);
  if (user.id == null || user.id === '') {
    return err('User record has no id (Directus field permissions on vimflowy_users?)', 500);
  }
  const token = await createSession({
    id: String(user.id),
    username: user.username,
    display_name: user.display_name,
    role: user.role,
  }, env);
  return json({ token });
}

async function handleAuthMe(request, env) {
  const user = await getSessionByToken(readBearer(request), env);
  if (!user) return err('Unauthorized', 401);
  return json({ user });
}

async function handleAuthLogout(request, env) {
  const token = readBearer(request);
  if (token) {
    await env.SESSION_KV.delete(`session:${token}`);
  }
  return json({ ok: true });
}

function setupSocket(server, env) {
  let joinedUserId = null;
  let joinedClientId = null;

  sockets.add(server);
  server.accept();

  function sendCallback(messageId, result) {
    server.send(JSON.stringify({ type: 'callback', id: messageId, result }));
  }

  server.addEventListener('message', async (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'join') {
        const user = await getSessionByToken(msg.token, env);
        if (!user) return sendCallback(msg.id, { error: 'Invalid or expired auth token' });
        joinedUserId = user.id;
        joinedClientId = msg.clientId;
        clientMap.set(user.id, msg.clientId);
        for (const ws of sockets) {
          ws.send(JSON.stringify({
            type: 'joined',
            userId: user.id,
            clientId: msg.clientId,
          }));
        }
        return sendCallback(msg.id, { error: null });
      }

      if (!joinedUserId) {
        return sendCallback(msg.id, { error: 'Not authenticated' });
      }
      if (msg.clientId !== joinedClientId || clientMap.get(joinedUserId) !== msg.clientId) {
        return sendCallback(msg.id, { error: 'Other client connected!' });
      }

      if (msg.type === 'get') {
        const value = await getValue(joinedUserId, msg.key, env);
        return sendCallback(msg.id, { value, error: null });
      }

      if (msg.type === 'set') {
        await upsertValue(joinedUserId, msg.key, msg.value, env);
        return sendCallback(msg.id, { error: null });
      }

      if (msg.type === 'setMany') {
        const entries = Array.isArray(msg.entries) ? msg.entries : [];
        await Promise.all(entries
          .filter((entry) => typeof entry?.key === 'string')
          .map((entry) => upsertValue(joinedUserId, entry.key, entry.value, env))
        );
        return sendCallback(msg.id, { error: null });
      }

      return sendCallback(msg.id, { error: `Unknown message type "${msg.type}"` });
    } catch (e) {
      return sendCallback(null, { error: String(e?.message || e) });
    }
  });

  server.addEventListener('close', () => {
    sockets.delete(server);
    if (joinedUserId && clientMap.get(joinedUserId) === joinedClientId) {
      clientMap.delete(joinedUserId);
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    try {
      if (path === '/socket') {
        const upgrade = request.headers.get('Upgrade');
        if (upgrade !== 'websocket') return err('Expected websocket upgrade', 426);
        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];
        setupSocket(server, env);
        return new Response(null, { status: 101, webSocket: client });
      }

      if (path === '/api/auth/login' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        return await handleLogin(body, env);
      }
      if (path === '/api/auth/me' && request.method === 'GET') {
        return await handleAuthMe(request, env);
      }
      if (path === '/api/auth/logout' && request.method === 'POST') {
        return await handleAuthLogout(request, env);
      }
      if (path === '/api/health') {
        await directus(env, '/server/ping');
        if (!env.R2_BUCKET) {
          return err('R2 backend not configured', 503);
        }
        return json({ ok: true });
      }

      if (!path.startsWith('/api/')) {
        const asset = await env.ASSETS.fetch(request);
        if (asset.status !== 404) return asset;
        return await env.ASSETS.fetch(new Request(new URL('/', url), request));
      }

      return err('Not found', 404);
    } catch (e) {
      console.error(e);
      return err(e.message || 'Internal server error', 500);
    }
  },
};
