// Versão 6 (pedidos da Macromaq): foto na movimentação e na leitura, conferência da leitura de campo, mão de obra no contrato
// com apontamento, conferência do faturamento, documentação dos veículos, oficina (OS interna) e mapa da equipe.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, COMP, HOJE, checklist } from './helpers.js';
import { LN } from '../src/b1/schema.js';

const FOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let app;
let b1;
let admin;
let leit;
before(async () => {
  ({ app, b1 } = await makeApp());
  admin = client(app);
  assert.equal((await admin.login()).status, 200);
  await admin.post('/api/admin/users', { login: 'leiturista1', name: 'Leiturista', password: 'SenhaLeitura123', profile: 'leiturista' });
  leit = client(app);
  assert.equal((await leit.login('leiturista1', 'SenhaLeitura123')).status, 200);
});
after(() => app.close());

test('leitura de campo: exige foto, fica pendente e só vale depois da conferência', async () => {
  const lista = (await leit.get('/api/readings/rented')).body;
  assert.ok(lista.some((x) => x.ativo === 'EQP-0001'));
  const antes = (await admin.get('/api/assets/EQP-0001')).body.U_Medidor;
  assert.equal((await leit.post('/api/readings/field', { ativo: 'EQP-0001', leitura: antes + 40, data: HOJE })).status, 400, 'sem foto');
  const r = await leit.post('/api/readings/field', { ativo: 'EQP-0001', leitura: antes + 40, data: HOJE, foto: FOTO });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.situacao, 'PEN');
  assert.equal((await admin.get('/api/assets/EQP-0001')).body.U_Medidor, antes, 'ainda não atualizou o medidor');
  assert.equal((await leit.get('/api/readings/review')).status, 403, 'leiturista não confere');
  const pend = (await admin.get('/api/readings/review')).body;
  assert.ok(pend.some((m) => m.Code === r.body.code));
  assert.equal((await admin.post(`/api/readings/${r.body.code}/review`, { acao: 'recusar' })).status, 400, 'recusa pede motivo');
  const ok = await admin.post(`/api/readings/${r.body.code}/review`, { acao: 'aprovar' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await admin.get('/api/assets/EQP-0001')).body.U_Medidor, antes + 40);
  assert.equal((await admin.post(`/api/readings/${r.body.code}/review`, { acao: 'aprovar' })).status, 400, 'não confere duas vezes');
});

test('movimentação guarda as fotos e recusa arquivo que não é imagem', async () => {
  const itens = (await admin.get('/api/checklist/EQP')).body.itens;
  const c = await admin.post('/api/contracts', { U_CardCode: 'C0004', U_Tipo: 'LOC', U_DtInicio: HOJE, U_DtFim: '2030-12-31', U_DiaFat: 10, U_Filial: 1, U_ModoFat: 'RAS',
    [LN]: [{ U_Ativo: 'EQP-0003', U_Regra: 'MENSAL', U_Valor: 9500, U_Franquia: 160, U_VlrExced: 60 }] });
  await admin.post(`/api/contracts/${c.body.DocEntry}/status`, { status: 'ATV', U_Versao: c.body.U_Versao });
  const base = { tipo: 'ENT', contrato: c.body.DocEntry, linha: 1, data: HOJE, leitura: 3105, checklist: checklist(itens), responsavel: 'João' };
  assert.equal((await admin.post('/api/movements', { ...base, fotos: [{ src: 'data:text/html;base64,PGI+', legenda: 'x' }] })).status, 400);
  const m = await admin.post('/api/movements', { ...base, fotos: [{ src: FOTO, legenda: 'Lateral esquerda' }, { src: FOTO, legenda: 'Horímetro' }] });
  assert.equal(m.status, 200, JSON.stringify(m.body));
  const gravado = b1.db.sets.SPSLMOV.find((x) => x.DocEntry === m.body.DocEntry);
  assert.equal(JSON.parse(gravado.U_Fotos).length, 2);
});

