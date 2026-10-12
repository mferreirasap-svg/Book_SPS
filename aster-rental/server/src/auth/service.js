// Usuários e sessões do Áster Rental (requisitos SEG-01, SEG-03, SEG-13).
// Senhas com bcrypt; a sessão é um token aleatório guardado só como hash no banco.
import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PROFILES, permsOf } from './permissions.js';
import { HttpError, badRequest } from '../lib/util.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const nowIso = () => new Date().toISOString();

export function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 10) throw badRequest('A senha precisa ter pelo menos 10 caracteres.');
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) throw badRequest('A senha precisa ter letras e números.');
}

export class AuthService {
  constructor(db, cfg) {
    this.db = db;
    this.cfg = cfg;
  }

  publicUser(u) {
    return {
      id: u.id, login: u.login, name: u.name, email: u.email, profile: u.profile, profileName: PROFILES[u.profile]?.name || u.profile,
      b1User: u.b1_user, branches: JSON.parse(u.branches || '[]'), active: !!u.active, perms: [...permsOf(u.profile)],
    };
  }

  /** Cria o administrador inicial se o banco ainda não tem usuários. */
  ensureAdmin(log) {
    const n = this.db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    if (n > 0) return null;
    let password = this.cfg.admin.password;
    let generated = false;
    if (!password) {
      if (this.cfg.production) throw new Error('Defina ADMIN_PASSWORD para criar o administrador inicial.');
      password = this.cfg.b1?.mode === 'mock' && this.cfg.demoPassword ? this.cfg.demoPassword : `Ar${randomBytes(9).toString('base64url')}9`;
      generated = true;
    }
    validatePassword(password);
    this.createUser({ login: this.cfg.admin.login, name: 'Administrador', password, profile: 'administrador' });
    if (generated) console.log(`\n  Administrador criado — usuário: ${this.cfg.admin.login}   senha: ${password}\n  (troque a senha no primeiro acesso)\n`);
    return { login: this.cfg.admin.login, password: generated ? password : undefined };
  }

  createUser({ login, name, email = '', password, profile, b1User = '', branches = [] }) {
    if (!/^[a-z0-9._-]{3,40}$/i.test(login || '')) throw badRequest('Login inválido (3 a 40 letras, números, ponto, hífen ou sublinhado).');
    if (!name) throw badRequest('Informe o nome.');
    if (!PROFILES[profile]) throw badRequest('Perfil inválido.');
    validatePassword(password);
    if (this.db.prepare('SELECT 1 FROM users WHERE login = ?').get(login)) throw badRequest('Já existe um usuário com este login.');
    const hash = bcrypt.hashSync(password, 11);
    const r = this.db
      .prepare('INSERT INTO users (login, name, email, password_hash, profile, b1_user, branches) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(login, name, email, hash, profile, b1User, JSON.stringify(branches.map(Number).filter(Boolean)));
    return this.getUser(Number(r.lastInsertRowid));
  }

  updateUser(id, { name, email, profile, b1User, branches, active, password }) {
    const u = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) throw new HttpError(404, 'Usuário não encontrado.');
    if (profile && !PROFILES[profile]) throw badRequest('Perfil inválido.');
    if (password) validatePassword(password);
    this.db
      .prepare(`UPDATE users SET name = ?, email = ?, profile = ?, b1_user = ?, branches = ?, active = ?,
                password_hash = ?, failed_attempts = CASE WHEN ? THEN 0 ELSE failed_attempts END,
                locked_until = CASE WHEN ? THEN NULL ELSE locked_until END, updated_at = datetime('now') WHERE id = ?`)
      .run(name ?? u.name, email ?? u.email, profile ?? u.profile, b1User ?? u.b1_user,
        branches ? JSON.stringify(branches.map(Number).filter(Boolean)) : u.branches, active == null ? u.active : active ? 1 : 0,
        password ? bcrypt.hashSync(password, 11) : u.password_hash, password ? 1 : 0, password ? 1 : 0, id);
    if (active === false || password) this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    return this.getUser(id);
  }

  getUser(id) {
    const u = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return u ? this.publicUser(u) : null;
  }

  listUsers() {
    return this.db.prepare('SELECT * FROM users ORDER BY name').all().map((u) => this.publicUser(u));
  }

  /** Confere login e senha, com bloqueio após 5 tentativas erradas por 15 minutos. */
  login(login, password, { ip, userAgent } = {}) {
    const u = this.db.prepare('SELECT * FROM users WHERE login = ?').get(String(login || ''));
    const generic = new HttpError(401, 'Login ou senha inválidos.');
    if (!u || !u.active) {
      bcrypt.compareSync(String(password || ''), '$2a$11$abcdefghijklmnopqrstuuJ3o3gS1mZ2Q8cB5C4fGx9kq6Fh1m2y'); // tempo constante
      throw generic;
    }
    if (u.locked_until && u.locked_until > nowIso()) throw new HttpError(429, 'Usuário bloqueado temporariamente por tentativas erradas. Tente mais tarde.');
    if (!bcrypt.compareSync(String(password || ''), u.password_hash)) {
      const fails = u.failed_attempts + 1;
      const lock = fails >= this.cfg.login.maxAttempts ? new Date(Date.now() + this.cfg.login.lockMinutes * 60000).toISOString() : null;
      this.db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : fails, lock, u.id);
      throw generic;
    }
    this.db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(u.id);
    const token = randomBytes(32).toString('base64url');
    const now = nowIso();
    this.db.prepare('INSERT INTO sessions (id, user_id, created_at, last_seen, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sha256(token), u.id, now, now, ip || '', String(userAgent || '').slice(0, 200));
    return { token, user: this.publicUser(u) };
  }

  /** Confere a senha atual sem abrir sessão (usado na troca de senha). */
  verifyPassword(id, password) {
    const u = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) throw badRequest('Senha atual incorreta.');
  }

  /** Usuário da sessão, ou null se expirou por inatividade ou por tempo máximo. */
  session(token) {
    if (!token) return null;
    const id = sha256(token);
    const s = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    if (!s) return null;
    const now = Date.now();
    const idle = now - Date.parse(s.last_seen) > this.cfg.session.idleMinutes * 60000;
    const old = now - Date.parse(s.created_at) > this.cfg.session.maxHours * 3600000;
    const u = this.db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
    if (idle || old || !u || !u.active) {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      return null;
    }
    this.db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(nowIso(), id);
    return this.publicUser(u);
  }

  logout(token) {
    if (token) this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
  }
}
