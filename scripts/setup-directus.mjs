#!/usr/bin/env node
// Creates Directus collections and permissions for Vimflowy
// Usage: npm run setup:directus   (loads .env from repo root via dotenv)

import 'dotenv/config';
import { createHash } from 'crypto';

const DIRECTUS_URL = process.env.DIRECTUS_STATIC_URL;
const ADMIN_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;
const STATIC_TOKEN = process.env.DIRECTUS_STATIC_TOKEN;

if (!DIRECTUS_URL) {
  console.error('DIRECTUS_STATIC_URL is required');
  process.exit(1);
}
if (!ADMIN_TOKEN) {
  console.error('DIRECTUS_ADMIN_TOKEN is required for schema setup');
  process.exit(1);
}

function directusClient(token) {
  return async function api(path, method = 'GET', body = null) {
    const opts = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${DIRECTUS_URL}${path}`, opts);
    const text = await res.text();
    if (!res.ok) {
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {}
      const alreadyExists = res.status === 409 || (
        res.status === 400 &&
        payload?.errors?.some((err) => String(err?.extensions?.reason || '').includes('already exists'))
      );
      if (alreadyExists) {
        return 'exists';
      }
      console.error(`  ERROR ${res.status} on ${method} ${path}: ${text}`);
      return null;
    }
    if (res.status === 409) {
      return 'exists';
    }
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return text;
    }
  };
}

const adminApi = directusClient(ADMIN_TOKEN);
const staticApi = STATIC_TOKEN ? directusClient(STATIC_TOKEN) : null;

async function createCollection(api, collection, fields, meta = {}) {
  console.log(`\nCreating collection: ${collection}`);
  const result = await api('/collections', 'POST', {
    collection,
    meta: { icon: meta.icon || 'box', note: meta.note || '' },
    schema: {},
    fields: [
      { field: 'id', type: 'integer', meta: { hidden: true, interface: 'input', readonly: true }, schema: { is_primary_key: true, has_auto_increment: true } },
      ...fields,
    ],
  });

  if (result === 'exists') {
    console.log(`  Collection "${collection}" already exists. Adding missing fields...`);
    for (const f of fields) {
      await api(`/fields/${collection}`, 'POST', f);
    }
  }
  return result;
}

async function ensureStaticTokenPermissions() {
  console.log('\n--- Setting permissions for runtime static token ---');
  if (!STATIC_TOKEN || !staticApi) {
    console.log('  DIRECTUS_STATIC_TOKEN not set, skipping permissions.');
    return;
  }

  const me = await staticApi('/users/me?fields=id');
  const staticUserId = me?.data?.id;
  if (!staticUserId) {
    console.log('  Could not resolve static token user.');
    return;
  }

  const staticUser = await adminApi(`/users/${staticUserId}?fields=id,role`);
  const roleId = staticUser?.data?.role;
  if (!roleId) {
    console.log('  Static token user has no role. Configure policy manually.');
    return;
  }

  const roleInfo = await adminApi(`/roles/${roleId}?fields=id,name,policies.policy`);
  const targetPolicy = roleInfo?.data?.policies?.[0]?.policy || null;
  if (!targetPolicy) {
    console.log('  Could not resolve role policy for static token user. Configure permissions manually.');
    return;
  }
  console.log(`  Static token policy: ${targetPolicy}`);

  const collections = ['vimflowy_users', 'vimflowy_data'];
  const actions = ['create', 'read', 'update', 'delete'];
  for (const collection of collections) {
    for (const action of actions) {
      await adminApi('/permissions', 'POST', {
        policy: targetPolicy,
        collection,
        action,
        fields: ['*'],
      });
    }
  }
  console.log('  Runtime token policy permissions ensured.');
}

async function seedAdmin() {
  console.log('\n--- Seeding Vimflowy admin user ---');
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = createHash('sha256').update(adminPassword).digest('hex');

  const existing = await adminApi('/items/vimflowy_users?filter[username][_eq]=admin&limit=1');
  if (existing?.data?.length > 0) {
    await adminApi(`/items/vimflowy_users/${existing.data[0].id}`, 'PATCH', {
      password_hash: hash,
      display_name: 'Administrator',
      role: 'admin',
    });
    console.log('  Updated existing admin user.');
  } else {
    await adminApi('/items/vimflowy_users', 'POST', {
      username: 'admin',
      password_hash: hash,
      display_name: 'Administrator',
      role: 'admin',
    });
    console.log('  Created admin user.');
  }
  console.log('  Admin username: admin (password is the value of ADMIN_PASSWORD in .env; not printed here).');
}

async function main() {
  console.log(`Directus URL: ${DIRECTUS_URL}`);
  console.log('Testing admin connection...');
  const ping = await adminApi('/server/ping');
  if (!ping) {
    console.error('Cannot reach Directus with admin token.');
    process.exit(1);
  }
  console.log('Connected OK.');

  await createCollection(adminApi, 'vimflowy_users', [
    { field: 'username', type: 'string', meta: { interface: 'input', required: true, options: { trim: true } }, schema: { is_unique: true, max_length: 100 } },
    { field: 'password_hash', type: 'string', meta: { interface: 'input', hidden: true }, schema: { max_length: 64 } },
    { field: 'display_name', type: 'string', meta: { interface: 'input', required: true }, schema: { max_length: 200 } },
    { field: 'role', type: 'string', meta: { interface: 'select-dropdown', options: { choices: [{ text: 'Admin', value: 'admin' }, { text: 'User', value: 'user' }] }, width: 'half' }, schema: { max_length: 20, default_value: 'user' } },
    { field: 'date_created', type: 'timestamp', meta: { interface: 'datetime', readonly: true, special: ['date-created'] }, schema: {} },
    { field: 'date_updated', type: 'timestamp', meta: { interface: 'datetime', readonly: true, special: ['date-updated'] }, schema: {} },
  ], { icon: 'person', note: 'Vimflowy login users' });

  await createCollection(adminApi, 'vimflowy_data', [
    { field: 'user_id', type: 'string', meta: { interface: 'input', required: true }, schema: { max_length: 255 } },
    { field: 'key', type: 'string', meta: { interface: 'input', required: true }, schema: { max_length: 255 } },
    { field: 'value', type: 'text', meta: { interface: 'input-multiline' }, schema: {} },
    { field: 'date_created', type: 'timestamp', meta: { interface: 'datetime', readonly: true, special: ['date-created'] }, schema: {} },
    { field: 'date_updated', type: 'timestamp', meta: { interface: 'datetime', readonly: true, special: ['date-updated'] }, schema: {} },
  ], { icon: 'storage', note: 'Vimflowy websocket key/value state' });

  await ensureStaticTokenPermissions();
  await seedAdmin();
  console.log('\nSetup complete.');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
