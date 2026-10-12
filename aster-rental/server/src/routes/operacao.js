// Contratos, movimentações, leituras e multas.
import { notFound, forbidden, badRequest } from '../lib/util.js';

export default async function operacaoRoutes(app, { deps }) {
  const { repos, contracts, movements, operations, db } = deps;
  const can = app.can;
  const inBranch = (req, c) => !req.user.branches.length || req.user.branches.includes(Number(c.U_Filial));

  /* ---- contratos ---- */
  app.get('/contracts', { preHandler: can('contratos.ver') }, async (req) =>
    repos.contracts.list({ status: req.query.status, q: req.query.q, branches: req.user.branches }, req.query));

  app.get('/contracts/:id', { preHandler: can('contratos.ver') }, async (req) => {
    const c = await repos.contracts.get(req.params.id);
    if (!c || !inBranch(req, c)) throw notFound('Contrato');
    return c;
  });

  app.get('/contracts/:id/history', { preHandler: can('contratos.ver') }, async (req) => {
    const c = await repos.contracts.get(req.params.id);
    if (!c || !inBranch(req, c)) throw notFound('Contrato');
    const [parcelas, movs, multas, foras] = await Promise.all([
      repos.installments.byContract(c.DocEntry), repos.movements.list({ ctr: c.DocEntry }, { size: 100 }), repos.fines.list({ ctr: c.DocEntry }),
      repos.offPeriods.list({ ctr: c.DocEntry }),
    ]);
    return { parcelas: parcelas.map(({ U_Detalhe, ...p }) => p), movimentos: movs.items, multas, foras };
  });

  app.post('/contracts', { preHandler: can('contratos.editar') }, async (req) => {
    if (req.user.branches.length && !req.user.branches.includes(Number(req.body.U_Filial))) throw forbidden('Filial não liberada para o seu usuário.');
    return contracts.create(req, req.body);
  });

  app.put('/contracts/:id', { preHandler: can('contratos.editar') }, async (req) => {
    const c = await repos.contracts.get(req.params.id);
    if (!c || !inBranch(req, c)) throw notFound('Contrato');
    return contracts.update(req, Number(req.params.id), req.body, req.body.U_Versao);
  });

  app.post('/contracts/:id/status', { preHandler: can('contratos.ativar') }, async (req) => {
    const c = await repos.contracts.get(req.params.id);
    if (!c || !inBranch(req, c)) throw notFound('Contrato');
    return contracts.setStatus(req, Number(req.params.id), req.body.status, req.body.U_Versao);
  });

  /* ---- movimentações (com chave de idempotência, requisito INT-02) ---- */
  app.get('/movements', { preHandler: can('contratos.ver', 'mov.registrar') }, async (req) =>
    repos.movements.list({ ctr: req.query.ctr, ativo: req.query.ativo }, req.query));

  app.get('/movements/:id', { preHandler: can('contratos.ver', 'mov.registrar') }, async (req) => {
    const m = await repos.movements.get(req.params.id);
    if (!m) throw notFound('Movimentação');
    return m;
  });

  app.get('/checklist/:tipo', async (req) => ({ itens: await movements.checklistItems(req.params.tipo === 'VEI' ? 'VEI' : 'EQP') }));

  app.post('/movements', { preHandler: can('mov.registrar') }, async (req, reply) => {
    const idem = String(req.headers['idempotency-key'] || '').slice(0, 100);
    if (idem) {
      const prev = db.prepare('SELECT status, response FROM idempotency WHERE key = ? AND user_login = ?').get(idem, req.user.login);
      if (prev) return reply.status(prev.status).send(JSON.parse(prev.response));
    }
    const result = await movements.register(req, req.body || {});
    if (idem) db.prepare('INSERT OR IGNORE INTO idempotency (key, user_login, status, response) VALUES (?, ?, ?, ?)').run(idem, req.user.login, 200, JSON.stringify(result));
    return result;
  });

  /* ---- leituras ---- */
  app.get('/readings', { preHandler: can('leituras.ver') }, async (req) => {
    if (!/^\d{6}$/.test(req.query.comp || '')) throw badRequest('Informe a competência (AAAAMM).');
    return repos.readings.list({ comp: req.query.comp, ctr: req.query.ctr });
  });
  app.get('/readings/pending', { preHandler: can('leituras.ver') }, async (req) => {
    const out = [];
    for (const c of await repos.contracts.open({ branches: req.user.branches })) {
      if (!['ATV', 'SUS'].includes(c.U_Status)) continue;
      for (const l of c.SPS_LCT1Collection || []) {
        if (l.U_StatusL !== 'LOC') continue;
        out.push({ DocEntry: c.DocEntry, DocNum: c.DocNum, U_CardName: c.U_CardName, LineId: l.LineId, U_Ativo: l.U_Ativo, U_AtvDesc: l.U_AtvDesc,
          U_Franquia: l.U_Franquia, U_Grupo: l.U_Grupo });
      }
    }
    const assets = Object.fromEntries((await repos.assets.all({ branches: req.user.branches })).map((a) => [a.Code, a]));
    return out.map((x) => ({ ...x, U_Tipo: assets[x.U_Ativo]?.U_Tipo, U_Medidor: assets[x.U_Ativo]?.U_Medidor }));
  });
  app.post('/readings', { preHandler: can('leituras.registrar') }, async (req) => operations.registerReading(req, req.body || {}));
  app.post('/readings/import', { preHandler: can('leituras.registrar') }, async (req) => operations.importReadings(req, req.body?.csv, req.body?.comp));

  /* ---- multas ---- */
  app.get('/fines', { preHandler: can('multas.ver') }, async (req) => repos.fines.list({ status: req.query.status, q: req.query.q }));
  app.get('/fines/lookup', { preHandler: can('multas.ver') }, async (req) => {
    const hit = await operations.contractOnDate(String(req.query.ativo || ''), String(req.query.data || ''));
    return hit ? { DocEntry: hit.c.DocEntry, DocNum: hit.c.DocNum, U_CardName: hit.c.U_CardName, U_Condutor: hit.l.U_Condutor || '' } : null;
  });
  app.post('/fines', { preHandler: can('multas.editar') }, async (req) => operations.createFine(req, req.body || {}));
  app.post('/fines/:code/status', { preHandler: can('multas.editar') }, async (req) => operations.setFineStatus(req, req.params.code, req.body?.status));

  /* ---- painel ---- */
  app.get('/dashboard', { preHandler: can('painel.ver') }, async (req) => operations.dashboard({ branches: req.user.branches }));
}
