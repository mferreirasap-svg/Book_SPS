// Monta a aplicação com banco em memória e B1 simulado para os testes.
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { MockServiceLayer } from '../src/b1/mock.js';
import { demoSeed } from '../src/b1/seed.js';
import { hoje, compDe } from '../src/lib/util.js';

export const ADMIN_PASS = 'SenhaForte123';

export async function makeApp() {
  const cfg = {
    nodeEnv: 'test', production: false, host: '127.0.0.1', port: 0, logLevel: 'silent', dbFile: ':memory:',
    session: { cookieName: 'ar_sid', idleMinutes: 30, maxHours: 12, secure: false },
    login: { maxAttempts: 5, lockMinutes: 15 }, allowedOrigins: [], frameAncestors: ["'self'"],
    admin: { login: 'admin', password: ADMIN_PASS }, b1: { mode: 'mock' },
  };
  const b1 = new MockServiceLayer({ seed: demoSeed });
  const app = await buildApp(cfg, { b1Client: b1, db: openDb(':memory:') });
  return { app, b1 };
}

/** Cliente HTTP de teste que guarda o cookie de sessão e envia o cabeçalho anti-CSRF. */
export function client(app) {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const r = await app.inject({
      method, url, payload: body,
      headers: { cookie, ...(method === 'GET' ? {} : { 'x-requested-with': 'aster-rental' }), ...headers },
    });
    const set = r.headers['set-cookie'];
    if (set) cookie = (Array.isArray(set) ? set : [set]).map((c) => c.split(';')[0]).join('; ');
    let json = null;
    try {
      json = r.json();
    } catch {
      json = null;
    }
    return { status: r.statusCode, body: json, headers: r.headers };
  };
  return {
    get: (u, h) => call('GET', u, undefined, h),
    post: (u, b, h) => call('POST', u, b ?? {}, h),
    put: (u, b, h) => call('PUT', u, b ?? {}, h),
    login: (login = 'admin', password = ADMIN_PASS) => call('POST', '/api/auth/login', { login, password }),
  };
}

export const COMP = compDe(hoje());
export const HOJE = hoje();
export const checklist = (itens) => Object.fromEntries(itens.map((i) => [i, { r: 'OK' }]));
