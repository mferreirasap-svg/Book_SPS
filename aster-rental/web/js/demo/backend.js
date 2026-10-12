// Backend de demonstração que roda no próprio navegador, usado quando a tela abre sem o servidor
// (por exemplo, no link online). Usa as MESMAS rotas e serviços do servidor; troca só o que depende
// do Node: usuários, auditoria e tarefas ficam no navegador e o SAP B1 é o simulado.
// Caminhos relativos à publicação: js/demo/ → ../../server/src/
import { MockServiceLayer } from '../../server/src/b1/mock.js';
import { demoSeed } from '../../server/src/b1/seed.js';
import { createServices } from '../../server/src/services/index.js';
import { PROFILES, permsOf } from '../../server/src/auth/permissions.js';
import { HttpError, badRequest, forbidden, uid } from '../../server/src/lib/util.js';
import authRoutes from '../../server/src/routes/auth.js';
import cadastroRoutes from '../../server/src/routes/cadastros.js';
import operacaoRoutes from '../../server/src/routes/operacao.js';
import faturamentoRoutes from '../../server/src/routes/faturamento.js';
import adminRoutes from '../../server/src/routes/admin.js';

const DEMO_PASSWORD = 'Demo2026senha';
const K = { b1: 'aster-rental-demo-b1', users: 'aster-rental-demo-users', audit: 'aster-rental-demo-audit', session: 'aster-rental-demo-sessions', token: 'aster-rental-demo-token' };

const ls = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* armazenamento indisponível: segue só em memória */
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignora */
    }
  },
};