test('mão de obra: linha no contrato, apontamento aprovado e cobrança em documento de serviço separado', async () => {
  const op = await admin.post('/api/operators', { Code: 'OP09', Name: 'Operador Teste', U_CNH: '123' });
  assert.equal(op.status, 200, JSON.stringify(op.body));
  const c = (await admin.get('/api/contracts/1')).body;
  const linhas = [...c[LN], { U_TipoLinha: 'MO', U_Maquina: 'EQP-0001', U_Operador: 'OP09', U_UnidCobr: 'H', U_Jornada: 8, U_Valor: 85, U_VlrExtra: 120 }];
  const u = await admin.put('/api/contracts/1', { ...c, [LN]: linhas });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  const mo = u.body[LN].find((l) => l.U_TipoLinha === 'MO');
  assert.equal(mo.U_StatusL, 'MO');
  assert.equal(mo.U_ItemCode, 'SLOC810');
  const linhasMO = (await admin.get('/api/timesheet/lines')).body;
  assert.ok(linhasMO.some((l) => l.ctr === 1 && l.linha === mo.LineId));

  // apontamento de quem não aprova fica pendente e trava o faturamento
  await admin.post('/api/admin/users', { login: 'apont1', name: 'Apontador', password: 'SenhaApont1234', profile: 'leiturista' });
  const ap = client(app);
  await ap.login('apont1', 'SenhaApont1234');
  const a1 = await ap.post('/api/timesheet', { ctr: 1, linha: mo.LineId, data: HOJE, hrNorm: 10 });
  assert.equal(a1.status, 200, JSON.stringify(a1.body));
  assert.equal(a1.body.U_HrNorm, 8);
  assert.equal(a1.body.U_HrExtra, 2, 'acima da jornada vira extra');
  assert.equal(a1.body.U_Situacao, 'LAN');
  assert.equal((await ap.post('/api/timesheet', { ctr: 1, linha: mo.LineId, data: HOJE, hrNorm: 4 })).status, 400, 'mesmo dia duplicado');
  const prev = (await admin.get(`/api/billing/1/${COMP}`)).body;
  assert.ok(prev.avisos.some((x) => /apontamento/i.test(x)), JSON.stringify(prev.avisos));

  assert.equal((await admin.post(`/api/timesheet/${a1.body.Code}/decision`, { acao: 'aprovar' })).status, 200);
  const p2 = (await admin.get(`/api/billing/1/${COMP}`)).body;
  const servicos = p2.linhas.filter((l) => l.servico);
  assert.equal(servicos.reduce((s, l) => s + l.total, 0), 8 * 85 + 2 * 120);

  // contrato com franquia: precisa conferir/liberar; abono acima da alçada exige permissão
  const sem = await admin.post('/api/billing/generate-one', { comp: COMP, contrato: 1 });
  assert.equal(sem.status, 400);
  const fat = client(app);
  await admin.post('/api/admin/users', { login: 'fat1', name: 'Faturista', password: 'SenhaFatura123', profile: 'faturamento' });
  await fat.login('fat1', 'SenhaFatura123');
  const caro = p2.linhas.findIndex((l) => !l.servico && l.total > 1000);
  const neg = await fat.post('/api/billing/liberar', { comp: COMP, contrato: 1, ajustes: [{ linha: caro, tipo: 'ABO', motivo: 'NEG' }] });
  assert.equal(neg.status, 403, JSON.stringify(neg.body));
  const lib = await fat.post('/api/billing/liberar', { comp: COMP, contrato: 1, ajustes: [] });
  assert.equal(lib.status, 200, JSON.stringify(lib.body));
  const g = await admin.post('/api/billing/generate-one', { comp: COMP, contrato: 1 });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  const parc = b1.db.sets.U_SPS_LFAT.find((x) => x.Code === `1-${COMP}`);
  assert.ok(parc.U_DocEntry2 > 0, 'mão de obra saiu em documento separado');
});

test('documentação dos veículos: calendário pela placa, pagamento e esboço de conta a pagar', async () => {
  const g = await admin.post('/api/vehicle-docs/calendar', { ano: HOJE.slice(0, 4) });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.ok(g.body.criados > 0);
  const again = await admin.post('/api/vehicle-docs/calendar', { ano: HOJE.slice(0, 4) });
  assert.equal(again.body.criados, 0, 'não duplica');
  const docs = (await admin.get('/api/vehicle-docs')).body;
  const d = docs.find((x) => x.U_Ativo === 'VEI-0001' && x.U_Tipo === 'LIC');
  assert.ok(d && d.placa === 'ABC1D23');
  assert.ok(d.U_Venc.slice(8, 10) === '13', 'final 3 vence no dia 13');
  const p = await admin.post(`/api/vehicle-docs/${d.Code}/pay`, { valor: 1.5e2, gerarB1: true, anexo: FOTO });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.ok(p.body.docB1 > 0);
  const draft = b1.db.sets.Drafts.at(-1);
  assert.equal(draft.DocObjectCode, 'oPurchaseInvoices');
  assert.equal(draft.CardCode, 'F0010');
  assert.equal((await admin.post(`/api/vehicle-docs/${d.Code}/pay`, { valor: 10 })).status, 400);
  assert.equal((await admin.post('/api/vehicle-docs', { ativo: 'EQP-0001', tipo: 'LIC', venc: HOJE })).status, 400, 'só veículos');
});

