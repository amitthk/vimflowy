import * as http from 'http';

import * as WebSocket from 'ws';

import DataBackend, { InMemory } from '../src/shared/data_backend';
import logger from '../src/shared/utils/logger';

import { PostgresBackend } from './data_backends';

type SocketServerOptions = {
  db?: string,
  dbConnectionString?: string,
  path?: string,
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
    if (options.db === 'postgres' && options.dbConnectionString) {
      logger.info('Using PostgreSQL database for user:', userId);
      const pg_db = new PostgresBackend(userId);
      await pg_db.init(options.dbConnectionString);
      db = pg_db;
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
      const msg = JSON.parse(msg_string);

      function respond(result: { value?: any, error: string | null }) {
        ws.send(JSON.stringify({
          type: 'callback',
          id: msg.id,
          result: result,
        }));
      }

      if (msg.type === 'join') {
        if (!msg.userId) {
          return respond({ error: 'User ID required!' });
        }
        authed = true;
        userId = msg.userId;
        clients[msg.userId] = msg.clientId;
        broadcast({
          type: 'joined',
          clientId: msg.clientId,
          userId: msg.userId,
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
      }
    });

    ws.on('close', () => {
      logger.info('Socket connection closed!');
      // TODO: clean up stuff?
    });
  });
  return server;
}