// Hash simples só para a demonstração (os dados ficam apenas neste navegador).
const hash = (s) => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `d1$${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
};

function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 10) throw badRequest('A senha precisa ter pelo menos 10 caracteres.');
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) throw badRequest('A senha precisa ter letras e números.');
}

/** Mesma interface do AuthService do servidor. */
class BrowserAuth {
  constructor() {
    this.users = ls.get(K.users) || [];
    this.sessions = new Map(Object.entries(ls.get(K.session) || {}));
    if (!this.users.length) this.createUser({ login: 'admin', name: 'Administrador', password: DEMO_PASSWORD, profile: 'administrador' });
  }
  save() {
    ls.set(K.users, this.users);
  }
  publicUser(u) {
    return { id: u.id, login: u.login, name: u.name, email: u.email || '', profile: u.profile, profileName: PROFILES[u.profile]?.name || u.profile,
      b1User: u.b1_user || '', branches: u.branches || [], active: !!u.active, perms: [...permsOf(u.profile)] };
  }
  createUser({ login, name, email = '', password, profile, b1User = '', branches = [] }) {
    if (!/^[a-z0-9._-]{3,40}$/i.test(login || '')) throw badRequest('Login inválido (3 a 40 letras, números, ponto, hífen ou sublinhado).');
    if (!name) throw badRequest('Informe o nome.');
    if (!PROFILES[profile]) throw badRequest('Perfil inválido.');
    validatePassword(password);
    if (this.users.some((u) => u.login.toLowerCase() === login.toLowerCase())) throw badRequest('Já existe um usuário com este login.');
    const u = { id: (this.users.reduce((m, x) => Math.max(m, x.id), 0) || 0) + 1, login, name, email, password_hash: hash(password), profile, b1_user: b1User,
      branches: branches.map(Number).filter(Boolean), active: 1, failed: 0, locked_until: null };
    this.users.push(u);
    this.save();
    return this.publicUser(u);
  }
  updateUser(id, { name, email, profile, b1User, branches, active, password }) {
    const u = this.users.find((x) => x.id === Number(id));
    if (!u) throw new HttpError(404, 'Usuário não encontrado.');
    if (profile && !PROFILES[profile]) throw badRequest('Perfil inválido.');
    if (password) validatePassword(password);
    Object.assign(u, { name: name ?? u.name, email: email ?? u.email, profile: profile ?? u.profile, b1_user: b1User ?? u.b1_user,
      branches: branches ? branches.map(Number).filter(Boolean) : u.branches, active: active == null ? u.active : active ? 1 : 0 });
    if (password) Object.assign(u, { password_hash: hash(password), failed: 0, locked_until: null });
    this.save();
    return this.publicUser(u);
  }
  getUser(id) {
    const u = this.users.find((x) => x.id === Number(id));
    return u ? this.publicUser(u) : null;
  }
  listUsers() {
    return [...this.users].sort((a, b) => a.name.localeCompare(b.name)).map((u) => this.publicUser(u));
  }
  verifyPassword(id, password) {
    const u = this.users.find((x) => x.id === Number(id));
    if (!u || u.password_hash !== hash(String(password || ''))) throw badRequest('Senha atual incorreta.');
  }
  login(login, password) {
    const u = this.users.find((x) => x.login.toLowerCase() === String(login || '').toLowerCase());
    if (!u || !u.active) throw new HttpError(401, 'Login ou senha inválidos.');
    if (u.locked_until && u.locked_until > Date.now()) throw new HttpError(429, 'Usuário bloqueado temporariamente por tentativas erradas. Tente mais tarde.');
    if (u.password_hash !== hash(String(password || ''))) {
      u.failed = (u.failed || 0) + 1;
      if (u.failed >= 5) Object.assign(u, { failed: 0, locked_until: Date.now() + 15 * 60000 });
      this.save();
      throw new HttpError(401, 'Login ou senha inválidos.');
    }
    Object.assign(u, { failed: 0, locked_until: null });
    this.save();
    const token = uid() + uid();
    this.sessions.set(token, { id: u.id, seen: Date.now() });
    this.saveSessions();
    return { token, user: this.publicUser(u) };
  }
  session(token) {
    const s = token && this.sessions.get(token);
    if (!s) return null;
    if (Date.now() - s.seen > 30 * 60000) {
      this.sessions.delete(token);
      return null;
    }
    s.seen = Date.now();
    const u = this.users.find((x) => x.id === s.id);
    return u && u.active ? this.publicUser(u) : null;
  }
  logout(token) {
    this.sessions.delete(token);
    this.saveSessions();
  }
  saveSessions() {
    ls.set(K.session, Object.fromEntries(this.sessions));
  }
}

function createAudit() {
  const rows = ls.get(K.audit) || [];
  const clean = (v) => (v == null ? null : JSON.stringify(v, (k, val) => (['U_Assinatura', 'password'].includes(k) ? '[omitido]' : val)));
  return {
    record(req, { action, entity, id, before, after }) {
      rows.unshift({ id: (rows[0]?.id || 0) + 1, at: new Date().toISOString(), user_login: req?.user?.login || 'sistema', action, entity,
        entity_id: id == null ? null : String(id), before_json: clean(before), after_json: clean(after), ip: 'navegador', request_id: req?.id || '' });
      rows.length = Math.min(rows.length, 1500);
      ls.set(K.audit, rows);
    },
    list({ entity, id, user, limit = 200 } = {}) {
      return rows.filter((r) => (!entity || r.entity === entity) && (!id || r.entity_id === String(id)) && (!user || r.user_login === user)).slice(0, Number(limit) || 200);
    },
  };
}

function createJobs() {
  const jobs = new Map();
  return {
    start(type, { createdBy, payload, total = 0 }, worker) {
      const id = uid();
      const j = { id, type, status: 'running', payload: payload || {}, progress: 0, total, result: [], created_by: createdBy || '' };
      jobs.set(id, j);
      setTimeout(async () => {
        try {
          await worker((item) => {
            j.result.push(item);
            j.progress = j.result.length;
          });
          j.status = 'done';
        } catch (e) {
          j.result.push({ ok: false, message: e.message });
          j.status = 'failed';
        }
      }, 0);
      return id;
    },
    get: (id) => (jobs.has(id) ? structuredClone(jobs.get(id)) : null),
  };
}

/** Roteador no formato do Fastify, para registrar os mesmos módulos de rotas do servidor. */
function createRouter() {
  const routes = [];
  const add = (method) => (path, a, b) => {
    const [opts, handler] = b ? [a, b] : [{}, a];
    const keys = [];
    const re = new RegExp(`^${path.replace(/:([A-Za-z]+)/g, (_, k) => {
      keys.push(k);
      return '([^/]+)';
    })}$`);
    routes.push({ method, re, keys, opts, handler });
  };
  const app = {
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    can: (...perms) => async (req) => {
      if (!perms.some((p) => req.user?.perms.includes(p))) throw forbidden();
    },
  };
  return { app, routes };
}

export async function createDemoBackend() {
  const cfg = { session: { cookieName: 'ar_sid', secure: false, maxHours: 12 }, b1: { mode: 'mock', company: 'demonstração' } };
  const sl = new MockServiceLayer({ seed: demoSeed, storage: { load: () => ls.get(K.b1), save: (db) => ls.set(K.b1, db) } });
  const auth = new BrowserAuth();
  const audit = createAudit();
  const jobs = createJobs();
  const idemMap = new Map();
  const idem = { get: (k, u) => idemMap.get(`${u}|${k}`), save: (k, u, status, response) => idemMap.set(`${u}|${k}`, { status, response }) };
  const deps = { cfg, auth, audit, jobs, sl, idem, ...createServices({ sl, audit, jobs }) };

  const { app, routes } = createRouter();
  for (const r of [authRoutes, cadastroRoutes, operacaoRoutes, faturamentoRoutes, adminRoutes]) await r(app, { deps });
  app.get('/health', async () => ({ ok: true, b1Mode: 'mock', version: 'demo' }));
  const PUBLIC = new Set(['/auth/login', '/health']);
  let token = ls.get(K.token);

  /** Atende uma chamada da tela como se fosse a API do servidor. */
  return async function handle(method, url, body, headers = {}) {
    const [path, q = ''] = url.split('?');
    const route = routes.find((r) => r.method === method && r.re.test(path));
    if (!route) return { status: 404, body: { error: 'Rota não encontrada.' } };
    const m = route.re.exec(path);
    const req = {
      method, url, id: uid(), ip: 'navegador', params: Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])),
      query: Object.fromEntries(new URLSearchParams(q)), body: body ? structuredClone(body) : {},
      headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), cookies: { ar_sid: token },
    };
    const reply = {
      statusCode: 200, payload: undefined, sent: false,
      status(c) { this.statusCode = c; return this; },
      send(v) { this.payload = v; this.sent = true; return this; },
      header() { return this; },
      setCookie(_n, v) { token = v; ls.set(K.token, v); return this; },
      clearCookie() { token = null; ls.del(K.token); return this; },
    };
    try {
      if (!PUBLIC.has(path)) {
        req.user = auth.session(token);
        if (!req.user) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
      }
      if (path === '/auth/login' && (typeof req.body.login !== 'string' || typeof req.body.password !== 'string')) throw badRequest('Dados inválidos.');
      const pre = route.opts.preHandler;
      for (const h of Array.isArray(pre) ? pre : pre ? [pre] : []) await h(req, reply);
      const out = await route.handler(req, reply);
      const payload = reply.sent ? reply.payload : out;
      return { status: reply.statusCode, body: payload === undefined ? null : structuredClone(payload) };
    } catch (e) {
      const status = e.statusCode || 500;
      if (status >= 500) console.error(e);
      return { status, body: { error: status >= 500 && !e.b1Code ? 'Erro interno na demonstração.' : e.message, requestId: req.id } };
    }
  };
}

export function resetDemoStorage() {
  Object.values(K).forEach((k) => ls.del(k));
}
