// Agenda da equipe: semana por técnico, com as OS agendadas e a fila sem data.
import { esc, fmtD, DOM, badge, hoje } from '../util.js';
import { get, qs } from '../api.js';
import { filtro } from '../state.js';

const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const addDias = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const segunda = (s) => addDias(s, -((new Date(`${s}T00:00:00Z`).getUTCDay() + 6) % 7));

export async function render(root, _p, c) {
  const f = filtro('agenda', { ini: segunda(hoje()) });
  const fim = addDias(f.ini, 6);
  const [tecs, sem, semana] = await Promise.all([
    get('/technicians'), get(`/orders${qs({ status: 'ABE', size: 100 })}`), get(`/orders${qs({ de: f.ini, ate: fim, size: 200 })}`),
  ]);
  const dias = Array.from({ length: 7 }, (_, i) => addDias(f.ini, i));
  const ativos = tecs.filter((t) => t.U_Ativo !== 'N' && (c.can('os.todas') || semana.items.some((o) => o.U_Tecnico === t.Code)));
  const card = (o) => `<button type="button" class="os-card st-${o.U_Status} pr-${o.U_Prior}" data-id="${o.DocEntry}" title="${esc(o.U_Descricao || '')}">
    <b>${esc(o.U_HrAgenda || '')}</b> OS ${o.DocNum} · ${esc(DOM.tipoOS[o.U_Tipo])}<br>${esc(o.U_CardName)}<br><span class="muted">${esc(o.U_Ativo)} · ${esc(DOM.statusOS[o.U_Status])}</span></button>`;
  const doDia = (t, d) => semana.items.filter((o) => o.U_Tecnico === t && String(o.U_DtAgenda).slice(0, 10) === d && o.U_Status !== 'CAN')
    .sort((a, b) => (a.U_HrAgenda < b.U_HrAgenda ? -1 : 1));

  root.innerHTML = `<div class="card"><div class="toolbar">
    <button type="button" data-sem="-7">‹ Semana anterior</button><button type="button" data-sem="0">Esta semana</button><button type="button" data-sem="7">Próxima semana ›</button>
    <span class="spacer"></span><b>${fmtD(f.ini)} a ${fmtD(fim)}</b></div>
    <div class="tbl"><div class="agenda"><div class="h">Técnico</div>
      ${dias.map((d, i) => `<div class="h ${d === hoje() ? 'hoje' : ''}">${DIAS[i]} ${fmtD(d).slice(0, 5)}</div>`).join('')}
      ${ativos.map((t) => `<div class="tec">${esc(t.Name)}<small>${esc(t.U_Especial || '')}</small></div>${dias.map((d) => `<div>${doDia(t.Code, d).map(card).join('')}</div>`).join('')}`).join('')
        || '<div class="empty" style="grid-column:1/-1">Nenhum técnico cadastrado.</div>'}
    </div></div>
    <p class="sub">Clique na OS para abrir. Borda laranja: em execução ou aguardando aprovação; vermelha: urgente.</p></div>
  <div class="card"><h2>Fila sem agenda (${sem.items.length})</h2><div class="tbl"><table><thead><tr><th>OS</th><th>Tipo</th><th>Cliente</th><th>Equipamento</th><th>Prioridade</th><th>Problema</th></tr></thead><tbody>
    ${sem.items.map((o) => `<tr class="click" data-id="${o.DocEntry}"><td>${o.DocNum}</td><td>${esc(DOM.tipoOS[o.U_Tipo])}</td><td>${esc(o.U_CardName)}</td><td>${esc(o.U_Ativo)}</td>
      <td>${badge(o.U_Prior, DOM.prioridade, 'p-')}</td><td>${esc(String(o.U_Descricao || '').slice(0, 80))}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhuma OS aguardando agenda.</td></tr>'}
  </tbody></table></div></div>`;

  root.onclick = (ev) => {
    const s = ev.target.closest('[data-sem]');
    if (s) {
      f.ini = s.dataset.sem === '0' ? segunda(hoje()) : addDias(f.ini, Number(s.dataset.sem));
      return render(root, {}, c);
    }
    const o = ev.target.closest('[data-id]');
    if (o) c.go('os', { id: o.dataset.id });
  };
}
