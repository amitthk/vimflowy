import firebase from 'firebase';
import localForage from 'localforage';
// import "firebase/auth";

import EventEmitter from '../utils/eventEmitter';
import DataBackend, { SynchronousDataBackend } from '../../../shared/data_backend';
import { ExtendableError } from '../../../shared/utils/errors';
import logger from '../../../shared/utils/logger';

export type BackendType = 'local' | 'firebase' | 'inmemory' | 'socketserver';

export class MultipleUsersError extends ExtendableError {
  constructor() { super(
    'This document has been modified (in another tab) since opening it in this tab. Please refresh to continue!'
  ); }
}

// NOTE: not very elegant, but this won't collide with other keys
// since prefix always contains either '*save' or 'settings:'.
// Future backends don't need to use this, as long as they prefix the key passed to them.
// Backends can prefix internal usage with internalPrefix to avoid namespace collision.
const internalPrefix: string = 'internal:';

export class SynchronousLocalStorageBackend extends SynchronousDataBackend {
  // constructor() {
  //   super();
  // }

  public get(key: string): string | null {
    const val = localStorage.getItem(key);
    if ((val == null) || (val === 'undefined')) {
      return null;
    }
    return val;
  }

  public set(key: string, value: string): void {
    return localStorage.setItem(key, value);
  }
}

export class LocalStorageBackend extends DataBackend {
  private lastSave: number;
  private docname: string;
  private sync_backend: SynchronousLocalStorageBackend;

  private _lastSaveKey_(): string {
    return `${internalPrefix}${this.docname}:lastSave`;
  }

  constructor(docname = '') {
    super();
    this.docname = docname;
    this.lastSave = Date.now();
    this.sync_backend = new SynchronousLocalStorageBackend();
  }

  public async get(key: string): Promise<string | null> {
    return this.sync_backend.get(key);
  }

  public async set(key: string, value: string): Promise<void> {
    if (this.getLastSave() > this.lastSave) {
      throw new MultipleUsersError();
    }
    this.lastSave = Date.now();
    this.sync_backend.set(this._lastSaveKey_(), this.lastSave + '');
    this.sync_backend.set(key, value);
  }

  // determine last time saved (for multiple tab detection)
  // note that this doesn't cache!
  public getLastSave(): number {
    return JSON.parse(this.sync_backend.get(this._lastSaveKey_()) || '0');
  }
}

export class IndexedDBBackend extends DataBackend {
  private lastSave: number;
  private docname: string;

  private _lastSaveKey_(): string {
    return `${internalPrefix}${this.docname}:lastSave`;
  }

  constructor(docname = '') {
    super();
    this.docname = docname;
    this.lastSave = Date.now();
  }

  public async get(key: string): Promise<string | null> {
    return localForage.getItem(key);
  }

  public async set(key: string, value: string): Promise<void> {
    if (await this.getLastSave() > this.lastSave) {
      throw new MultipleUsersError();
    }
    this.lastSave = Date.now();
    await localForage.setItem(this._lastSaveKey_(), this.lastSave + '');
    await localForage.setItem(key, value);
    return Promise.resolve();
  }

  // determine last time saved (for multiple tab detection)
  // note that this doesn't cache!
  public async getLastSave(): Promise<number> {
    return JSON.parse(await localForage.getItem(this._lastSaveKey_()) || '0');
  }
}

export class ManualSaveBackend extends DataBackend {
  public events: EventEmitter = new EventEmitter();
  private backend: DataBackend;
  private pendingWrites: {[key: string]: string} = {};
  private dirty: boolean = false;

  constructor(backend: DataBackend) {
    super();
    this.backend = backend;
  }

  public async get(key: string): Promise<string | null> {
    if (key in this.pendingWrites) {
      return this.pendingWrites[key];
    }
    return this.backend.get(key);
  }

  public async set(key: string, value: string): Promise<void> {
    const wasDirty = this.dirty;
    this.pendingWrites[key] = value;
    this.dirty = true;
    if (!wasDirty) {
      this.events.emit('unsaved');
    }
  }

  public async flush(): Promise<void> {
    if (!this.dirty) {
      return;
    }
    const entries = Object.keys(this.pendingWrites).map((key) => ({
      key,
      value: this.pendingWrites[key],
    }));
    await this.backend.setMany(entries);
    this.pendingWrites = {};
    this.dirty = false;
    this.events.emit('saved');
  }
}

export class AuthenticatedServerBackend extends DataBackend {
  private authToken: string;

  constructor(authToken: string) {
    super();
    this.authToken = authToken;
  }

