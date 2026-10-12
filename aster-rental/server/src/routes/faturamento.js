// Faturamento: painel de parcelas, prévia com memória de cálculo, geração em lote e liberação.
import { badRequest, notFound, forbidden } from '../lib/util.js';

const compOk = (c) => {
  if (!/^\d{6}$/.test(c || '')) throw badRequest('Informe a competência (AAAAMM).');
  return c;
};

export default async function faturamentoRoutes(app, { deps }) {
  const { billing, jobs, repos } = deps;
  const can = app.can;

  app.get('/billing', { preHandler: can('faturamento.ver') }, async (req) => billing.list(compOk(req.query.comp), { branches: req.user.branches }));

  app.get('/billing/:id/:comp', { preHandler: can('faturamento.ver') }, async (req) => billing.preview(Number(req.params.id), compOk(req.params.comp)));

  app.get('/billing/installment/:code', { preHandler: can('faturamento.ver') }, async (req) => {
    const p = await repos.installments.get(req.params.code);
    if (!p) throw notFound('Parcela');
    return { ...p, U_Detalhe: JSON.parse(p.U_Detalhe || '[]') };
  });

  app.post('/billing/generate', { preHandler: can('faturamento.gerar') }, async (req) => {
    const { comp, contratos } = req.body || {};
    return { job: billing.generateBatch(req, compOk(comp), (contratos || []).map(Number)) };
  });

  app.post('/billing/generate-one', { preHandler: can('faturamento.gerar') }, async (req) => {
    const { comp, contrato, desconto, acrescimo } = req.body || {};
    return billing.generateOne(req, Number(contrato), compOk(comp), { desconto, acrescimo });
  });

  app.post('/billing/installment/:code/release', { preHandler: can('faturamento.liberar') }, async (req) => billing.release(req, req.params.code));

  app.get('/jobs/:id', async (req) => {
    const j = jobs.get(req.params.id);
    if (!j) throw notFound('Tarefa');
    if (j.created_by !== req.user.login && req.user.profile !== 'administrador') throw forbidden();
    return j;
  });
}
