// Contratos de locação: validação, gravação e mudança de status.
// Todas as regras ficam aqui, no backend (requisito INT-04); a tela só repete as mais simples.
import { LN, GR, DOM } from '../b1/schema.js';
import { badRequest, conflict, forbidden, notFound, d10, hoje } from '../lib/util.js';

const EDITABLE_LINE = ['U_Familia', 'U_Ativo', 'U_AtvDesc', 'U_ItemCode', 'U_Regra', 'U_Grupo', 'U_Valor', 'U_Diaria', 'U_Franquia', 'U_VlrExced', 'U_Condutor', 'U_Local'];
const NUM_LINE = new Set(['U_Valor', 'U_Diaria', 'U_Franquia', 'U_VlrExced']);
const VALUE_FIELDS = ['U_Valor', 'U_Diaria', 'U_Franquia', 'U_VlrExced', 'U_Regra'];
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const nonNeg = (v, label) => {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n < 0) throw badRequest(`${label}: valor inválido.`);
  return n;
};

export function createContractService({ repos, audit }) {
  /** Ativos em itens não devolvidos de contratos abertos: código → nº do contrato. */
  async function allocations(exceptId) {
    const map = new Map();
    for (const c of await repos.contracts.open()) {
      if (Number(c.DocEntry) === Number(exceptId)) continue;
      for (const l of c[LN] || []) if (l.U_Ativo && l.U_StatusL !== 'DEV') map.set(l.U_Ativo, c.DocNum);
    }
    return map;
  }

  function normalizeHeader(input) {
    const h = {
      U_CardCode: str(input.U_CardCode, 15),
      U_Tipo: input.U_Tipo || 'LOC',
      U_DtInicio: d10(input.U_DtInicio) || null,
      U_DtFim: d10(input.U_DtFim) || null,
      U_DtCorte: d10(input.U_DtCorte) || null,
      U_DiaFat: Number(input.U_DiaFat) || 1,
      U_Filial: Number(input.U_Filial) || 0,
      U_Obra: str(input.U_Obra, 100),
      U_Indice: str(input.U_Indice, 20),
      U_ModoFat: input.U_ModoFat || 'RAS',
      U_Email: str(input.U_Email, 100),
      U_Obs: str(input.U_Obs, 4000),
    };
    if (!DOM.tipoContrato[h.U_Tipo]) throw badRequest('Tipo de contrato inválido.');
    if (!DOM.modoFat[h.U_ModoFat]) throw badRequest('Documento de faturamento inválido.');
    if (h.U_Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(h.U_Email)) throw badRequest('E-mail de cobrança inválido.');
    return h;
  }

  function normalizeLines(lines = []) {
    return lines.map((l) => {
      const o = { LineId: l.LineId ? Number(l.LineId) : undefined };
      for (const k of EDITABLE_LINE) o[k] = NUM_LINE.has(k) ? nonNeg(l[k], k.slice(2)) : str(l[k], k === 'U_AtvDesc' || k === 'U_Condutor' || k === 'U_Local' ? 100 : 50);
      return o;
    });
  }

  function normalizeGroups(groups = []) {
    return groups.map((g) => ({
      LineId: g.LineId ? Number(g.LineId) : undefined,
      U_Grupo: str(g.U_Grupo, 20), U_Descr: str(g.U_Descr, 100), U_Regra: str(g.U_Regra, 50), U_ItemCode: str(g.U_ItemCode, 50),
      U_Valor: nonNeg(g.U_Valor, 'Mensalidade do grupo'), U_Diaria: nonNeg(g.U_Diaria, 'Diária do grupo'),
      U_Franquia: nonNeg(g.U_Franquia, 'Franquia do grupo'), U_VlrExced: nonNeg(g.U_VlrExced, 'Excedente do grupo'),
    }));
  }

  async function validate(c, { ativar = false, exceptId } = {}) {
    const bp = c.U_CardCode ? await repos.partners.get(c.U_CardCode) : null;
    if (!bp) throw badRequest('Cliente não encontrado no SAP B1.');
    c.U_CardName = bp.CardName;
    if (!c.U_DtInicio) throw badRequest('Informe o início da vigência.');
    if (c.U_DtFim && c.U_DtFim < c.U_DtInicio) throw badRequest('O fim da vigência é anterior ao início.');
    if (c.U_DiaFat < 1 || c.U_DiaFat > 31) throw badRequest('Dia de faturamento deve ser de 1 a 31.');
    const regras = await repos.rules.map();
    const grupos = new Set();
    for (const g of c[GR]) {
      if (!g.U_Grupo) throw badRequest('Todo grupo de cobrança precisa de um código.');
      if (grupos.has(g.U_Grupo)) throw badRequest(`Grupo ${g.U_Grupo} repetido.`);
      grupos.add(g.U_Grupo);
      if (!regras[g.U_Regra]) throw badRequest(`Grupo ${g.U_Grupo}: regra de cobrança inexistente.`);
      if (ativar && !g.U_ItemCode) throw badRequest(`Grupo ${g.U_Grupo}: informe o item de faturamento.`);
    }
    const alloc = await allocations(exceptId);
    const vistos = new Set();
    for (const l of c[LN]) {
      const ref = l.U_Ativo || l.U_Familia || 'item';
      if (!l.U_Ativo && !l.U_Familia) throw badRequest('Cada item precisa de um ativo ou de uma família.');
      if (l.U_Grupo && !grupos.has(l.U_Grupo)) throw badRequest(`${ref}: grupo ${l.U_Grupo} não existe no contrato.`);
      if (!l.U_Grupo && !regras[l.U_Regra]) throw badRequest(`${ref}: escolha uma regra de cobrança válida.`);
      if (l.U_Ativo && l.U_StatusL !== 'DEV') {
        if (vistos.has(l.U_Ativo)) throw badRequest(`Ativo ${l.U_Ativo} aparece duas vezes no contrato.`);
        vistos.add(l.U_Ativo);
        if (alloc.has(l.U_Ativo)) throw conflict(`Ativo ${l.U_Ativo} já está no contrato nº ${alloc.get(l.U_Ativo)}.`);
        const a = await repos.assets.get(l.U_Ativo);
        if (!a) throw badRequest(`Ativo ${l.U_Ativo} não encontrado.`);
        if (a.U_Status === 'BAI') throw badRequest(`Ativo ${l.U_Ativo} está baixado.`);
        if (l.U_Familia && a.U_Familia && l.U_Familia !== a.U_Familia) throw badRequest(`Ativo ${l.U_Ativo} não é da família ${l.U_Familia}.`);
        l.U_Familia ||= a.U_Familia || '';
        l.U_AtvDesc ||= a.Name;
        l.U_ItemCode ||= a.U_ItemCode || '';
      }
      if (ativar && !l.U_Grupo && !l.U_ItemCode) throw badRequest(`${ref}: informe o item de faturamento.`);
      if (ativar && !l.U_Grupo && ['ITEM'].includes(regras[l.U_Regra]?.U_Tipo) && !(l.U_Valor > 0 || l.U_Diaria > 0)) {
        throw badRequest(`${ref}: informe a mensalidade ou a diária.`);
      }
    }
    if (ativar && !c[LN].length) throw badRequest('Inclua ao menos um item no contrato.');
    return c;
  }

  return {
    async create(req, input) {
      const c = { ...normalizeHeader(input), U_Status: 'RAS', [LN]: normalizeLines(input[LN]).map((l) => ({ ...l, U_StatusL: 'PEN' })), [GR]: normalizeGroups(input[GR]) };
      c[LN].forEach((l) => delete l.LineId);
      c[GR].forEach((g) => delete g.LineId);
      await validate(c);
      const created = await repos.contracts.create(c);
      audit.record(req, { action: 'criar', entity: 'contrato', id: created.DocEntry, after: created });
      return repos.contracts.get(created.DocEntry);
    },

    async update(req, id, input, version) {
      const cur = await repos.contracts.get(id);
      if (!cur) throw notFound('Contrato');
      if (cur.U_Status === 'ENC') throw badRequest('Contrato encerrado não pode ser alterado.');
      const header = normalizeHeader(input);
      if (cur[LN].some((l) => l.U_StatusL !== 'PEN') && header.U_CardCode !== cur.U_CardCode) throw badRequest('O cliente não pode mudar depois que um item foi entregue.');
      const incoming = normalizeLines(input[LN]);
      const byId = new Map(cur[LN].map((l) => [l.LineId, l]));
      const lines = [];
      for (const l of incoming) {
        const old = l.LineId ? byId.get(l.LineId) : null;
        if (l.LineId && !old) throw badRequest(`Item ${l.LineId} não pertence ao contrato.`);
        if (old && old.U_StatusL !== 'PEN') {
          // Item já entregue: ativo, datas e status são da movimentação; valores só com permissão de ativação.
          const mudouValor = VALUE_FIELDS.some((k) => String(old[k] ?? '') !== String(l[k] ?? ''));
          if (mudouValor && cur.U_Status !== 'RAS' && !req.user.perms.includes('contratos.ativar')) throw forbidden('Alterar valores de um contrato ativo exige permissão de ativação.');
          lines.push({ ...old, ...l, U_Ativo: old.U_Ativo, U_Familia: old.U_Familia, U_DtSaida: old.U_DtSaida, U_DtDevol: old.U_DtDevol, U_StatusL: old.U_StatusL });
        } else {
          lines.push({ ...(old || {}), ...l, U_StatusL: 'PEN', U_DtSaida: null, U_DtDevol: null });
        }
        byId.delete(l.LineId);
      }
      for (const removed of byId.values()) {
        if (removed.U_StatusL !== 'PEN') throw badRequest(`O item ${removed.U_Ativo} já foi entregue e não pode ser removido; registre a devolução.`);
      }
      const c = { ...cur, ...header, [LN]: lines, [GR]: normalizeGroups(input[GR]) };
      await validate(c, { exceptId: id });
      const patch = { ...header, U_CardName: c.U_CardName, [LN]: c[LN], [GR]: c[GR] };
      const { before, after } = await repos.contracts.update(id, patch, version, { replaceLines: true });
      audit.record(req, { action: 'alterar', entity: 'contrato', id, before, after });
      return after;
    },

    async setStatus(req, id, status, version) {
      const cur = await repos.contracts.get(id);
      if (!cur) throw notFound('Contrato');
      const ok = { RAS: ['ATV'], ATV: ['SUS', 'ENC'], SUS: ['ATV', 'ENC'], ENC: [] }[cur.U_Status] || [];
      if (!ok.includes(status)) throw badRequest(`Não é possível passar de ${DOM.statusContrato[cur.U_Status]} para ${DOM.statusContrato[status] || status}.`);
      const patch = { U_Status: status };
      let replaceLines = false;
      if (status === 'ATV' && cur.U_Status === 'RAS') await validate({ ...cur, [LN]: cur[LN].map((l) => ({ ...l })) }, { ativar: true, exceptId: id });
      if (status === 'ENC') {
        if (cur[LN].some((l) => l.U_StatusL === 'LOC')) throw badRequest('Registre a devolução de todos os itens antes de encerrar.');
        patch[LN] = cur[LN].filter((l) => l.U_StatusL !== 'PEN');
        patch[GR] = cur[GR];
        patch.U_DtFim = d10(cur.U_DtFim) || hoje();
        replaceLines = true;
      }
      const { before, after } = await repos.contracts.update(id, patch, version, { replaceLines });
      audit.record(req, { action: `status:${status}`, entity: 'contrato', id, before: { U_Status: before.U_Status }, after: { U_Status: after.U_Status } });
      return after;
    },

    allocations,
  };
}
