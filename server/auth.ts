import { createHash, randomUUID } from 'crypto';

type DirectusResponse<T> = {
  data: T;
};

type AuthUser = {
  id: string;
  username: string;
  display_name: string;
  role: string;
};

type SessionInfo = {
  user: AuthUser;
  expiresAt: number;
};

export default class AuthService {
  private readonly directusUrl: string;
  private readonly token: string;
  private readonly sessions: { [token: string]: SessionInfo } = {};
  private readonly sessionTtlMs: number;

  constructor(directusUrl: string, token: string, sessionTtlMs: number = 24 * 60 * 60 * 1000) {
    this.directusUrl = directusUrl.replace(/\/+$/, '');
    this.token = token;
    this.sessionTtlMs = sessionTtlMs;
  }

  private async request<T>(path: string, method: string = 'GET', body: Object | null = null): Promise<T> {
    const response = await fetch(`${this.directusUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Directus request failed (${response.status} ${method} ${path}): ${text}`);
    }
    if (response.status === 204) {
      return null as unknown as T;
    }
    return await response.json() as T;
  }

  private hashPassword(password: string): string {
    return createHash('sha256').update(password).digest('hex');
  }

  public async login(username: string, password: string): Promise<{ token: string, user: AuthUser }> {
    const passwordHash = this.hashPassword(password);
    const query = '/items/vimflowy_users' +
      `?filter[username][_eq]=${encodeURIComponent(username)}` +
      `&filter[password_hash][_eq]=${encodeURIComponent(passwordHash)}` +
      '&fields=id,username,display_name,role' +
      '&limit=1';
    const response = await this.request<DirectusResponse<Array<AuthUser>>>(query);
    const user = response.data && response.data[0];
    if (!user) {
      throw new Error('Invalid credentials');
    }
    const token = randomUUID();
    this.sessions[token] = {
      user,
      expiresAt: Date.now() + this.sessionTtlMs,
    };
    return { token, user };
  }

  public getSession(token: string | null): AuthUser | null {
    if (!token) {
      return null;
    }
    const session = this.sessions[token];
    if (!session) {
      return null;
    }
    if (Date.now() > session.expiresAt) {
      delete this.sessions[token];
      return null;
    }
    return session.user;
  }

  public logout(token: string | null): void {
    if (token && token in this.sessions) {
      delete this.sessions[token];
    }
  }

  public async ping(): Promise<void> {
    await this.request('/server/ping');
  }
}
