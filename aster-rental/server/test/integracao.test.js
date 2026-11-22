// Testes da integração com objetos nativos do SAP B1 (B1 simulado com as mesmas regras de item, nº de série e documento base).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, HOJE, COMP, checklist } from './helpers.js';
import { LN } from '../src/b1/schema.js';
import { MockServiceLayer } from '../src/b1/mock.js';
import { createRepos } from '../src/repos.js';
import { createIntegrationService } from '../src/services/integration.js';
import { installStructures } from '../src/b1/installer.js';

let app;
let b1;
let admin;
before(async () => {
  ({ app, b1 } = await makeApp());
  admin = client(app);
  assert.equal((await admin.login()).status, 200);
});
after(() => app.close());

const sets = () => b1.db.sets;

test('prontidão da base de demonstração e listas nativas do de-para', async () => {
  const r = (await admin.get('/api/integration/readiness')).body;
  const pend = r.itens.filter((i) => i.ok === 'pendente');
  assert.deepEqual(pend, [], JSON.stringify(pend));
  assert.equal(r.pronto, r.total);
  const l = (await admin.get('/api/b1/lists?k=depositos,utilizacoes,formasPgto,funcionarios,tiposChamada')).body;
  assert.ok(l.depositos.some((d) => d.id === 'LOC'));
  assert.ok(l.formasPgto.every((f) => f.id !== 'TED-FORN')); // só formas de recebimento
  assert.equal(l.funcionarios.find((f) => f.id === 11).nome, 'Rafael Moreira');
  const end = (await admin.get('/api/b1/addresses/C0001')).body;
  assert.deepEqual(end.map((e) => e.id), ['OBRA PARQUE DAS AGUAS', 'OBRA CENTRO']);
});

test('estrutura: base vazia lista tudo o que falta; depois da instalação não falta nada', async () => {
  const sl = new MockServiceLayer({ seed: () => ({ sets: {}, seq: {} }) });
  const integ = createIntegrationService({ repos: createRepos(sl), audit: { record() {} } });
  const antes = await integ.estrutura();
  assert.ok(antes.tabelas.length >= 20 && antes.objetos.length === 6);
  assert.ok(antes.campos.some((c) => c.startsWith('OSCL.U_SPS_ChaEntry')));
  assert.ok(antes.campos.some((c) => c.startsWith('OWTR.U_SPS_MovEntry')));
  await installStructures(sl);
  const depois = await integ.estrutura();
  assert.equal(depois.tabelas.length + depois.campos.length + depois.objetos.length, 0);
});

test('entrega gera NF de remessa com nº de série e devolução referencia a entrega', async () => {
  const c = await admin.post('/api/contracts', { U_CardCode: 'C0004', U_Tipo: 'LOC', U_DtInicio: `${HOJE.slice(0, 8)}01`, U_DtFim: '2030-12-31', U_DiaFat: 10,
    U_Filial: 1, U_ModoFat: 'RAS', U_EndEntrega: 'FAZENDA BOA VISTA', U_SlpCode: 2, U_CondPgto: 2, U_Projeto: 'OBRA-PQAGUAS',
    [LN]: [{ U_Ativo: 'EQP-0003', U_Regra: 'MENSAL', U_Valor: 9500, U_ItemCode: 'SLOC001' }] });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const id = c.body.DocEntry;
  assert.equal((await admin.post(`/api/contracts/${id}/status`, { status: 'ATV', U_Versao: c.body.U_Versao })).status, 200);
  const itens = (await admin.get('/api/checklist/EQP')).body.itens;
  const ent = await admin.post('/api/movements', { tipo: 'ENT', contrato: id, linha: 1, data: HOJE, leitura: 3110, checklist: checklist(itens), responsavel: 'João' });
  assert.equal(ent.status, 200, JSON.stringify(ent.body));
  assert.equal(ent.body.integracao.ok, true, JSON.stringify(ent.body.integracao));
  const nf = sets().DeliveryNotes.find((d) => d.U_SPS_MovEntry === ent.body.DocEntry);
  assert.equal(nf.CardCode, 'C0004');
  assert.equal(nf.ShipToCode, 'FAZENDA BOA VISTA');
  assert.equal(nf.DocumentLines[0].ItemCode, 'BEM-MINI');
  assert.equal(nf.DocumentLines[0].Usage, 12);
  assert.equal(nf.DocumentLines[0].WarehouseCode, '01');
  assert.deepEqual(nf.DocumentLines[0].SerialNumbers, [{ InternalSerialNumber: 'BOB-S450-1192', Quantity: 1 }]);
  assert.equal((await admin.get(`/api/movements/${ent.body.DocEntry}`)).body.U_DocNumB1, nf.DocNum);

  // faturamento: campos nativos do contrato e do de-para no documento
  const f = await admin.post('/api/billing/generate-one', { comp: COMP, contrato: id });
  assert.equal(f.status, 200, JSON.stringify(f.body));
  const dr = sets().Drafts.find((d) => d.U_SPS_CtrEntry === id);
  assert.equal(dr.PaymentMethod, 'BOLETO-ITAU');
  assert.equal(dr.PaymentGroupCode, 2);
  assert.equal(dr.SalesPersonCode, 2);
  assert.equal(dr.Project, 'OBRA-PQAGUAS');
  assert.equal(dr.ShipToCode, 'FAZENDA BOA VISTA');
  assert.equal(dr.DocumentLines[0].Usage, 9);

  const dev = await admin.post('/api/movements', { tipo: 'DEV', contrato: id, linha: 1, data: HOJE, leitura: 3120, checklist: checklist(itens), responsavel: 'João' });
  assert.equal(dev.status, 200, JSON.stringify(dev.body));
  assert.equal(dev.body.integracao.ok, true, JSON.stringify(dev.body.integracao));
  const ret = sets().Returns.find((d) => d.U_SPS_MovEntry === dev.body.DocEntry);
  assert.equal(ret.DocumentLines[0].BaseType, 15);
  assert.equal(ret.DocumentLines[0].BaseEntry, nf.DocEntry);
  assert.equal(ret.DocumentLines[0].Usage, 13);
});