  private async request(path: string, body: Object): Promise<any> {
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.authToken}`,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Request failed with ${response.status}`);
    }
    return payload;
  }

  public async get(key: string): Promise<string | null> {
    const payload = await this.request('/api/data/get', { key });
    if (typeof payload.value === 'string' || payload.value === null) {
      return payload.value;
    }
    return null;
  }

  public async set(key: string, value: string): Promise<void> {
    await this.setMany([{ key, value }]);
  }

  public async setMany(entries: Array<{ key: string, value: string }>): Promise<void> {
    await this.request('/api/data/setMany', { entries });
  }
}

export class FirebaseBackend extends DataBackend {
  public events: EventEmitter = new EventEmitter();

  private fbase: firebase.database.Database;
  private numPendingSaves: number = 0;
  private docname: string;

  constructor(docname = '', dbName: string, apiKey: string) {
    super();
    this.docname = docname;
    this.fbase = firebase.initializeApp({
      apiKey: apiKey,
      databaseURL: `https://${dbName}.firebaseio.com`,
    }).database();
    // this.fbase.authWithCustomToken(token, (err, authdata) => {})
  }

  public async init(email: string, password: string) {
    this.events.emit('saved');

    await this.auth(email, password);

    const clientId = Date.now() + '-' + ('' + Math.random()).slice(2);
    const lastClientRef = this.fbase.ref(`${internalPrefix}${this.docname}:lastClient`);

    await lastClientRef.set(clientId);

    // Number of online users is the number of objects in the presence list.
    lastClientRef.on('value', function(snap) {
      if (snap == null) {
        throw new Error('Failed to get listRef');
      }
      if (snap.val() !== clientId) {
        throw new MultipleUsersError();
      }
    });
  }

  public async auth(email: string, password: string) { // : Promise<UserCredential | undefined>
    try {
        let credential = await firebase.auth().signInWithEmailAndPassword(email, password);
        logger.info('Authenticated against Firebase.');
        return credential;
    } catch (x:any) {
        logger.error('Authentication against Firebase failed: ' + x.code + ': ' + x.message);
        return;
    }
  }

  public get(key: string): Promise<string | null> {
    logger.debug('Firebase: getting', key);
    return new Promise((resolve: (result: string | null) => void, reject) => {
      this.fbase.ref(key).once(
        'value',
        (data) => {
          const exists = data.exists();
          if (!exists) {
            return resolve(null);
          }
          return resolve(data.val());
        },
        (err: Error) => {
          return reject(err);
        }
      );
    });
  }

  // TODO: make this set proper, and do the pending thing elsewhere
  // same with for socket backend
  public set(key: string, value: string): Promise<void> {
    if (this.numPendingSaves === 0) {
      this.events.emit('unsaved');
    }
    logger.debug('Firebase: setting', key, 'to', value);
    this.numPendingSaves++;
    // TODO: buffer these and batch them?
    this.fbase.ref(key).set(
      value,
      (err) => {
        if (err) { throw err; }
        this.numPendingSaves--;
        if (this.numPendingSaves === 0) {
          this.events.emit('saved');
        }
      }
    );
    return Promise.resolve();
  }

  public async flush(): Promise<void> {
    if (this.numPendingSaves === 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.events.once('saved', () => resolve());
    });
  }
}

export class ClientSocketBackend extends DataBackend {
  public events: EventEmitter = new EventEmitter();
  private numPendingSaves: number = 0;
  private callback_table: {[id: string]: {
    resolve: (result: string | null) => void,
    reject: (err: any) => void,
    timeoutId: number,
  }} = {};
  private pendingWrites: {[key: string]: string} = {};
  private dirty: boolean = false;
  private flushTimer: number | null = null;
  private flushInFlight: boolean = false;
  private readonly flushIntervalMs: number = 250;
  private readonly requestTimeoutMs: number = 8000;
  private reconnectTimer: number | null = null;

  // init is like async constructor
  private ws!: WebSocket;
  private clientId: string;
  private userId: string | null = null;
  private authToken: string = '';
  private connected: boolean = false;

  constructor() {
    super();
    this.clientId = Date.now() + '-' + ('' + Math.random()).slice(2);
  }

