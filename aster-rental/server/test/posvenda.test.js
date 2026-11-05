// Testes do pós-venda: chamados com SLA, OS com parada, orçamento e cobrança, preventivas, pesquisa e histórico.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, HOJE, checklist } from './helpers.js';
import { prazoSituacao } from '../src/services/aftersales.js';
import { addDias } from '../src/lib/util.js';

let app;
let b1;
let admin;
before(async () => {
  ({ app, b1 } = await makeApp());
  admin = client(app);
  assert.equal((await admin.login()).status, 200);
});
after(() => app.close());

const concluirBase = async (id, extra = {}) => {
  const os = (await admin.get(`/api/orders/${id}`)).body;
  return admin.post(`/api/orders/${id}/conclude`, { checklist: checklist(os.checklistItens), laudo: 'Serviço executado e testado.', respons: 'Eng. Paulo', ...extra });
};

test('SLA: situação do prazo', () => {
  assert.equal(prazoSituacao('2026-01-01T08:00', '2026-01-01T12:00', '2026-01-01T11:00', '2026-01-01T13:00'), 'cumprido');
  assert.equal(prazoSituacao('2026-01-01T08:00', '2026-01-01T12:00', '', '2026-01-01T12:30'), 'violado');
  assert.equal(prazoSituacao('2026-01-01T08:00', '2026-01-01T12:00', '', '2026-01-01T11:30'), 'vencendo');
  assert.equal(prazoSituacao('2026-01-01T08:00', '2026-01-01T12:00', '', '2026-01-01T09:00'), 'no_prazo');
});