test('erro no B1 não desfaz a movimentação: fica no monitor e reprocessa depois de corrigir', async () => {
  // ativo sem item do bem: a devolução é registrada no Áster, a NF de retorno fica com erro
  const a = (await admin.get('/api/assets/VEI-0001')).body;
  assert.equal((await admin.put('/api/assets/VEI-0001', { ...a, U_ItemBem: '', U_Versao: a.U_Versao })).status, 200);
  const itens = (await admin.get('/api/checklist/VEI')).body.itens;
  const dev = await admin.post('/api/movements', { tipo: 'DEV', contrato: 2, linha: 1, data: HOJE, leitura: 49000, checklist: checklist(itens), responsavel: 'Carlos' });
  assert.equal(dev.status, 200);
  assert.equal(dev.body.integracao.ok, false);
  assert.match(dev.body.integracao.erro, /item do bem/);
  const log = (await admin.get('/api/integration/log?status=ERR')).body;
  const reg = log.find((l) => l.U_Ref === String(dev.body.DocEntry));
  assert.ok(reg);
  const r1 = (await admin.get('/api/integration/readiness')).body;
  assert.ok(r1.itens.some((i) => i.grupo === 'Monitor' && i.ok === 'pendente'));

  const a2 = (await admin.get('/api/assets/VEI-0001')).body;
  assert.equal((await admin.put('/api/assets/VEI-0001', { ...a2, U_ItemBem: 'BEM-PICAPE', U_Versao: a2.U_Versao })).status, 200);
  const rp = await admin.post(`/api/integration/log/${encodeURIComponent(reg.Code)}/retry`, {});
  assert.equal(rp.status, 200);
  assert.equal(rp.body.ok, true, JSON.stringify(rp.body));
  const ret = sets().Returns.find((d) => d.U_SPS_MovEntry === dev.body.DocEntry);
  assert.equal(ret.DocumentLines[0].ItemCode, 'BEM-PICAPE'); // sem entrega do Áster: retorno avulso com o item
  assert.equal((await admin.get('/api/integration/log?status=ERR')).body.length, 0);
});

test('modo transferência: entrega move o bem do pátio para o depósito de clientes', async () => {
  assert.equal((await admin.put('/api/admin/settings', { B1_REMESSA: 'TRANSF' })).status, 200);
  const c = await admin.post('/api/contracts', { U_CardCode: 'C0005', U_Tipo: 'LOC', U_DtInicio: HOJE, U_DiaFat: 5, U_Filial: 1, U_ModoFat: 'RAS',
    [LN]: [{ U_Ativo: 'EQP-0002', U_Regra: 'MENSAL', U_Valor: 32000, U_ItemCode: 'SLOC001' }] });
  await admin.post(`/api/contracts/${c.body.DocEntry}/status`, { status: 'ATV', U_Versao: c.body.U_Versao });
  const itens = (await admin.get('/api/checklist/EQP')).body.itens;
  const ent = await admin.post('/api/movements', { tipo: 'ENT', contrato: c.body.DocEntry, linha: 1, data: HOJE, leitura: 2210, checklist: checklist(itens), responsavel: 'Ana' });
  assert.equal(ent.body.integracao.ok, true, JSON.stringify(ent.body.integracao));
  const tr = sets().StockTransfers.find((d) => d.U_SPS_MovEntry === ent.body.DocEntry);
  assert.equal(tr.FromWarehouse, '01');
  assert.equal(tr.ToWarehouse, 'LOC');
  assert.equal(tr.StockTransferLines[0].SerialNumbers[0].InternalSerialNumber, 'CAT320-55120');
  await admin.put('/api/admin/settings', { B1_REMESSA: 'NF' });
});

