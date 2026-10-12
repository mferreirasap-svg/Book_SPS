// Faturamento: painel de parcelas, prévia, geração do documento no B1 e liberação para refaturar.
// A parcela (@SPS_LFAT, Code = contrato-competência) é criada antes do documento e serve de trava:
// a mesma competência nunca é faturada duas vezes, mesmo com dois usuários (requisito INT-02).
import { calcularParcela } from '../domain/billing/engine.js';
import { SET, DOM } from '../b1/schema.js';
import { badRequest, conflict, notFound, hoje, compDe, compFmt, compRange, round2, pad, difDias } from '../lib/util.js';

const DOC_SET = { RAS: 'Drafts', PRE: 'Orders', FAT: 'Invoices' };

export function createBillingService({ repos, audit, jobs }) {
  async function context(comp) {
    const [regras, cfg, leituras, foras, multas] = await Promise.all([
      repos.rules.map(), repos.settings.all(), repos.readings.list({ comp }), repos.offPeriods.list({}), repos.fines.list({ status: 'REP' }),
    ]);
    return { regras, cfg, leituras, foras, multas };
  }

  function calc(c, comp, ctx) {
    const de = Number(c.DocEntry);
    return calcularParcela({
      contrato: c, comp, regras: ctx.regras, itemMulta: ctx.cfg.ITEM_MULTA || '',
      leituras: ctx.leituras.filter((m) => Number(m.U_CtrEntry) === de),
      foras: ctx.foras.filter((f) => Number(f.U_CtrEntry) === de),
      multas: ctx.multas.filter((m) => Number(m.U_CtrEntry) === de),
    });
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
        return {
          DocEntry: c.DocEntry, DocNum: c.DocNum, U_CardName: c.U_CardName, U_DiaFat: c.U_DiaFat, U_ModoFat: c.U_ModoFat, U_Status: c.U_Status,
          total: p?.U_Status === 'OK' ? p.U_Valor : r.total, linhas: r.linhas.length, avisos: r.avisos,
          parcela: p ? { Code: p.Code, status: p.U_Status, docType: p.U_DocType, docNum: p.U_DocNum, valor: p.U_Valor, erro: p.U_Erro } : null,
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
    return { contrato: { DocEntry: c.DocEntry, DocNum: c.DocNum, U_CardName: c.U_CardName, U_ModoFat: c.U_ModoFat }, comp, ...calc(c, comp, ctx), parcela };
  }

  async function generateOne(req, id, comp, { desconto = 0, acrescimo = 0 } = {}) {
    const c = await repos.contracts.get(id);
    if (!c) throw notFound('Contrato');
    if (!['ATV', 'SUS', 'ENC'].includes(c.U_Status)) throw badRequest('Só contratos ativos, suspensos ou encerrados podem ser faturados.');
    const ctx = await context(comp);
    const r = calc(c, comp, ctx);
    if (!r.faturavel) throw badRequest(r.motivo || 'Nada a faturar.');
    if (r.avisos.length) throw badRequest(r.avisos.join(' '));
    desconto = round2(Math.max(0, Number(desconto) || 0));
    acrescimo = round2(Math.max(0, Number(acrescimo) || 0));
    if (desconto >= r.total) throw badRequest('O desconto não pode ser maior que o valor da parcela.');

    const code = `${c.DocEntry}-${comp}`;
    const valor = round2(r.total - desconto + acrescimo);
    const trava = { Code: code, Name: code, U_CtrEntry: c.DocEntry, U_Comp: comp, U_Status: 'PRO', U_Data: hoje(), U_Valor: valor,
      U_Desc: desconto, U_Acres: acrescimo, U_Usuario: req.user.login, U_Erro: '', U_DocEntry: 0, U_DocNum: 0 };
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
    const cfg = ctx.cfg;
    const linhas = r.linhas.map((x) => {
      const L = { ItemCode: x.ItemCode, Quantity: x.qtd, UnitPrice: x.preco, FreeText: x.desc.slice(0, 100) };
      if (Number(cfg.USAGE)) L.Usage = Number(cfg.USAGE);
      return L;
    });
    if (acrescimo > 0) linhas.push({ ItemCode: r.linhas[0].ItemCode, Quantity: 1, UnitPrice: acrescimo, FreeText: 'Acréscimo' });
    const doc = {
      CardCode: c.U_CardCode, DocDate: hoje(), U_SPS_CtrEntry: c.DocEntry, U_SPS_Comp: comp,
      Comments: `Locação - contrato ${c.DocNum} - competência ${compFmt(comp)}${c.U_Obra ? ` - ${c.U_Obra}` : ''}`.slice(0, 254),
      DocumentLines: linhas,
    };
    if (desconto > 0) doc.DiscountPercent = round2((desconto / (r.total + acrescimo)) * 100 * 100) / 100;
    if (Number(c.U_Filial)) doc.BPL_IDAssignedToInvoice = Number(c.U_Filial);
    if (tipo === 'RAS') doc.DocObjectCode = 'oInvoices';
    if (tipo === 'PRE') doc.DocDueDate = hoje();

    let criado;
    try {
      criado = await repos.sl.request('POST', DOC_SET[tipo], doc);
    } catch (e) {
      await repos.installments.patch(code, { U_Status: 'ERR', U_Erro: String(e.message).slice(0, 254) }).catch(() => {});
      throw e;
    }
    const detalhe = JSON.stringify(r.linhas.map(({ tipo: t, desc, qtd, preco, total, memoria }) => ({ tipo: t, desc, qtd, preco, total, memoria })));
    await repos.installments.patch(code, { U_Status: 'OK', U_DocType: tipo, U_DocEntry: criado.DocEntry, U_DocNum: criado.DocNum, U_Detalhe: detalhe });
    for (const x of r.linhas.filter((l) => l.multa)) await repos.fines.patch(x.multa, { U_Status: 'FAT', U_Comp: comp });
    audit.record(req, { action: 'faturar', entity: 'contrato', id: c.DocEntry, after: { comp, tipo, doc: criado.DocNum, valor } });
    return { contrato: c.DocNum, cliente: c.U_CardName, docType: tipo, docTypeName: DOM.modoFat[tipo], docNum: criado.DocNum, valor };
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

  return { list, preview, generateOne, generateBatch, release };
}

export { DOC_SET };
export const SET_FAT = SET.FAT;
