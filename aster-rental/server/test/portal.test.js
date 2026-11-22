// Portal do cliente: acesso por código, isolamento entre clientes, QR Code sem login, mensagens e orçamentos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, HOJE } from './helpers.js';

let app;
let b1;
let admin;
before(async () => {
  ({ app, b1 } = await makeApp());
  admin = client(app);
  assert.equal((await admin.login()).status, 200);
});
after(() => app.close());

const portal = (token) => {
  const c = client(app);
  const h = token ? { 'x-portal-token': token } : {};
  return { get: (u) => c.get(`/api/public/portal${u}`, h), post: (u, b) => c.post(`/api/public/portal${u}`, b, h) };
};

let codigo;
let token;

test('locadora cria acesso; o código só aparece uma vez e fica gravado só o resumo', async () => {
  const r = await admin.post('/api/portal/accesses', { cardCode: 'C0001', nome: 'Paulo Mendes', email: 'Paulo@Horizonte.example', fone: '(31) 3333-1020' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  codigo = r.body.codigo;
  assert.match(codigo, /^[A-Z2-9]{8}$/);
  const gravado = b1.db.sets.U_SPS_LPOR.find((x) => x.Code === 'paulo@horizonte.example');
  assert.notEqual(gravado.U_Codigo, codigo);
  assert.equal(gravado.U_Codigo.length, 64);
  const lista = (await admin.get('/api/portal/accesses')).body;
  assert.ok(lista.every((x) => !('U_Codigo' in x) && !('U_Sessao' in x)));
  assert.equal((await admin.post('/api/portal/accesses', { cardCode: 'C0001', nome: 'X', email: 'paulo@horizonte.example' })).status, 400);
});

test('entrar: código errado é recusado e bloqueia após 5 tentativas; certo devolve sessão', async () => {
  const p = portal();
  assert.equal((await p.post('/login', { email: 'paulo@horizonte.example', codigo: 'ERRADO12' })).status, 401);
  const ok = await p.post('/login', { email: 'paulo@horizonte.example', codigo: codigo.toLowerCase() });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  token = ok.body.token;
  assert.equal(ok.body.cliente, 'Construtora Horizonte Ltda');
  assert.equal((await portal(token).get('/me')).body.nome, 'Paulo Mendes');
  assert.equal((await portal('paulo@horizonte.example|tokenfalso').get('/me')).status, 401);
  assert.equal((await portal().get('/chamados')).status, 401);

  await admin.post('/api/portal/accesses', { cardCode: 'C0003', nome: 'Carlos', email: 'carlos@rotasul.example' });
  for (let i = 0; i < 5; i++) await p.post('/login', { email: 'carlos@rotasul.example', codigo: 'NAOEESSE' });
  const bloq = await p.post('/login', { email: 'carlos@rotasul.example', codigo: 'NAOEESSE' });
  assert.equal(bloq.status, 429);
});

test('cliente vê só os próprios equipamentos e chamados, sem as notas internas', async () => {
  const p = portal(token);
  const eq = (await p.get('/equipamentos')).body;
  assert.deepEqual(eq.map((e) => e.ativo).sort(), ['EQP-0001', 'EQP-0004']);
  assert.ok(eq.every((e) => e.preventiva));
  const ch = (await p.get('/chamados')).body;
  assert.ok(ch.length >= 1 && ch.every((c) => c.DocEntry !== 2)); // chamado 2 é da Rota Sul
  assert.equal((await p.get('/chamados/2')).status, 404);
  await admin.post('/api/tickets/1/interactions', { texto: 'Nota interna: cliente costuma desligar o gerador errado.', publico: false });
  const d = (await p.get('/chamados/1')).body;
  assert.ok(d.mensagens.length >= 1);
  assert.ok(d.mensagens.every((m) => !/Nota interna/.test(m.texto)));
  assert.ok(d.visita && d.visita.tecnico === 'Marcos');
});

test('cliente abre chamado com foto, conversa e reabre o que estava aguardando ele', async () => {
  const p = portal(token);
  const foto = { src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD', legenda: 'vazamento' };
  assert.equal((await p.post('/chamados', { ativo: 'VEI-0001', assunto: 'x' })).status, 403); // não é dele
  const r = await p.post('/chamados', { ativo: 'EQP-0001', tipo: 'MAN', assunto: 'Barulho no motor', descricao: 'Barulho ao acelerar', fotos: [foto] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const id = r.body.DocEntry;
  const interno = (await admin.get(`/api/tickets/${id}`)).body;
  assert.equal(interno.U_Origem, 'POR');
  assert.equal(interno.U_Contato, 'Paulo Mendes');
  assert.equal(JSON.parse(interno.U_Fotos)[0].legenda, 'vazamento');
  assert.equal(interno.U_DtResp, '');
  await admin.post(`/api/tickets/${id}/interactions`, { texto: 'Pode mandar um vídeo?', publico: true, status: 'AGC' });
  const m = await p.post(`/chamados/${id}/mensagens`, { texto: 'Enviei por WhatsApp.' });
  assert.equal(m.status, 200);
  assert.equal(m.body.status, 'AND');
  assert.ok(m.body.mensagens.some((x) => x.cliente && x.autor === 'Paulo Mendes'));
  const t2 = (await admin.get(`/api/tickets/${id}`)).body;
  assert.equal(t2.U_Status, 'AND');
});

test('orçamento: cliente aprova pelo portal e a OS registra quem aprovou', async () => {
  const o = (await admin.post('/api/orders', { tipo: 'REP', ativo: 'EQP-0001', descricao: 'Para-brisa trincado', cha: 1 })).body;
  await admin.put(`/api/orders/${o.DocEntry}`, { itens: [{ tipo: 'PEC', itemCode: 'PEC-0210', descr: 'Vidro da cabine', qtd: 1, preco: 1200, cobrar: 'S' }] });
  await admin.post(`/api/orders/${o.DocEntry}/quote`, { acao: 'enviar' });
  const p = portal(token);
  const lista = (await p.get('/orcamentos')).body;
  const orc = lista.find((x) => x.DocEntry === o.DocEntry);
  assert.equal(orc.valor, 1200);
  assert.equal(orc.itens[0].descr, 'Vidro da cabine');
  assert.equal((await p.post(`/orcamentos/${o.DocEntry}`, { acao: 'aprovar' })).status, 200);
  const os = (await admin.get(`/api/orders/${o.DocEntry}`)).body;
  assert.equal(os.U_Orc, 'APR');
  assert.equal(os.U_OrcAprov, 'Paulo Mendes (portal)');
  assert.equal((await p.get('/orcamentos')).body.length, 0);
});

test('etiqueta QR: abre chamado sem login para o equipamento locado; equipamento no pátio recusa', async () => {
  const [eqp, patio] = (await admin.post('/api/portal/qr-labels', { ativos: ['EQP-0004', 'EQP-0002'] })).body;
  assert.match(eqp.token, /^[a-z0-9]{16}$/);
  assert.equal((await admin.post('/api/portal/qr-labels', { ativos: ['EQP-0004'] })).body[0].token, eqp.token); // estável
  const anon = client(app);
  const info = (await anon.get(`/api/public/qr/${eqp.token}`)).body;
  assert.equal(info.codigo, 'EQP-0004');
  assert.equal(info.cliente, 'Construtora Horizonte Ltda');
  assert.ok(!('U_ValorMes' in info) && !('contrato' in info));
  assert.equal((await anon.post(`/api/public/qr/${eqp.token}`, { nome: 'João', tipo: 'PAR' })).status, 400); // sem telefone
  const r = await anon.post(`/api/public/qr/${eqp.token}`, { nome: 'João (operador)', fone: '(31) 99999-0000', tipo: 'PAR', descricao: 'Não liga' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const t = (await admin.get(`/api/tickets?q=${encodeURIComponent('João')}`)).body.items[0];
  assert.equal(t.U_Ativo, 'EQP-0004');
  assert.equal(t.U_Parado, 'S');
  assert.equal(t.U_Origem, 'POR');
  assert.equal((await anon.post(`/api/public/qr/${patio.token}`, { nome: 'X', fone: '1', tipo: 'MAN' })).status, 400);
  assert.equal((await anon.get('/api/public/qr/naoexiste123')).status, 404);
});

test('preventivas: gerar OS de todas as vencidas de uma vez, sem duplicar', async () => {
  const r = await admin.post('/api/preventive/overdue', {});
  assert.equal(r.status, 200);
  assert.ok(r.body.length >= 1 && r.body.every((x) => x.ok), JSON.stringify(r.body));
  assert.equal((await admin.post('/api/preventive/overdue', {})).body.length, 0);
  assert.ok(HOJE);
});

test('desativar acesso derruba a sessão', async () => {
  assert.equal((await admin.post('/api/portal/accesses/paulo@horizonte.example/status', { ativo: false })).status, 200);
  assert.equal((await portal(token).get('/me')).status, 401);
});
