// Testes de ponta a ponta da API com o SAP B1 simulado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, COMP, HOJE, checklist } from './helpers.js';
import { LN } from '../src/b1/schema.js';

let app;
let b1;
let admin;
before(async () => {
  ({ app, b1 } = await makeApp());
  admin = client(app);
  const r = await admin.login();
  assert.equal(r.status, 200);
});
after(() => app.close());

const novoContrato = (o = {}) => ({
  U_CardCode: 'C0004', U_Tipo: 'LOC', U_DtInicio: HOJE.slice(0, 8) + '01', U_DtFim: '2030-12-31', U_DiaFat: 10, U_Filial: 1, U_ModoFat: 'RAS',
  U_Obra: 'Fazenda Boa Vista', [LN]: [{ U_Ativo: 'EQP-0003', U_Regra: 'MENSAL', U_Valor: 9500, U_Franquia: 160, U_VlrExced: 60 }], ...o,
});

test('segurança: sem sessão é 401, sem cabeçalho anti-CSRF é 403, cabeçalhos de segurança presentes', async () => {
  const anon = client(app);
  assert.equal((await anon.get('/api/contracts')).status, 401);
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'admin', password: 'x' } });
  assert.equal(r.statusCode, 403);
  const h = await app.inject({ method: 'GET', url: '/' });
  assert.match(h.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(h.headers['x-content-type-options'], 'nosniff');
});

test('login bloqueia após 5 tentativas erradas', async () => {
  const u = await admin.post('/api/admin/users', { login: 'teste.bloqueio', name: 'Teste', password: 'OutraSenha123', profile: 'comercial' });
  assert.equal(u.status, 200);
  const c = client(app);
  for (let i = 0; i < 5; i++) assert.equal((await c.login('teste.bloqueio', 'errada')).status, 401);
  assert.equal((await c.login('teste.bloqueio', 'OutraSenha123')).status, 429);
});

test('perfis: pátio não vê faturamento, mas registra movimentação', async () => {
  await admin.post('/api/admin/users', { login: 'patio1', name: 'Pátio', password: 'SenhaPatio123', profile: 'patio' });
  const p = client(app);
  assert.equal((await p.login('patio1', 'SenhaPatio123')).status, 200);
  assert.equal((await p.post('/api/billing/generate-one', { comp: COMP, contrato: 1 })).status, 403);
  assert.equal((await p.get('/api/contracts')).status, 200);
  assert.equal((await p.post('/api/admin/users', {})).status, 403);
});

