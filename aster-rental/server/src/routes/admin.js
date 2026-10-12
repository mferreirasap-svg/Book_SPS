// Administração: usuários, perfis, parâmetros, instalação no B1 e auditoria.
import { PROFILES, PERMISSIONS } from '../auth/permissions.js';
import { CFG_DEFAULTS } from '../b1/schema.js';
import { installStructures } from '../b1/installer.js';
import { badRequest, notFound } from '../lib/util.js';

export default async function adminRoutes(app, { deps }) {
  const { auth, audit, repos, sl, cfg } = deps;
  const can = app.can;

  app.get('/admin/profiles', { preHandler: can('admin.usuarios') }, async () => ({
    profiles: Object.entries(PROFILES).map(([code, p]) => ({ code, name: p.name, perms: p.perms })),
    permissions: PERMISSIONS,
  }));

  app.get('/admin/users', { preHandler: can('admin.usuarios') }, async () => auth.listUsers());

  app.post('/admin/users', { preHandler: can('admin.usuarios') }, async (req) => {
    const u = auth.createUser(req.body || {});
    audit.record(req, { action: 'criar', entity: 'usuario', id: u.login, after: u });
    return u;
  });

  app.put('/admin/users/:id', { preHandler: can('admin.usuarios') }, async (req) => {
    const before = auth.getUser(Number(req.params.id));
    if (!before) throw notFound('Usuário');
    if (before.id === req.user.id && (req.body.active === false || (req.body.profile && req.body.profile !== 'administrador'))) {
      throw badRequest('Você não pode desativar nem rebaixar o seu próprio usuário.');
    }
    const after = auth.updateUser(Number(req.params.id), req.body || {});
    audit.record(req, { action: 'alterar', entity: 'usuario', id: after.login, before, after });
    return after;
  });

  app.put('/me/password', async (req) => {
    const { atual, nova } = req.body || {};
    auth.verifyPassword(req.user.id, atual);
    const after = auth.updateUser(req.user.id, { password: nova });
    audit.record(req, { action: 'trocar_senha', entity: 'usuario', id: after.login });
    return { ok: true };
  });

  app.get('/admin/settings', { preHandler: can('admin.parametros') }, async () => ({ ...CFG_DEFAULTS, ...(await repos.settings.all()) }));

  app.put('/admin/settings', { preHandler: can('admin.parametros') }, async (req) => {
    const allowed = Object.keys(CFG_DEFAULTS).filter((k) => k !== 'SCHEMA_VERSION');
    const before = await repos.settings.all();
    for (const [k, v] of Object.entries(req.body || {})) {
      if (!allowed.includes(k)) continue;
      const val = String(v ?? '').slice(0, 4000);
      if (before[k] !== val) await repos.settings.set(k, val);
    }
    const after = await repos.settings.all();
    audit.record(req, { action: 'alterar', entity: 'parametros', before, after });
    return after;
  });

  app.post('/admin/install', { preHandler: can('admin.instalar') }, async (req) => {
    const log = [];
    const r = await installStructures(sl, (l) => log.push(l));
    audit.record(req, { action: 'instalar_estruturas', entity: 'b1', after: { errors: r.errors, version: r.version } });
    return { ...r, log };
  });

  app.get('/admin/b1-status', { preHandler: can('admin.instalar') }, async () => {
    try {
      const cfgB1 = await repos.settings.all();
      return { ok: true, mode: cfg.b1.mode, company: cfg.b1.company || 'demonstração', schemaVersion: cfgB1.SCHEMA_VERSION || '0' };
    } catch (e) {
      return { ok: false, mode: cfg.b1.mode, error: e.message };
    }
  });

  app.post('/admin/demo-reset', { preHandler: can('admin.instalar') }, async (req) => {
    if (cfg.b1.mode !== 'mock' || typeof sl.reset !== 'function') throw badRequest('Disponível só no modo de demonstração.');
    sl.reset();
    audit.record(req, { action: 'restaurar_demo', entity: 'b1' });
    return { ok: true };
  });

  app.get('/admin/audit', { preHandler: can('auditoria.ver') }, async (req) => audit.list(req.query));
}
