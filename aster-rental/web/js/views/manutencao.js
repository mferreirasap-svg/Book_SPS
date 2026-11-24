// Manutenção da frota (oficina própria): o que está parado, quanto custa cada equipamento e quem quebra mais.
// As peças baixam do estoque da oficina e os serviços de terceiros viram pedido de compra no SAP B1, com o centro de custo do equipamento.
import { $, esc, brl, num, DOM, badge, toast, acao, modal, closeModal, SETA } from '../util.js';
import { get, post } from '../api.js';

export async function render(root, _p, c) {
  const d = await get('/maintenance/indicators?meses=12');
  const podeOS = c.can('os.editar');
  root.innerHTML = `<div class="kpis">
    <div class="kpi ${d.disponibilidade < 90 ? 'atencao' : 'ok'}"><div class="l">Disponibilidade da frota</div><div class="v">${num(d.disponibilidade, 1)}%</div><div class="bar"><i style="width:${d.disponibilidade}%"></i></div><div class="sub">${d.emManutencao.length} de ${d.frota} em manutenção</div></div>
    <div class="kpi"><div class="l">Custo de manutenção (12 meses)</div><div class="v" style="font-size:19px">${brl(d.custoTotal)}</div><div class="sub">${d.osConcluidas} OS concluída(s)</div></div>
    <div class="kpi"><div class="l">Custo por hora trabalhada</div><div class="v" style="font-size:19px">${d.custoHoraFrota != null ? brl(d.custoHoraFrota) : '—'}</div><div class="sub">máquinas, pelo horímetro conferido</div></div>
    <div class="kpi"><div class="l">Quebras (corretivas)</div><div class="v">${d.quebras}</div></div></div>
  <div class="card"><div class="row"><h2 style="margin:0">Na oficina agora</h2><span class="spacer"></span>${podeOS ? '<button type="button" class="primary" data-a="nova">+ OS interna</button>' : ''}</div>
    <div class="tbl"><table><thead><tr><th>Equipamento</th><th>OS</th><th>Situação</th><th class="num">Dias parado</th></tr></thead><tbody>
    ${d.emManutencao.map((m) => `<tr ${m.os ? `class="click" data-os="${m.os.DocEntry}"` : ''}><td>${m.os ? SETA : ''}<b>${esc(m.ativo)}</b> <span class="sub">${esc(m.nome)}</span></td>
      <td>${m.os ? `nº ${m.os.DocNum} · ${esc(DOM.tipoOS[m.os.tipo] || '')}` : '<span class="badge b-MAN">sem OS</span>'}</td><td>${m.os ? badge(m.os.status, DOM.statusOS) : ''}</td>
      <td class="num">${m.dias ?? '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nenhum equipamento em manutenção.</td></tr>'}</tbody></table></div>
    <p class="sub">Ao mudar o status de um ativo para "Manutenção", a OS interna é aberta automaticamente.</p></div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px">
  <div class="card"><h2>Maiores custos</h2><div class="tbl"><table><thead><tr><th>Equipamento</th><th class="num">Custo</th><th class="num">Uso</th><th class="num">Custo/uso</th></tr></thead><tbody>
    ${d.maisCaros.map((p) => `<tr><td><b>${esc(p.ativo)}</b> <span class="sub">${esc(p.nome)}</span></td><td class="num">${brl(p.custo)}</td><td class="num">${num(p.horas, 0)} ${p.tipo === 'VEI' ? 'km' : 'h'}</td>
      <td class="num">${p.custoHora != null ? brl(p.custoHora) : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sem custos no período.</td></tr>'}</tbody></table></div></div>
  <div class="card"><h2>Mais quebras</h2><div class="tbl"><table><thead><tr><th>Equipamento</th><th class="num">Quebras</th><th class="num">Preventivas</th><th class="num" title="Uso médio entre quebras (MTBF)">Uso/quebra</th></tr></thead><tbody>
    ${d.maisQuebras.map((p) => `<tr><td><b>${esc(p.ativo)}</b> <span class="sub">${esc(p.nome)}</span></td><td class="num">${p.quebras}</td><td class="num">${p.preventivas}</td>
      <td class="num">${p.mtbf != null ? `${num(p.mtbf, 0)} ${p.tipo === 'VEI' ? 'km' : 'h'}` : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nenhuma quebra no período.</td></tr>'}</tbody></table></div></div></div>`;

  root.onclick = async (ev) => {
    const os = ev.target.closest('[data-os]');
    if (os) return c.go('os', { id: os.dataset.os });
    const b = ev.target.closest('button');
    if (b?.dataset.a !== 'nova') return;
    const [ativos, tecs] = await Promise.all([get('/assets?size=200'), get('/technicians')]);
    const m = modal(`<h2>OS interna (oficina)</h2><div class="grid">
      <div><label>Equipamento</label><select id="iAtv">${ativos.items.filter((a) => a.U_Status !== 'BAI').map((a) => `<option value="${esc(a.Code)}">${esc(a.Code)} — ${esc(a.Name)} (${esc(DOM.statusAtivo[a.U_Status])})</option>`).join('')}</select></div>
      <div><label>Mecânico</label><select id="iTec"><option value="">A definir</option>${tecs.filter((t) => t.U_Ativo !== 'N').map((t) => `<option value="${esc(t.Code)}">${esc(t.Name)}</option>`).join('')}</select></div></div>
      <label>O que fazer</label><textarea id="iDesc" maxlength="2000" placeholder="Ex.: revisão geral antes da próxima locação"></textarea>
      <p class="sub">Equipamento disponível no pátio passa para "Manutenção" até a OS ser concluída.</p>
      <div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="primary" data-x="1">Abrir OS</button></div>`);
    m.onclick = async (e) => {
      const x = e.target.closest('[data-x]');
      if (!x) return;
      if (x.dataset.x === '0') return closeModal();
      await acao(async () => {
        const r = await post('/orders', { tipo: 'INT', ativo: $('#iAtv').value, tecnico: $('#iTec').value, descricao: $('#iDesc').value, prior: 'MED' });
        closeModal();
        toast(`OS interna nº ${r.DocNum} aberta.`);
        c.go('os', { id: r.DocEntry });
      });
    };
  };
}
