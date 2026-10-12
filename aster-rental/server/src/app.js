// Montagem da aplicação: segurança, sessão, rotas da API e arquivos da tela.
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { openDb } from './db.js';
import { AuthService } from './auth/service.js';
import { createAudit } from './lib/audit.js';
import { createJobs } from './lib/jobs.js';
import { HttpError, forbidden } from './lib/util.js';
import { createB1Client } from './b1/index.js';
import { createServices } from './services/index.js';
import authRoutes from './routes/auth.js';
import cadastroRoutes from './routes/cadastros.js';
import operacaoRoutes from './routes/operacao.js';
import faturamentoRoutes from './routes/faturamento.js';
import adminRoutes from './routes/admin.js';

const here = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(here, '..', '..', 'web');
const PUBLIC = new Set(['/api/auth/login', '/api/health']);

export async function buildApp(cfg, { b1Client, db: dbOverride } = {}) {
  const app = Fastify({
    logger: { level: cfg.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization', 'body.password'] },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    genReqId: (req) => req.headers['x-request-id'] || randomUUID(),
  });

  const db = dbOverride || openDb(cfg.dbFile);
  const auth = new AuthService(db, cfg);
  auth.ensureAdmin(app.log);
  const audit = createAudit(db);
  const jobs = createJobs(db, app.log);
  const sl = b1Client || createB1Client(cfg.b1, app.log);
  const services = createServices({ sl, audit, jobs });
  const idem = {
    get: (key, user) => db.prepare('SELECT status, response FROM idempotency WHERE key = ? AND user_login = ?').get(key, user),
    save: (key, user, status, response) =>
      db.prepare('INSERT OR IGNORE INTO idempotency (key, user_login, status, response) VALUES (?, ?, ?, ?)').run(key, user, status, response),
  };
  const deps = { cfg, db, auth, audit, jobs, sl, idem, ...services };
  app.decorate('deps', deps);

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: cfg.frameAncestors,
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    hsts: cfg.production ? { maxAge: 31536000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute', allowList: () => !cfg.production && cfg.nodeEnv === 'test' });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });

  // Sessão, proteção contra requisições de outros sites (CSRF) e permissões.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers['x-requested-with'] !== 'aster-rental') throw new HttpError(403, 'Requisição recusada (cabeçalho de origem ausente).');
      const origin = req.headers.origin;
      if (origin) {
        const own = `${req.protocol}://${req.headers.host}`;
        if (origin !== own && !cfg.allowedOrigins.includes(origin)) throw new HttpError(403, 'Origem não permitida.');
      }
    }
    const path = req.url.split('?')[0];
    if (PUBLIC.has(path)) return;
    const user = auth.session(req.cookies[cfg.session.cookieName]);
    if (!user) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
    req.user = user;
  });

  app.decorate('can', (...perms) => async (req) => {
    if (!perms.some((p) => req.user?.perms.includes(p))) throw forbidden();
  });

  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode || 500;
    if (status >= 500) req.log.error({ err, b1Code: err.b1Code, b1Message: err.b1Message }, 'erro interno');
    else if (err.b1Code) req.log.warn({ b1Code: err.b1Code, b1Message: err.b1Message }, 'erro do B1');
    const message = status >= 500 && !(err.b1Code || err.b1Status) ? 'Erro interno. Informe ao suporte o código da requisição.' : err.validation ? 'Dados inválidos.' : err.message;
    reply.status(status).send({ error: message, requestId: req.id, details: err.details });
  });

  await app.register(authRoutes, { prefix: '/api', deps });
  await app.register(cadastroRoutes, { prefix: '/api', deps });
  await app.register(operacaoRoutes, { prefix: '/api', deps });
  await app.register(faturamentoRoutes, { prefix: '/api', deps });
  await app.register(adminRoutes, { prefix: '/api', deps });

  app.get('/api/health', async () => ({ ok: true, b1Mode: cfg.b1.mode, version: process.env.npm_package_version || '0.1.0' }));

  await app.register(fastifyStatic, { root: WEB_DIR, prefix: '/', index: ['index.html'] });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Rota não encontrada.' });
    return reply.sendFile('index.html');
  });

  app.addHook('onClose', async () => db.close());
  return app;
}
