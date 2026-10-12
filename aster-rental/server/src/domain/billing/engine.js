// Motor de cobrança do Áster Rental. Função pura: recebe contrato, regras, leituras, dias fora,
// multas e competência e devolve as linhas da parcela com a memória de cálculo de cada uma.
// Ordem de cálculo: competência faturável → dias no cliente → tolerância → pró-rata → mensalidade
// → franquia → uso → excedente → multas → arredondamento (2 casas por linha).
import { compRange, d10, addDias, maxD, minD, difDias, sobreposicao, round2, fmtD } from '../../lib/util.js';
import { LN, GR } from '../../b1/schema.js';

const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (n, d = 2) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

export const DEFAULT_RULE = { Code: '(padrão)', U_Tipo: 'ITEM', U_ProRata: 'LIN', U_FranqProp: 'S', U_Toler: 0, U_MesesNF: '', U_Tabela: '[]' };

export function parseRule(r = DEFAULT_RULE) {
  let tabela = [];
  try {
    tabela = JSON.parse(r.U_Tabela || '[]');
  } catch {
    tabela = [];
  }
  tabela = (Array.isArray(tabela) ? tabela : [])
    .map((f) => ({ ate: Number(f.ate), valor: Number(f.valor) }))
    .filter((f) => f.ate > 0 && f.valor >= 0)
    .sort((a, b) => a.ate - b.ate);
  const mesesNF = new Set(String(r.U_MesesNF || '').split(/[,;\s]+/).map(Number).filter((m) => m >= 1 && m <= 12));
  return {
    code: r.Code,
    tipo: r.U_Tipo || 'ITEM',
    proRata: r.U_ProRata || 'LIN',
    tabela,
    franqProp: r.U_FranqProp !== 'N',
    toler: Number(r.U_Toler) || 0,
    mesesNF,
  };
}

/** Período em que o item ficou com o cliente dentro da competência: da entrega à véspera da devolução. */
export function periodoNoCliente(contrato, linha, comp) {
  if (!linha.U_DtSaida) return null;
  const r = compRange(comp);
  const saida = d10(linha.U_DtSaida);
  const ultimo = linha.U_DtDevol ? maxD(saida, addDias(d10(linha.U_DtDevol), -1)) : '';
  const ini = maxD(r.ini, d10(contrato.U_DtInicio), saida, d10(contrato.U_DtCorte));
  const fim = minD(r.fim, d10(contrato.U_DtFim), ultimo);
  if (!ini || !fim || ini > fim) return null;
  return { ini, fim, dias: difDias(ini, fim) + 1, diasMes: r.dias };
}

function diasForaNoPeriodo(foras, linha, p) {
  return foras
    .filter((f) => Number(f.U_CtrLine) === Number(linha.LineId))
    .reduce((s, f) => s + sobreposicao(d10(f.U_Ini), d10(f.U_Fim) || p.fim, p.ini, p.fim), 0);
}

function usoNaCompetencia(leituras, lineId, comp) {
  return leituras
    .filter((m) => Number(m.U_CtrLine) === Number(lineId) && m.U_Comp === comp)
    .reduce((s, m) => s + Math.max(0, (Number(m.U_LeitFim) || 0) - (Number(m.U_LeitIni) || 0) - (Number(m.U_Abat) || 0)), 0);
}

/** Valor da mensalidade para `dias` cobráveis, conforme a forma de pró-rata da regra. */
export function valorPeriodo(rule, mensal, diaria, dias, diasMes) {
  mensal = Number(mensal) || 0;
  diaria = Number(diaria) || 0;
  if (dias >= diasMes) return { valor: mensal, memo: `Mês cheio: ${brl(mensal)}` };
  if (rule.proRata === 'PCT') {
    const faixa = rule.tabela.find((f) => dias <= f.ate);
    const pct = faixa ? faixa.valor : 100;
    return { valor: round2((mensal * pct) / 100), memo: `Tabela: ${dias} dias = ${num(pct, 0)}% de ${brl(mensal)}` };
  }
  if (rule.proRata === 'DIA') {
    const faixa = rule.tabela.find((f) => dias <= f.ate);
    const diarias = faixa ? faixa.valor : dias;
    const bruto = round2(diarias * diaria);
    const valor = mensal > 0 ? Math.min(bruto, mensal) : bruto;
    return { valor, memo: `${num(diarias, 0)} diárias × ${brl(diaria)} = ${brl(bruto)}${mensal > 0 && bruto > mensal ? `, limitado à mensalidade ${brl(mensal)}` : ''}` };
  }
  const valor = round2((mensal * dias) / diasMes);
  return { valor, memo: `Pró-rata linear: ${brl(mensal)} × ${dias} ÷ ${diasMes}` };
}

