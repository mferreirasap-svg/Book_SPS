// Pós-venda: chamados com SLA, ordens de serviço de campo, manutenção preventiva, pesquisa de satisfação
// e histórico do equipamento. Equipamento parado no cliente vira "dias fora", que o faturamento já desconta.
import { SET, LN, CH1, OS1, DOM, CFG_DEFAULTS } from '../b1/schema.js';
import { key } from '../b1/odata.js';
import { badRequest, conflict, forbidden, notFound, d10, hoje, agora, addHoras, difHoras, addDias, difDias, maxD, compDe, uid, round2 } from '../lib/util.js';

const ABERTOS = ['ABE', 'AND', 'AGC'];
const OS_ABERTAS = ['ABE', 'AGE', 'EXE', 'AOR'];
const CHA_FLUXO = { ABE: ['AND', 'AGC', 'RES', 'CAN'], AND: ['AGC', 'RES', 'CAN'], AGC: ['AND', 'RES', 'CAN'], RES: ['FEC', 'AND'] };
const PRIOR_ORDEM = ['BAI', 'MED', 'ALT', 'URG'];
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const sn = (v) => (v === true || v === 'S' || v === 'true' ? 'S' : 'N');
const dtOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

/** Token aleatório da pesquisa (link público). */
function token() {
  const b = new Uint8Array(15);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Situação de um prazo de SLA: cumprido, violado, vencendo (menos de 25% do tempo) ou no prazo. */
export function prazoSituacao(inicio, prazo, feito, agoraDt) {
  if (!prazo) return '';
  if (feito) return feito <= prazo ? 'cumprido' : 'violado';
  if (agoraDt > prazo) return 'violado';
  const total = difHoras(inicio, prazo);
  return total > 0 && difHoras(agoraDt, prazo) <= total * 0.25 ? 'vencendo' : 'no_prazo';
}

export function createAfterSalesService({ repos, audit }) {
  const sl = repos.sl;

  async function cfg() {
    return { ...CFG_DEFAULTS, ...(await repos.settings.all()) };
  }
  function slaHoras(c, prior) {
    const [r, s] = String(c[`SLA_${prior}`] || CFG_DEFAULTS[`SLA_${prior}`] || '4/48').split('/').map(Number);
    return { resp: r > 0 ? r : 4, sol: s > 0 ? s : 48 };
  }
  async function tecnicoDo(login) {
    return (await repos.technicians.all()).find((t) => t.U_Login && t.U_Login === login) || null;
  }
  const veTodas = (req) => req.user.perms.includes('os.todas');
  async function exigirMinha(req, os) {
    if (veTodas(req)) return;
    const t = await tecnicoDo(req.user.login);
    if (!t || t.Code !== os.U_Tecnico) throw forbidden('Esta OS é de outro técnico.');
  }

  /* ================= chamados ================= */

  function comSla(t, now = agora()) {
    return {
      ...t,
      slaResp: prazoSituacao(t.U_Abertura, t.U_PrazoResp, t.U_DtResp, now),
      slaSol: ['CAN'].includes(t.U_Status) ? '' : prazoSituacao(t.U_Abertura, t.U_PrazoSol, t.U_DtSol, now),
    };
  }

  async function listTickets(req, f, pg) {
    const r = await repos.tickets.list({ ...f, branches: req.user.branches }, pg);
    const now = agora();
    let items = r.items.map((t) => comSla(t, now));
    if (f.sla === 'violado') items = items.filter((t) => t.slaResp === 'violado' || t.slaSol === 'violado');
    return { ...r, items: items.map(({ [CH1]: _i, U_Descricao: _d, ...t }) => t) };
  }

  async function getTicket(id) {
    const t = await repos.tickets.get(id);
    if (!t) throw notFound('Chamado');
    const os = t.U_OsEntry ? await repos.orders.get(t.U_OsEntry) : null;
    return { ...comSla(t), os: os ? { DocEntry: os.DocEntry, DocNum: os.DocNum, U_Status: os.U_Status, U_Tecnico: os.U_Tecnico, U_DtAgenda: os.U_DtAgenda } : null };
  }

  /** Contrato e ativo do chamado/OS: o ativo locado puxa o contrato atual; o contrato precisa ser do mesmo cliente. */
  async function vinculo({ cardCode, ctr, ativo }) {
    let at = null;
    let c = null;
    if (ativo) {
      at = await repos.assets.get(ativo);
      if (!at) throw badRequest(`Ativo ${ativo} não encontrado.`);
    }
    if (ctr) {
      c = await repos.contracts.get(ctr);
      if (!c) throw badRequest('Contrato não encontrado.');
    } else if (at?.U_CtrAtual) {
      c = await repos.contracts.get(at.U_CtrAtual);
    }
    if (c && cardCode && c.U_CardCode !== cardCode) {
      if (ctr) throw badRequest('O contrato informado é de outro cliente.');
      c = null;
    }
    // Item em uso tem preferência; o devolvido vale para a OS de reparo aberta na devolução.
    const linha = c && at ? c[LN].find((l) => l.U_Ativo === at.Code && l.U_StatusL !== 'DEV') || (ctr ? [...c[LN]].reverse().find((l) => l.U_Ativo === at.Code) : null) : null;
    if (c && at && ctr && !linha) throw badRequest(`O ativo ${at.Code} não está neste contrato.`);
    return { at, c, linha };
  }

  async function createTicket(req, input) {
    const cardCode = str(input.cardCode, 15);
    const bp = cardCode ? await repos.partners.get(cardCode) : null;
    if (!bp) throw badRequest('Escolha o cliente.');
    const assunto = str(input.assunto, 150);
    if (!assunto) throw badRequest('Informe o assunto do chamado.');
    const tipo = DOM.tipoCha[input.tipo] ? input.tipo : 'MAN';
    let prior = DOM.prioridade[input.prior] ? input.prior : 'MED';
    const parado = tipo === 'PAR' || sn(input.parado) === 'S' ? 'S' : 'N';
    if (parado === 'S' && PRIOR_ORDEM.indexOf(prior) < PRIOR_ORDEM.indexOf('ALT')) prior = 'ALT';
    const { at, c } = await vinculo({ cardCode, ctr: input.ctr, ativo: str(input.ativo, 50) });
    const c0 = await cfg();
    const sla = slaHoras(c0, prior);
    const ab = agora();
    const rec = {
      U_CardCode: bp.CardCode, U_CardName: bp.CardName, U_Contato: str(input.contato, 100), U_Fone: str(input.fone, 30),
      U_Email: str(input.email || bp.EmailAddress, 100), U_CtrEntry: c ? c.DocEntry : 0, U_Ativo: at ? at.Code : '', U_Tipo: tipo,
      U_Origem: DOM.origemCha[input.origem] ? input.origem : 'TEL', U_Prior: prior, U_Status: 'ABE', U_Assunto: assunto,
      U_Descricao: str(input.descricao, 4000), U_Parado: parado, U_Abertura: ab, U_PrazoResp: addHoras(ab, sla.resp), U_PrazoSol: addHoras(ab, sla.sol),
      U_DtResp: '', U_DtSol: '', U_Respons: str(input.respons, 50) || req.user?.login || '', U_OsEntry: 0, U_Filial: Number(c?.U_Filial || at?.U_Filial) || 1,
      [CH1]: [],
    };
    const r = await repos.tickets.create(rec);
    audit.record(req, { action: 'criar', entity: 'chamado', id: r.DocEntry, after: { ...rec, [CH1]: undefined } });
    return getTicket(r.DocEntry);
  }

  async function updateTicket(req, id, input) {
    const t = await repos.tickets.get(id);
    if (!t) throw notFound('Chamado');
    if (['FEC', 'CAN'].includes(t.U_Status)) throw badRequest('Chamado encerrado não pode ser alterado.');
    const patch = {};
    for (const [k, n] of [['contato', 100], ['fone', 30], ['email', 100], ['assunto', 150], ['respons', 50]]) {
      if (input[k] != null) patch[`U_${k[0].toUpperCase()}${k.slice(1)}`] = str(input[k], n);
    }
    if (input.descricao != null) patch.U_Descricao = str(input.descricao, 4000);
    if (input.tipo && DOM.tipoCha[input.tipo]) patch.U_Tipo = input.tipo;
    if (input.prior && DOM.prioridade[input.prior] && input.prior !== t.U_Prior) {
      const sla = slaHoras(await cfg(), input.prior);
      Object.assign(patch, { U_Prior: input.prior, U_PrazoResp: addHoras(t.U_Abertura, sla.resp), U_PrazoSol: addHoras(t.U_Abertura, sla.sol) });
    }
    if (patch.U_Assunto === '') throw badRequest('Informe o assunto do chamado.');
    const { before, after } = await repos.tickets.update(id, patch, input.U_Versao);
    audit.record(req, { action: 'alterar', entity: 'chamado', id, before: { ...before, [CH1]: undefined }, after: patch });
    return getTicket(after.DocEntry);
  }

  /** Registra nota interna ou resposta ao cliente, e muda o status se pedido. */
  async function interact(req, id, input) {
    const t = await repos.tickets.get(id);
    if (!t) throw notFound('Chamado');
    const texto = str(input.texto, 4000);
    const status = input.status && input.status !== t.U_Status ? input.status : '';
    if (!texto && !status) throw badRequest('Escreva a mensagem ou escolha o novo status.');
    if (status && !(CHA_FLUXO[t.U_Status] || []).includes(status)) throw badRequest(`Mudança de "${DOM.statusCha[t.U_Status]}" para "${DOM.statusCha[status] || status}" não permitida.`);
    if (status === 'RES' && t.U_OsEntry) {
      const os = await repos.orders.get(t.U_OsEntry);
      if (os && OS_ABERTAS.includes(os.U_Status)) throw badRequest(`A OS ${os.DocNum} ainda está aberta. Conclua ou cancele a OS antes de resolver o chamado.`);
    }
    const now = agora();
    const publico = sn(input.publico);
    const patch = {};
    if (texto) patch[CH1] = [{ U_Data: now, U_Usuario: req.user.login, U_Texto: texto, U_Publico: publico }];
    if (!t.U_DtResp && (publico === 'S' || ['AND', 'AGC', 'RES'].includes(status))) patch.U_DtResp = now;
    if (status) {
      patch.U_Status = status;
      if (status === 'RES') patch.U_DtSol = now;
      if (status === 'AND' && t.U_Status === 'RES') patch.U_DtSol = '';
    }
    await repos.tickets.update(id, patch, input.U_Versao);
    audit.record(req, { action: status ? `status:${status}` : 'interacao', entity: 'chamado', id, before: { U_Status: t.U_Status }, after: { U_Status: status || t.U_Status, texto } });
    if (status === 'RES' && !t.U_OsEntry) await surveyFor({ cha: { ...t, U_Status: 'RES' } });
    return getTicket(id);
  }

  /* ================= ordens de serviço ================= */

  async function checklistItens(os, c0) {
    if (os.U_Tipo === 'PRE' && os.U_Plano) {
      const p = await repos.plans.get(os.U_Plano);
      if (p) return String(p.U_Checklist || '').split('\n').map((s) => s.trim()).filter(Boolean);
    }
    const k = `CHK_OS_${os.U_Tipo === 'PRE' ? 'COR' : os.U_Tipo}`;
    return String((c0 || (await cfg()))[k] || '').split('\n').map((s) => s.trim()).filter(Boolean);
  }

  const totalCobravel = (itens) => round2((itens || []).filter((i) => i.U_Cobrar === 'S').reduce((s, i) => s + (Number(i.U_Qtd) || 0) * (Number(i.U_Preco) || 0), 0));

  async function listOrders(req, f, pg) {
    const filtro = { ...f, branches: req.user.branches };
    if (!veTodas(req)) {
      const t = await tecnicoDo(req.user.login);
      if (!t) return { items: [], page: 1, size: 50, hasMore: false, semTecnico: true };
      filtro.tecnico = t.Code;
    }
    const r = await repos.orders.list(filtro, pg);
    return { ...r, items: r.items.map(({ [OS1]: _i, U_Assinatura: _a, U_Fotos: _f, U_Checklist: _c, ...o }) => o) };
  }

  async function getOrder(req, id) {
    const os = await repos.orders.get(id);
    if (!os) throw notFound('Ordem de serviço');
    await exigirMinha(req, os);
    const [itens, tec, at, pesq] = await Promise.all([
      checklistItens(os), os.U_Tecnico ? repos.technicians.get(os.U_Tecnico) : null, os.U_Ativo ? repos.assets.get(os.U_Ativo) : null, repos.surveys.byOs(os.DocEntry),
    ]);
    return { ...os, checklistItens: itens, tecnicoNome: tec?.Name || '', ativo: at ? { Code: at.Code, Name: at.Name, U_Tipo: at.U_Tipo, U_Medidor: at.U_Medidor,
      U_Placa: at.U_Placa, U_Serie: at.U_Serie, U_Status: at.U_Status } : null, pesquisa: pesq[0] || null };
  }

  async function createOrder(req, input) {
    const tipo = DOM.tipoOS[input.tipo] ? input.tipo : 'COR';
    const ativo = str(input.ativo, 50);
    if (!ativo) throw badRequest('Escolha o equipamento.');
    let cardCode = str(input.cardCode, 15);
    const { at, c, linha } = await vinculo({ cardCode, ctr: input.ctr, ativo });
    if (!cardCode && c) cardCode = c.U_CardCode;
    const bp = cardCode ? await repos.partners.get(cardCode) : null;
    if (cardCode && !bp) throw badRequest('Cliente não encontrado.');
    let plano = '';
    if (tipo === 'PRE') {
      const p = input.plano ? await repos.plans.get(input.plano) : null;
      if (input.plano && (!p || p.U_Familia !== at.U_Familia)) throw badRequest('Plano preventivo não é da família do equipamento.');
      plano = p?.Code || '';
    }
    const tecnico = str(input.tecnico, 50);
    if (tecnico && !(await repos.technicians.get(tecnico))) throw badRequest('Técnico não encontrado.');
    const data = d10(input.data);
    if (input.data && !dtOk(data)) throw badRequest('Data de agendamento inválida.');
    const hora = /^\d{2}:\d{2}$/.test(input.hora || '') ? input.hora : '08:00';
    const noCliente = Boolean(c && linha?.U_StatusL === 'LOC');
    const parada = sn(input.parada) === 'S' && noCliente ? 'S' : 'N';
    const dtParada = parada === 'S' ? (dtOk(d10(input.dtParada)) ? d10(input.dtParada) : hoje()) : null;
    if (parada === 'S' && dtParada < d10(linha.U_DtSaida)) throw badRequest('A parada não pode começar antes da entrega do equipamento.');
    if (parada === 'S' && (await repos.offPeriods.openFor(c.DocEntry, linha.LineId))) throw badRequest('Este equipamento já tem uma parada em aberto.');
    const foraCode = parada === 'S' ? `F-${uid()}` : '';
    const rec = {
      U_Tipo: tipo, U_Status: tecnico && data ? 'AGE' : 'ABE', U_Prior: DOM.prioridade[input.prior] ? input.prior : 'MED',
      U_CardCode: bp?.CardCode || '', U_CardName: bp?.CardName || 'Uso interno (pátio)', U_Email: str(input.email || bp?.EmailAddress, 100),
      U_CtrEntry: c ? c.DocEntry : 0, U_CtrLine: linha ? linha.LineId : 0, U_Ativo: at.Code, U_ChaEntry: Number(input.cha) || 0, U_MovEntry: Number(input.mov) || 0,
      U_Plano: plano, U_Tecnico: tecnico, U_DtAgenda: data || null, U_HrAgenda: hora, U_Duracao: Math.max(0, Number(input.duracao) || 120),
      U_Local: str(input.local, 150) || (noCliente ? str(c.U_Obra, 150) : 'Pátio da locadora'), U_Descricao: str(input.descricao, 4000), U_Laudo: '',
      U_CheckIn: '', U_CheckOut: '', U_Medidor: 0, U_Checklist: '{}', U_Fotos: '[]', U_Respons: '', U_DocResp: '', U_Assinatura: '',
      U_Parada: parada, U_DtParada: dtParada, U_ForaCode: foraCode, U_Orc: '', U_OrcAprov: '', U_Valor: 0, U_DocType: '', U_DocEntry: 0, U_DocNum: 0,
      U_Filial: Number(c?.U_Filial || at.U_Filial) || 1, U_Usuario: req.user?.login || 'sistema', [OS1]: [],
    };
    const ops = [{ method: 'POST', path: SET.OS, body: { ...rec, U_Versao: 0 } }];
    if (parada === 'S') {
      ops.push({ method: 'POST', path: SET.FORA, body: { Code: foraCode, Name: foraCode, U_CtrEntry: c.DocEntry, U_CtrLine: linha.LineId, U_Ativo: at.Code,
        U_Ini: dtParada, U_Fim: null, U_Motivo: `Equipamento parado (OS) — ${str(input.descricao, 60)}`.slice(0, 100) } });
    }
    const [r] = await sl.batch(ops);
    const os = r.body;
    if (rec.U_ChaEntry) {
      const t = await repos.tickets.get(rec.U_ChaEntry);
      if (t) {
        await repos.tickets.update(t.DocEntry, { U_OsEntry: os.DocEntry, ...(t.U_Status === 'ABE' ? { U_Status: 'AND' } : {}),
          [CH1]: [{ U_Data: agora(), U_Usuario: req.user?.login || 'sistema', U_Texto: `OS ${os.DocNum} aberta (${DOM.tipoOS[tipo].toLowerCase()})${tecnico && data ? `, agendada para ${data.split('-').reverse().join('/')} ${hora}` : ''}.`, U_Publico: 'N' }] });
      }
    }
    audit.record(req, { action: 'criar', entity: 'os', id: os.DocEntry, after: { ...rec, [OS1]: undefined } });
    return { DocEntry: os.DocEntry, DocNum: os.DocNum };
  }

  async function orderFromTicket(req, id, input) {
    const t = await repos.tickets.get(id);
    if (!t) throw notFound('Chamado');
    if (!ABERTOS.includes(t.U_Status)) throw badRequest('Só chamados abertos geram OS.');
    if (t.U_OsEntry) {
      const os = await repos.orders.get(t.U_OsEntry);
      if (os && OS_ABERTAS.includes(os.U_Status)) throw conflict(`Este chamado já tem a OS ${os.DocNum} em aberto.`);
    }
    if (!t.U_Ativo && !input.ativo) throw badRequest('Informe o equipamento do chamado antes de abrir a OS.');
    return createOrder(req, {
      tipo: input.tipo || (['PAR', 'MAN'].includes(t.U_Tipo) ? 'COR' : t.U_Tipo === 'TRO' ? 'INS' : 'VIS'), ativo: t.U_Ativo || input.ativo, cardCode: t.U_CardCode,
      ctr: t.U_CtrEntry || undefined, cha: t.DocEntry, prior: t.U_Prior, email: t.U_Email, descricao: input.descricao || `${t.U_Assunto}\n${t.U_Descricao || ''}`.trim(),
      tecnico: input.tecnico, data: input.data, hora: input.hora, duracao: input.duracao,
      parada: input.parada ?? t.U_Parado === 'S', dtParada: input.dtParada || d10(t.U_Abertura),
    });
  }

  /** OS de reparo aberta na devolução/substituição com avaria (base para cobrar o cliente). */
  async function orderFromReturn(req, movEntry) {
    const m = await repos.movements.get(movEntry);
    if (!m) throw notFound('Movimentação');
    const c = await repos.contracts.get(m.U_CtrEntry);
    let chk = {};
    try {
      chk = JSON.parse(m.U_Checklist || '{}');
    } catch {
      chk = {};
    }
    const nok = Object.entries(chk).filter(([, v]) => v.r === 'NOK').map(([k, v]) => `• ${k}${v.o ? `: ${v.o}` : ''}`);
    const descricao = [`Avarias constatadas na ${m.U_Tipo === 'SUB' ? 'substituição' : 'devolução'} nº ${m.DocNum} (${String(m.U_Data).slice(0, 10).split('-').reverse().join('/')}).`,
      ...nok, m.U_Avarias || ''].filter(Boolean).join('\n');
    return createOrder(req, { tipo: 'REP', ativo: m.U_Ativo, cardCode: c?.U_CardCode, ctr: c ? c.DocEntry : undefined, mov: m.DocEntry, descricao,
      local: 'Pátio da locadora', prior: 'ALT', email: c?.U_Email });
  }

  async function scheduleOrder(req, id, input) {
    const os = await repos.orders.get(id);
    if (!os) throw notFound('Ordem de serviço');
    if (!['ABE', 'AGE'].includes(os.U_Status)) throw badRequest('Só OS sem agenda ou agendadas podem ser reagendadas.');
    const tecnico = str(input.tecnico, 50);
    const data = d10(input.data);
    if (!tecnico || !(await repos.technicians.get(tecnico))) throw badRequest('Escolha o técnico.');
    if (!dtOk(data)) throw badRequest('Informe a data.');
    const patch = { U_Tecnico: tecnico, U_DtAgenda: data, U_HrAgenda: /^\d{2}:\d{2}$/.test(input.hora || '') ? input.hora : os.U_HrAgenda || '08:00',
      U_Duracao: Math.max(0, Number(input.duracao) || Number(os.U_Duracao) || 120), U_Status: 'AGE' };
    await repos.orders.update(id, patch, input.U_Versao);
    audit.record(req, { action: 'agendar', entity: 'os', id, before: { U_Tecnico: os.U_Tecnico, U_DtAgenda: os.U_DtAgenda }, after: patch });
    return getOrder(req, id);
  }

  async function startOrder(req, id, input) {
    const os = await repos.orders.get(id);
    if (!os) throw notFound('Ordem de serviço');
    await exigirMinha(req, os);
    if (!['ABE', 'AGE'].includes(os.U_Status)) throw badRequest('Esta OS já foi iniciada ou encerrada.');
    await repos.orders.update(id, { U_Status: 'EXE', U_CheckIn: agora(), U_Usuario: req.user.login }, input?.U_Versao);
    audit.record(req, { action: 'iniciar', entity: 'os', id });
    return getOrder(req, id);
  }

  /** Lê e valida os dados de execução (laudo, checklist, peças, fotos, assinatura). */
  function dadosExecucao(input) {
    const patch = {};
    if (input.laudo != null) patch.U_Laudo = str(input.laudo, 8000);
    if (input.descricao != null) patch.U_Descricao = str(input.descricao, 4000);
    if (input.respons != null) patch.U_Respons = str(input.respons, 100);
    if (input.docResp != null) patch.U_DocResp = str(input.docResp, 30);
    if (input.checklist != null) {
      if (typeof input.checklist !== 'object') throw badRequest('Checklist inválido.');
      patch.U_Checklist = JSON.stringify(input.checklist).slice(0, 20000);
    }
    if (input.medidor != null && input.medidor !== '') {
      const m = Number(input.medidor);
      if (!Number.isFinite(m) || m < 0) throw badRequest('Leitura inválida.');
      patch.U_Medidor = m;
    }
    if (input.assinatura != null) {
      if (input.assinatura && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.assinatura)) throw badRequest('Assinatura em formato inválido.');
      if (input.assinatura.length > 300000) throw badRequest('Assinatura muito grande.');
      patch.U_Assinatura = input.assinatura;
    }
    if (input.fotos != null) {
      if (!Array.isArray(input.fotos) || input.fotos.length > 4) throw badRequest('Envie no máximo 4 fotos.');
      for (const f of input.fotos) {
        if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(f?.src || '')) throw badRequest('Foto em formato inválido.');
        if (f.src.length > 400000) throw badRequest('Foto muito grande. Reduza a resolução.');
      }
      patch.U_Fotos = JSON.stringify(input.fotos.map((f) => ({ src: f.src, legenda: str(f.legenda, 100) })));
    }
    if (input.itens != null) {
      if (!Array.isArray(input.itens) || input.itens.length > 60) throw badRequest('Itens inválidos.');
      patch[OS1] = input.itens.map((i) => {
        const qtd = Number(i.qtd);
        const preco = Number(i.preco) || 0;
        if (!str(i.descr, 100)) throw badRequest('Descreva cada peça ou serviço.');
        if (!(qtd > 0) || preco < 0) throw badRequest(`Quantidade ou preço inválido em "${str(i.descr, 40)}".`);
        return { U_Tipo: DOM.tipoItemOS[i.tipo] ? i.tipo : 'PEC', U_ItemCode: str(i.itemCode, 50), U_Descr: str(i.descr, 100), U_Qtd: qtd, U_Preco: preco, U_Cobrar: sn(i.cobrar) };
      });
      patch.U_Valor = totalCobravel(patch[OS1]);
    }
    return patch;
  }

  async function saveOrder(req, id, input) {
    const os = await repos.orders.get(id);
    if (!os) throw notFound('Ordem de serviço');
    await exigirMinha(req, os);
    if (!OS_ABERTAS.includes(os.U_Status)) throw badRequest('OS encerrada não pode ser alterada.');
    const patch = dadosExecucao(input);
    if (os.U_Status === 'AOR' && patch[OS1] && patch.U_Valor !== Number(os.U_Valor)) {
      Object.assign(patch, { U_Orc: '', U_OrcAprov: '', U_Status: 'EXE' }); // orçamento mudou: precisa de nova aprovação
    }
    if (os.U_Orc === 'APR' && patch[OS1] && patch.U_Valor > Number(os.U_Valor)) Object.assign(patch, { U_Orc: '', U_OrcAprov: '' });
    await repos.orders.update(id, patch, input.U_Versao, { replaceLines: Boolean(patch[OS1]) });
    audit.record(req, { action: 'salvar', entity: 'os', id, after: { campos: Object.keys(patch).filter((k) => !['U_Assinatura', 'U_Fotos'].includes(k)) } });
    return getOrder(req, id);
  }

  async function quoteOrder(req, id, input) {
    const os = await repos.orders.get(id);
    if (!os) throw notFound('Ordem de serviço');
    await exigirMinha(req, os);
    const acao = input.acao;
    if (acao === 'enviar') {
      if (!['ABE', 'AGE', 'EXE'].includes(os.U_Status)) throw badRequest('Orçamento só pode ser enviado com a OS em aberto.');
      if (!(Number(os.U_Valor) > 0)) throw badRequest('Inclua peças ou serviços cobráveis antes de enviar o orçamento.');
      await repos.orders.update(id, { U_Orc: 'PEN', U_OrcAprov: '', U_Status: 'AOR' }, input.U_Versao);
    } else if (acao === 'aprovar' || acao === 'recusar') {
      if (os.U_Status !== 'AOR') throw badRequest('Não há orçamento aguardando aprovação.');
      const nome = str(input.nome, 100);
      if (!nome) throw badRequest('Informe quem aprovou ou recusou no cliente.');
      await repos.orders.update(id, { U_Orc: acao === 'aprovar' ? 'APR' : 'REC', U_OrcAprov: nome, U_Status: os.U_CheckIn ? 'EXE' : os.U_Tecnico ? 'AGE' : 'ABE' }, input.U_Versao);
    } else throw badRequest('Ação de orçamento inválida.');
    audit.record(req, { action: `orcamento:${acao}`, entity: 'os', id, after: { valor: os.U_Valor, nome: input.nome } });
    return getOrder(req, id);
  }

  /** Fecha a parada do equipamento (dias fora). Conserto no mesmo dia da parada não gera desconto. */
  async function fecharParada(os, data, ops) {
    if (os.U_Parada !== 'S' || !os.U_ForaCode) return;
    const fora = await repos.offPeriods.list({ ctr: os.U_CtrEntry }).then((l) => l.find((f) => f.Code === os.U_ForaCode));
    if (!fora || fora.U_Fim) return;
    const ini = d10(fora.U_Ini);
    if (data <= ini) ops.push({ method: 'DELETE', path: `${SET.FORA}${key(fora.Code)}` });
    else ops.push({ method: 'PATCH', path: `${SET.FORA}${key(fora.Code)}`, body: { U_Fim: maxD(ini, addDias(data, -1)) } });
  }

  async function concludeOrder(req, id, input) {
    const os0 = await repos.orders.get(id);
    if (!os0) throw notFound('Ordem de serviço');
    await exigirMinha(req, os0);
    if (os0.U_Status === 'AOR') throw badRequest('O orçamento ainda não foi aprovado pelo cliente.');
    if (!['ABE', 'AGE', 'EXE'].includes(os0.U_Status)) throw badRequest('Esta OS já está encerrada.');
    const exec = dadosExecucao(input);
    const os = { ...os0, ...exec, [OS1]: exec[OS1] || os0[OS1] };
    const c0 = await cfg();
    const itensChk = await checklistItens(os, c0);
    let chk = {};
    try {
      chk = JSON.parse(os.U_Checklist || '{}');
    } catch {
      chk = {};
    }
    const falta = itensChk.filter((i) => !['OK', 'NOK', 'NA'].includes(chk[i]?.r));
    if (falta.length) throw badRequest(`Checklist incompleto: ${falta.join(', ')}.`);
    if (!str(os.U_Laudo, 10)) throw badRequest('Descreva o laudo / serviço executado.');
    if (!str(os.U_Respons, 100)) throw badRequest('Informe o responsável do cliente que acompanhou o serviço.');
    const valor = totalCobravel(os[OS1]);
    if (valor > 0 && os.U_Orc !== 'APR') throw badRequest(`Há ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} a cobrar: envie o orçamento e registre a aprovação do cliente antes de concluir.`);
    if (valor > 0 && !os.U_CardCode) throw badRequest('OS sem cliente não pode ter itens cobráveis.');

    const at = await repos.assets.get(os.U_Ativo);
    const now = agora();
    const data = now.slice(0, 10);
    const medAtual = Number(at?.U_Medidor) || 0;
    const leitura = Number(os.U_Medidor) || 0;
    if (leitura && leitura < medAtual) throw badRequest(`Leitura menor que a última registrada (${medAtual}).`);

    const ops = [{ method: 'PATCH', path: `${SET.OS}(${Number(id)})`, headers: exec[OS1] ? { 'B1S-ReplaceCollectionsOnPatch': 'true' } : undefined,
      body: { ...exec, U_Valor: valor, U_Status: 'CON', U_CheckIn: os0.U_CheckIn || now, U_CheckOut: now, U_Medidor: leitura || medAtual, U_Versao: (Number(os0.U_Versao) || 0) + 1 } }];
    if (at) {
      const atPatch = { U_Versao: (Number(at.U_Versao) || 0) + 1 };
      if (leitura > medAtual) atPatch.U_Medidor = leitura;
      if (at.U_Status === 'MAN' && !at.U_CtrAtual && input.liberarAtivo !== false) atPatch.U_Status = 'DIS';
      ops.push({ method: 'PATCH', path: `${SET.ATV}${key(at.Code)}`, body: atPatch });
      if (leitura > medAtual && at.U_CtrAtual && Number(at.U_CtrAtual) === Number(os.U_CtrEntry)) {
        const code = `${os.U_CtrEntry}-${os.U_CtrLine}-${uid()}`;
        ops.push({ method: 'POST', path: SET.MED, body: { Code: code, Name: code, U_CtrEntry: os.U_CtrEntry, U_CtrLine: os.U_CtrLine, U_Ativo: at.Code,
          U_Comp: compDe(data), U_Data: data, U_LeitIni: medAtual, U_LeitFim: leitura, U_Abat: 0, U_Origem: 'OS' } });
      }
    }
    await fecharParada(os, data, ops);
    const t = os.U_ChaEntry ? await repos.tickets.get(os.U_ChaEntry) : null;
    if (t && ABERTOS.includes(t.U_Status)) {
      ops.push({ method: 'PATCH', path: `${SET.CHA}(${Number(t.DocEntry)})`, body: { U_Status: 'RES', U_DtSol: now, ...(t.U_DtResp ? {} : { U_DtResp: now }),
        U_Versao: (Number(t.U_Versao) || 0) + 1,
        [CH1]: [{ U_Data: now, U_Usuario: req.user.login, U_Texto: `OS ${os.DocNum} concluída. ${str(os.U_Laudo, 600)}`, U_Publico: 'S' }] } });
    }
    await sl.batch(ops);
    audit.record(req, { action: 'concluir', entity: 'os', id, after: { valor, laudo: str(os.U_Laudo, 200) } });

    const out = { DocNum: os.DocNum, valor, documento: null, avisoDocumento: '', pesquisa: null };
    if (valor > 0) {
      try {
        const doc = { CardCode: os.U_CardCode, DocDate: data, DocObjectCode: 'oInvoices', U_SPS_OsEntry: os.DocEntry, U_SPS_CtrEntry: os.U_CtrEntry || 0,
          Comments: `Assistência técnica - OS ${os.DocNum} - ${os.U_Ativo}${os.U_CtrEntry ? ` - contrato ${os.U_CtrEntry}` : ''}`.slice(0, 254),
          DocumentLines: os[OS1].filter((i) => i.U_Cobrar === 'S').map((i) => ({ ItemCode: i.U_ItemCode || c0.ITEM_SERVICO, Quantity: Number(i.U_Qtd),
            UnitPrice: Number(i.U_Preco), FreeText: str(i.U_Descr, 100) })) };
        if (Number(c0.USAGE)) doc.DocumentLines.forEach((l) => (l.Usage = Number(c0.USAGE)));
        if (Number(os.U_Filial)) doc.BPL_IDAssignedToInvoice = Number(os.U_Filial);
        const d = await sl.request('POST', 'Drafts', doc);
        await repos.orders.update(id, { U_DocType: 'RAS', U_DocEntry: d.DocEntry, U_DocNum: d.DocNum });
        out.documento = { tipo: 'Rascunho de NF', numero: d.DocNum };
      } catch (e) {
        out.avisoDocumento = `OS concluída, mas o rascunho de NF não foi criado no SAP B1: ${e.message}`;
      }
    }
    if (c0.PESQ_AUTO === 'S') out.pesquisa = await surveyFor({ os: { ...os, U_Status: 'CON' } });
    return out;
  }

  async function cancelOrder(req, id, input) {
    const os = await repos.orders.get(id);
    if (!os) throw notFound('Ordem de serviço');
    if (!OS_ABERTAS.includes(os.U_Status)) throw badRequest('Esta OS já está encerrada.');
    const motivo = str(input.motivo, 300);
    if (!motivo) throw badRequest('Informe o motivo do cancelamento.');
    const ops = [{ method: 'PATCH', path: `${SET.OS}(${Number(id)})`, body: { U_Status: 'CAN', U_Laudo: `Cancelada: ${motivo}`, U_Versao: (Number(os.U_Versao) || 0) + 1 } }];
    await fecharParada(os, hoje(), ops);
    await sl.batch(ops);
    audit.record(req, { action: 'cancelar', entity: 'os', id, after: { motivo } });
    return getOrder(req, id);
  }

  /* ================= preventivas ================= */

  async function preventive({ branches } = {}) {
    const [assets, plans, ordens] = await Promise.all([repos.assets.all({ branches }), repos.plans.all(), repos.orders.all({ tipo: 'PRE' })]);
    const ativos = plans.filter((p) => p.U_Ativo !== 'N');
    const out = [];
    for (const a of assets.filter((x) => x.U_Status !== 'BAI')) {
      for (const p of ativos.filter((x) => x.U_Familia === a.U_Familia)) {
        const doPlano = ordens.filter((o) => o.U_Ativo === a.Code && o.U_Plano === p.Code);
        const ult = doPlano.filter((o) => o.U_Status === 'CON').sort((x, y) => (x.U_CheckOut < y.U_CheckOut ? 1 : -1))[0];
        const aberta = doPlano.find((o) => OS_ABERTAS.includes(o.U_Status));
        const med = Number(a.U_Medidor) || 0;
        const intMed = Number(p.U_IntMed) || 0;
        const intDias = Number(p.U_IntDias) || 0;
        const aviso = (Number(p.U_Aviso) || 10) / 100;
        // Sem preventiva registrada no Áster: considera feitas as revisões dos múltiplos do intervalo (como no manual do fabricante).
        const baseMed = ult ? Number(ult.U_Medidor) || 0 : intMed ? Math.floor(med / intMed) * intMed : 0;
        const baseData = ult ? d10(ult.U_CheckOut) : '';
        const proxMed = intMed ? baseMed + intMed : null;
        const proxData = intDias && baseData ? addDias(baseData, intDias) : null;
        const faltaMed = proxMed != null ? round2(proxMed - med) : null;
        const faltaDias = proxData ? difDias(hoje(), proxData) : null;
        let status = 'ok';
        if ((faltaMed != null && faltaMed <= 0) || (faltaDias != null && faltaDias <= 0)) status = 'vencida';
        else if ((faltaMed != null && faltaMed <= intMed * aviso) || (faltaDias != null && faltaDias <= intDias * aviso)) status = 'proxima';
        out.push({ ativo: a.Code, nome: a.Name, tipo: a.U_Tipo, familia: a.U_Familia, statusAtivo: a.U_Status, contrato: a.U_CtrAtual || 0, medidor: med,
          plano: p.Code, planoNome: p.Name, estimada: !ult, ultima: ult ? { DocNum: ult.DocNum, DocEntry: ult.DocEntry, data: baseData, medidor: baseMed } : null,
          proxMed, proxData, faltaMed, faltaDias, status, aberta: aberta ? { DocEntry: aberta.DocEntry, DocNum: aberta.DocNum, U_Status: aberta.U_Status } : null });
      }
    }
    const ordem = { vencida: 0, proxima: 1, ok: 2 };
    return out.sort((x, y) => ordem[x.status] - ordem[y.status] || (x.faltaMed ?? 1e9) - (y.faltaMed ?? 1e9));
  }

  async function preventiveOrder(req, { ativo, plano, tecnico, data, hora }) {
    const p = await repos.plans.get(plano);
    if (!p) throw badRequest('Plano não encontrado.');
    const aberta = (await repos.orders.all({ ativo, tipo: 'PRE', abertas: true })).find((o) => o.U_Plano === plano);
    if (aberta) throw conflict(`Já existe a OS ${aberta.DocNum} em aberto para esta preventiva.`);
    return createOrder(req, { tipo: 'PRE', ativo, plano, tecnico, data, hora, descricao: `Manutenção preventiva — ${p.Name}.` });
  }

  /* ================= pesquisa de satisfação ================= */

  async function surveyFor({ os, cha }) {
    const doc = os || cha;
    if (!doc?.U_Email || !doc.U_CardCode) return null;
    const ja = os ? await repos.surveys.byOs(os.DocEntry) : [];
    if (ja.length) return ja[0].Code;
    const code = token();
    await repos.surveys.create({ Code: code, Name: code, U_OsEntry: os ? os.DocEntry : 0, U_ChaEntry: cha ? cha.DocEntry : Number(os?.U_ChaEntry) || 0,
      U_CardCode: doc.U_CardCode, U_CardName: doc.U_CardName, U_Email: doc.U_Email, U_Tecnico: os?.U_Tecnico || '', U_Enviada: hoje(), U_Nota: -1,
      U_Comentario: '', U_Respondida: '' });
    return code;
  }

  async function publicSurvey(code) {
    if (!/^[a-z0-9-]{8,40}$/.test(String(code))) throw notFound('Pesquisa');
    const p = await repos.surveys.get(code);
    if (!p) throw notFound('Pesquisa');
    const [c0, os, tec] = await Promise.all([cfg(), p.U_OsEntry ? repos.orders.get(p.U_OsEntry) : null, p.U_Tecnico ? repos.technicians.get(p.U_Tecnico) : null]);
    return { empresa: c0.EMPRESA || '', cliente: p.U_CardName, os: os ? { numero: os.DocNum, tipo: DOM.tipoOS[os.U_Tipo], data: d10(os.U_CheckOut), equipamento: os.U_Ativo } : null,
      chamado: p.U_ChaEntry || null, tecnico: tec?.Name?.split(' ')[0] || '', respondida: Number(p.U_Nota) >= 0 };
  }

  /** Resposta do cliente pelo link. Nota 0 a 6 (detrator) abre um chamado de reclamação para o pós-venda tratar. */
  async function answerSurvey(code, { nota, comentario }) {
    const info = await publicSurvey(code);
    if (info.respondida) throw conflict('Esta pesquisa já foi respondida. Obrigado!');
    const n = Number(nota);
    if (!Number.isInteger(n) || n < 0 || n > 10) throw badRequest('Escolha uma nota de 0 a 10.');
    const p = await repos.surveys.get(code);
    await repos.surveys.patch(code, { U_Nota: n, U_Comentario: str(comentario, 2000), U_Respondida: agora() });
    if (n <= 6) {
      const sys = { user: { login: 'pesquisa', perms: [], branches: [] }, id: uid() };
      await createTicket(sys, { cardCode: p.U_CardCode, tipo: 'REC', origem: 'POR', prior: n <= 3 ? 'ALT' : 'MED', email: p.U_Email, respons: '',
        assunto: `Pesquisa de satisfação com nota ${n}${info.os ? ` (OS ${info.os.numero})` : ''}`, descricao: str(comentario, 2000) || 'Cliente não deixou comentário.' })
        .catch(() => null);
    }
    audit.record({ user: { login: 'cliente' }, id: uid() }, { action: 'responder', entity: 'pesquisa', id: code, after: { nota: n } });
    return { ok: true };
  }

  async function surveys({ de, ate } = {}) {
    const [rows, tecs] = await Promise.all([repos.surveys.all(), repos.technicians.all()]);
    const nomes = Object.fromEntries(tecs.map((t) => [t.Code, t.Name]));
    const lista = rows.filter((r) => (!de || d10(r.U_Enviada) >= de) && (!ate || d10(r.U_Enviada) <= ate)).map((r) => ({ ...r, tecnicoNome: nomes[r.U_Tecnico] || '' }));
    const nps = (rs) => {
      const resp = rs.filter((r) => Number(r.U_Nota) >= 0);
      if (!resp.length) return { respostas: 0, nps: null, promotores: 0, neutros: 0, detratores: 0, media: null };
      const pr = resp.filter((r) => r.U_Nota >= 9).length;
      const de2 = resp.filter((r) => r.U_Nota <= 6).length;
      return { respostas: resp.length, promotores: pr, neutros: resp.length - pr - de2, detratores: de2, nps: Math.round(((pr - de2) / resp.length) * 100),
        media: round2(resp.reduce((s, r) => s + Number(r.U_Nota), 0) / resp.length) };
    };
    const porTecnico = Object.entries(Object.groupBy ? Object.groupBy(lista.filter((r) => r.U_Tecnico), (r) => r.U_Tecnico)
      : lista.filter((r) => r.U_Tecnico).reduce((g, r) => ((g[r.U_Tecnico] ||= []).push(r), g), {}))
      .map(([k, rs]) => ({ tecnico: k, nome: nomes[k] || k, ...nps(rs) }));
    return { resumo: { enviadas: lista.length, ...nps(lista) }, porTecnico, itens: lista };
  }

  /* ================= histórico do equipamento e painel ================= */

  async function assetHistory(code) {
    const at = await repos.assets.get(code);
    if (!at) throw notFound('Ativo');
    const [ctrsA, ctrsB, movs, chas, oss, meds, tecs] = await Promise.all([repos.contracts.open(), repos.contracts.billable(), repos.movements.list({ ativo: code }, { size: 200 }),
      repos.tickets.all({ ativo: code }), repos.orders.all({ ativo: code }), repos.readings.list({ ativo: code }), repos.technicians.all()]);
    const nomes = Object.fromEntries(tecs.map((t) => [t.Code, t.Name]));
    const ev = [];
    const vistos = new Set();
    for (const c of [...ctrsA, ...ctrsB]) {
      if (vistos.has(c.DocEntry)) continue;
      vistos.add(c.DocEntry);
      for (const l of (c[LN] || []).filter((x) => x.U_Ativo === code)) {
        ev.push({ data: d10(l.U_DtSaida) || d10(c.U_DtInicio), tipo: 'contrato', titulo: `Contrato ${c.DocNum} — ${c.U_CardName}`,
          detalhe: `${DOM.statusLinha[l.U_StatusL] || l.U_StatusL}${l.U_DtDevol ? ` até ${d10(l.U_DtDevol).split('-').reverse().join('/')}` : ''}`, ref: { contrato: c.DocEntry } });
      }
    }
    for (const m of movs.items) ev.push({ data: d10(m.U_Data), tipo: 'movimento', titulo: `${DOM.tipoMov[m.U_Tipo]} nº ${m.DocNum}`, detalhe: `${m.U_CardName} · leitura ${m.U_Medidor}`, ref: { mov: m.DocEntry } });
    for (const t of chas) ev.push({ data: d10(t.U_Abertura), tipo: 'chamado', titulo: `Chamado ${t.DocNum} — ${t.U_Assunto}`, detalhe: `${DOM.statusCha[t.U_Status]} · ${t.U_CardName}`, ref: { chamado: t.DocEntry } });
    for (const o of oss) {
      ev.push({ data: d10(o.U_CheckOut) || d10(o.U_DtAgenda) || '', tipo: 'os', titulo: `OS ${o.DocNum} — ${DOM.tipoOS[o.U_Tipo]}`,
        detalhe: `${DOM.statusOS[o.U_Status]}${o.U_Tecnico ? ` · ${nomes[o.U_Tecnico] || o.U_Tecnico}` : ''}${o.U_Laudo ? ` · ${str(o.U_Laudo, 120)}` : ''}`, ref: { os: o.DocEntry } });
    }
    for (const r of meds) ev.push({ data: d10(r.U_Data), tipo: 'leitura', titulo: `Leitura ${r.U_LeitIni} → ${r.U_LeitFim}`, detalhe: `competência ${r.U_Comp.slice(4)}/${r.U_Comp.slice(0, 4)} · origem ${r.U_Origem}`, ref: {} });
    ev.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
    const con = oss.filter((o) => o.U_Status === 'CON');
    const custo = round2(con.reduce((s, o) => s + (o[OS1] || []).reduce((x, i) => x + (Number(i.U_Qtd) || 0) * (Number(i.U_Preco) || 0), 0), 0));
    return {
      ativo: { Code: at.Code, Name: at.Name, U_Tipo: at.U_Tipo, U_Familia: at.U_Familia, U_Serie: at.U_Serie, U_Placa: at.U_Placa, U_Medidor: at.U_Medidor, U_Status: at.U_Status },
      resumo: { corretivas: con.filter((o) => ['COR', 'REP'].includes(o.U_Tipo)).length, preventivas: con.filter((o) => o.U_Tipo === 'PRE').length,
        chamados: chas.length, custoPecasServicos: custo, cobradoClientes: round2(con.reduce((s, o) => s + (Number(o.U_Valor) || 0), 0)) },
      eventos: ev,
    };
  }

  async function dashboard({ branches } = {}) {
    const now = agora();
    const [chas, oss, prev, pes] = await Promise.all([repos.tickets.all({ abertos: true, branches }), repos.orders.all({ abertas: true, branches }),
      preventive({ branches }), surveys({ de: addDias(hoje(), -90) })]);
    const ch = chas.map((t) => comSla(t, now));
    return {
      chamadosAbertos: ch.length,
      slaViolado: ch.filter((t) => t.slaResp === 'violado' || t.slaSol === 'violado').length,
      parados: ch.filter((t) => t.U_Parado === 'S').length,
      osHoje: oss.filter((o) => d10(o.U_DtAgenda) === hoje()).length,
      osSemAgenda: oss.filter((o) => o.U_Status === 'ABE').length,
      osAguardandoAprovacao: oss.filter((o) => o.U_Status === 'AOR').length,
      preventivasVencidas: prev.filter((p) => p.status === 'vencida' && !p.aberta).length,
      preventivasProximas: prev.filter((p) => p.status === 'proxima' && !p.aberta).length,
      nps: pes.resumo.nps, respostas: pes.resumo.respostas,
      urgentes: ch.map((t) => ({ ...t, sla: [t.slaResp, t.slaSol].includes('violado') ? 'violado' : [t.slaResp, t.slaSol].includes('vencendo') ? 'vencendo' : 'no_prazo' })).sort((a, b) => (a.U_PrazoSol < b.U_PrazoSol ? -1 : 1)).slice(0, 6)
        .map((t) => ({ DocEntry: t.DocEntry, DocNum: t.DocNum, U_CardName: t.U_CardName, U_Assunto: t.U_Assunto, U_Prior: t.U_Prior, U_PrazoSol: t.U_PrazoSol, sla: t.sla, U_Parado: t.U_Parado })),
    };
  }

  return {
    listTickets, getTicket, createTicket, updateTicket, interact, orderFromTicket,
    listOrders, getOrder, createOrder, orderFromReturn, scheduleOrder, startOrder, saveOrder, quoteOrder, concludeOrder, cancelOrder,
    preventive, preventiveOrder, publicSurvey, answerSurvey, surveys, assetHistory, dashboard, tecnicoDo,
  };
}
