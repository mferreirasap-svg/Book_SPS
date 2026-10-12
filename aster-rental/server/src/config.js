// Configuração lida das variáveis de ambiente ou do arquivo .env (veja .env.example).
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
const env = process.env;
const bool = (v, d = false) => (v == null || v === '' ? d : ['1', 'true', 'sim', 'yes'].includes(String(v).toLowerCase()));
const int = (v, d) => (v == null || v === '' ? d : Number.parseInt(v, 10));

const nodeEnv = env.NODE_ENV || 'development';
const production = nodeEnv === 'production';

export const config = {
  nodeEnv,
  production,
  host: env.HOST || '0.0.0.0',
  port: int(env.PORT, 3000),
  logLevel: env.LOG_LEVEL || (production ? 'info' : 'warn'),

  // Banco interno do Áster Rental (usuários, sessões, auditoria, tarefas). Os dados de negócio ficam no B1.
  dbFile: env.APP_DB_FILE || 'data/aster-rental.db',

  session: {
    cookieName: 'ar_sid',
    idleMinutes: int(env.SESSION_IDLE_MINUTES, 30),
    maxHours: int(env.SESSION_MAX_HOURS, 12),
    secure: bool(env.COOKIE_SECURE, production),
  },
  login: { maxAttempts: 5, lockMinutes: 15 },

  // Origens que podem chamar a API (além da própria). Ex.: https://aster.spsgroup.com.br
  allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  // Quem pode exibir o sistema em iframe (o portal do Áster).
  frameAncestors: (env.FRAME_ANCESTORS || "'self'").split(',').map((s) => s.trim()).filter(Boolean),

  admin: { login: env.ADMIN_LOGIN || 'admin', password: env.ADMIN_PASSWORD || '' },
  // Senha padrão só para o modo demonstração fora de produção; nunca vale com o SAP B1 real.
  demoPassword: 'Demo2026senha',

  b1: {
    mode: env.B1_MODE || 'mock', // mock | servicelayer
    url: env.B1_SL_URL || '',
    company: env.B1_COMPANY_DB || '',
    user: env.B1_USER || '',
    password: env.B1_PASSWORD || '',
    caFile: env.B1_CA_FILE || '',
    rejectUnauthorized: bool(env.B1_TLS_VERIFY, true),
    poolSize: int(env.B1_POOL_SIZE, 4),
    timeoutMs: int(env.B1_TIMEOUT_MS, 60000),
    // Em demonstração, os dados de exemplo ficam salvos em data/ para não sumirem ao reiniciar.
    mockFile: env.B1_MOCK_FILE || (production ? '' : 'data/demo-b1.json'),
  },
};

export function validateConfig(c = config) {
  const errors = [];
  if (c.production) {
    if (c.b1.mode === 'mock') errors.push('B1_MODE=mock não é permitido em produção.');
    if (!c.session.secure) errors.push('COOKIE_SECURE deve ser true em produção.');
  }
  if (c.b1.mode === 'servicelayer') {
    for (const k of ['url', 'company', 'user', 'password']) if (!c.b1[k]) errors.push(`Configuração B1 ausente: ${k}.`);
  }
  return errors;
}
