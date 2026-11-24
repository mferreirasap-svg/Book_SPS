// Faturamento: painel de parcelas, prévia, conferência/liberação, geração do documento no B1 e liberação para refaturar.
// A parcela (@SPS_LFAT, Code = contrato-competência) é criada antes do documento e serve de trava:
// a mesma competência nunca é faturada duas vezes, mesmo com dois usuários (requisito INT-02).
// Contratos com franquia, consumo ou mão de obra por hora passam por conferência: alguém decide, linha a linha, se cobra, abona ou
// ajusta (com motivo, @SPS_LFAJ) e libera; só a parcela liberada vira documento. A mão de obra vai em documento de serviço separado.
import { calcularParcela } from '../domain/billing/engine.js';
import { SET, DOM } from '../b1/schema.js';
import { badRequest, conflict, forbidden, notFound, hoje, agora, compDe, compFmt, compRange, round2, pad, difDias, uid } from '../lib/util.js';

const DOC_SET = { RAS: 'Drafts', PRE: 'Orders', FAT: 'Invoices' };
const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function createBillingService({ repos, audit, jobs, integ }) {
  async function context(comp) {
    const [regras, cfg, leituras, foras, multas, apontamentos] = await Promise.all([
      repos.rules.map(), repos.settings.all(), repos.readings.list({ comp }), repos.offPeriods.list({}), repos.fines.list({ status: 'REP' }),
      repos.appointments.list({ comp }),
    ]);
    return { regras, cfg, leituras, foras, multas, apontamentos };
  }

  function calc(c, comp, ctx) {
    const de = Number(c.DocEntry);
    const doContrato = (rows) => rows.filter((m) => Number(m.U_CtrEntry) === de);
    const leit = doContrato(ctx.leituras);
    const r = calcularParcela({
      contrato: c, comp, regras: ctx.regras, itemMulta: ctx.cfg.ITEM_MULTA || '',
      // Leitura lançada no campo só vale depois de conferida.
      leituras: leit.filter((m) => !m.U_Situacao || m.U_Situacao === 'CON'),
      foras: doContrato(ctx.foras), multas: doContrato(ctx.multas), apontamentos: doContrato(ctx.apontamentos),
    });
    const pendLeit = leit.filter((m) => m.U_Situacao === 'PEN').length;
    if (pendLeit) r.avisos.push(`${pendLeit} leitura(s) de campo aguardando conferência.`);
    const pendApo = doContrato(ctx.apontamentos).filter((a) => a.U_Situacao === 'LAN').length;
    if (pendApo) r.avisos.push(`${pendApo} apontamento(s) de horas aguardando aprovação.`);
    return r;
  }

  /** O contrato passa por conferência antes de faturar? Marca do contrato ou regra geral (FAT_CONFERENCIA). */
  function precisaConferir(c, cfg, regras) {
    if (c.U_Conferir === 'S') return true;
    if (c.U_Conferir === 'N') return false;
    const modo = cfg.FAT_CONFERENCIA || 'FRANQUIA';
    if (modo === 'TODOS') return true;
    if (modo === 'NENHUM') return false;
    const variavel = (x) => Number(x.U_Franquia) > 0 || regras[x.U_Regra]?.U_Tipo === 'CONS';
    return (c.SPS_LCT1Collection || []).some((l) => variavel(l) || (l.U_TipoLinha === 'MO' && l.U_UnidCobr !== 'M'))
      || (c.SPS_LCT2Collection || []).some(variavel);
  }

  /** Aplica abonos e ajustes da conferência nas linhas calculadas. */
  function aplicarAjustes(r, ajustes) {
    const linhas = r.linhas.map((l) => ({ ...l }));
    const notas = [];
    for (const a of ajustes) {
      const l = linhas[Number(a.U_Linha)];
      if (!l || l.desc.slice(0, 150) !== a.U_Descr) throw badRequest('As linhas do cálculo mudaram depois da liberação. Confira e libere de novo.');
      if (a.U_Tipo === 'ABO') {
        l.abonada = true;
        notas.push(`Abonado: ${l.desc} (${DOM.motivoAjuste[a.U_Motivo] || a.U_Motivo})`);
      } else if (a.U_Tipo === 'AJU') {
        l.total = round2(Number(a.U_VlrFinal) || 0);
        l.preco = round2(l.total / (Number(l.qtd) || 1));
        l.ajustada = true;
        notas.push(`Ajustado: ${l.desc} de ${brl(a.U_VlrOrig)} para ${brl(l.total)}`);
      }
    }
    const finais = linhas.filter((l) => !l.abonada && l.total > 0);
    return { linhas: finais, total: round2(finais.reduce((s, x) => s + x.total, 0)), notas, todas: linhas };
  }

  /** Situação da competência para o painel: gerada, atrasada, vence em breve ou em dia. */
  function situacao(c, comp, parcela, alerta) {
    if (parcela && parcela.U_Status === 'OK') return 'gerada';
    const atual = compDe(hoje());
    if (comp < atual) return 'atrasada';
    if (comp > atual) return 'em_dia';
    const r = compRange(comp);
    const venc = `${r.ini.slice(0, 8)}${pad(Math.min(Number(c.U_DiaFat) || 1, r.dias))}`;
    const faltam = difDias(hoje(), venc);
    if (faltam < 0) return 'atrasada';
    if (faltam <= alerta) return 'vence';
    return 'em_dia';
  }

  async function list(comp, { branches } = {}) {
    compRange(comp);
    const [ctrs, ctx, parcelas] = await Promise.all([repos.contracts.billable({ branches }), context(comp), repos.installments.byComp(comp)]);
    const alerta = Number(ctx.cfg.DIAS_ALERTA_FAT) || 7;
    return ctrs
      .map((c) => {
        const r = calc(c, comp, ctx);
        const p = parcelas.find((x) => Number(x.U_CtrEntry) === Number(c.DocEntry));
        if (!r.faturavel && !p) return null;
        const exige = precisaConferir(c, ctx.cfg, ctx.regras);
        const liberada = p?.U_Status === 'LIB' && round2(p.U_ValorCalc) === round2(r.total);
        return {
          DocEntry: c.DocEntry, DocNum: c.DocNum, U_CardName: c.U_CardName, U_DiaFat: c.U_DiaFat, U_ModoFat: c.U_ModoFat, U_Status: c.U_Status,
          total: ['OK', 'LIB'].includes(p?.U_Status) && (p.U_Status === 'OK' || liberada) ? p.U_Valor : r.total, calculado: r.total,
          linhas: r.linhas.length, avisos: r.avisos, servico: r.linhas.some((l) => l.servico),
          conferencia: { exige, liberada: Boolean(liberada), mudou: p?.U_Status === 'LIB' && !liberada, por: p?.U_LibPor || '', em: p?.U_DtLib || '' },
          parcela: p ? { Code: p.Code, status: p.U_Status, docType: p.U_DocType, docNum: p.U_DocNum, docNum2: p.U_DocNum2 || 0, valor: p.U_Valor, erro: p.U_Erro } : null,
          situacao: situacao(c, comp, p, alerta),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.DocNum - b.DocNum);
  }

  async function preview(id, comp) {
    const c = await repos.contracts.get(id);
    if (!c) throw notFound('Contrato');
    const ctx = await context(comp);
    const parcela = await repos.installments.get(`${c.DocEntry}-${comp}`);
    const ajustes = parcela ? await repos.adjustments.byParcel(parcela.Code) : [];
    return { contrato: { DocEntry: c.DocEntry, DocNum: c.DocNum, U_CardName: c.U_CardName, U_ModoFat: c.U_ModoFat }, comp, ...calc(c, comp, ctx), parcela,
      conferir: precisaConferir(c, ctx.cfg, ctx.regras), ajustes, alcada: Number(ctx.cfg.FAT_ALCADA_ABONO) || 0 };
  }

  /** Conferência: grava a decisão de cada linha (cobrar, abonar, ajustar) e libera a parcela para gerar o documento. */
  async function liberar(req, id, comp, ajustesIn = []) {
    const c = await repos.contracts.get(id);
    if (!c) throw notFound('Contrato');
    if (!['ATV', 'SUS', 'ENC'].includes(c.U_Status)) throw badRequest('Só contratos ativos, suspensos ou encerrados podem ser faturados.');
    const ctx = await context(comp);
    const r = calc(c, comp, ctx);
    if (!r.faturavel) throw badRequest(r.motivo || 'Nada a faturar.');
    if (r.avisos.length) throw badRequest(`Antes de liberar: ${r.avisos.join(' ')}`);
    const code = `${c.DocEntry}-${comp}`;
    const p = await repos.installments.get(code);
    if (p && ['OK', 'PRO'].includes(p.U_Status)) throw conflict('Esta competência já foi faturada.');
    if (!Array.isArray(ajustesIn)) throw badRequest('Ajustes inválidos.');
    const ajustes = [];
    let reducao = 0;
    for (const a of ajustesIn.filter((x) => x && ['ABO', 'AJU'].includes(x.tipo))) {
      const idx = Number(a.linha);
      const l = r.linhas[idx];
      if (!l) throw badRequest('Linha do cálculo inválida.');
      if (!DOM.motivoAjuste[a.motivo]) throw badRequest(`Informe o motivo do ajuste em "${l.desc}".`);
      const final = a.tipo === 'ABO' ? 0 : round2(Number(String(a.valor).replace(',', '.')));
      if (!Number.isFinite(final) || final < 0) throw badRequest(`Valor inválido em "${l.desc}".`);
      reducao = round2(reducao + Math.max(0, l.total - final));
      ajustes.push({ idx, l, tipo: a.tipo, final, motivo: a.motivo, obs: String(a.obs || '').slice(0, 254) });
    }
    const alcada = Number(ctx.cfg.FAT_ALCADA_ABONO) || 0;
    if (reducao > alcada && !req.user.perms.includes('faturamento.abonar')) {
      throw forbidden(`Abono/redução de ${brl(reducao)} acima da sua alçada (${brl(alcada)}). Peça a liberação a um gestor.`);
    }
    for (const old of await repos.adjustments.byParcel(code)) await repos.adjustments.remove(old.Code);
    const now = agora();
    for (const a of ajustes) {
      const k = `${code}-${a.idx}-${uid()}`.slice(0, 50);
      await repos.adjustments.create({ Code: k, Name: k, U_Parcela: code, U_Linha: a.idx, U_Descr: a.l.desc.slice(0, 150), U_Tipo: a.tipo, U_VlrOrig: a.l.total,
        U_VlrFinal: a.final, U_Motivo: a.motivo, U_Obs: a.obs, U_Usuario: req.user.login, U_Data: now });
    }
    const final = aplicarAjustes(r, await repos.adjustments.byParcel(code));
    const rec = { U_CtrEntry: c.DocEntry, U_Comp: comp, U_Status: 'LIB', U_Data: hoje(), U_Valor: final.total, U_ValorCalc: r.total, U_LibPor: req.user.login,
      U_DtLib: now, U_Usuario: req.user.login, U_Erro: '', U_DocEntry: 0, U_DocNum: 0, U_DocEntry2: 0, U_DocNum2: 0, U_Desc: 0, U_Acres: 0 };
    if (p) await repos.installments.patch(code, rec);
    else await repos.installments.create({ Code: code, Name: code, ...rec });
    audit.record(req, { action: 'liberar_parcela', entity: 'contrato', id: c.DocEntry, after: { comp, calculado: r.total, liberado: final.total, ajustes: final.notas } });
    return { contrato: c.DocNum, comp, calculado: r.total, liberado: final.total, ajustes: final.notas };
  }

  async function generateOne(req, id, comp, { desconto = 0, acrescimo = 0 } = {}) {
    const c = await repos.contracts.get(id);
    if (!c) throw notFound('Contrato');
    if (!['ATV', 'SUS', 'ENC'].includes(c.U_Status)) throw badRequest('Só contratos ativos, suspensos ou encerrados podem ser faturados.');
    const ctx = await context(comp);
    const r = calc(c, comp, ctx);
    if (!r.faturavel) throw badRequest(r.motivo || 'Nada a faturar.');
    if (r.avisos.length) throw badRequest(r.avisos.join(' '));
    const code = `${c.DocEntry}-${comp}`;
    const existente = await repos.installments.get(code);
    if (existente?.U_Status === 'OK') throw conflict(`Competência já faturada (documento ${existente.U_DocNum}).`);
    if (existente?.U_Status === 'PRO') throw conflict('Esta parcela está sendo gerada por outro usuário.');
    let ajustes = [];
    if (precisaConferir(c, ctx.cfg, ctx.regras)) {
      if (!existente || existente.U_Status !== 'LIB') throw badRequest('Contrato com conferência: confira e libere a parcela antes de gerar o documento.');
      if (round2(existente.U_ValorCalc) !== round2(r.total)) throw badRequest('O cálculo mudou depois da liberação (nova leitura, apontamento ou multa). Confira e libere de novo.');
      ajustes = await repos.adjustments.byParcel(code);
    }
    const final = aplicarAjustes(r, ajustes);
    if (!final.linhas.length) throw badRequest('Tudo foi abonado: não há documento a gerar.');
    desconto = round2(Math.max(0, Number(desconto) || 0));
    acrescimo = round2(Math.max(0, Number(acrescimo) || 0));
    const cfg = ctx.cfg;
    const separar = cfg.MO_DOC_SEPARADO !== 'N';
    const grupos = separar ? [final.linhas.filter((l) => !l.servico), final.linhas.filter((l) => l.servico)].filter((g) => g.length) : [final.linhas];
    const principal = grupos[0];
    const totalPrincipal = round2(principal.reduce((s, l) => s + l.total, 0));
    if (desconto >= totalPrincipal) throw badRequest('O desconto não pode ser maior que o valor da parcela.');

    const valor = round2(final.total - desconto + acrescimo);
    const trava = { Code: code, Name: code, U_CtrEntry: c.DocEntry, U_Comp: comp, U_Status: 'PRO', U_Data: hoje(), U_Valor: valor,
      U_Desc: desconto, U_Acres: acrescimo, U_Usuario: req.user.login, U_Erro: '', U_DocEntry: 0, U_DocNum: 0, U_DocEntry2: 0, U_DocNum2: 0 };
    try {
      await repos.installments.create(trava);
    } catch (e) {
      if (e.b1Code !== -2035 && e.statusCode !== 400) throw e;
      const ex = await repos.installments.get(code);
      if (!ex) throw e;
      if (ex.U_Status === 'OK') throw conflict(`Competência já faturada (documento ${ex.U_DocNum}).`);
      if (ex.U_Status === 'PRO') throw conflict('Esta parcela está sendo gerada por outro usuário.');
      const { Code: _c, Name: _n, ...reabrir } = trava;
      await repos.installments.patch(code, reabrir);
    }

    const tipo = c.U_ModoFat || 'RAS';
    const montar = (linhas, servico, primeiro) => {
      const uso = servico ? Number(cfg.B1_USAGE_SRV) || Number(cfg.USAGE) : Number(cfg.USAGE);
      const L = linhas.map((x) => ({ ItemCode: x.ItemCode, Quantity: x.qtd, UnitPrice: x.preco, FreeText: x.desc.slice(0, 100), ...(uso ? { Usage: uso } : {}) }));
      if (primeiro && acrescimo > 0) L.push({ ItemCode: linhas[0].ItemCode, Quantity: 1, UnitPrice: acrescimo, FreeText: 'Acréscimo' });
      const doc = {
        CardCode: c.U_CardCode, DocDate: hoje(), U_SPS_CtrEntry: c.DocEntry, U_SPS_Comp: comp,
        Comments: `${servico ? 'Mão de obra / operação' : 'Locação'} - contrato ${c.DocNum} - competência ${compFmt(comp)}${c.U_Obra ? ` - ${c.U_Obra}` : ''}${primeiro && final.notas.length ? ` - ${final.notas.join('; ')}` : ''}`.slice(0, 254),
        DocumentLines: L,
      };
      if (integ) Object.assign(doc, integ.extrasDocumento(cfg, c, { servico }));
      const tot = round2(linhas.reduce((s, l) => s + l.total, 0));
      if (primeiro && desconto > 0) doc.DiscountPercent = round2((desconto / (tot + acrescimo)) * 100 * 100) / 100;
      if (Number(c.U_Filial)) doc.BPL_IDAssignedToInvoice = Number(c.U_Filial);
      if (tipo === 'RAS') doc.DocObjectCode = 'oInvoices';
      if (tipo === 'PRE') doc.DocDueDate = hoje();
      return doc;
    };

    const criados = [];
    try {
      for (const [i, g] of grupos.entries()) criados.push(await repos.sl.request('POST', DOC_SET[tipo], montar(g, g[0].servico === true && separar, i === 0)));
    } catch (e) {
      const parcial = criados.length ? ` Documento ${criados[0].DocNum} já criado; o de serviço falhou.` : '';
      await repos.installments.patch(code, { U_Status: 'ERR', U_Erro: `${e.message}${parcial}`.slice(0, 254), U_DocEntry: criados[0]?.DocEntry || 0, U_DocNum: criados[0]?.DocNum || 0 })
        .catch(() => {});
      throw e;
    }
    const detalhe = JSON.stringify(final.todas.map(({ tipo: t, desc, qtd, preco, total, memoria, abonada, ajustada, servico }) => ({ tipo: t, desc, qtd, preco, total, memoria,
      abonada: Boolean(abonada), ajustada: Boolean(ajustada), servico: Boolean(servico) })));
    await repos.installments.patch(code, { U_Status: 'OK', U_DocType: tipo, U_DocEntry: criados[0].DocEntry, U_DocNum: criados[0].DocNum, U_DocEntry2: criados[1]?.DocEntry || 0,
      U_DocNum2: criados[1]?.DocNum || 0, U_Detalhe: detalhe });
    for (const x of final.linhas.filter((l) => l.multa)) await repos.fines.patch(x.multa, { U_Status: 'FAT', U_Comp: comp });
    audit.record(req, { action: 'faturar', entity: 'contrato', id: c.DocEntry, after: { comp, tipo, doc: criados.map((d) => d.DocNum), valor } });
    return { contrato: c.DocNum, cliente: c.U_CardName, docType: tipo, docTypeName: DOM.modoFat[tipo], docNum: criados[0].DocNum, docNum2: criados[1]?.DocNum || 0, valor };
  }

  function generateBatch(req, comp, ids) {
    if (!Array.isArray(ids) || !ids.length) throw badRequest('Selecione ao menos um contrato.');
    compRange(comp);
    return jobs.start('faturamento', { createdBy: req.user.login, payload: { comp, ids }, total: ids.length }, async (progress) => {
      for (const id of ids) {
        try {
          progress({ ok: true, id, ...(await generateOne(req, id, comp)) });
        } catch (e) {
          progress({ ok: false, id, message: e.message });
        }
      }
    });
  }

  async function release(req, code) {
    const p = await repos.installments.get(code);
    if (!p) throw notFound('Parcela');
    if (p.U_Status === 'CAN') return p;
    await repos.installments.patch(code, { U_Status: 'CAN' });
    for (const m of await repos.fines.list({ ctr: p.U_CtrEntry, status: 'FAT' })) {
      if (m.U_Comp === p.U_Comp) await repos.fines.patch(m.Code, { U_Status: 'REP', U_Comp: '' });
    }
    audit.record(req, { action: 'liberar_refaturamento', entity: 'parcela', id: code, before: { U_Status: p.U_Status }, after: { U_Status: 'CAN' } });
    return repos.installments.get(code);
  }

  return { list, preview, liberar, generateOne, generateBatch, release, precisaConferir };
}

export { DOC_SET };
export const SET_FAT = SET.FAT;