test('fluxo completo: contrato → ativação → entrega → leitura → parcela única → liberar → refaturar', async () => {
  const c = await admin.post('/api/contracts', novoContrato());
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const id = c.body.DocEntry;
  assert.equal(c.body.U_CardName, 'Agro Vale Verde Ltda');

  const at = await admin.post(`/api/contracts/${id}/status`, { status: 'ATV', U_Versao: c.body.U_Versao });
  assert.equal(at.status, 200, JSON.stringify(at.body));

  const itens = (await admin.get('/api/checklist/EQP')).body.itens;
  const sem = await admin.post('/api/movements', { tipo: 'ENT', contrato: id, linha: 1, data: HOJE.slice(0, 8) + '01', leitura: 3105 });
  assert.equal(sem.status, 400, 'checklist é obrigatório');

  const ent = { tipo: 'ENT', contrato: id, linha: 1, data: HOJE.slice(0, 8) + '01', leitura: 3105, checklist: checklist(itens), responsavel: 'João' };
  const e1 = await admin.post('/api/movements', ent, { 'idempotency-key': 'ent-1' });
  assert.equal(e1.status, 200, JSON.stringify(e1.body));
  const e2 = await admin.post('/api/movements', ent, { 'idempotency-key': 'ent-1' });
  assert.equal(e2.body.DocEntry, e1.body.DocEntry, 'mesma chave não grava de novo');
  assert.equal(b1.db.sets.SPSLMOV.length, 1);
  assert.equal((await admin.get('/api/assets/EQP-0003')).body.U_Status, 'LOC');

  const lt = await admin.post('/api/readings', { ativo: 'EQP-0003', leitura: 3305, comp: COMP });
  assert.equal(lt.status, 200, JSON.stringify(lt.body));
  assert.equal(lt.body.uso, 200);

  const pv = await admin.get(`/api/billing/${id}/${COMP}`);
  assert.equal(pv.status, 200);
  const exc = pv.body.linhas.find((l) => l.tipo === 'EXC');
  assert.ok(exc && exc.qtd > 0, 'excedente calculado');

  const g1 = await admin.post('/api/billing/generate-one', { comp: COMP, contrato: id });
  assert.equal(g1.status, 200, JSON.stringify(g1.body));
  assert.equal(b1.db.sets.Drafts.at(-1).U_SPS_CtrEntry, id);
  assert.equal(b1.db.sets.Drafts.at(-1).DocObjectCode, 'oInvoices');

  const g2 = await admin.post('/api/billing/generate-one', { comp: COMP, contrato: id });
  assert.equal(g2.status, 409, 'não fatura a mesma competência duas vezes');

  const rel = await admin.post(`/api/billing/installment/${id}-${COMP}/release`);
  assert.equal(rel.body.U_Status, 'CAN');
  const g3 = await admin.post('/api/billing/generate-one', { comp: COMP, contrato: id, desconto: 100 });
  assert.equal(g3.status, 200, JSON.stringify(g3.body));
  assert.ok(b1.db.sets.Drafts.at(-1).DiscountPercent > 0);
});

test('concorrência: gravar com versão antiga é recusado (409)', async () => {
  const c = (await admin.post('/api/contracts', novoContrato({ [LN]: [{ U_Familia: 'ESCAV', U_Regra: 'DIARIA', U_Valor: 32000, U_Diaria: 1600, U_ItemCode: 'SLOC001' }] }))).body;
  const v = c.U_Versao;
  const ok = await admin.put(`/api/contracts/${c.DocEntry}`, { ...c, U_Obra: 'Alterado', U_Versao: v });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const stale = await admin.put(`/api/contracts/${c.DocEntry}`, { ...c, U_Obra: 'Outra', U_Versao: v });
  assert.equal(stale.status, 409);
});

test('contrato por família: na entrega escolhe o equipamento da família certa', async () => {
  const c = (await admin.post('/api/contracts', novoContrato({ U_CardCode: 'C0005',
    [LN]: [{ U_Familia: 'ESCAV', U_Regra: 'DIARIA', U_Valor: 32000, U_Diaria: 1600, U_ItemCode: 'SLOC001' }] }))).body;
  await admin.post(`/api/contracts/${c.DocEntry}/status`, { status: 'ATV', U_Versao: c.U_Versao });
  const itens = (await admin.get('/api/checklist/EQP')).body.itens;
  const base = { tipo: 'ENT', contrato: c.DocEntry, linha: 1, data: HOJE, checklist: checklist(itens), responsavel: 'Ana' };
  const errado = await admin.post('/api/movements', { ...base, ativo: 'EQP-0001' });
  assert.ok([400, 409].includes(errado.status));
  const certo = await admin.post('/api/movements', { ...base, ativo: 'EQP-0006' });
  assert.equal(certo.status, 200, JSON.stringify(certo.body));
  const depois = (await admin.get(`/api/contracts/${c.DocEntry}`)).body;
  assert.equal(depois[LN][0].U_Ativo, 'EQP-0006');
});

test('transação: devolução com leitura menor não altera nada', async () => {
  const antes = JSON.stringify(b1.db.sets.SPSLCTR.find((c) => c.DocEntry === 1));
  const itens = (await admin.get('/api/checklist/EQP')).body.itens;
  const r = await admin.post('/api/movements', { tipo: 'DEV', contrato: 1, linha: 1, data: HOJE, leitura: 10, checklist: checklist(itens), responsavel: 'X' });
  assert.equal(r.status, 400);
  assert.equal(JSON.stringify(b1.db.sets.SPSLCTR.find((c) => c.DocEntry === 1)), antes);
});

