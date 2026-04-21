import * as http from 'http';

import * as WebSocket from 'ws';

import DataBackend, { InMemory } from '../src/shared/data_backend';
import logger from '../src/shared/utils/logger';

import AuthService from './auth';
import { DirectusBackend } from './data_backends';

type SocketServerOptions = {
  directusUrl?: string,
  directusToken?: string,
  path?: string,
  authService: AuthService,
};

export default function makeSocketServer(server: http.Server, options: SocketServerOptions) {
  const wss = new WebSocket.Server({ server, path: options.path });

  const dbs: {[userId: string]: DataBackend} = {};
  const clients: {[userId: string]: string} = {};

  async function getBackend(userId: string): Promise<DataBackend> {
    if (userId in dbs) {
      return dbs[userId];
    }
    let db: DataBackend;
    if (options.directusUrl && options.directusToken) {
      logger.info('Using Directus database for user:', userId);
      db = new DirectusBackend(userId, options.directusUrl, options.directusToken);
    } else {
      logger.info('Using in-memory database for user:', userId);
      db = new InMemory();
    }
    dbs[userId] = db;
    return db;
  }

  function broadcast(message: Object): void {
    wss.clients.forEach(client => {
      client.send(JSON.stringify(message));
    });
  }

  wss.on('connection', function connection(ws) {
    logger.info('New socket connection!');
    let authed = false;
    let userId: string | null = null;
    ws.on('message', async (msg_string) => {
      logger.debug('received message: %s', msg_string);
      let msg: any;
      try {
        const raw = typeof msg_string === 'string' ? msg_string : msg_string.toString();
        msg = JSON.parse(raw);
      } catch (_err) {
        ws.send(JSON.stringify({
          type: 'callback',
          id: null,
          result: { error: 'Invalid JSON payload' },
        }));
        return;
      }

      function respond(result: { value?: any, error: string | null }) {
        ws.send(JSON.stringify({
          type: 'callback',
          id: msg.id,
          result: result,
        }));
      }

      if (msg.type === 'join') {
        if (!msg.token) {
          return respond({ error: 'Auth token required!' });
        }
        const user = options.authService.getSession(msg.token);
        if (!user) {
          return respond({ error: 'Invalid or expired auth token' });
        }
        authed = true;
        userId = user.id;
        clients[user.id] = msg.clientId;
        broadcast({
          type: 'joined',
          clientId: msg.clientId,
          userId: user.id,
        });
        return respond({ error: null });
      }

      if (!authed) {
        return respond({ error: 'Not authenticated!' });
      }
      if (userId == null) {
        throw new Error('No userId!');
      }
      if (msg.clientId !== clients[userId]) {
        return respond({ error: 'Other client connected!' });
      }
      const db = await getBackend(userId);

      if (msg.type === 'get') {
        const value = await db.get(msg.key);
        logger.debug('got', msg.key, value);
        respond({ value: value, error: null });
      } else if (msg.type === 'set') {
        await db.set(msg.key, msg.value);
        logger.debug('set', msg.key, msg.value);
        respond({ error: null });
      } else if (msg.type === 'setMany') {
        if (!Array.isArray(msg.entries)) {
          return respond({ error: 'entries must be an array' });
        }
        const entries = msg.entries.filter((entry: any) => entry && typeof entry.key === 'string');
        await db.setMany(entries);
        logger.debug('setMany', entries.length);
        respond({ error: null });
      } else {
        respond({ error: `Unknown message type "${msg.type}"` });
      }
    });

    ws.on('close', () => {
      logger.info('Socket connection closed!');
      // TODO: clean up stuff?
    });
  });
  return server;
}
