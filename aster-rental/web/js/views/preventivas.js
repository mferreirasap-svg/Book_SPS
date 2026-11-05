// Manutenção preventiva: vencidas e próximas pelo horímetro/hodômetro e pelo calendário, com geração da OS.
import { $, esc, num, fmtD, UN, DOM, badge, toast, modal, closeModal, msg, hoje } from '../util.js';
import { get, post } from '../api.js';
import { filtro } from '../state.js';

export async function render(root, _p, c) {
  const f = filtro('preventivas', { status: 'pendentes' });
  const lista = await get('/preventive');
  const vis = lista.filter((p) => (f.status === 'pendentes' ? p.status !== 'ok' : !f.status || p.status === f.status));
  const cont = { vencida: 0, proxima: 0, ok: 0 };
  lista.forEach((p) => cont[p.status]++);
  const usado = (p) => {
    if (p.proxMed == null) return null;
    const base = p.ultima?.medidor || 0;
    const tot = p.proxMed - base;
    return tot > 0 ? Math.min(100, Math.max(0, ((p.medidor - base) / tot) * 100)) : 0;
  };
  root.innerHTML = `<div class="kpis">
    <div class="kpi alerta"><div class="l">Vencidas</div><div class="v">${cont.vencida}</div></div>
    <div class="kpi atencao"><div class="l">Próximas</div><div class="v">${cont.proxima}</div></div>
    <div class="kpi ok"><div class="l">Em dia</div><div class="v">${cont.ok}</div></div></div>
  <div class="card"><div class="toolbar"><div><label>Mostrar</label><select id="pvSt">
    <option value="pendentes" ${f.status === 'pendentes' ? 'selected' : ''}>Vencidas e próximas</option><option value="vencida" ${f.status === 'vencida' ? 'selected' : ''}>Vencidas</option>
    <option value="proxima" ${f.status === 'proxima' ? 'selected' : ''}>Próximas</option><option value="" ${f.status === '' ? 'selected' : ''}>Todas</option></select></div></div>
  <p class="sub">Calculado com a leitura atual do equipamento (as leituras mensais e as movimentações atualizam) e a última preventiva concluída do plano. Planos por família em Pós-venda › Técnicos e planos.</p>
  <div class="tbl"><table><thead><tr><th>Equipamento</th><th>Plano</th><th>Onde está</th><th class="num">Leitura atual</th><th>Última</th><th>Próxima</th><th>Uso do intervalo</th><th>Situação</th><th></th></tr></thead><tbody>
  ${vis.map((p) => {
    const u = usado(p);
    const un = UN(p.tipo);
    return `<tr><td><b>${esc(p.ativo)}</b> ${esc(p.nome)}</td><td>${esc(p.planoNome)}</td>
      <td>${p.contrato ? `no cliente · <a href="#/contratos?id=${p.contrato}">contrato ${p.contrato}</a>` : esc(DOM.statusAtivo[p.statusAtivo] || '')}</td>
      <td class="num">${num(p.medidor, 0)} ${un}</td>
      <td>${p.ultima ? `${fmtD(p.ultima.data)} · ${num(p.ultima.medidor, 0)} ${un}` : '<span class="muted" title="Sem preventiva registrada: considera o último múltiplo do intervalo">sem registro (estimada)</span>'}</td>
      <td>${p.proxMed != null ? `${num(p.proxMed, 0)} ${un}${p.faltaMed != null ? ` <span class="sub">(${p.faltaMed > 0 ? `faltam ${num(p.faltaMed, 0)}` : `passou ${num(-p.faltaMed, 0)}`})</span>` : ''}` : ''}
        ${p.proxData ? `<br>${fmtD(p.proxData)} <span class="sub">(${p.faltaDias >= 0 ? `${p.faltaDias} dias` : `${-p.faltaDias} dias atrás`})</span>` : ''}</td>
      <td style="min-width:120px">${u != null ? `<div class="bar"><i style="width:${u.toFixed(0)}%;background:${p.status === 'vencida' ? 'var(--coral)' : p.status === 'proxima' ? 'var(--arrow)' : 'var(--teal)'}"></i></div><span class="sub">${u.toFixed(0)}%</span>` : '—'}</td>
      <td>${badge(p.status, DOM.prev, 'v-')}</td>
      <td class="right">${p.aberta ? `<a href="#/os?id=${p.aberta.DocEntry}">OS ${p.aberta.DocNum}</a> ${badge(p.aberta.U_Status, DOM.statusOS)}`
        : c.can('os.editar') ? `<button type="button" class="mini primary" data-gerar="${esc(p.ativo)}" data-plano="${esc(p.plano)}" data-nome="${esc(`${p.ativo} — ${p.planoNome}`)}">Gerar OS</button>` : ''}</td></tr>`;
  }).join('') || '<tr><td colspan="9" class="empty">Nada a mostrar.</td></tr>'}</tbody></table></div></div>`;

  root.onchange = (ev) => {
    if (ev.target.id === 'pvSt') {
      f.status = ev.target.value;
      render(root, {}, c);
    }
  };
  root.onclick = async (ev) => {
    const b = ev.target.closest('[data-gerar]');
    if (!b) return;
    const tecs = (await get('/technicians')).filter((t) => t.U_Ativo !== 'N');
    const m = modal(`<h2>Preventiva — ${esc(b.dataset.nome)}</h2><div class="grid">
      <div class="span2"><label>Técnico</label><select id="pvTec"><option value="">(agendar depois)</option>${tecs.map((t) => `<option value="${esc(t.Code)}">${esc(t.Name)}</option>`).join('')}</select></div>
      <div><label>Data</label><input type="date" id="pvData" value="${hoje()}"></div><div><label>Hora</label><input type="time" id="pvHora" value="08:00"></div></div>
      <p class="sub">A OS já vem com o checklist do plano.</p><div id="pvMsg"></div>
      <div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="primary" data-x="1">Gerar OS</button></div>`);
    m.onclick = async (e2) => {
      const x = e2.target.closest('[data-x]');
      if (!x) return;
      if (x.dataset.x === '0') return closeModal();
      try {
        const r = await post('/preventive/order', { ativo: b.dataset.gerar, plano: b.dataset.plano, tecnico: $('#pvTec').value, data: $('#pvTec').value ? $('#pvData').value : '', hora: $('#pvHora').value });
        closeModal();
        toast(`OS ${r.DocNum} gerada.`);
        render(root, {}, c);
      } catch (err) {
        msg('#pvMsg', 'err', err.message);
      }
    };
  };
}
