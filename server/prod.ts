import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { AddressInfo } from 'net';

import express from 'express';
import minimist from 'minimist';
import dotenv from 'dotenv';

import logger from '../src/shared/utils/logger';
import DataBackend, { InMemory } from '../src/shared/data_backend';

import AuthService from './auth';
import makeSocketServer from './socket_server';
import { defaultBuildDir } from './constants';
import { DirectusBackend } from './data_backends';

// Load environment variables
dotenv.config();

function readBearerToken(req: express.Request): string | null {
  const auth = req.header('Authorization');
  if (!auth) {
    return null;
  }
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function main(args: any) {
  if (args.help || args.h) {
    process.stdout.write(`
      Usage: ./node_modules/.bin/ts-node ${process.argv[1]}
          -h, --help: help menu

          --host $hostname: Host to listen on
          --port $portnumber: Port to run on

          --buildDir: Where build assets should be served from.  Defaults to the \`build\`
            folder at the repo root.

          Environment Variables (can be used instead of CLI args):
          - DIRECTUS_STATIC_URL: Directus base URL
          - DIRECTUS_STATIC_TOKEN: Directus static token (runtime access)
          - DIRECTUS_ADMIN_TOKEN: Directus admin token (used by setup script)

    `, () => {
      process.exit(0);
    });
    return;
  }

  const buildDir = path.resolve(args.buildDir || defaultBuildDir);

  let port: number = args.port || 3000;
  let host: string = args.host || 'localhost';

  if (!fs.existsSync(buildDir)) {
    logger.info(`
        No assets found at ${buildDir}!
        Try running \`npm run build -- --outdir ${buildDir}\` first.
        Or specify where they should be found with --buildDir $somedir.
    `);
    return;
  }

  const directusUrl = args.directusUrl || process.env.DIRECTUS_STATIC_URL;
  const directusToken = args.directusToken || process.env.DIRECTUS_STATIC_TOKEN;

  if (!directusUrl || !directusToken) {
    logger.error('DIRECTUS_STATIC_URL and DIRECTUS_STATIC_TOKEN are required.');
    process.exit(1);
  }

  const auth = new AuthService(directusUrl, directusToken);
  await auth.ping();
  const backends: {[userId: string]: DataBackend} = {};

  async function getBackendForUser(userId: string): Promise<DataBackend> {
    if (backends[userId]) {
      return backends[userId];
    }
    let backend: DataBackend;
    if (directusUrl && directusToken) {
      backend = new DirectusBackend(userId, directusUrl, directusToken);
    } else {
      backend = new InMemory();
    }
    backends[userId] = backend;
    return backend;
  }

  logger.info('Starting production server');
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.post('/api/auth/login', async (req, res) => {
    const username = req.body && req.body.username;
    const password = req.body && req.body.password;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    try {
      const result = await auth.login(username, password);
      return res.json(result);
    } catch (err: any) {
      logger.error('Login failed:', err.message);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
  });

  app.get('/api/auth/me', (req, res) => {
    const token = readBearerToken(req);
    const user = auth.getSession(token);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.json({ user });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = readBearerToken(req);
    auth.logout(token);
    return res.json({ ok: true });
  });

  app.get('/api/documents', async (req, res) => {
    const token = readBearerToken(req);
    const user = auth.getSession(token);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const backend = await getBackendForUser(user.id);
      if (typeof (backend as any).listDocumentNames === 'function') {
        const names = await (backend as any).listDocumentNames();
        return res.json({ documents: names });
      } else {
        // Backend doesn't support document listing
        return res.json({ documents: [] });
      }
    } catch (err: any) {
      logger.error('List documents failed:', err.message);
      return res.status(500).json({ error: 'Failed to list documents' });
    }
  });

  app.post('/api/data/get', async (req, res) => {
    const token = readBearerToken(req);
    const user = auth.getSession(token);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const key = req.body && req.body.key;
    if (typeof key !== 'string' || key.length === 0) {
      return res.status(400).json({ error: 'Key is required' });
    }
    try {
      const backend = await getBackendForUser(user.id);
      const value = await backend.get(key);
      return res.json({ value });
    } catch (err: any) {
      logger.error('Data get failed:', err.message);
      return res.status(500).json({ error: 'Failed to read data' });
    }
  });

  app.post('/api/data/setMany', async (req, res) => {
    const token = readBearerToken(req);
    const user = auth.getSession(token);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const entriesRaw = req.body && req.body.entries;
    const entries = Array.isArray(entriesRaw) ? entriesRaw.filter((entry: any) => (
      entry && typeof entry.key === 'string' && typeof entry.value === 'string'
    )) : [];
    try {
      const backend = await getBackendForUser(user.id);
      await backend.setMany(entries);
      return res.json({ ok: true });
    } catch (err: any) {
      logger.error('Data setMany failed:', err.message);
      return res.status(500).json({ error: 'Failed to write data' });
    }
  });

  app.use(express.static(buildDir));

  const server = http.createServer(app as any);

  makeSocketServer(server, {
    directusUrl,
    directusToken,
    path: '/socket',
    authService: auth,
  });

  server.listen(port, host, (err?: Error) => {
    if (err) { return logger.error(err); }
    const address_info: AddressInfo = server.address() as AddressInfo;
    logger.info('Listening on http://%s:%d', address_info.address, address_info.port);
  });
}

main(minimist(process.argv.slice(2)));
