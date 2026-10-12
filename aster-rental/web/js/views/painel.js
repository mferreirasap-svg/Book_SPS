// Painel: frota, ocupação, faturamento do mês, multas e contratos vencendo.
import { esc, brl, num, fmtD, compFmt, SETA } from '../util.js';
import { get } from '../api.js';

export async function render(root, _p, { go, can }) {
  const d = await get('/dashboard');
  const a = d.ativos;
  const fams = Object.entries(d.familias).sort();
  root.innerHTML = `
  <div class="kpis">
    <div class="kpi"><div class="l">Ativos em operação</div><div class="v">${a.total}</div><div class="sub">${a.DIS} disponíveis · ${a.RES} reservados</div></div>
    <div class="kpi"><div class="l">Taxa de ocupação</div><div class="v">${num(a.ocupacao * 100, 0)}%</div><div class="bar"><i style="width:${(a.ocupacao * 100).toFixed(1)}%"></i></div><div class="sub">${a.LOC} locados</div></div>
    <div class="kpi"><div class="l">Em manutenção</div><div class="v">${a.MAN}</div></div>
    <div class="kpi"><div class="l">Contratos ativos</div><div class="v">${d.contratosAtivos}</div></div>
    ${d.faturamento ? `<div class="kpi"><div class="l">A faturar em ${compFmt(d.comp)}</div><div class="v" style="font-size:19px">${brl(d.faturamento.previsto)}</div>
      <div class="sub">gerado: ${brl(d.faturamento.gerado)}${d.faturamento.atrasadas ? ` · <b style="color:#C25113">${d.faturamento.atrasadas} atrasada(s)</b>` : ''}${d.faturamento.vencendo ? ` · ${d.faturamento.vencendo} vencendo` : ''}</div></div>` : ''}
    <div class="kpi"><div class="l">Multas em aberto</div><div class="v">${d.multas.quantidade}</div><div class="sub">${brl(d.multas.valor)}</div></div>
  </div>
  <div class="card"><h2>Disponibilidade por família</h2><div class="tbl"><table><thead><tr><th>Família</th><th class="num">Disponível</th><th class="num">Reservado</th>
    <th class="num">Locado</th><th class="num">Manutenção</th><th class="num">Total</th></tr></thead><tbody>
    ${fams.map(([k, v]) => `<tr class="click" data-fam="${esc(k)}"><td>${SETA}${esc(k)}</td><td class="num">${v.DIS}</td><td class="num">${v.RES}</td><td class="num">${v.LOC}</td>
      <td class="num">${v.MAN}</td><td class="num"><b>${v.total}</b></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhum ativo.</td></tr>'}
  </tbody></table></div></div>
  <div class="card"><h2>Contratos vencendo em até 30 dias</h2><div class="tbl"><table><thead><tr><th>Contrato</th><th>Cliente</th><th>Fim da vigência</th></tr></thead><tbody>
    ${d.vencendo.map((c) => `<tr class="click" data-ctr="${c.DocEntry}"><td>${SETA}${c.DocNum}</td><td>${esc(c.U_CardName)}</td><td>${fmtD(c.U_DtFim)}</td></tr>`).join('')
      || '<tr><td colspan="3" class="empty">Nenhum contrato vencendo.</td></tr>'}
  </tbody></table></div></div>`;
  root.onclick = (ev) => {
    const c = ev.target.closest('[data-ctr]');
    if (c && can('contratos.ver')) return go('contratos', { id: c.dataset.ctr });
    const f = ev.target.closest('[data-fam]');
    if (f && can('ativos.ver')) return go('disponibilidade', { familia: f.dataset.fam === '(sem família)' ? '' : f.dataset.fam });
  };
}