test('chamado de equipamento parado sobe a prioridade, calcula SLA e puxa o contrato do ativo', async () => {
  const r = await admin.post('/api/tickets', { cardCode: 'C0003', tipo: 'PAR', prior: 'BAI', ativo: 'VEI-0001', assunto: 'Hilux não liga', contato: 'Carlos' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.U_Prior, 'ALT');
  assert.equal(r.body.U_Parado, 'S');
  assert.equal(r.body.U_CtrEntry, 2);
  assert.ok(r.body.U_PrazoResp > r.body.U_Abertura && r.body.U_PrazoSol > r.body.U_PrazoResp);
  // resposta ao cliente marca a primeira resposta
  const i = await admin.post(`/api/tickets/${r.body.DocEntry}/interactions`, { texto: 'Técnico a caminho.', publico: true, status: 'AND' });
  assert.equal(i.status, 200, JSON.stringify(i.body));
  assert.equal(i.body.slaResp, 'cumprido');
  assert.equal(i.body.SPS_LCH1Collection.length, 1);
  // contrato de outro cliente é recusado
  assert.equal((await admin.post('/api/tickets', { cardCode: 'C0002', ctr: 1, assunto: 'x' })).status, 400);
  // fluxo de status protegido
  assert.equal((await admin.post(`/api/tickets/${r.body.DocEntry}/interactions`, { status: 'FEC' })).status, 400);
});

test('chamado da base com resposta atrasada aparece no filtro de SLA violado', async () => {
  const r = await admin.get('/api/tickets?sla=violado');
  assert.ok(r.body.items.some((t) => t.DocNum === 2));
});

test('OS do chamado com parada: desconta dias fora, fecha o chamado, atualiza horímetro e gera pesquisa', async () => {
  const t = (await admin.post('/api/tickets', { cardCode: 'C0001', tipo: 'PAR', ativo: 'EQP-0001', assunto: 'Retro sem força', email: 'obra@horizonte.example' })).body;
  const ontem = addDias(HOJE, -2);
  const o = await admin.post(`/api/tickets/${t.DocEntry}/order`, { tecnico: 'T01', data: HOJE, hora: '15:00', dtParada: ontem });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  assert.equal((await admin.get(`/api/tickets/${t.DocEntry}`)).body.U_Status, 'AND');
  const os = (await admin.get(`/api/orders/${o.body.DocEntry}`)).body;
  assert.equal(os.U_Status, 'AGE');
  assert.equal(os.U_Parada, 'S');
  const foraAberta = (await admin.get('/api/contracts/1/history')).body.foras.find((f) => f.Code === os.U_ForaCode);
  assert.ok(foraAberta && !foraAberta.U_Fim);
  // segundo chamado do mesmo item não abre outra parada
  const t2 = (await admin.post('/api/tickets', { cardCode: 'C0001', tipo: 'PAR', ativo: 'EQP-0001', assunto: 'Repetido' })).body;
  assert.equal((await admin.post(`/api/tickets/${t2.DocEntry}/order`, { dtParada: ontem })).status, 400);

  assert.equal((await admin.post(`/api/orders/${os.DocEntry}/start`, {})).status, 200);
  // checklist incompleto é recusado
  assert.equal((await admin.post(`/api/orders/${os.DocEntry}/conclude`, { laudo: 'ok ok ok', respons: 'X' })).status, 400);
  const c = await concluirBase(os.DocEntry, { medidor: 4600 });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.valor, 0);
  assert.ok(c.body.pesquisa);
  const fora = (await admin.get('/api/contracts/1/history')).body.foras.find((f) => f.Code === os.U_ForaCode);
  assert.equal(fora.U_Fim, addDias(HOJE, -1));
  assert.equal((await admin.get('/api/assets/EQP-0001')).body.U_Medidor, 4600);
  const tk = (await admin.get(`/api/tickets/${t.DocEntry}`)).body;
  assert.equal(tk.U_Status, 'RES');
  assert.equal(tk.slaSol, 'cumprido');

  // pesquisa pública: sem login, uma resposta só; detrator abre chamado de reclamação
  const anon = client(app);
  const pub = await anon.get(`/api/public/survey/${c.body.pesquisa}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.respondida, false);
  assert.equal(pub.body.tecnico, 'Rafael');
  assert.equal((await anon.post(`/api/public/survey/${c.body.pesquisa}`, { nota: 11 })).status, 400);
  assert.equal((await anon.post(`/api/public/survey/${c.body.pesquisa}`, { nota: 4, comentario: 'Demorou muito.' })).status, 200);
  assert.equal((await anon.post(`/api/public/survey/${c.body.pesquisa}`, { nota: 10 })).status, 409);
  assert.equal((await anon.get('/api/surveys')).status, 401);
  const rec = (await admin.get('/api/tickets?q=nota%204')).body.items;
  assert.equal(rec.length, 1);
  assert.equal(rec[0].U_Tipo, 'REC');
  const s = (await admin.get('/api/surveys')).body;
  assert.ok(s.resumo.respostas >= 4);
  assert.equal(typeof s.resumo.nps, 'number');
});

test('conserto no mesmo dia da parada não desconta nada', async () => {
  const o = (await admin.post('/api/orders', { tipo: 'COR', ativo: 'VEI-0002', parada: true, dtParada: HOJE, tecnico: 'T02', data: HOJE })).body;
  const os = (await admin.get(`/api/orders/${o.DocEntry}`)).body;
  assert.equal(os.U_CtrEntry, 2);
  assert.equal((await concluirBase(o.DocEntry)).status, 200);
  const h = (await admin.get('/api/contracts/2/history')).body;
  assert.ok(!h.foras.some((f) => f.Code === os.U_ForaCode));
});

test('orçamento: peça cobrável exige aprovação do cliente e gera rascunho de NF no B1', async () => {
  const o = (await admin.post('/api/orders', { tipo: 'COR', ativo: 'EQP-0004', descricao: 'Bateria' })).body;
  const itens = [{ tipo: 'PEC', itemCode: 'PEC-0305', descr: 'Bateria 150 Ah', qtd: 1, preco: 980, cobrar: 'S' },
    { tipo: 'SRV', itemCode: '', descr: 'Mão de obra', qtd: 1, preco: 150, cobrar: 'N' }];
  const sv = await admin.put(`/api/orders/${o.DocEntry}`, { itens });
  assert.equal(sv.status, 200, JSON.stringify(sv.body));
  assert.equal(sv.body.U_Valor, 980);
  assert.match((await concluirBase(o.DocEntry)).body.error, /orçamento/i);
  assert.equal((await admin.post(`/api/orders/${o.DocEntry}/quote`, { acao: 'enviar' })).body.U_Status, 'AOR');
  assert.equal((await concluirBase(o.DocEntry)).status, 400);
  assert.equal((await admin.post(`/api/orders/${o.DocEntry}/quote`, { acao: 'aprovar' })).status, 400); // sem nome
  assert.equal((await admin.post(`/api/orders/${o.DocEntry}/quote`, { acao: 'aprovar', nome: 'Eng. Paulo' })).body.U_Orc, 'APR');
  const c = await concluirBase(o.DocEntry);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.valor, 980);
  assert.ok(c.body.documento?.numero);
  const draft = b1.db.sets.Drafts.find((d) => d.U_SPS_OsEntry === o.DocEntry);
  assert.equal(draft.DocumentLines.length, 1);
  assert.equal(draft.DocumentLines[0].ItemCode, 'PEC-0305');
  assert.equal(draft.CardCode, 'C0001');
});

test('devolução com avaria abre OS de reparo; reparo no pátio libera o ativo', async () => {
  const itens = (await admin.get('/api/checklist/VEI')).body.itens;
  const chk = checklist(itens);
  chk[itens[3]] = { r: 'NOK', o: 'Amassado na porta traseira' };
  const d = await admin.post('/api/movements', { tipo: 'DEV', contrato: 2, linha: 2, data: HOJE, leitura: 31500, checklist: chk, responsavel: 'Paula',
    destino: 'MAN', avarias: 'Retrovisor quebrado', abrirOS: true });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.ok(d.body.os?.DocEntry);
  const os = (await admin.get(`/api/orders/${d.body.os.DocEntry}`)).body;
  assert.equal(os.U_Tipo, 'REP');
  assert.equal(os.U_CardCode, 'C0003');
  assert.match(os.U_Descricao, /Amassado na porta/);
  assert.equal(os.ativo.U_Status, 'MAN');
  assert.equal((await concluirBase(os.DocEntry)).status, 200);
  assert.equal((await admin.get('/api/assets/VEI-0002')).body.U_Status, 'DIS');
});

test('preventivas: vencida pelo horímetro gera OS uma única vez', async () => {
  const p = (await admin.get('/api/preventive')).body;
  const ger = p.find((x) => x.ativo === 'EQP-0004' && x.plano === 'PRE-GER-250');
  assert.equal(ger.status, 'vencida');
  assert.equal(ger.proxMed, 850);
  const o = await admin.post('/api/preventive/order', { ativo: 'EQP-0004', plano: 'PRE-GER-250', tecnico: 'T03', data: HOJE });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  assert.equal((await admin.post('/api/preventive/order', { ativo: 'EQP-0004', plano: 'PRE-GER-250' })).status, 409);
  const os = (await admin.get(`/api/orders/${o.body.DocEntry}`)).body;
  assert.ok(os.checklistItens.includes('Teste com carga'));
});

test('técnico vê só as próprias OS; histórico do equipamento junta tudo', async () => {
  assert.equal((await admin.post('/api/admin/users', { login: 'tecnico', name: 'Rafael Moreira', password: 'SenhaTecnico123', profile: 'tecnico' })).status, 200);
  const t = client(app);
  assert.equal((await t.login('tecnico', 'SenhaTecnico123')).status, 200);
  const l = (await t.get('/api/orders')).body.items;
  assert.ok(l.length > 0 && l.every((o) => o.U_Tecnico === 'T01'));
  const outra = (await admin.get('/api/orders?tecnico=T03')).body.items[0];
  assert.equal((await t.get(`/api/orders/${outra.DocEntry}`)).status, 403);
  assert.equal((await t.post('/api/orders', { tipo: 'COR', ativo: 'EQP-0002' })).status, 403);
  assert.equal((await t.get('/api/billing?comp=202601')).status, 403);

  const h = (await admin.get('/api/assets/EQP-0001/history')).body;
  const tipos = new Set(h.eventos.map((e) => e.tipo));
  for (const k of ['contrato', 'os', 'chamado', 'leitura']) assert.ok(tipos.has(k), k);
  assert.ok(h.resumo.preventivas >= 1 && h.resumo.corretivas >= 1);
  const d = (await admin.get('/api/aftersales/dashboard')).body;
  assert.ok(d.chamadosAbertos >= 1 && d.slaViolado >= 1);
});