test('manutenção: envio e retorno registram os dias fora do cliente', async () => {
  const m = await admin.post('/api/movements', { tipo: 'MAN', contrato: 1, linha: 1, data: HOJE, avarias: 'Vazamento hidráulico' });
  assert.equal(m.status, 200, JSON.stringify(m.body));
  assert.equal((await admin.get('/api/assets/EQP-0001')).body.U_Status, 'MAN');
  const r = await admin.post('/api/movements', { tipo: 'RET', contrato: 1, linha: 1, data: HOJE });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await admin.get('/api/assets/EQP-0001')).body.U_Status, 'LOC');
  const h = (await admin.get('/api/contracts/1/history')).body;
  assert.equal(h.foras.length, 1);
  assert.ok(h.foras[0].U_Fim);
});

test('substituição exige a mesma família', async () => {
  const itens = (await admin.get('/api/checklist/VEI')).body.itens;
  const r = await admin.post('/api/movements', { tipo: 'SUB', contrato: 2, linha: 1, data: HOJE, leitura: 49000, ativoNovo: 'VEI-0004',
    checklist: checklist(itens), responsavel: 'Carlos' });
  assert.equal(r.status, 400);
});

test('multa identifica o contrato e entra no faturamento agrupado', async () => {
  const f = await admin.post('/api/fines', { ativo: 'VEI-0002', data: HOJE, ait: 'B777', valor: 195.23, descricao: 'Estacionamento' });
  assert.equal(f.status, 200, JSON.stringify(f.body));
  assert.equal(f.body.U_CtrEntry, 2);
  assert.equal((await admin.post(`/api/fines/${f.body.Code}/status`, { status: 'REP' })).status, 200);
  const pv = (await admin.get(`/api/billing/2/${COMP}`)).body;
  assert.ok(pv.linhas.some((l) => l.tipo === 'GRP'));
  assert.ok(pv.linhas.some((l) => l.tipo === 'MUL' && l.total === 195.23));
});

test('faturamento em lote roda em segundo plano', async () => {
  const r = await admin.post('/api/billing/generate', { comp: COMP, contratos: [2] });
  assert.equal(r.status, 200);
  let job;
  for (let i = 0; i < 50; i++) {
    job = (await admin.get(`/api/jobs/${r.body.job}`)).body;
    if (job.status !== 'running') break;
    await new Promise((s) => setTimeout(s, 20));
  }
  assert.equal(job.status, 'done');
  assert.equal(job.result[0].ok, true, JSON.stringify(job.result));
  assert.equal(b1.db.sets.Orders.length, 1, 'contrato 2 gera pré-fatura (pedido)');
});

test('painel, disponibilidade, leituras por planilha e auditoria', async () => {
  const d = await admin.get('/api/dashboard');
  assert.equal(d.status, 200);
  assert.ok(d.body.ativos.total > 0);
  const av = await admin.get(`/api/assets/availability?ini=${HOJE}&fim=${HOJE}&familia=PICAPE`);
  assert.ok(av.body.every((a) => a.U_Familia === 'PICAPE'));
  const imp = await admin.post('/api/readings/import', { comp: COMP, csv: 'ativo;leitura;data\nVEI-0001;50000;' + HOJE + '\nEQP-9999;1;' + HOJE });
  assert.equal(imp.body.filter((x) => x.ok).length, 1);
  assert.equal(imp.body.filter((x) => !x.ok).length, 1);
  const au = await admin.get('/api/admin/audit?entity=contrato');
  assert.ok(au.body.length >= 3);
  assert.ok(!JSON.stringify(au.body).includes('data:image'), 'assinatura não vai para o log');
});

test('instalador de estruturas roda sem erro e é idempotente', async () => {
  const r = await admin.post('/api/admin/install');
  assert.equal(r.body.errors, 0, r.body.log?.join('\n'));
});
