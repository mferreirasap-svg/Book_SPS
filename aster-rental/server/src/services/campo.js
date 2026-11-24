// Operação de campo e frota (versão 6):
//  - apontamento de horas do operador (mão de obra), com aprovação antes de valer no faturamento;
//  - documentação dos veículos (licenciamento, IPVA, seguro…) com calendário, alertas e esboço de conta a pagar no SAP;
//  - indicadores da manutenção (oficina): disponibilidade, custo por equipamento e por hora trabalhada, quebras.
import { LN, OS1, DOM, CFG_DEFAULTS } from '../b1/schema.js';
import { badRequest, notFound, d10, hoje, agora, addDias, difDias, compDe, round2, uid } from '../lib/util.js';
import { validarFoto } from '../lib/fotos.js';

const str = (v, n) => String(v ?? '').trim().slice(0, n);

export function createFieldService({ repos, audit }) {
  const sl = repos.sl;
  const cfg = async () => ({ ...CFG_DEFAULTS, ...(await repos.settings.all()) });

  /* ================= apontamento de horas do operador ================= */

  /** Linhas de mão de obra dos contratos ativos (para o lançamento). */
  async function linhasMO({ branches } = {}) {
    const out = [];
    for (const c of await repos.contracts.open({ branches })) {
      if (!['ATV', 'SUS'].includes(c.U_Status)) continue;
      for (const l of (c[LN] || []).filter((x) => x.U_TipoLinha === 'MO')) {
        out.push({ ctr: c.DocEntry, DocNum: c.DocNum, cliente: c.U_CardName, obra: c.U_Obra, linha: l.LineId, operador: l.U_Operador, maquina: l.U_Maquina,
          unid: l.U_UnidCobr, jornada: Number(l.U_Jornada) || 0, valor: l.U_Valor });
      }
    }
    return out;
  }

  async function apontar(req, input) {
    const c = await repos.contracts.get(input.ctr);
    if (!c || !['ATV', 'SUS'].includes(c.U_Status)) throw badRequest('Escolha um contrato ativo.');
    const l = c[LN].find((x) => Number(x.LineId) === Number(input.linha) && x.U_TipoLinha === 'MO');
    if (!l) throw badRequest('Escolha a linha de mão de obra do contrato.');
    const data = d10(input.data);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw badRequest('Informe a data.');
    if (data > hoje()) throw badRequest('Não é possível apontar horas de um dia futuro.');
    if (d10(c.U_DtInicio) && data < d10(c.U_DtInicio)) throw badRequest('Data anterior ao início do contrato.');
    const norm = round2(Number(String(input.hrNorm ?? 0).replace(',', '.')) || 0);
    let extra = round2(Number(String(input.hrExtra ?? 0).replace(',', '.')) || 0);
    if (norm < 0 || extra < 0 || norm + extra > 24) throw badRequest('Horas inválidas (no máximo 24 por dia).');
    if (!(norm + extra > 0)) throw badRequest('Informe as horas trabalhadas.');
    // Acima da jornada vira hora extra automaticamente.
    const jornada = Number(l.U_Jornada) || 0;
    let normais = norm;
    if (jornada && normais > jornada) {
      extra = round2(extra + normais - jornada);
      normais = jornada;
    }
    const dup = (await repos.appointments.list({ ctr: c.DocEntry, linha: l.LineId })).find((a) => d10(a.U_Data) === data && a.U_Situacao !== 'REC');
    if (dup) throw badRequest(`Já existe apontamento de ${data.split('-').reverse().join('/')} para este operador. Corrija o existente.`);
    const aprova = req.user.perms.includes('mo.aprovar');
    const code = `A-${uid()}`;
    const rec = { Code: code, Name: code, U_CtrEntry: c.DocEntry, U_CtrLine: l.LineId, U_Operador: l.U_Operador || '', U_Data: data, U_Comp: compDe(data),
      U_HrNorm: normais, U_HrExtra: extra, U_Obs: str(input.obs, 254), U_Situacao: aprova ? 'APR' : 'LAN', U_LancPor: req.user.login, U_AprPor: aprova ? req.user.login : '' };
    await repos.appointments.create(rec);
    audit.record(req, { action: 'apontar', entity: 'contrato', id: c.DocEntry, after: rec });
    return rec;
  }

  async function apontamentos({ comp, ctr, situacao } = {}) {
    const [rows, ops] = await Promise.all([repos.appointments.list({ comp, ctr, situacao }), repos.operators.all()]);
    const nome = Object.fromEntries(ops.map((o) => [o.Code, o.Name]));
    return rows.map((a) => ({ ...a, operadorNome: nome[a.U_Operador] || a.U_Operador }));
  }

  async function decidirApontamento(req, code, { acao, obs }) {
    const a = await repos.appointments.get(code);
    if (!a) throw notFound('Apontamento');
    if (a.U_Situacao !== 'LAN') throw badRequest('Este apontamento já foi decidido.');
    if (!['aprovar', 'recusar'].includes(acao)) throw badRequest('Ação inválida.');
    if (acao === 'recusar' && !str(obs, 254)) throw badRequest('Informe o motivo da recusa.');
    await repos.appointments.patch(code, { U_Situacao: acao === 'aprovar' ? 'APR' : 'REC', U_AprPor: req.user.login, ...(obs ? { U_Obs: str(obs, 254) } : {}) });
    audit.record(req, { action: `apontamento:${acao}`, entity: 'contrato', id: a.U_CtrEntry, after: { code, obs } });
    return repos.appointments.get(code);
  }

  /* ================= documentação dos veículos ================= */

  function situacaoDoc(d, alerta) {
    if (d.U_Status === 'PAG') return 'paga';
    if (d.U_Status === 'ISE') return 'isenta';
    const falta = difDias(hoje(), d10(d.U_Venc));
    if (falta < 0) return 'vencida';
    if (falta <= alerta) return 'vence';
    return 'em_dia';
  }

  async function documentos({ ativo, situacao } = {}) {
    const c0 = await cfg();
    const alerta = Number(c0.VEI_ALERTA_DIAS) || 30;
    const [rows, ativos] = await Promise.all([repos.vehicleDocs.list({ ativo }), repos.assets.all()]);
    const porCode = Object.fromEntries(ativos.map((a) => [a.Code, a]));
    return rows.map((d) => ({ ...d, U_Anexo: d.U_Anexo ? 'sim' : '', situacao: situacaoDoc(d, alerta), faltam: difDias(hoje(), d10(d.U_Venc)),
      veiculo: porCode[d.U_Ativo]?.Name || '', placa: porCode[d.U_Ativo]?.U_Placa || '' }))
      .filter((d) => !situacao || (situacao === 'pendentes' ? ['vencida', 'vence'].includes(d.situacao) : d.situacao === situacao));
  }

  async function documento(code) {
    const d = await repos.vehicleDocs.get(code);
    if (!d) throw notFound('Documento');
    return d;
  }

  async function criarDocumento(req, input) {
    const at = await repos.assets.get(str(input.ativo, 50));
    if (!at || at.U_Tipo !== 'VEI') throw badRequest('Escolha um veículo.');
    if (!DOM.tipoDocVei[input.tipo]) throw badRequest('Escolha a obrigação.');
    const venc = d10(input.venc);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(venc)) throw badRequest('Informe o vencimento.');
    const code = `D-${uid()}`;
    const rec = { Code: code, Name: `${at.Code} ${input.tipo} ${str(input.exercicio, 4) || venc.slice(0, 4)}`, U_Ativo: at.Code, U_Tipo: input.tipo,
      U_Exercicio: str(input.exercicio, 4) || venc.slice(0, 4), U_Venc: venc, U_Valor: round2(Number(input.valor) || 0), U_Status: 'PEN', U_DtPag: null, U_VlrPago: 0,
      U_Anexo: '', U_DocB1: 0, U_Obs: str(input.obs, 254) };
    await repos.vehicleDocs.create(rec);
    audit.record(req, { action: 'criar', entity: 'documento_veiculo', id: code, after: rec });
    return rec;
  }

  /** Gera licenciamento e IPVA do ano para todos os veículos, pelo calendário da UF e o final da placa. Não duplica. */
  async function gerarCalendario(req, ano) {
    ano = String(Number(ano) || Number(hoje().slice(0, 4)));
    const [ativos, cal, docs] = await Promise.all([repos.assets.all(), repos.calendar.all(), repos.vehicleDocs.list({})]);
    const criados = [];
    const semCal = [];
    for (const a of ativos.filter((x) => x.U_Tipo === 'VEI' && x.U_Status !== 'BAI')) {
      const final = String(a.U_Placa || '').slice(-1);
      const uf = a.U_UF || 'MG';
      const regra = cal.find((r) => r.U_UF === uf && r.U_Final === final);
      if (!regra) {
        semCal.push(a.Code);
        continue;
      }
      for (const [tipo, mes] of [['LIC', regra.U_MesLic], ['IPVA', regra.U_MesIPVA]]) {
        if (!Number(mes)) continue;
        if (docs.some((d) => d.U_Ativo === a.Code && d.U_Tipo === tipo && d.U_Exercicio === ano)) continue;
        const venc = `${ano}-${String(mes).padStart(2, '0')}-${final === '0' ? '30' : String(10 + Number(final)).padStart(2, '0')}`.replace(/-02-3\d$/, '-02-28');
        criados.push(await criarDocumento(req, { ativo: a.Code, tipo, exercicio: ano, venc, valor: 0, obs: 'Gerado pelo calendário — confira a data e o valor na guia.' }));
      }
    }
    return { criados: criados.length, semCalendario: semCal };
  }

  /** Registra o pagamento (com comprovante) e, se pedido, cria o esboço de nota de entrada de serviço no SAP para o financeiro. */
  async function pagarDocumento(req, code, input) {
    const d = await repos.vehicleDocs.get(code);
    if (!d) throw notFound('Documento');
    if (d.U_Status === 'PAG') throw badRequest('Já está pago.');
    const data = d10(input.data) || hoje();
    const valor = round2(Number(String(input.valor ?? d.U_Valor).replace(',', '.')) || 0);
    if (!(valor > 0)) throw badRequest('Informe o valor pago.');
    const anexo = input.anexo ? validarFoto(input.anexo).src : '';
    const patch = { U_Status: 'PAG', U_DtPag: data, U_VlrPago: valor, ...(anexo ? { U_Anexo: anexo } : {}) };
    let docB1 = null;
    if (input.gerarB1) {
      const c0 = await cfg();
      if (!c0.VEI_FORNECEDOR) throw badRequest('Configure o fornecedor das taxas de veículos (Integração SAP B1 › De-para).');
      const at = await repos.assets.get(d.U_Ativo);
      const r = await sl.request('POST', 'Drafts', { DocObjectCode: 'oPurchaseInvoices', DocType: 'dDocument_Service', CardCode: c0.VEI_FORNECEDOR, DocDate: data,
        DocDueDate: data, Comments: `${DOM.tipoDocVei[d.U_Tipo]} ${d.U_Exercicio} - ${d.U_Ativo} ${at?.U_Placa || ''}`.slice(0, 254), U_SPS_DocVei: d.Code,
        DocumentLines: [{ ItemDescription: `${DOM.tipoDocVei[d.U_Tipo]} ${d.U_Exercicio} - placa ${at?.U_Placa || d.U_Ativo}`.slice(0, 100), LineTotal: valor,
          ...(c0.VEI_CONTA ? { AccountCode: c0.VEI_CONTA } : {}), ...(at?.U_CCusto ? { [`CostingCode${Number(c0.OFI_DIM) > 1 ? Number(c0.OFI_DIM) : ''}`]: at.U_CCusto } : {}) }] });
      patch.U_DocB1 = r.DocNum;
      docB1 = r.DocNum;
    }
    await repos.vehicleDocs.patch(code, patch);
    audit.record(req, { action: 'pagar', entity: 'documento_veiculo', id: code, after: { data, valor, docB1 } });
    return { ...(await repos.vehicleDocs.get(code)), U_Anexo: anexo ? 'sim' : '', docB1 };
  }

  async function isentarDocumento(req, code, obs) {
    if (!(await repos.vehicleDocs.get(code))) throw notFound('Documento');
    await repos.vehicleDocs.patch(code, { U_Status: 'ISE', U_Obs: str(obs, 254) });
    audit.record(req, { action: 'isentar', entity: 'documento_veiculo', id: code, after: { obs } });
    return { ok: true };
  }

  /* ================= manutenção da frota: indicadores ================= */

  async function indicadoresManutencao({ meses = 12 } = {}) {
    const desde = addDias(hoje(), -30 * Number(meses || 12));
    const c0 = await cfg();
    const [ativos, ordens, leituras] = await Promise.all([repos.assets.all(), repos.orders.all({}), repos.readings.list({})]);
    const frota = ativos.filter((a) => a.U_Status !== 'BAI');
    const custoOS = (o) => round2((o[OS1] || []).reduce((s, i) => s + (Number(i.U_Qtd) || 0) * (Number(i.U_Preco) || 0), 0));
    const porAtivo = {};
    for (const a of frota) porAtivo[a.Code] = { ativo: a.Code, nome: a.Name, tipo: a.U_Tipo, familia: a.U_Familia, status: a.U_Status, custo: 0, quebras: 0, preventivas: 0, horas: 0, os: 0 };
    for (const o of ordens.filter((x) => x.U_Status === 'CON' && d10(x.U_CheckOut) >= desde)) {
      const p = porAtivo[o.U_Ativo];
      if (!p) continue;
      p.custo = round2(p.custo + custoOS(o));
      p.os++;
      if (['COR', 'REP', 'INT'].includes(o.U_Tipo)) p.quebras++;
      if (o.U_Tipo === 'PRE') p.preventivas++;
    }
    for (const m of leituras.filter((x) => (!x.U_Situacao || x.U_Situacao === 'CON') && d10(x.U_Data) >= desde)) {
      const p = porAtivo[m.U_Ativo];
      if (p) p.horas = round2(p.horas + Math.max(0, Number(m.U_LeitFim) - Number(m.U_LeitIni) - (Number(m.U_Abat) || 0)));
    }
    const lista = Object.values(porAtivo).map((p) => ({ ...p, custoHora: p.horas ? round2(p.custo / p.horas) : null, mtbf: p.quebras ? round2(p.horas / p.quebras) : null }));
    const emManut = frota.filter((a) => a.U_Status === 'MAN').map((a) => {
      const aberta = ordens.filter((o) => o.U_Ativo === a.Code && ['ABE', 'AGE', 'EXE', 'AOR'].includes(o.U_Status)).sort((x, y) => y.DocEntry - x.DocEntry)[0];
      const desdeDt = aberta ? d10(aberta.U_CheckIn) || d10(aberta.U_DtAgenda) || '' : '';
      return { ativo: a.Code, nome: a.Name, os: aberta ? { DocEntry: aberta.DocEntry, DocNum: aberta.DocNum, status: aberta.U_Status, tipo: aberta.U_Tipo } : null,
        dias: desdeDt ? Math.max(0, difDias(desdeDt, hoje())) : null };
    });
    const custoTotal = round2(lista.reduce((s, p) => s + p.custo, 0));
    const horasTotal = round2(lista.filter((p) => p.tipo === 'EQP').reduce((s, p) => s + p.horas, 0));
    return {
      meses: Number(meses || 12), custoHoraMecanico: Number(c0.OFI_CUSTO_HORA) || 0,
      disponibilidade: frota.length ? round2(((frota.length - emManut.length) / frota.length) * 100) : 100,
      frota: frota.length, emManutencao: emManut, custoTotal, osConcluidas: lista.reduce((s, p) => s + p.os, 0), quebras: lista.reduce((s, p) => s + p.quebras, 0),
      custoHoraFrota: horasTotal ? round2(lista.filter((p) => p.tipo === 'EQP').reduce((s, p) => s + p.custo, 0) / horasTotal) : null,
      maisCaros: [...lista].sort((a, b) => b.custo - a.custo).filter((p) => p.custo > 0).slice(0, 8),
      maisQuebras: [...lista].sort((a, b) => b.quebras - a.quebras).filter((p) => p.quebras > 0).slice(0, 8),
      ativos: lista,
    };
  }

  async function alertas() {
    const docs = await documentos({ situacao: 'pendentes' });
    return { veiculosVencidos: docs.filter((d) => d.situacao === 'vencida').length, veiculosVencendo: docs.filter((d) => d.situacao === 'vence').length,
      leiturasPendentes: (await repos.readings.list({ situacao: 'PEN' })).length, apontamentosPendentes: (await repos.appointments.list({ situacao: 'LAN' })).length,
      atualizado: agora() };
  }

  return { linhasMO, apontar, apontamentos, decidirApontamento, documentos, documento, criarDocumento, gerarCalendario, pagarDocumento, isentarDocumento,
    indicadoresManutencao, alertas };
}