test('chamado vira chamada de serviço nativa; OS vira atividade do técnico e fecha a chamada', async () => {
  const t = (await admin.post('/api/tickets', { cardCode: 'C0001', tipo: 'PAR', ativo: 'EQP-0001', assunto: 'Retro com vazamento' })).body;
  const call = sets().ServiceCalls.find((s) => s.U_SPS_ChaEntry === t.DocEntry);
  assert.ok(call, 'chamada criada');
  assert.equal(t.U_CallID, call.ServiceCallID);
  assert.equal(call.CustomerCode, 'C0001');
  assert.equal(call.ItemCode, 'BEM-RETRO');
  assert.equal(call.InternalSerialNum, 'JCB3CX-778812');
  assert.equal(call.Priority, 'scp_High');
  assert.equal(call.Status, -3);
  assert.equal(call.CallType, 1);

  const o = await admin.post(`/api/tickets/${t.DocEntry}/order`, { tecnico: 'T01', data: HOJE, hora: '15:30', parada: false });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  const os = (await admin.get(`/api/orders/${o.body.DocEntry}`)).body;
  const act = sets().Activities.find((a) => a.U_SPS_OsEntry === os.DocEntry);
  assert.ok(act, 'atividade criada');
  assert.equal(os.U_ActCode, act.ActivityCode);
  assert.equal(act.HandledByEmployee, 11);
  assert.equal(act.ActivityTime, '15:30:00');
  assert.equal(act.Closed, 'tNO');
  let sc = sets().ServiceCalls.find((s) => s.ServiceCallID === call.ServiceCallID);
  assert.equal(sc.TechnicianCode, 11);
  assert.ok(sc.ServiceCallActivities.some((a) => a.ActivityCode === act.ActivityCode));

  const conc = await admin.post(`/api/orders/${os.DocEntry}/conclude`, { checklist: checklist(os.checklistItens), laudo: 'Mangueira trocada e testada.', respons: 'Eng. Paulo' });
  assert.equal(conc.status, 200, JSON.stringify(conc.body));
  sc = sets().ServiceCalls.find((s) => s.ServiceCallID === call.ServiceCallID);
  assert.equal(sc.Status, -1);
  assert.match(sc.Resolution, /Mangueira trocada/);
  assert.equal(sets().Activities.find((a) => a.ActivityCode === act.ActivityCode).Closed, 'tYES');
});

test('trazer equipamentos a partir dos nºs de série do B1', async () => {
  const l = (await admin.get('/api/integration/serials')).body;
  assert.deepEqual(l.map((s) => s.SerialNumber).sort(), ['JLG450-31877', 'STM-260-77801']);
  const r = await admin.post('/api/integration/serials/import', { linhas: [{ ...l.find((s) => s.ItemCode === 'BEM-GER'), familia: 'GERADOR', itemFat: 'SLOC003' }] });
  assert.equal(r.status, 200);
  assert.equal(r.body[0].ok, true, JSON.stringify(r.body));
  const a = (await admin.get(`/api/assets/${r.body[0].code}`)).body;
  assert.equal(a.U_ItemBem, 'BEM-GER');
  assert.equal(a.U_Serie, 'STM-260-77801');
  assert.equal(a.U_Familia, 'GERADOR');
  assert.equal((await admin.get('/api/integration/serials')).body.length, 1);
});

test('base de apresentação: monta tudo pelas regras do sistema, com um único erro proposital no monitor', async () => {
  const { montarApresentacao } = await import('../src/b1/apresentacao.js');
  const { demoSeed } = await import('../src/b1/seed.js');
  const sl = new MockServiceLayer({ seed: demoSeed });
  await montarApresentacao(sl);
  const s = sl.db.sets;
  assert.equal(s.SPSLCTR.length, 9);
  assert.deepEqual([...new Set(s.SPSLCTR.map((c) => c.U_Status))].sort(), ['ATV', 'ENC', 'RAS', 'SUS']);
  assert.ok(s.U_SPS_LFAT.length >= 8 && s.U_SPS_LFAT.every((p) => p.U_Status === 'OK'));
  const erros = s.U_SPS_LINT.filter((l) => l.U_Status === 'ERR');
  assert.equal(erros.length, 1);
  assert.match(erros[0].U_Erro, /VEI-0007/);
  assert.ok(s.SPSLCHA.every((t) => t.U_CallID), 'todos os chamados espelhados no B1');
  assert.ok(s.U_SPS_LPES.filter((p) => p.U_Nota >= 0).length >= 10);
});