/**
 * Calcula a parcela de um contrato numa competência (AAAAMM).
 * @returns {{faturavel:boolean, motivo?:string, linhas:object[], avisos:string[], total:number}}
 */
export function calcularParcela({ contrato, regras = {}, leituras = [], foras = [], multas = [], comp, itemMulta = '' }) {
  const out = { faturavel: true, linhas: [], avisos: [], total: 0 };
  if (contrato.U_Tipo === 'COM') return { ...out, faturavel: false, motivo: 'Contrato de comodato não gera cobrança.' };
  const { mes, dias: diasMes } = compRange(comp);
  const regraDe = (code) => parseRule(regras[code] || (code ? undefined : DEFAULT_RULE) || DEFAULT_RULE);
  const linhas = contrato[LN] || [];
  const grupos = contrato[GR] || [];

  for (const l of linhas) {
    if (l.U_Grupo) continue;
    if (l.U_Regra && !regras[l.U_Regra]) out.avisos.push(`Regra de cobrança ${l.U_Regra} não encontrada; usada a regra padrão.`);
    const rule = regraDe(l.U_Regra);
    if (rule.tipo === 'SEM') continue;
    if (rule.mesesNF.has(mes)) continue;
    const p = periodoNoCliente(contrato, l, comp);
    if (!p) continue;
    const ref = `${l.U_Ativo || l.U_Familia}`;
    const memoria = [`No cliente de ${fmtD(p.ini)} a ${fmtD(p.fim)}: ${p.dias} dia(s) de ${diasMes}`];
    const fora = diasForaNoPeriodo(foras, l, p);
    const desconto = Math.max(0, fora - rule.toler);
    if (fora) memoria.push(`Fora do cliente ${fora} dia(s), tolerância ${rule.toler}: desconta ${desconto}`);
    const dias = Math.max(0, p.dias - desconto);
    if (!l.U_ItemCode) out.avisos.push(`${ref}: item de faturamento não informado.`);

    if (rule.tipo === 'ITEM' && dias > 0) {
      const v = valorPeriodo(rule, l.U_Valor, l.U_Diaria, dias, diasMes);
      memoria.push(v.memo);
      out.linhas.push({ tipo: 'LOC', lineId: l.LineId, ItemCode: l.U_ItemCode, qtd: 1, preco: round2(v.valor), total: round2(v.valor),
        desc: `Locação ${ref} ${l.U_AtvDesc || ''} ${fmtD(p.ini)} a ${fmtD(p.fim)}`.replace(/\s+/g, ' ').trim(), memoria: [...memoria] });
    }

    const franqBase = Number(l.U_Franquia) || 0;
    const franquia = round2(franqBase * (rule.franqProp ? Math.min(1, dias / diasMes) : 1));
    const uso = round2(usoNaCompetencia(leituras, l.LineId, comp));
    const preco = Number(l.U_VlrExced) || 0;
    if (rule.tipo === 'CONS') {
      const qtd = round2(Math.max(0, uso - franquia));
      if (qtd > 0 && preco > 0) {
        out.linhas.push({ tipo: 'CONS', lineId: l.LineId, ItemCode: l.U_ItemCode, qtd, preco, total: round2(qtd * preco),
          desc: `Consumo ${ref}: ${num(qtd, 2)} × ${brl(preco)}`, memoria: [...memoria, `Uso ${num(uso)} − franquia ${num(franquia)} = ${num(qtd)}`] });
      }
    } else if (rule.tipo === 'ITEM' && franqBase > 0 && preco > 0 && uso > franquia) {
      const qtd = round2(uso - franquia);
      out.linhas.push({ tipo: 'EXC', lineId: l.LineId, ItemCode: l.U_ItemCode, qtd, preco, total: round2(qtd * preco),
        desc: `Excedente ${ref}: uso ${num(uso, 1)}, franquia ${num(franquia, 1)}`,
        memoria: [`Franquia ${num(franqBase)}${rule.franqProp && dias < diasMes ? ` × ${dias}/${diasMes} = ${num(franquia)}` : ''}`,
          `Uso ${num(uso)} − franquia ${num(franquia)} = ${num(qtd)} × ${brl(preco)}`] });
    }
  }

  for (const g of grupos) {
    const membros = linhas.filter((l) => l.U_Grupo && l.U_Grupo === g.U_Grupo);
    if (g.U_Regra && !regras[g.U_Regra]) out.avisos.push(`Regra de cobrança ${g.U_Regra} não encontrada; usada a regra padrão.`);
    const rule = regraDe(g.U_Regra);
    if (rule.tipo === 'SEM' || rule.mesesNF.has(mes) || !membros.length) continue;
    // Dias em que ao menos um equipamento do grupo estava com o cliente.
    const ativos = new Array(diasMes + 1).fill(false);
    const usos = [];
    for (const l of membros) {
      const p = periodoNoCliente(contrato, l, comp);
      if (!p) continue;
      for (let d = Number(p.ini.slice(8)); d <= Number(p.fim.slice(8)); d++) ativos[d] = true;
      usos.push({ l, uso: round2(usoNaCompetencia(leituras, l.LineId, comp)) });
    }
    const dias = ativos.filter(Boolean).length;
    if (!dias) continue;
    if (!g.U_ItemCode) out.avisos.push(`Grupo ${g.U_Grupo}: item de faturamento não informado.`);
    const v = valorPeriodo(rule, g.U_Valor, g.U_Diaria, dias, diasMes);
    out.linhas.push({ tipo: 'GRP', grupo: g.U_Grupo, ItemCode: g.U_ItemCode, qtd: 1, preco: round2(v.valor), total: round2(v.valor),
      desc: `Locação ${g.U_Descr || `grupo ${g.U_Grupo}`}: ${usos.length} equipamento(s)`,
      memoria: [`Grupo com equipamento no cliente em ${dias} de ${diasMes} dias`, v.memo] });
    const franqBase = Number(g.U_Franquia) || 0;
    const franquia = round2(franqBase * (rule.franqProp ? Math.min(1, dias / diasMes) : 1));
    const usoTotal = round2(usos.reduce((s, u) => s + u.uso, 0));
    const preco = Number(g.U_VlrExced) || 0;
    const qtd = round2(Math.max(0, usoTotal - franquia));
    if (preco > 0 && qtd > 0 && (rule.tipo === 'CONS' || franqBase > 0)) {
      const total = round2(qtd * preco);
      // Rateio do excedente por uso, só para o extrato. O último leva a diferença de arredondamento.
      let acumulado = 0;
      const rateio = usos.map((u, i) => {
        const parte = i === usos.length - 1 ? round2(total - acumulado) : round2((total * u.uso) / (usoTotal || 1));
        acumulado = round2(acumulado + parte);
        return { ativo: u.l.U_Ativo, uso: u.uso, valor: parte };
      });
      out.linhas.push({ tipo: 'EXC', grupo: g.U_Grupo, ItemCode: g.U_ItemCode, qtd, preco, total,
        desc: `Excedente ${g.U_Descr || `grupo ${g.U_Grupo}`}: uso ${num(usoTotal, 0)}, franquia ${num(franquia, 0)}`,
        memoria: [`Uso total ${num(usoTotal)} − franquia ${num(franquia)} = ${num(qtd)} × ${brl(preco)}`,
          ...rateio.map((r) => `${r.ativo}: uso ${num(r.uso)} → ${brl(r.valor)}`)], rateio });
    }
  }

  for (const m of multas.filter((x) => x.U_Status === 'REP' && Number(x.U_CtrEntry) === Number(contrato.DocEntry))) {
    if (!itemMulta) out.avisos.push('Parâmetro "Item para repasse de multa" não configurado.');
    out.linhas.push({ tipo: 'MUL', multa: m.Code, ItemCode: itemMulta, qtd: 1, preco: round2(m.U_Valor), total: round2(m.U_Valor),
      desc: `Repasse de multa AIT ${m.U_AIT || ''} ${m.U_Placa || ''} ${fmtD(m.U_DtInfr)}`.trim(), memoria: [`Multa de ${fmtD(m.U_DtInfr)} com status "a repassar"`] });
  }

  out.avisos = [...new Set(out.avisos)];
  out.total = round2(out.linhas.reduce((s, x) => s + x.total, 0));
  if (!out.linhas.length) {
    out.faturavel = false;
    out.motivo = 'Nada a cobrar nesta competência.';
  }
  return out;
}
