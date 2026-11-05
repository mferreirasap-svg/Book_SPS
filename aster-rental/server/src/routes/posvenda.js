// Pós-venda: chamados, ordens de serviço, agenda, preventivas, pesquisa de satisfação e histórico do equipamento.
// As rotas /public/* (resposta da pesquisa pelo cliente) não pedem login: o token aleatório é a autorização.
import { badRequest } from '../lib/util.js';

const pagina = (q) => ({ page: q.page, size: q.size });

export default async function posvendaRoutes(app, { deps }) {
  const { aftersales: A, repos, audit } = deps;
  const can = app.can;

  /* ---- chamados ---- */
  app.get('/tickets', { preHandler: can('chamados.ver') }, async (req) =>
    A.listTickets(req, { status: req.query.status, abertos: req.query.abertos === '1', q: req.query.q, cardCode: req.query.cliente, ativo: req.query.ativo,
      sla: req.query.sla }, pagina(req.query)));
  app.get('/tickets/:id', { preHandler: can('chamados.ver') }, async (req) => A.getTicket(req.params.id));
  app.post('/tickets', { preHandler: can('chamados.editar') }, async (req) => A.createTicket(req, req.body || {}));
  app.put('/tickets/:id', { preHandler: can('chamados.editar') }, async (req) => A.updateTicket(req, req.params.id, req.body || {}));
  app.post('/tickets/:id/interactions', { preHandler: can('chamados.editar') }, async (req) => A.interact(req, req.params.id, req.body || {}));
  app.post('/tickets/:id/order', { preHandler: can('os.editar') }, async (req) => A.orderFromTicket(req, req.params.id, req.body || {}));

  /* ---- ordens de serviço ---- */
  app.get('/orders', { preHandler: can('os.ver') }, async (req) =>
    A.listOrders(req, { status: req.query.status, abertas: req.query.abertas === '1', tipo: req.query.tipo, tecnico: req.query.tecnico, de: req.query.de,
      ate: req.query.ate, q: req.query.q, ativo: req.query.ativo }, pagina(req.query)));
  app.get('/orders/:id', { preHandler: can('os.ver') }, async (req) => A.getOrder(req, req.params.id));
  app.post('/orders', { preHandler: can('os.editar') }, async (req) => A.createOrder(req, req.body || {}));
  app.post('/orders/:id/schedule', { preHandler: can('os.editar') }, async (req) => A.scheduleOrder(req, req.params.id, req.body || {}));
  app.post('/orders/:id/start', { preHandler: can('os.executar', 'os.editar') }, async (req) => A.startOrder(req, req.params.id, req.body || {}));
  app.put('/orders/:id', { preHandler: can('os.executar', 'os.editar') }, async (req) => A.saveOrder(req, req.params.id, req.body || {}));
  app.post('/orders/:id/quote', { preHandler: can('os.executar', 'os.editar') }, async (req) => A.quoteOrder(req, req.params.id, req.body || {}));
  app.post('/orders/:id/conclude', { preHandler: can('os.executar', 'os.editar') }, async (req) => A.concludeOrder(req, req.params.id, req.body || {}));
  app.post('/orders/:id/cancel', { preHandler: can('os.editar') }, async (req) => A.cancelOrder(req, req.params.id, req.body || {}));

  /* ---- preventivas ---- */
  app.get('/preventive', { preHandler: can('os.ver') }, async (req) => A.preventive({ branches: req.user.branches }));
  app.post('/preventive/order', { preHandler: can('os.editar') }, async (req) => A.preventiveOrder(req, req.body || {}));

  /* ---- técnicos e planos ---- */
  app.get('/technicians', { preHandler: can('os.ver', 'chamados.ver', 'planos.editar') }, async () => repos.technicians.all());
  app.get('/technicians/me', { preHandler: can('os.ver') }, async (req) => (await A.tecnicoDo(req.user.login)) || {});
  app.get('/plans', { preHandler: can('os.ver', 'planos.editar') }, async () => repos.plans.all());

  const cadastro = (path, repo, entidade, campos) => {
    const limpa = (b) => {
      const out = {};
      for (const [k, t] of Object.entries(campos)) {
        if (b[k] === undefined) continue;
        out[k] = t === 'n' ? Math.max(0, Number(b[k]) || 0) : t === 'sn' ? (b[k] === 'N' ? 'N' : 'S') : String(b[k] ?? '').trim().slice(0, t);
      }
      return out;
    };
    app.post(path, { preHandler: can('planos.editar') }, async (req) => {
      const code = String(req.body?.Code || '').trim().toUpperCase().slice(0, 30);
      const name = String(req.body?.Name || '').trim().slice(0, 100);
      if (!/^[A-Z0-9-]{2,30}$/.test(code)) throw badRequest('Código inválido (use letras, números e hífen).');
      if (!name) throw badRequest('Informe o nome.');
      if (await repo.get(code)) throw badRequest('Já existe um cadastro com este código.');
      const rec = { Code: code, Name: name, ...limpa(req.body) };
      await repo.create(rec);
      audit.record(req, { action: 'criar', entity: entidade, id: code, after: rec });
      return repo.get(code);
    });
    app.put(`${path}/:code`, { preHandler: can('planos.editar') }, async (req) => {
      const before = await repo.get(req.params.code);
      if (!before) throw badRequest('Cadastro não encontrado.');
      const patch = limpa(req.body || {});
      if (req.body?.Name) patch.Name = String(req.body.Name).trim().slice(0, 100);
      await repo.patch(req.params.code, patch);
      audit.record(req, { action: 'alterar', entity: entidade, id: req.params.code, before, after: patch });
      return repo.get(req.params.code);
    });
  };
  cadastro('/technicians', repos.technicians, 'tecnico', { U_Login: 50, U_Fone: 30, U_Email: 100, U_Especial: 100, U_Filial: 'n', U_Ativo: 'sn' });
  cadastro('/plans', repos.plans, 'plano', { U_Familia: 50, U_IntMed: 'n', U_IntDias: 'n', U_Aviso: 'n', U_Checklist: 4000, U_Ativo: 'sn' });

  /* ---- satisfação, histórico e painel ---- */
  app.get('/surveys', { preHandler: can('pesquisa.ver') }, async (req) => A.surveys({ de: req.query.de, ate: req.query.ate }));
  app.get('/assets/:code/history', { preHandler: can('ativos.ver') }, async (req) => A.assetHistory(req.params.code));
  app.get('/aftersales/dashboard', { preHandler: can('chamados.ver', 'os.ver') }, async (req) => A.dashboard({ branches: req.user.branches }));

  /* ---- público: resposta da pesquisa pelo cliente ---- */
  app.get('/public/survey/:code', async (req) => A.publicSurvey(req.params.code));
  app.post('/public/survey/:code', async (req) => A.answerSurvey(req.params.code, req.body || {}));
}
