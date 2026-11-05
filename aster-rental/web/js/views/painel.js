// Painel: frota, ocupação, faturamento do mês, multas e contratos vencendo.
import { esc, brl, num, fmtD, fmtDT, compFmt, SETA, DOM, badge } from '../util.js';
import { get } from '../api.js';

export async function render(root, _p, { go, can }) {
  const d = await get('/dashboard');
  const pv = can('chamados.ver') || can('os.ver') ? await get('/aftersales/dashboard').catch(() => null) : null;
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
  ${pv ? `<div class="card"><div class="row"><h2 style="margin:0">Pós-venda</h2><span class="spacer"></span>${can('chamados.ver') ? '<button type="button" class="mini" data-ir="chamados">Chamados</button>' : ''}
    ${can('os.ver') ? '<button type="button" class="mini" data-ir="agenda">Agenda</button><button type="button" class="mini" data-ir="preventivas">Preventivas</button>' : ''}</div>
    <div class="kpis" style="margin:10px 0">
      <div class="kpi ${pv.slaViolado ? 'alerta' : 'ok'}"><div class="l">Chamados em aberto</div><div class="v">${pv.chamadosAbertos}</div><div class="sub">${pv.slaViolado} com SLA estourado · ${pv.parados} equipamento(s) parado(s)</div></div>
      <div class="kpi"><div class="l">OS agendadas hoje</div><div class="v">${pv.osHoje}</div><div class="sub">${pv.osSemAgenda} sem agenda · ${pv.osAguardandoAprovacao} aguardando aprovação</div></div>
      <div class="kpi ${pv.preventivasVencidas ? 'atencao' : 'ok'}"><div class="l">Preventivas vencidas</div><div class="v">${pv.preventivasVencidas}</div><div class="sub">${pv.preventivasProximas} próximas</div></div>
      <div class="kpi"><div class="l">NPS (90 dias)</div><div class="v">${pv.nps ?? '—'}</div><div class="sub">${pv.respostas} resposta(s)</div></div></div>
    ${pv.urgentes.length ? `<div class="tbl"><table><thead><tr><th>Chamado</th><th>Cliente</th><th>Assunto</th><th>Prioridade</th><th>Solução até</th><th>SLA</th></tr></thead><tbody>
      ${pv.urgentes.map((t) => `<tr class="click" data-cha="${t.DocEntry}"><td>${SETA}${t.DocNum}</td><td>${esc(t.U_CardName)}</td><td>${t.U_Parado === 'S' ? '<span class="badge p-URG">PARADO</span> ' : ''}${esc(t.U_Assunto)}</td>
        <td>${badge(t.U_Prior, DOM.prioridade, 'p-')}</td><td>${fmtDT(t.U_PrazoSol)}</td><td>${badge(t.sla, DOM.sla, 's-')}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>` : ''}
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
    const ir = ev.target.closest('[data-ir]');
    if (ir) return go(ir.dataset.ir);
    const ch = ev.target.closest('[data-cha]');
    if (ch) return go('chamados', { id: ch.dataset.cha });
    const c = ev.target.closest('[data-ctr]');
    if (c && can('contratos.ver')) return go('contratos', { id: c.dataset.ctr });
    const f = ev.target.closest('[data-fam]');
    if (f && can('ativos.ver')) return go('disponibilidade', { familia: f.dataset.fam === '(sem família)' ? '' : f.dataset.fam });
  };
}
