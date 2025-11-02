import { Pool, PoolClient } from 'pg';

import DataBackend from '../src/shared/data_backend';

export class PostgresBackend extends DataBackend {
  private pool!: Pool;
  private tableName: string = 'vimflowy_data';
  private userId: string;

  constructor(userId: string) {
    super();
    this.userId = userId;
  }

  public async init(connectionString: string): Promise<void> {
    this.pool = new Pool({
      connectionString: connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    const client: PoolClient = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          user_id VARCHAR(255) NOT NULL,
          key VARCHAR(255) NOT NULL,
          value TEXT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, key)
        )
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_user_key ON ${this.tableName} (user_id, key)
      `);
    } finally {
      client.release();
    }
  }

  public async get(key: string): Promise<string | null> {
    const client: PoolClient = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT value FROM ${this.tableName} WHERE user_id = $1 AND key = $2`,
        [this.userId, key]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      return result.rows[0].value;
    } finally {
      client.release();
    }
  }

  public async set(key: string, value: string): Promise<void> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO ${this.tableName} (user_id, key, value, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, key) 
         DO UPDATE SET value = $3, updated_at = CURRENT_TIMESTAMP`,
        [this.userId, key, value]
      );
    } finally {
      client.release();
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
