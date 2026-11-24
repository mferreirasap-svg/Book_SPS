// Base de apresentação — pedidos da Macromaq (versão 6): mão de obra com apontamento, leituras de campo com foto a conferir,
// documentação dos veículos, oficina (OS interna com baixa de peças e pedido de compra), mapa da equipe e títulos no portal.
// Tudo passa pelos serviços do Áster, como o resto da base de apresentação.
import { SET, LN } from './schema.js';
import { addDias, addHoras } from '../lib/util.js';
import { FOTO_HORIMETRO, FOTO_HODOMETRO } from './fotos-demo.js';

export async function montarV6({ S, sl, repos, req, h, D, tenta, posicoes }) {
  const campo = { ...req, user: { ...req.user, login: 'leiturista', name: 'Antônio Carlos', perms: ['leituras.lancar', 'mo.apontar'] } };

  /* ---------- coordenadas das obras (endereços de entrega no cadastro do parceiro) ---------- */
  const coord = { C0002: { 'MINA CORREGO FUNDO': ['-20.2530', '-43.8040'] }, C0006: { 'PATIO OBRAS': ['-19.4650', '-44.2470'] }, C0007: { 'USINA JANAUBA': ['-15.8030', '-43.3090'] } };
  for (const [card, ends] of Object.entries(coord)) {
    const bp = await sl.get(`BusinessPartners('${card}')`);
    await sl.request('PATCH', `BusinessPartners('${card}')`, { BPAddresses: (bp.BPAddresses || []).map((a) => (ends[a.AddressName]
      ? { ...a, U_SPS_Lat: ends[a.AddressName][0], U_SPS_Lon: ends[a.AddressName][1] } : a)) });
  }

  /* ---------- mão de obra: operador junto com a retroescavadeira do contrato 1 ---------- */
  const c1 = await repos.contracts.get(1);
  await tenta(() => S.contracts.update(req, 1, { ...c1, [LN]: [...c1[LN], { U_TipoLinha: 'MO', U_Maquina: 'EQP-0001', U_Operador: 'OP01', U_UnidCobr: 'H',
    U_Valor: 85, U_Jornada: 8, U_VlrExtra: 120, U_ItemCode: 'SLOC810' }] }, c1.U_Versao));
  const mo = (await repos.contracts.get(1))[LN].find((l) => l.U_TipoLinha === 'MO');
  if (mo) {
    const inicioMes = `${h.slice(0, 8)}01`;
    const dias = [];
    for (let d = inicioMes; d < h; d = addDias(d, 1)) if (![0, 6].includes(new Date(`${d}T12:00:00`).getDay())) dias.push(d);
    const horas = [8, 9.5, 8, 10, 8, 8.5, 9, 8, 11, 8, 8, 9, 8, 10, 8, 8.5, 8, 9, 8, 8, 9.5, 8];
    for (const [i, d] of dias.entries()) {
      const ultimo = i === dias.length - 1;
      await tenta(() => S.campo.apontar(ultimo ? campo : req, { ctr: 1, linha: mo.LineId, data: d, hrNorm: horas[i % horas.length],
        obs: ultimo ? 'Concretagem: ficou até mais tarde.' : '' }));
    }
  }

  /* ---------- leituras lançadas no campo, com foto, esperando a conferência ---------- */
  await tenta(() => S.operations.registerReading(campo, { ativo: 'EQP-0001', leitura: 4588.5, data: h, origem: 'CAM', foto: FOTO_HORIMETRO }));
  await tenta(() => S.operations.registerReading(campo, { ativo: 'VEI-0002', leitura: 33480, data: h, origem: 'CAM', foto: FOTO_HODOMETRO, obs: 'Hodômetro com o vidro arranhado.' }));

  /* ---------- documentação dos veículos ---------- */
  const ano = h.slice(0, 4);
  await tenta(() => S.campo.gerarCalendario(req, ano));
  const veics = Object.fromEntries((await repos.assets.all()).filter((a) => a.U_Tipo === 'VEI').map((a) => [a.Code, a]));
  let deixarVencida = 'VEI-0006';
  let comEsboco = 0;
  for (const d of await repos.vehicleDocs.list({})) {
    const at = veics[d.U_Ativo];
    const valor = d.U_Tipo === 'IPVA' ? Math.round((Number(at?.U_VlrBem) || 180000) * 0.04 * 100) / 100 : 164.39;
    if (d.U_Venc >= h) {
      await repos.vehicleDocs.patch(d.Code, { U_Valor: valor, U_Obs: '' });
      continue;
    }
    if (d.U_Ativo === deixarVencida && d.U_Tipo === 'LIC') {
      await repos.vehicleDocs.patch(d.Code, { U_Valor: valor, U_Obs: 'Guia emitida; aguardando pagamento.' });
      deixarVencida = '';
      continue;
    }
    await tenta(() => S.campo.pagarDocumento(req, d.Code, { data: addDias(d.U_Venc, -2), valor, gerarB1: comEsboco++ < 3 }));
  }
  await tenta(() => S.campo.criarDocumento(req, { ativo: 'VEI-0001', tipo: 'SEG', exercicio: ano, venc: D(12), valor: 3890, obs: 'Renovação do seguro frota (corretora).' }));
  await tenta(() => S.campo.criarDocumento(req, { ativo: 'VEI-0003', tipo: 'TAC', exercicio: ano, venc: D(40), valor: 280, obs: 'Aferição do tacógrafo (INMETRO).' }));

  /* ---------- oficina: OS internas concluídas (custos) e uma aberta ---------- */
  async function osInterna(ativo, { tecnico, dia, desc, itens, laudo, horas, concluir = true }) {
    const o = await S.aftersales.createOrder(req, { tipo: 'INT', ativo, tecnico, data: dia, hora: '08:00', descricao: desc });
    await S.aftersales.startOrder(req, o.DocEntry, {});
    let os = await S.aftersales.getOrder(req, o.DocEntry);
    if (itens) {
      await S.aftersales.saveOrder(req, o.DocEntry, { itens, laudo: concluir ? undefined : laudo, U_Versao: os.U_Versao });
      os = await S.aftersales.getOrder(req, o.DocEntry);
    }
    if (concluir) {
      await S.aftersales.concludeOrder(req, o.DocEntry, { checklist: Object.fromEntries(os.checklistItens.map((i) => [i, { r: 'OK' }])), laudo, respons: 'Oficina' });
    }
    const ini = `${dia}T08:00`;
    await sl.request('PATCH', `${SET.OS}(${o.DocEntry})`, { U_CheckIn: ini, ...(concluir ? { U_CheckOut: addHoras(ini, horas) } : {}) });
    return o;
  }
  await tenta(() => osInterna('EQP-0010', { tecnico: 'T03', dia: D(-20), horas: 6, desc: 'Plataforma voltou da feira com vazamento no cilindro de elevação.',
    laudo: 'Cilindro retificado (terceiro) e kit de vedação trocado. Teste de carga ok.',
    itens: [{ tipo: 'PEC', itemCode: 'PEC-0420', descr: 'Kit de vedação do cilindro', qtd: 1, preco: 480, baixar: 'S' },
      { tipo: 'TER', itemCode: '', descr: 'Retífica do cilindro de elevação', qtd: 1, preco: 1500, fornecedor: 'F0001' },
      { tipo: 'SRV', itemCode: 'SLOC800', descr: 'Mão de obra da oficina', qtd: 4, preco: 95 }] }));
  await tenta(() => osInterna('VEI-0004', { tecnico: 'T02', dia: D(-34), horas: 5, desc: 'Strada com falha na partida.',
    laudo: 'Motor de partida recondicionado (auto elétrica) e bateria substituída.',
    itens: [{ tipo: 'PEC', itemCode: 'PEC-0515', descr: 'Bateria 60 Ah', qtd: 1, preco: 520, baixar: 'S' },
      { tipo: 'TER', itemCode: '', descr: 'Recondicionamento do motor de partida', qtd: 1, preco: 650, fornecedor: 'F0002' }] }));
  await tenta(() => osInterna('EQP-0003', { tecnico: 'T01', dia: D(-58), horas: 4, desc: 'Revisão antes da próxima locação.', laudo: 'Revisão geral executada.',
    itens: [{ tipo: 'PEC', itemCode: 'PEC-0420', descr: 'Kit de vedação', qtd: 1, preco: 480, baixar: 'S' }, { tipo: 'SRV', itemCode: 'SLOC800', descr: 'Mão de obra da oficina', qtd: 3, preco: 95 }] }));
  await tenta(() => osInterna('EQP-0002', { tecnico: 'T03', dia: D(-3), concluir: false, desc: 'Escavadeira com ruído na bomba hidráulica. Aguardando peça.',
    laudo: 'Bomba desmontada; rolamento com folga. Peça encomendada.',
    itens: [{ tipo: 'TER', itemCode: '', descr: 'Recondicionamento da bomba hidráulica', qtd: 1, preco: 4200, fornecedor: 'F0001' }] }));
  // A plataforma EQP-0005 já estava "em manutenção" na base: abre a OS interna dela.
  if (!(await repos.orders.all({ ativo: 'EQP-0005', abertas: true })).length) {
    await tenta(() => osInterna('EQP-0005', { tecnico: 'T03', dia: D(-6), concluir: false, desc: 'Bateria não segura carga; plataforma não eleva.' }));
  }

  /* ---------- mapa: OS de hoje com check-in pelo celular ---------- */
  // Rafael e Juliana já aceitaram o termo de localização no celular; Marcos ainda não.
  for (const t of ['T01', 'T02']) await repos.technicians.patch(t, { U_GeoAceite: addHoras(`${D(-30)}T08:00`, 0) });
  const hoje = async (ativo, tecnico, hora, desc, pos) => {
    const o = await tenta(() => S.aftersales.createOrder(req, { tipo: 'VIS', ativo, tecnico, data: h, hora, descricao: desc }));
    if (o && pos) await tenta(() => S.aftersales.startOrder(req, o.DocEntry, { lat: pos[0], lon: pos[1] }));
    return o;
  };
  await hoje('EQP-0001', 'T01', '08:00', 'Vistoria mensal da retroescavadeira na obra.', [-19.93195, -44.05418]);
  await hoje('VEI-0001', 'T01', '14:00', 'Vistoria da picape na base da Rota Sul.');
  await hoje('EQP-0008', 'T03', '09:30', 'Vistoria do rolo parado no pátio da prefeitura.');
  await hoje('EQP-0006', 'T02', '10:00', 'Vistoria da escavadeira na mina.', [-20.2297, -43.7811]);
  await hoje('VEI-0005', 'T02', '15:30', 'Conferir o para-brisa trincado antes da troca.');
  if (posicoes) {
    const agora = `${h}T${new Date().toTimeString().slice(0, 5)}`;
    posicoes.registrar({ login: 'juliana', tecnico: 'T02', lat: -20.2297, lon: -43.7811, origem: 'INICIO', at: addHoras(agora, -0.5) });
  }

  /* ---------- portal: títulos pagos, em aberto e vencido da Serra Azul ---------- */
  const notas = (sl.db.sets.Invoices || []).filter((n) => n.CardCode === 'C0002').sort((a, b) => a.DocEntry - b.DocEntry);
  for (const [i, n] of notas.entries()) {
    const total = Math.round((n.DocumentLines || []).reduce((s, l) => s + (Number(l.Quantity) || 0) * (Number(l.UnitPrice) || 0), 0) * 100) / 100;
    // Emissão no dia de faturamento da competência; vencimento em 20 dias. As duas últimas ficam em aberto (a anterior, vencida).
    const comp = String(n.U_SPS_Comp || '');
    if (/^\d{6}$/.test(comp)) n.DocDate = `${comp.slice(0, 4)}-${comp.slice(4, 6)}-10`;
    n.DocTotal = total;
    n.DocDueDate = addDias(n.DocDate, 20);
    n.PaidToDate = i >= notas.length - 2 ? 0 : total;
  }
  sl.persist?.();
}
