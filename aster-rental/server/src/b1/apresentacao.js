// Base de apresentação: parte da base de demonstração e executa as operações pelos próprios serviços do Áster
// (contratos, entregas, leituras, faturamento de meses anteriores, chamados, OS e pesquisas). Assim tudo fica coerente:
// parcelas com memória de cálculo, documentos no B1 simulado, log de integração, SLA e NPS. As datas são relativas a hoje.
import { createServices } from '../services/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { SET, LN, CH1 } from './schema.js';
import { hoje, addDias, compDe, addHoras } from '../lib/util.js';
import { montarV6 } from './apresentacao-v6.js';

const req = { user: { login: 'implantacao', name: 'Implantação', perms: Object.keys(PERMISSIONS), branches: [] }, id: 'apresentacao', ip: '' };

// Aumente a cada mudança nos dados de apresentação: a base guardada de uma versão anterior é recriada ao abrir.
export const VERSAO_APRESENTACAO = '4';

/** Base guardada é de outra versão (ou não é de apresentação)? Então volta à semente e monta de novo. */
export async function garantirApresentacao(sl, opts = {}) {
  const marca = (sl.db.sets.U_SPS_LCFG || []).find((r) => r.Code === 'APRESENTACAO')?.U_Valor;
  if (sl.carregado && marca === VERSAO_APRESENTACAO) return false;
  if (sl.carregado) sl.reset();
  await montarApresentacao(sl, opts);
  return true;
}