test('oficina: equipamento em manutenção abre OS interna; peças baixam estoque e terceiro vira pedido de compra', async () => {
  const at = (await admin.get('/api/assets/EQP-0002')).body;
  assert.equal(at.U_Status, 'DIS');
  const s = await admin.post('/api/assets/EQP-0002/status', { status: 'MAN', U_Versao: at.U_Versao, motivo: 'Vazamento no cilindro' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const os = s.body.osInterna;
  assert.ok(os?.DocEntry, JSON.stringify(s.body));
  const det = (await admin.get(`/api/orders/${os.DocEntry}`)).body;
  assert.equal(det.U_Tipo, 'INT');
  const salvar = await admin.put(`/api/orders/${os.DocEntry}`, { U_Versao: det.U_Versao, itens: [
    { tipo: 'PEC', itemCode: 'PEC-0420', descr: 'Kit de vedação', qtd: 1, preco: 480, baixar: 'S' },
    { tipo: 'TER', descr: 'Retífica do cilindro', qtd: 1, preco: 1500, fornecedor: 'F0001' },
  ] });
  assert.equal(salvar.status, 200, JSON.stringify(salvar.body));
  await admin.post(`/api/orders/${os.DocEntry}/start`, {});
  const c = await admin.post(`/api/orders/${os.DocEntry}/conclude`, { checklist: checklist(det.checklistItens || []), laudo: 'Cilindro retificado e vedação trocada.', respons: 'Oficina' });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(b1.db.sets.InventoryGenExits.length, 1);
  assert.equal(b1.db.sets.PurchaseOrders.length, 1);
  assert.equal(b1.db.sets.PurchaseOrders[0].CardCode, 'F0001');
  const ind = (await admin.get('/api/maintenance/indicators')).body;
  assert.ok(ind.custoTotal >= 1980, JSON.stringify(ind).slice(0, 300));
});

test('mapa: check-in da OS grava a posição e calcula a distância da obra', async () => {
  const tec = client(app);
  await admin.post('/api/admin/users', { login: 'tecnico', name: 'Rafael', password: 'SenhaTecnico123', profile: 'tecnico' }).catch(() => {});
  const lg = await tec.login('tecnico', 'SenhaTecnico123');
  assert.equal(lg.status, 200, JSON.stringify(lg.body));
  const o = await admin.post('/api/orders', { tipo: 'COR', ativo: 'EQP-0001', tecnico: 'T01', data: HOJE, hora: '09:00', descricao: 'Ruído no braço' });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  const st = await tec.post(`/api/orders/${o.body.DocEntry}/start`, { lat: -19.9321, lon: -44.0540 });
  assert.equal(st.status, 200, JSON.stringify(st.body));
  const mapa = (await admin.get(`/api/geo/map?data=${HOJE}`)).body;
  const t = mapa.tecnicos.find((x) => x.code === 'T01');
  assert.ok(t.ultima && Math.abs(t.ultima.lat + 19.9321) < 1e-6);
  const item = mapa.os.find((x) => x.DocEntry === o.body.DocEntry);
  assert.equal(item.checkIn.longe, false);
  assert.equal((await tec.post('/api/geo/position', { lat: -19.9, lon: -44 })).status, 403, 'modo padrão só registra na OS');
});

test('portal: cliente vê títulos e resumo financeiro só dele', async () => {
  const r = await admin.post('/api/portal/accesses', { cardCode: 'C0001', nome: 'Paulo', email: 'fin@horizonte.example' });
  const c = client(app);
  const s = await c.post('/api/public/portal/login', { email: 'fin@horizonte.example', codigo: r.body.codigo });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const f = await c.get('/api/public/portal/financeiro', { 'x-portal-token': s.body.token });
  assert.equal(f.status, 200, JSON.stringify(f.body));
  assert.ok(Array.isArray(f.body.titulos));
  assert.ok(f.body.titulos.every((t) => t.CardCode === undefined || t.CardCode === 'C0001'));
  assert.ok('aberto' in f.body.resumo);
});