  private async connect(host: string, userId: string) {
    logger.info('Trying to connect', host);
    this.ws = new WebSocket(`${host}/socket`);
    this.ws.onerror = () => {
      logger.info('Socket connection error!');
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.rejectPendingCallbacks(new Error('Socket connection closed before response was received'));
      logger.info('Socket connection closed! Trying to reconnect...');
      if (this.reconnectTimer !== null) {
        window.clearTimeout(this.reconnectTimer);
      }
      this.reconnectTimer = window.setTimeout(() => {
        this.connect(host, userId).catch((err) => {
          logger.error('Reconnect failed:', err);
        });
      }, 2000);
    };

    await new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        reject(new Error('Timed out trying to connect!'));
      }, 5000);
      this.ws.onopen = () => {
        window.clearTimeout(timeoutId);
        resolve(null);
      };
    });
    logger.info('Connected', host);
    this.connected = true;

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'callback') {
        const id: string = message.id;
        if (!(id in this.callback_table)) {
          logger.warn(`ID ${id} not found in callback table`);
          return;
        }
        const callback = this.callback_table[id];
        window.clearTimeout(callback.timeoutId);
        delete this.callback_table[id];
        if (message.result.error) {
          callback.reject(message.result.error);
        } else {
          callback.resolve(message.result.value);
        }
      } else if (message.type === 'joined') {
        if (message.userId === userId) {
          if (message.clientId !== this.clientId) {
            throw new MultipleUsersError();
          }
        }
      }
    };

    await this.sendMessage({
      type: 'join',
      token: this.authToken,
    });

    this.flushNow().catch((err) => {
      logger.error('Flush after reconnect failed:', err);
    });
  }

  public async init(host: string, userId: string, authToken: string) {
    this.userId = userId;
    this.authToken = authToken;
    this.events.emit('saved');
    await this.connect(host, userId);
  }

  private rejectPendingCallbacks(error: Error) {
    const callbackIds = Object.keys(this.callback_table);
    for (let i = 0; i < callbackIds.length; i++) {
      const callbackId = callbackIds[i];
      const callback = this.callback_table[callbackId];
      window.clearTimeout(callback.timeoutId);
      callback.reject(error);
      delete this.callback_table[callbackId];
    }
  }

  private async sendMessage(message: Object): Promise<string | null> {
    return new Promise((resolve: (result: string | null) => void, reject) => {
      if (!this.connected || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Socket client is disconnected'));
        return;
      }
      const id = Date.now() + '-' + ('' + Math.random()).slice(2);
      if (id in this.callback_table) { throw new Error('Duplicate IDs!?'); }
      const timeoutId = window.setTimeout(() => {
        if (!(id in this.callback_table)) {
          return;
        }
        delete this.callback_table[id];
        reject(new Error(`Socket request timed out (${this.requestTimeoutMs}ms)`));
      }, this.requestTimeoutMs);
      this.callback_table[id] = { resolve, reject, timeoutId };
      this.ws.send(JSON.stringify({
        ...message,
        id: id,
        clientId: this.clientId
      }));
    });
  }

  public async get(key: string): Promise<string | null> {
    logger.debug('Socket client: getting', key);
    return await this.sendMessage({
      type: 'get',
      key: key,
    });
  }

  public set(key: string, value: string): Promise<void> {
    if (this.numPendingSaves === 0) {
      this.events.emit('unsaved');
    }
    this.pendingWrites[key] = value;
    this.dirty = true;
    this.numPendingSaves = Object.keys(this.pendingWrites).length + (this.flushInFlight ? 1 : 0);
    this.scheduleFlush();
    return Promise.resolve();
  }

  private scheduleFlush() {
    if (this.flushTimer !== null) {
      return;
    }
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      this.flushNow().catch((err) => {
        logger.error('Flush failed:', err);
        this.scheduleFlush();
      });
    }, this.flushIntervalMs);
  }

  private async flushNow(options: { failIfDisconnected?: boolean } = {}) {
    const { failIfDisconnected = false } = options;
    if (!this.dirty) {
      return;
    }
    if (this.flushInFlight) {
      return;
    }
    if (!this.connected) {
      if (failIfDisconnected) {
        throw new Error('Cannot flush while socket is disconnected');
      }
      return;
    }
    const batch: {[key: string]: string} = this.pendingWrites;
    const batchKeys = Object.keys(batch);
    if (batchKeys.length === 0) {
      this.dirty = false;
      this.numPendingSaves = 0;
      this.events.emit('saved');
      return;
    }

    this.pendingWrites = {};
    this.dirty = false;
    this.flushInFlight = true;
    this.numPendingSaves = batchKeys.length;

    try {
      await this.sendMessage({
        type: 'setMany',
        entries: batchKeys.map((key) => ({
          key,
          value: batch[key],
        })),
      });
    } catch (err) {
      // Re-queue failed writes unless newer values already replaced them.
      batchKeys.forEach((key) => {
        if (!(key in this.pendingWrites)) {
          this.pendingWrites[key] = batch[key];
        }
      });
      this.dirty = Object.keys(this.pendingWrites).length > 0;
      this.numPendingSaves = Object.keys(this.pendingWrites).length;
      throw err;
    } finally {
      this.flushInFlight = false;
    }

    const remaining = Object.keys(this.pendingWrites).length;
    if (remaining > 0) {
      this.dirty = true;
      this.numPendingSaves = remaining;
      this.scheduleFlush();
      return;
    }
    this.numPendingSaves = 0;
    this.events.emit('saved');
  }

  public async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushNow({ failIfDisconnected: true });
  }
}