export async function montarApresentacao(sl, { posicoes } = {}) {
  const S = createServices({ sl, audit: { record() {} }, jobs: null, posicoes });
  const { repos } = S;
  const h = hoje();
  const D = (n) => addDias(h, n);
  const ini = (mesesAtras) => {
    let d = `${h.slice(0, 8)}01`;
    for (let i = 0; i < mesesAtras; i++) d = `${addDias(d, -1).slice(0, 8)}01`;
    return d;
  };
  const m3 = ini(3);
  const m2 = ini(2);
  const m1 = ini(1);
  const tenta = async (fn) => {
    try {
      return await fn();
    } catch {
      return null;
    }
  };

  /* ---------- cadastros nativos extras no B1 ---------- */
  const novosBP = [
    ['C0006', 'Prefeitura Municipal de Sete Lagoas', '18.715.383/0001-40', 'compras@setelagoas.example', 'PATIO OBRAS', 'Av. Prefeito Alberto Moura, 2000', 'Sete Lagoas'],
    ['C0007', 'Energia Solar Minas Ltda', '41.226.884/0001-75', 'financeiro@solarminas.example', 'USINA JANAUBA', 'Rodovia MG-401, km 8', 'Janaúba'],
  ];
  for (const [CardCode, CardName, FederalTaxID, EmailAddress, end, Street, City] of novosBP) {
    await sl.request('POST', 'BusinessPartners', { CardCode, CardName, FederalTaxID, EmailAddress, CardType: 'cCustomer', Valid: 'tYES',
      BPAddresses: [{ AddressName: 'COBRANCA', AddressType: 'bo_BillTo', Street, City, State: 'MG' }, { AddressName: end, AddressType: 'bo_ShipTo', Street, City, State: 'MG' }] });
  }
  const serra = await sl.get("BusinessPartners('C0002')");
  await sl.request('PATCH', "BusinessPartners('C0002')", { BPAddresses: [...(serra.BPAddresses || []),
    { AddressName: 'MINA CORREGO FUNDO', AddressType: 'bo_ShipTo', Street: 'Estrada da Mina, km 3', City: 'Itabirito', State: 'MG' }] });
  await sl.request('POST', SET.FAM, { Code: 'ROLO', Name: 'Rolos compactadores', U_Tipo: 'EQP', U_Caract: 'terraplenagem, diesel' });
  await sl.request('POST', 'Items', { ItemCode: 'BEM-ROLO', ItemName: 'Rolo compactador', SalesItem: 'tYES', InventoryItem: 'tYES', ManageSerialNumbers: 'tYES', Valid: 'tYES' });
  await sl.request('POST', SET.PLN, { Code: 'PRE-ROLO-250', Name: 'Rolo compactador — 250 h', U_Familia: 'ROLO', U_IntMed: 250, U_IntDias: 180, U_Aviso: 10,
    U_Checklist: 'Troca de óleo do motor\nFiltros\nSistema vibratório\nRaspadores do cilindro\nTeste de funcionamento', U_Ativo: 'S' });

  const ativos = [
    ['EQP-0007', 'Retroescavadeira CAT 416F', 'EQP', 'RETRO', 'BEM-RETRO', 'CAT416F-90233', 'Caterpillar', '416F', '2022', 2860, 17500, 880],
    ['EQP-0008', 'Rolo compactador Dynapac CA250', 'EQP', 'ROLO', 'BEM-ROLO', 'DYN-CA250-4471', 'Dynapac', 'CA250', '2021', 3310, 12500, 620],
    ['EQP-0010', 'Plataforma tesoura Genie GS-2632', 'EQP', 'PLAT', 'BEM-PLAT', 'GS2632-71520', 'Genie', 'GS-2632', '2022', 640, 5200, 280],
    ['EQP-0011', 'Minicarregadeira Bobcat S510', 'EQP', 'MINICAR', 'BEM-MINI', 'BOB-S510-2280', 'Bobcat', 'S510', '2023', 1150, 9800, 490],
    ['EQP-0012', 'Retroescavadeira JCB 3CX (2)', 'EQP', 'RETRO', 'BEM-RETRO', 'JCB3CX-781190', 'JCB', '3CX', '2023', 1320, 18000, 900],
    ['VEI-0005', 'Picape Toyota Hilux CD 4x4 (2)', 'VEI', 'PICAPE', 'BEM-PICAPE', '9BRBA3HE0R0456789', 'Toyota', 'Hilux CD SRV', '2024', 15000, 6500, 320, 'QRS2T45'],
    ['VEI-0006', 'Fiat Strada Freedom CS (2)', 'VEI', 'UTIL', 'BEM-UTIL', '9BD281A2DRY112233', 'Fiat', 'Strada Freedom', '2024', 8300, 3200, 160, 'UVW3X67'],
    ['VEI-0007', 'Caminhão VW Delivery 11.180 (2)', 'VEI', 'CAMINHAO', '', '9535N8243RR445566', 'Volkswagen', 'Delivery 11.180', '2024', 21300, 9800, 490, 'YZA4B89'],
  ];
  const itemFat = { EQP: 'SLOC001', VEI: 'SLOC002' };
  let docSerie = 100;
  for (const [Code, Name, U_Tipo, U_Familia, U_ItemBem, U_Serie, U_Marca, U_Modelo, U_Ano, U_Medidor, U_ValorMes, U_ValorDia, U_Placa] of ativos) {
    await repos.assets.create({ Code, Name, U_Tipo, U_Familia, U_Categoria: '', U_ItemCode: itemFat[U_Tipo], U_ItemBem, U_Serie, U_Marca, U_Modelo, U_Ano,
      U_Medidor, U_ValorMes, U_ValorDia, U_VlrBem: U_ValorMes * 30, U_Placa: U_Placa || '', U_Chassi: U_Tipo === 'VEI' ? U_Serie : '', U_Status: 'DIS', U_CtrAtual: 0, U_Filial: 1 });
    // O caminhão VEI-0007 fica sem "item do bem" de propósito: a remessa dá erro e aparece no monitor para reprocessar na apresentação.
    await sl.request('POST', 'SerialNumberDetails', { DocEntry: ++docSerie, ItemCode: U_ItemBem || 'BEM-CAM', ItemDescription: Name, SerialNumber: U_Serie, MfrSerialNo: U_Serie, Status: 0 });
  }

  /* ---------- contratos, entregas, leituras e faturamento ---------- */
  const chk = {};
  for (const t of ['EQP', 'VEI']) chk[t] = Object.fromEntries((await S.movements.checklistItems(t)).map((i) => [i, { r: 'OK' }]));
  const tipoDe = (code) => (code.startsWith('VEI') ? 'VEI' : 'EQP');

  async function contrato(input, ativar = true) {
    let c = await S.contracts.create(req, input);
    if (ativar) c = await S.contracts.setStatus(req, c.DocEntry, 'ATV', c.U_Versao);
    return c;
  }
  async function mov(tipo, c, linha, data, leitura, extra = {}) {
    const l = (await repos.contracts.get(c.DocEntry))[LN].find((x) => x.LineId === linha);
    const r = await S.movements.register(req, { tipo, contrato: c.DocEntry, linha, data, leitura, checklist: chk[tipoDe(l.U_Ativo)], responsavel: extra.responsavel || 'Encarregado da obra',
      documento: '', avarias: extra.avarias || '', destino: 'DIS' });
    await S.integ.movimento(req, r.DocEntry);
    return r;
  }
  const leitura = (ativo, valor, data) => tenta(() => S.operations.registerReading(req, { ativo, leitura: valor, data, comp: compDe(data) }));
  // Faturar na base de apresentação: libera a conferência (sem ajustes) e gera o documento.
  const faturar = (c, data) => tenta(async () => {
    await S.billing.liberar(req, c.DocEntry, compDe(data), []);
    return S.billing.generateOne(req, c.DocEntry, compDe(data));
  });

  // Leitura e faturamento de meses anteriores dos contratos da base (horímetro já atualizado: grava a leitura direto).
  await sl.request('POST', SET.MED, { Code: 'apr-1', Name: 'apr-1', U_CtrEntry: 1, U_CtrLine: 1, U_Ativo: 'EQP-0001', U_Comp: compDe(m2), U_Data: addDias(m1, -1),
    U_LeitIni: 4090, U_LeitFim: 4280, U_Abat: 0, U_Origem: 'MAN' });
  const ctr1 = await repos.contracts.get(1);
  const ctr2 = await repos.contracts.get(2);
  await faturar(ctr1, m2);
  await faturar(ctr1, m1);
  await faturar(ctr2, m1);

  // 4 — Mineração Serra Azul: escavadeira e picape há três meses, com excedente de horas e km.
  const c4 = await contrato({ U_CardCode: 'C0002', U_Tipo: 'LOC', U_DtInicio: addDias(m3, 4), U_DtFim: addDias(m3, 4 + 365), U_DiaFat: 10, U_Filial: 1, U_ModoFat: 'FAT',
    U_Obra: 'Mina Córrego Fundo — Itabirito/MG', U_EndEntrega: 'MINA CORREGO FUNDO', U_SlpCode: 1, U_CondPgto: 1, U_Indice: 'IPCA', U_Email: 'contas@serraazul.example',
    [LN]: [{ U_Familia: 'ESCAV', U_Ativo: 'EQP-0006', U_ItemCode: 'SLOC001', U_Regra: 'MENSAL', U_Valor: 32000, U_Diaria: 1600, U_Franquia: 200, U_VlrExced: 140 },
      { U_Familia: 'PICAPE', U_Ativo: 'VEI-0005', U_ItemCode: 'SLOC002', U_Regra: 'MENSAL', U_Valor: 6500, U_Diaria: 320, U_Franquia: 3000, U_VlrExced: 0.9,
        U_Condutor: 'Marcos Antônio Reis — CNH 04455667788' }] });
  await mov('ENT', c4, 1, addDias(m3, 4), 940);
  await mov('ENT', c4, 2, addDias(m3, 4), 15000);
  for (const [ativo, vals] of [['EQP-0006', [1110, 1340, 1590]], ['VEI-0005', [17600, 20900, 23500]]]) {
    for (const [i, mes] of [m2, m1, h.slice(0, 8) + '01'].entries()) await leitura(ativo, vals[i], addDias(mes, -1));
  }
  await faturar(c4, m3);
  await faturar(c4, m2);
  await faturar(c4, m1);

  // 5 — Agro Vale Verde: começou no mês passado e a parcela ficou sem gerar (aparece como atrasada).
  const c5 = await contrato({ U_CardCode: 'C0004', U_Tipo: 'LOC', U_DtInicio: addDias(m1, 4), U_DtFim: addDias(m1, 4 + 180), U_DiaFat: 20, U_Filial: 1, U_ModoFat: 'RAS',
    U_Obra: 'Fazenda Boa Vista — Unaí/MG', U_EndEntrega: 'FAZENDA BOA VISTA', U_SlpCode: 2, U_CondPgto: 2, U_Email: 'adm@valeverde.example', U_Indice: 'IGP-M',
    [LN]: [{ U_Familia: 'MINICAR', U_Ativo: 'EQP-0011', U_ItemCode: 'SLOC001', U_Regra: 'MENSAL', U_Valor: 9800, U_Diaria: 490, U_Franquia: 160, U_VlrExced: 65 },
      { U_Familia: 'UTIL', U_Ativo: 'VEI-0006', U_ItemCode: 'SLOC002', U_Regra: 'MENSAL', U_Valor: 3200, U_Diaria: 160, U_Franquia: 2500, U_VlrExced: 0.7,
        U_Condutor: 'José Carlos Lima — CNH 09988776655' }] });
  await mov('ENT', c5, 1, addDias(m1, 4), 1150);
  await mov('ENT', c5, 2, addDias(m1, 4), 8300);
  await leitura('EQP-0011', 1328, addDias(`${h.slice(0, 8)}01`, -1));
  await leitura('VEI-0006', 10900, addDias(`${h.slice(0, 8)}01`, -1));

  // 6 — Eventos Prime: plataforma por diária, devolvida no mês passado e contrato encerrado.
  const c6 = await contrato({ U_CardCode: 'C0005', U_Tipo: 'LOC', U_DtInicio: addDias(m2, 9), U_DtFim: addDias(m1, 13), U_DiaFat: 5, U_Filial: 1, U_ModoFat: 'RAS',
    U_Obra: 'Expominas — montagem de feira', U_SlpCode: 1, U_Email: 'contato@prime.example',
    [LN]: [{ U_Familia: 'PLAT', U_Ativo: 'EQP-0010', U_ItemCode: 'SLOC001', U_Regra: 'DIARIA', U_Valor: 5200, U_Diaria: 280 }] });
  await mov('ENT', c6, 1, addDias(m2, 9), 640);
  await mov('DEV', c6, 1, addDias(m1, 13), 702);
  await faturar(c6, m2);
  await faturar(c6, m1);
  await tenta(async () => S.contracts.setStatus(req, c6.DocEntry, 'ENC', (await repos.contracts.get(c6.DocEntry)).U_Versao));

  // 7 — Prefeitura: rolo compactador, contrato suspenso (obra parada).
  const c7 = await contrato({ U_CardCode: 'C0006', U_Tipo: 'LOC', U_DtInicio: m2, U_DtFim: addDias(m2, 240), U_DiaFat: 1, U_Filial: 1, U_ModoFat: 'PRE',
    U_Obra: 'Pátio de obras — Sete Lagoas/MG', U_EndEntrega: 'PATIO OBRAS', U_CondPgto: 1, U_Email: 'compras@setelagoas.example',
    [LN]: [{ U_Familia: 'ROLO', U_Ativo: 'EQP-0008', U_ItemCode: 'SLOC001', U_Regra: 'MENSAL', U_Valor: 12500, U_Diaria: 620 }] });
  await mov('ENT', c7, 1, m2, 3310);
  await faturar(c7, m2);
  await faturar(c7, m1);
  await tenta(async () => S.contracts.setStatus(req, c7.DocEntry, 'SUS', (await repos.contracts.get(c7.DocEntry)).U_Versao));

  // 8 — Energia Solar Minas: novo, com a remessa do caminhão em erro (ativo sem item do bem no B1).
  const ent8 = h.slice(8) > '06' ? D(-6) : `${h.slice(0, 8)}01`;
  const c8 = await contrato({ U_CardCode: 'C0007', U_Tipo: 'LOC', U_DtInicio: ent8, U_DtFim: addDias(ent8, 365), U_DiaFat: 15, U_Filial: 1, U_ModoFat: 'RAS',
    U_Obra: 'Usina solar Janaúba — MG-401', U_EndEntrega: 'USINA JANAUBA', U_SlpCode: 2, U_CondPgto: 1, U_Email: 'financeiro@solarminas.example',
    [LN]: [{ U_Familia: 'RETRO', U_Ativo: 'EQP-0007', U_ItemCode: 'SLOC001', U_Regra: 'MENSAL', U_Valor: 17500, U_Diaria: 880, U_Franquia: 200, U_VlrExced: 90 },
      { U_Familia: 'CAMINHAO', U_Ativo: 'VEI-0007', U_ItemCode: 'SLOC002', U_Regra: 'MENSAL', U_Valor: 9800, U_Diaria: 490, U_Franquia: 4000, U_VlrExced: 0.85,
        U_Condutor: 'Wellington Souza — CNH 07766554433' }] });
  await mov('ENT', c8, 1, ent8, 2860);
  await mov('ENT', c8, 2, ent8, 21300);

  // 9 — Proposta em rascunho para a Construtora Horizonte.
  await contrato({ U_CardCode: 'C0001', U_Tipo: 'LOC', U_DtInicio: h, U_DtFim: D(180), U_DiaFat: 5, U_Filial: 1, U_ModoFat: 'RAS', U_Obra: 'Obra Centro — Belo Horizonte/MG',
    U_EndEntrega: 'OBRA CENTRO', U_SlpCode: 1, U_CondPgto: 1, U_Projeto: 'OBRA-PQAGUAS', U_Email: 'financeiro@horizonte.example',
    U_Obs: 'Proposta enviada; aguardando aprovação do cliente.',
    [LN]: [{ U_Familia: 'RETRO', U_Ativo: 'EQP-0012', U_ItemCode: 'SLOC001', U_Regra: 'MENSAL', U_Valor: 18000, U_Diaria: 900, U_Franquia: 200, U_VlrExced: 95 },
      { U_Familia: 'PLAT', U_ItemCode: 'SLOC001', U_Regra: 'MENSAL', U_Valor: 4200, U_Diaria: 210 }] }, false);

  // Situações variadas no faturamento do mês: geradas, vencendo em breve e atrasadas (dia relativo a hoje).
  const dia = Number(h.slice(8));
  const vence = String(Math.min(dia + 3, 28));
  for (const [id, d] of [[2, vence], [c8.DocEntry, String(Math.min(dia + 5, 28))]]) await sl.request('PATCH', `${SET.CTR}(${id})`, { U_DiaFat: Number(d) });
  await faturar(c4, h);
  await faturar(c7, h);

  /* ---------- multas ---------- */
  const mu1 = await tenta(() => S.operations.createFine(req, { ativo: 'VEI-0005', data: D(-25), hora: '08:47', ait: 'MG2026-554120', valor: 195.23, descricao: 'Avançar sinal vermelho' }));
  if (mu1) await tenta(() => S.operations.setFineStatus(req, mu1.Code, 'REP'));
  await tenta(() => S.operations.createFine(req, { ativo: 'VEI-0006', data: D(-9), hora: '17:12', ait: 'MG2026-601873', valor: 130.16, descricao: 'Excesso de velocidade até 20%' }));

  /* ---------- pós-venda: histórico de chamados, OS e pesquisas ---------- */
  // Chamados e OS que já vinham na base: espelha no B1 (chamada de serviço e atividade).
  for (const t of await repos.tickets.all()) await S.integ.chamado(req, t.DocEntry);
  for (const o of await repos.orders.all({ abertas: true })) await S.integ.atividade(req, o.DocEntry);

  async function envelhecer(chaId, abertura, respH, solH) {
    const t = await repos.tickets.get(chaId);
    const sla = { URG: [1, 8], ALT: [2, 24], MED: [4, 48], BAI: [8, 96] }[t.U_Prior];
    const patch = { U_Abertura: abertura, U_PrazoResp: addHoras(abertura, sla[0]), U_PrazoSol: addHoras(abertura, sla[1]) };
    if (t.U_DtResp) patch.U_DtResp = addHoras(abertura, respH);
    if (t.U_DtSol) patch.U_DtSol = addHoras(abertura, solH);
    patch[CH1] = (t[CH1] || []).map((l, i) => ({ LineId: l.LineId, U_Data: addHoras(abertura, Math.min(respH + i * 2, solH ?? respH + i * 2)) }));
    await sl.request('PATCH', `${SET.CHA}(${chaId})`, patch);
  }
  async function atenderComOS(t, { tecnico, dia, horaIni, horas, laudo, itens, aprovador }) {
    const o = await S.aftersales.orderFromTicket(req, t.DocEntry, { tecnico, data: dia, hora: horaIni, parada: false });
    await S.aftersales.startOrder(req, o.DocEntry, {});
    let os = await S.aftersales.getOrder(req, o.DocEntry);
    if (itens) {
      await S.aftersales.saveOrder(req, o.DocEntry, { itens, U_Versao: os.U_Versao });
      await S.aftersales.quoteOrder(req, o.DocEntry, { acao: 'enviar' });
      await S.aftersales.quoteOrder(req, o.DocEntry, { acao: 'aprovar', nome: aprovador });
      os = await S.aftersales.getOrder(req, o.DocEntry);
    }
    const r = await S.aftersales.concludeOrder(req, o.DocEntry, { checklist: Object.fromEntries(os.checklistItens.map((i) => [i, { r: 'OK' }])), laudo,
      respons: 'Responsável da obra' });
    const inicio = `${dia}T${horaIni}`;
    await sl.request('PATCH', `${SET.OS}(${o.DocEntry})`, { U_CheckIn: inicio, U_CheckOut: addHoras(inicio, horas) });
    return { os: o, pesquisa: r.pesquisa, fim: addHoras(inicio, horas) };
  }
  const responder = async (code, nota, comentario, quando) => {
    if (!code) return;
    await tenta(() => S.aftersales.answerSurvey(code, { nota, comentario }));
    await sl.request('PATCH', `${SET.PES}('${code}')`, { U_Enviada: quando.slice(0, 10), U_Respondida: addHoras(quando, 20) });
  };

  // Pneu furado na mina: resolvido no mesmo dia.
  const ta = await S.aftersales.createTicket(req, { cardCode: 'C0002', tipo: 'PAR', prior: 'ALT', origem: 'WPP', ativo: 'VEI-0005', contato: 'Marcos Reis',
    fone: '(31) 99876-1122', assunto: 'Pneu rasgado na picape', descricao: 'Pneu traseiro rasgou na estrada da mina. Estepe já usado.' });
  await S.aftersales.interact(req, ta.DocEntry, { texto: 'Técnica a caminho com pneu novo.', publico: true, status: 'AND' });
  const ra = await atenderComOS(ta, { tecnico: 'T02', dia: D(-40), horaIni: '10:00', horas: 2, laudo: 'Pneu substituído e calibrado. Estepe reposto.' });
  await envelhecer(ta.DocEntry, `${D(-40)}T07:30`, 0.5, 4.5);
  await responder(ra.pesquisa, 10, 'Atendimento muito rápido, salvou o turno.', ra.fim);

  // Minicarregadeira sem força: peça cobrada (mau uso) com orçamento aprovado.
  const tb = await S.aftersales.createTicket(req, { cardCode: 'C0004', tipo: 'MAN', prior: 'MED', origem: 'TEL', ativo: 'EQP-0011', contato: 'José Carlos',
    fone: '(38) 99654-3321', assunto: 'Minicarregadeira perdendo força', descricao: 'Equipamento perde força ao subir rampa.' });
  const rb = await atenderComOS(tb, { tecnico: 'T01', dia: D(-11), horaIni: '09:00', horas: 3, aprovador: 'José Carlos Lima',
    laudo: 'Filtro de ar entupido por falta de limpeza diária (mau uso). Filtro trocado; orientado o operador.',
    itens: [{ tipo: 'PEC', itemCode: 'PEC-0101', descr: 'Filtro de ar', qtd: 1, preco: 340, cobrar: 'S' }, { tipo: 'SRV', itemCode: 'SLOC800', descr: 'Mão de obra técnica', qtd: 2, preco: 180, cobrar: 'S' },
      { tipo: 'DES', itemCode: '', descr: 'Deslocamento até a fazenda', qtd: 1, preco: 250, cobrar: 'N' }] });
  await envelhecer(tb.DocEntry, `${D(-12)}T14:00`, 1, 22);
  await responder(rb.pesquisa, 8, 'Bom atendimento. A cobrança do filtro poderia ter sido explicada antes.', rb.fim);

  // Dúvida de operação resolvida por telefone (sem OS).
  const tc = await S.aftersales.createTicket(req, { cardCode: 'C0005', tipo: 'DUV', prior: 'BAI', origem: 'TEL', ativo: 'EQP-0010', contato: 'Renata',
    assunto: 'Como nivelar a plataforma em piso irregular', descricao: 'Cliente com dúvida sobre os estabilizadores.' });
  await S.aftersales.interact(req, tc.DocEntry, { texto: 'Orientado por telefone: a GS-2632 só opera em piso nivelado; usar calços certificados no acesso.', publico: true, status: 'RES' });
  await envelhecer(tc.DocEntry, `${D(-30)}T10:15`, 0.4, 0.6);
  const pc = (await repos.surveys.all()).find((p) => Number(p.U_ChaEntry) === tc.DocEntry && Number(p.U_Nota) < 0);
  await responder(pc?.Code, 9, 'Resolveram na hora pelo telefone.', `${D(-30)}T11:00`);

  // Reclamação com SLA estourado, já fechada.
  const td = await S.aftersales.createTicket(req, { cardCode: 'C0006', tipo: 'REC', prior: 'MED', origem: 'EMA', contato: 'Secretaria de Obras',
    assunto: 'Atraso na entrega do rolo compactador', descricao: 'Entrega combinada para 8h chegou às 15h.' });
  await S.aftersales.interact(req, td.DocEntry, { texto: 'Pedimos desculpas. Ajustamos a logística para entregas antes das 7h.', publico: true, status: 'RES' });
  await S.aftersales.interact(req, td.DocEntry, { texto: 'Cliente confirmou o recebimento da resposta.', publico: false, status: 'FEC' });
  await envelhecer(td.DocEntry, `${D(-50)}T09:00`, 9, 60);

  // Em andamento: escavadeira vazando óleo, OS agendada para amanhã.
  const te = await S.aftersales.createTicket(req, { cardCode: 'C0002', tipo: 'MAN', prior: 'ALT', origem: 'POR', ativo: 'EQP-0006', contato: 'Marcos Reis',
    assunto: 'Vazamento de óleo no braço da escavadeira', descricao: 'Mancha de óleo embaixo do braço após o turno.' });
  await S.aftersales.interact(req, te.DocEntry, { texto: 'Recebido. Técnico agendado para amanhã cedo.', publico: true, status: 'AND' });
  await S.aftersales.orderFromTicket(req, te.DocEntry, { tecnico: 'T01', data: D(1), hora: '07:30' });
  await envelhecer(te.DocEntry, addHoras(`${h}T08:00`, -20), 1.5, null);

  // Aberto agora: treinamento de operador na usina.
  await S.aftersales.createTicket(req, { cardCode: 'C0007', tipo: 'DUV', prior: 'BAI', origem: 'EMA', ativo: 'EQP-0007', contato: 'Eng. Larissa',
    assunto: 'Treinamento de operadores da retroescavadeira', descricao: 'Solicitam treinamento para 3 operadores novos.' });

  // Pesquisas antigas respondidas, para o NPS ter volume.
  const antigas = [[9, 'Equipe pontual.', 'T02', -70], [10, '', 'T01', -63], [7, 'Demorou um pouco para agendar.', 'T03', -55], [9, 'Muito bom.', 'T01', -47],
    [6, 'Técnico precisou voltar no dia seguinte.', 'T03', -35], [10, 'Excelente.', 'T02', -21], [9, '', 'T01', -15]];
  for (const [i, [nota, com, tec, dias]] of antigas.entries()) {
    const code = `pesq-apr-${i + 1}`;
    await sl.request('POST', SET.PES, { Code: code, Name: code, U_OsEntry: 0, U_ChaEntry: 0, U_CardCode: ['C0001', 'C0002', 'C0003', 'C0004'][i % 4],
      U_CardName: ['Construtora Horizonte Ltda', 'Mineração Serra Azul S.A.', 'Transportes Rota Sul Ltda', 'Agro Vale Verde Ltda'][i % 4], U_Email: '', U_Tecnico: tec,
      U_Enviada: D(dias), U_Nota: nota, U_Comentario: com, U_Respondida: `${D(dias + 1)}T10:30` });
  }
  /* ---------- portal do cliente ---------- */
  // Acesso de demonstração com código conhecido (na vida real o código é aleatório e enviado ao contato do cliente).
  await S.portal.criarAcesso(req, { cardCode: 'C0002', nome: 'Marcos Reis', email: 'marcos@serraazul.example', fone: '(31) 99876-1122' }, 'SERRA2026');
  await S.portal.criarAcesso(req, { cardCode: 'C0004', nome: 'José Carlos Lima', email: 'jose@valeverde.example', fone: '(38) 99654-3321' });
  for (const a of await repos.assets.all()) if (a.U_Status !== 'BAI') await S.portal.tokenQR(req, a.Code);
  // Orçamento esperando o cliente aprovar pelo portal: para-brisa da picape trincado por pedra na mina.
  const tf = await S.aftersales.createTicket(req, { cardCode: 'C0002', tipo: 'MAN', prior: 'MED', origem: 'TEL', ativo: 'VEI-0005', contato: 'Marcos Reis',
    assunto: 'Para-brisa da picape trincado', descricao: 'Pedra lançada por caminhão na estrada da mina trincou o para-brisa.' });
  const of = await S.aftersales.orderFromTicket(req, tf.DocEntry, { tipo: 'COR', tecnico: 'T02', data: D(2), hora: '09:00' });
  const osf = await S.aftersales.getOrder(req, of.DocEntry);
  await S.aftersales.saveOrder(req, of.DocEntry, { U_Versao: osf.U_Versao, laudo: 'Vistoria por foto: troca do para-brisa necessária. Dano externo, não coberto pelo contrato.',
    itens: [{ tipo: 'PEC', itemCode: 'PEC-0210', descr: 'Para-brisa Hilux (original)', qtd: 1, preco: 1890, cobrar: 'S' },
      { tipo: 'SRV', itemCode: 'SLOC800', descr: 'Mão de obra de instalação', qtd: 1.5, preco: 180, cobrar: 'S' }] });
  await S.aftersales.quoteOrder(req, of.DocEntry, { acao: 'enviar' });
  await S.aftersales.interact(req, tf.DocEntry, { texto: 'Enviamos o orçamento da troca do para-brisa. Pode aprovar pelo portal.', publico: true, status: 'AGC' });
  await envelhecer(tf.DocEntry, addHoras(`${h}T08:00`, -28), 3, null);
  /* ---------- pedidos da Macromaq (versão 6) ---------- */
  await montarV6({ S, sl, repos, req, h, D, tenta, posicoes });

  const marca = { Code: 'APRESENTACAO', Name: 'APRESENTACAO', U_Valor: VERSAO_APRESENTACAO };
  if ((sl.db.sets.U_SPS_LCFG || []).some((r) => r.Code === 'APRESENTACAO')) await sl.request('PATCH', `${SET.CFG}('APRESENTACAO')`, { U_Valor: VERSAO_APRESENTACAO });
  else await sl.request('POST', SET.CFG, marca);
  return { ok: true };
}
