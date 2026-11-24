// Rotas da versão 6: leituras de campo e conferência, apontamento de horas, operadores, documentação de veículos,
// indicadores da manutenção e mapa da equipe.
import { badRequest } from '../lib/util.js';

export default async function campoRoutes(app, { deps }) {
  const { repos, audit, operations, campo, geo } = deps;
  const can = app.can;

  /* ---- leituras de campo ---- */
  app.get('/readings/rented', { preHandler: can('leituras.lancar', 'leituras.registrar') }, async (req) => {
    const out = [];
    for (const c of await repos.contracts.open({ branches: req.user.branches })) {
      for (const l of (c.SPS_LCT1Collection || []).filter((x) => x.U_StatusL === 'LOC' && x.U_Ativo)) out.push({ ativo: l.U_Ativo, desc: l.U_AtvDesc, cliente: c.U_CardName, obra: c.U_Obra });
    }
    const ativos = Object.fromEntries((await repos.assets.all()).map((a) => [a.Code, a]));
    return out.map((x) => ({ ...x, tipo: ativos[x.ativo]?.U_Tipo, medidor: ativos[x.ativo]?.U_Medidor, placa: ativos[x.ativo]?.U_Placa || '' }));
  });
  app.post('/readings/field', { preHandler: can('leituras.lancar') }, async (req) => operations.registerReading(req, { ...(req.body || {}), origem: 'CAM' }));
  app.get('/readings/review', { preHandler: can('leituras.conferir', 'leituras.ver') }, async (req) =>
    repos.readings.list({ situacao: req.query.situacao || 'PEN' }));
  app.get('/readings/mine', { preHandler: can('leituras.lancar') }, async (req) =>
    (await repos.readings.list({})).filter((m) => m.U_LancPor === req.user.login).sort((a, b) => (a.U_Data < b.U_Data ? 1 : -1)).slice(0, 30)
      .map(({ U_Foto, ...m }) => ({ ...m, foto: Boolean(U_Foto) })));
  app.post('/readings/:code/review', { preHandler: can('leituras.conferir') }, async (req) => operations.conferirLeitura(req, req.params.code, req.body || {}));

  /* ---- mão de obra: operadores e apontamento ---- */
  app.get('/operators', async () => repos.operators.all());
  const opCampos = (b) => ({ U_EmpID: Number(b.U_EmpID) || 0, U_Fone: String(b.U_Fone || '').slice(0, 30), U_CNH: String(b.U_CNH || '').slice(0, 30),
    U_CNHVal: b.U_CNHVal || null, U_Habilit: String(b.U_Habilit || '').slice(0, 150), U_HabVal: b.U_HabVal || null, U_Ativo: b.U_Ativo === 'N' ? 'N' : 'S' });
  app.post('/operators', { preHandler: can('planos.editar') }, async (req) => {
    const Code = String(req.body?.Code || '').trim().toUpperCase().slice(0, 30);
    const Name = String(req.body?.Name || '').trim().slice(0, 100);
    if (!/^[A-Z0-9-]{2,30}$/.test(Code) || !Name) throw badRequest('Informe código e nome do operador.');
    if (await repos.operators.get(Code)) throw badRequest('Já existe operador com este código.');
    const rec = { Code, Name, ...opCampos(req.body) };
    await repos.operators.create(rec);
    audit.record(req, { action: 'criar', entity: 'operador', id: Code, after: rec });
    return rec;
  });
  app.put('/operators/:code', { preHandler: can('planos.editar') }, async (req) => {
    if (!(await repos.operators.get(req.params.code))) throw badRequest('Operador não encontrado.');
    const patch = { ...opCampos(req.body || {}), ...(req.body?.Name ? { Name: String(req.body.Name).slice(0, 100) } : {}) };
    await repos.operators.patch(req.params.code, patch);
    audit.record(req, { action: 'alterar', entity: 'operador', id: req.params.code, after: patch });
    return repos.operators.get(req.params.code);
  });
  app.get('/timesheet/lines', { preHandler: can('mo.apontar', 'mo.aprovar') }, async (req) => campo.linhasMO({ branches: req.user.branches }));
  app.get('/timesheet', { preHandler: can('mo.apontar', 'mo.aprovar', 'faturamento.ver') }, async (req) =>
    campo.apontamentos({ comp: req.query.comp, ctr: req.query.ctr, situacao: req.query.situacao }));
  app.post('/timesheet', { preHandler: can('mo.apontar') }, async (req) => campo.apontar(req, req.body || {}));
  app.post('/timesheet/:code/decision', { preHandler: can('mo.aprovar') }, async (req) => campo.decidirApontamento(req, req.params.code, req.body || {}));

  /* ---- documentação dos veículos ---- */
  app.get('/vehicle-docs', { preHandler: can('veiculos.docs', 'ativos.ver') }, async (req) => campo.documentos({ ativo: req.query.ativo, situacao: req.query.situacao }));
  app.get('/vehicle-docs/:code', { preHandler: can('veiculos.docs') }, async (req) => campo.documento(req.params.code));
  app.post('/vehicle-docs', { preHandler: can('veiculos.docs') }, async (req) => campo.criarDocumento(req, req.body || {}));
  app.post('/vehicle-docs/calendar', { preHandler: can('veiculos.docs') }, async (req) => campo.gerarCalendario(req, req.body?.ano));
  app.post('/vehicle-docs/:code/pay', { preHandler: can('veiculos.docs') }, async (req) => campo.pagarDocumento(req, req.params.code, req.body || {}));
  app.post('/vehicle-docs/:code/exempt', { preHandler: can('veiculos.docs') }, async (req) => campo.isentarDocumento(req, req.params.code, req.body?.obs));

  /* ---- manutenção da frota ---- */
  app.get('/maintenance/indicators', { preHandler: can('manutencao.ver', 'os.editar') }, async (req) => campo.indicadoresManutencao({ meses: req.query.meses }));
  app.get('/lookup/suppliers', async (req) => {
    const q = String(req.query.q || '').toLowerCase();
    return (await repos.sl.getAll("BusinessPartners?$select=CardCode,CardName,CardType&$filter=CardType eq 'cSupplier'"))
      .filter((b) => !q || `${b.CardCode} ${b.CardName}`.toLowerCase().includes(q)).slice(0, 20);
  });
  app.get('/alerts', async () => campo.alertas());

  /* ---- localização e mapa ---- */
  app.get('/geo/policy', async (req) => geo.politica(req));
  app.post('/geo/accept', async (req) => geo.aceitar(req));
  app.post('/geo/position', { preHandler: can('os.executar') }, async (req) => geo.registrar(req, req.body || {}));
  app.get('/geo/map', { preHandler: can('geo.ver', 'os.editar') }, async (req) => geo.mapa({ data: req.query.data }));
}
