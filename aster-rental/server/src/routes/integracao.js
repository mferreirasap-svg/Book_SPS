// Integração com o SAP B1: listas de cadastros nativos (de-para), estrutura, prontidão, monitor e carga de equipamentos.
import { badRequest } from '../lib/util.js';
import { LISTAS } from '../services/integration.js';

export default async function integracaoRoutes(app, { deps }) {
  const { integ } = deps;
  const can = app.can;

  // Listas nativas usadas nas telas (contrato, técnico, de-para). Só leitura, para qualquer usuário logado.
  app.get('/b1/lists', async (req) => {
    const kinds = String(req.query.k || '').split(',').map((s) => s.trim()).filter((k) => LISTAS[k]);
    if (!kinds.length) throw badRequest('Informe as listas desejadas.');
    return integ.listas(kinds);
  });
  app.get('/b1/addresses/:card', async (req) => integ.enderecos(String(req.params.card).slice(0, 15)));

  app.get('/integration/structure', { preHandler: can('admin.instalar') }, async () => integ.estrutura());
  app.get('/integration/readiness', { preHandler: can('admin.instalar', 'admin.parametros') }, async () => integ.prontidao());
  app.get('/integration/log', { preHandler: can('admin.instalar', 'admin.parametros') }, async (req) => integ.listLog({ status: req.query.status, tipo: req.query.tipo }));
  app.post('/integration/log/:code/retry', { preHandler: can('admin.instalar', 'admin.parametros') }, async (req) => integ.reprocessar(req, req.params.code));
  app.get('/integration/serials', { preHandler: can('ativos.editar') }, async (req) => integ.seriesDisponiveis({ item: req.query.item, q: req.query.q }));
  app.post('/integration/serials/import', { preHandler: can('ativos.editar') }, async (req) => integ.importarSeries(req, req.body?.linhas));
}
