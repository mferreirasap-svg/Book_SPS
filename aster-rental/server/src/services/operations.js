// Leituras, multas, disponibilidade e painel.
import { SET, LN } from '../b1/schema.js';
import { key } from '../b1/odata.js';
import { badRequest, notFound, d10, hoje, addDias, compDe, uid } from '../lib/util.js';

export function createOperationsService({ repos, audit, billing }) {
  /** Item locado de um ativo, a partir do contrato atual dele. */
  async function linhaAtual(ativoCode) {
    const at = await repos.assets.get(ativoCode);
    if (!at) throw badRequest(`Ativo ${ativoCode} não encontrado.`);
    const c = at.U_CtrAtual ? await repos.contracts.get(at.U_CtrAtual) : null;
    const l = c?.[LN].find((x) => x.U_Ativo === at.Code && x.U_StatusL === 'LOC');
    if (!l) throw badRequest(`Ativo ${ativoCode} não está locado.`);
    return { at, c, l };
  }

  async function registerReading(req, { ativo, leitura, data, comp, abatimento = 0, origem = 'MAN' }) {
    const { at, c, l } = await linhaAtual(ativo);
    const fim = Number(leitura);
    const ini = Number(at.U_Medidor) || 0;
    if (!Number.isFinite(fim)) throw badRequest(`${ativo}: leitura inválida.`);
    if (fim < ini) throw badRequest(`${ativo}: leitura ${fim} menor que a última (${ini}).`);
    const abat = Math.max(0, Number(abatimento) || 0);
    data = d10(data) || hoje();
    comp = comp || compDe(data);
    if (!/^\d{6}$/.test(comp)) throw badRequest('Competência inválida.');
    const code = `${c.DocEntry}-${l.LineId}-${uid()}`;
    await repos.sl.batch([
      { method: 'POST', path: SET.MED, body: { Code: code, Name: code, U_CtrEntry: c.DocEntry, U_CtrLine: l.LineId, U_Ativo: at.Code, U_Comp: comp, U_Data: data,
        U_LeitIni: ini, U_LeitFim: fim, U_Abat: abat, U_Origem: origem } },
      { method: 'PATCH', path: `${SET.ATV}${key(at.Code)}`, body: { U_Medidor: fim, U_Versao: (Number(at.U_Versao) || 0) + 1 } },
    ]);
    audit.record(req, { action: 'leitura', entity: 'ativo', id: at.Code, after: { comp, ini, fim, abat } });
    return { ativo: at.Code, contrato: c.DocNum, uso: fim - ini - abat };
  }

  /** Importa leituras de planilha CSV: ativo;leitura;data[;abatimento]. Linhas com erro não impedem as demais. */
  async function importReadings(req, csv, comp) {
    const rows = String(csv || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (rows.length > 2000) throw badRequest('Envie no máximo 2.000 linhas por vez.');
    const out = [];
    for (const [i, row] of rows.entries()) {
      const [ativo, leitura, data, abat] = row.split(/[;,\t]/).map((s) => s.trim());
      if (i === 0 && /ativo/i.test(ativo)) continue; // cabeçalho
      const dataIso = /^\d{2}\/\d{2}\/\d{4}$/.test(data || '') ? data.split('/').reverse().join('-') : data;
      try {
        out.push({ linha: i + 1, ok: true, ...(await registerReading(req, { ativo, leitura: String(leitura).replace(',', '.'), data: dataIso, comp, abatimento: abat, origem: 'PLA' })) });
      } catch (e) {
        out.push({ linha: i + 1, ok: false, ativo, message: e.message });
      }
    }
    return out;
  }

  /** Contrato e item que estavam com o ativo numa data (para identificar o condutor da multa). */
  async function contractOnDate(ativo, data) {
    const ctrs = [...(await repos.contracts.open()), ...(await repos.contracts.billable())];
    for (const c of ctrs) {
      for (const l of c[LN] || []) {
        if (l.U_Ativo !== ativo || !l.U_DtSaida) continue;
        if (d10(l.U_DtSaida) <= data && (!l.U_DtDevol || d10(l.U_DtDevol) >= data)) return { c, l };
      }
    }
    return null;
  }

  async function createFine(req, input) {
    const at = await repos.assets.get(input.ativo);
    if (!at || at.U_Tipo !== 'VEI') throw badRequest('Escolha um veículo.');
    const data = d10(input.data);
    if (!data) throw badRequest('Informe a data da infração.');
    const valor = Number(input.valor);
    if (!(valor > 0)) throw badRequest('Informe o valor da multa.');
    const hit = await contractOnDate(at.Code, data);
    const code = `M-${uid()}`;
    const rec = { Code: code, Name: `AIT ${String(input.ait || '').slice(0, 30)}`, U_Ativo: at.Code, U_Placa: at.U_Placa || '', U_DtInfr: data,
      U_HrInfr: String(input.hora || '').slice(0, 5), U_AIT: String(input.ait || '').slice(0, 30), U_Descricao: String(input.descricao || '').slice(0, 100),
      U_Valor: valor, U_CtrEntry: hit ? hit.c.DocEntry : 0, U_CtrLine: hit ? hit.l.LineId : 0, U_CardName: hit ? hit.c.U_CardName : '',
      U_Condutor: hit ? hit.l.U_Condutor || '' : '', U_Status: 'PEN', U_Comp: '' };
    await repos.fines.create(rec);
    audit.record(req, { action: 'criar', entity: 'multa', id: code, after: rec });
    return rec;
  }

  async function setFineStatus(req, code, status) {
    const m = await repos.fines.get(code);
    if (!m) throw notFound('Multa');
    const ok = { PEN: ['IND', 'REP', 'PAG'], IND: ['REP', 'PAG'], REP: ['IND', 'PAG'] }[m.U_Status] || [];
    if (!ok.includes(status)) throw badRequest('Mudança de status não permitida para esta multa.');
    if (status === 'REP' && !m.U_CtrEntry) throw badRequest('Multa sem contrato identificado não pode ser repassada.');
    await repos.fines.patch(code, { U_Status: status });
    audit.record(req, { action: `status:${status}`, entity: 'multa', id: code, before: { U_Status: m.U_Status }, after: { U_Status: status } });
    return repos.fines.get(code);
  }

  /** Situação de cada ativo num período: disponível, reservado, locado, manutenção ou baixado. */
  async function availability({ ini, fim, familia, branches }) {
    ini = d10(ini) || hoje();
    fim = d10(fim) || addDias(ini, 30);
    if (fim < ini) throw badRequest('Período inválido.');
    const [assets, ctrs] = await Promise.all([repos.assets.all({ branches }), repos.contracts.open({ branches })]);
    const uso = new Map();
    for (const c of ctrs) {
      for (const l of c[LN] || []) {
        if (!l.U_Ativo || l.U_StatusL === 'DEV') continue;
        const inicio = d10(l.U_DtSaida) || d10(c.U_DtInicio);
        const termino = d10(l.U_DtDevol) || d10(c.U_DtFim) || '9999-12-31';
        if (inicio <= fim && termino >= ini) uso.set(l.U_Ativo, { contrato: c.DocNum, DocEntry: c.DocEntry, cliente: c.U_CardName, status: l.U_StatusL === 'LOC' ? 'LOC' : 'RES', ate: d10(c.U_DtFim) });
      }
    }
    return assets
      .filter((a) => !familia || a.U_Familia === familia)
      .map((a) => {
        const u = uso.get(a.Code);
        const status = a.U_Status === 'BAI' ? 'BAI' : a.U_Status === 'MAN' ? 'MAN' : u ? u.status : 'DIS';
        return { Code: a.Code, Name: a.Name, U_Tipo: a.U_Tipo, U_Familia: a.U_Familia, U_Placa: a.U_Placa, U_Serie: a.U_Serie, status, uso: u || null };
      });
  }

  async function dashboard({ branches }) {
    const comp = compDe(hoje());
    const [assets, ctrs, fat, multas] = await Promise.all([
      availability({ ini: hoje(), fim: hoje(), branches }), repos.contracts.open({ branches }), billing.list(comp, { branches }), repos.fines.list({}),
    ]);
    const ops = assets.filter((a) => a.status !== 'BAI');
    const cont = { DIS: 0, RES: 0, LOC: 0, MAN: 0 };
    ops.forEach((a) => (cont[a.status] = (cont[a.status] || 0) + 1));
    const familias = {};
    for (const a of ops) {
      const k = a.U_Familia || '(sem família)';
      familias[k] ||= { DIS: 0, RES: 0, LOC: 0, MAN: 0, total: 0 };
      familias[k][a.status]++;
      familias[k].total++;
    }
    const lim = addDias(hoje(), 30);
    const ativos = ctrs.filter((c) => c.U_Status === 'ATV');
    const abertas = multas.filter((m) => ['PEN', 'IND', 'REP'].includes(m.U_Status));
    return {
      comp,
      ativos: { total: ops.length, ...cont, ocupacao: ops.length ? cont.LOC / ops.length : 0 },
      contratosAtivos: ativos.length,
      vencendo: ativos.filter((c) => c.U_DtFim && d10(c.U_DtFim) <= lim).map((c) => ({ DocEntry: c.DocEntry, DocNum: c.DocNum, U_CardName: c.U_CardName, U_DtFim: c.U_DtFim }))
        .sort((a, b) => (d10(a.U_DtFim) < d10(b.U_DtFim) ? -1 : 1)),
      faturamento: {
        previsto: fat.filter((f) => f.situacao !== 'gerada').reduce((s, f) => s + f.total, 0),
        gerado: fat.filter((f) => f.situacao === 'gerada').reduce((s, f) => s + f.total, 0),
        atrasadas: fat.filter((f) => f.situacao === 'atrasada').length,
        vencendo: fat.filter((f) => f.situacao === 'vence').length,
      },
      multas: { quantidade: abertas.length, valor: abertas.reduce((s, m) => s + (Number(m.U_Valor) || 0), 0) },
      familias,
    };
  }

  return { registerReading, importReadings, createFine, setFineStatus, availability, dashboard, contractOnDate };
}
