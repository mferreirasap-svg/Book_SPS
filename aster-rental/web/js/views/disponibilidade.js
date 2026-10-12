// Disponibilidade por período: quem está livre, reservado, locado ou em manutenção.
import { esc, fmtD, hoje, DOM, badge, SETA } from '../util.js';
import { get, qs } from '../api.js';
import { filtro } from '../state.js';

const addDias = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function render(root, params, { go, can }) {
  const f = filtro('disponibilidade', { ini: hoje(), fim: addDias(hoje(), 30), familia: '', status: '' });
  if (params.familia !== undefined) f.familia = params.familia;
  const [fams, rows] = await Promise.all([get('/families'), get(`/assets/availability${qs({ ini: f.ini, fim: f.fim, familia: f.familia })}`)]);
  const lista = rows.filter((r) => r.status !== 'BAI' && (!f.status || r.status === f.status));
  const cont = { DIS: 0, RES: 0, LOC: 0, MAN: 0 };
  lista.forEach((r) => cont[r.status]++);
  root.innerHTML = `<div class="card"><div class="toolbar">
    <div><label>De</label><input type="date" data-f="ini" value="${esc(f.ini)}"></div>
    <div><label>Até</label><input type="date" data-f="fim" value="${esc(f.fim)}"></div>
    <div><label>Família</label><select data-f="familia"><option value="">Todas</option>${fams.map((x) => `<option value="${esc(x.Code)}" ${f.familia === x.Code ? 'selected' : ''}>${esc(x.Name)}</option>`).join('')}</select></div>
    <div><label>Situação</label><select data-f="status"><option value="">Todas</option>${['DIS', 'RES', 'LOC', 'MAN'].map((k) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${DOM.statusAtivo[k]}</option>`).join('')}</select></div>
    <div class="sub" style="flex:1">${cont.DIS} disponível(is) · ${cont.RES} reservado(s) · ${cont.LOC} locado(s) · ${cont.MAN} em manutenção no período</div></div>
  <div class="tbl"><table><thead><tr><th>Ativo</th><th>Descrição</th><th>Família</th><th>Placa / série</th><th>Situação no período</th><th>Contrato</th><th>Até</th></tr></thead><tbody>
  ${lista.map((r) => `<tr ${r.uso ? `class="click" data-ctr="${r.uso.DocEntry}"` : ''}><td><b>${esc(r.Code)}</b></td><td>${esc(r.Name)}</td>
    <td>${esc(fams.find((x) => x.Code === r.U_Familia)?.Name || r.U_Familia || '')}</td><td>${esc(r.U_Placa || r.U_Serie || '')}</td><td>${badge(r.status, DOM.statusAtivo)}</td>
    <td>${r.uso ? `${SETA}${r.uso.contrato} · ${esc(r.uso.cliente)}` : ''}</td><td>${r.uso ? fmtD(r.uso.ate) : ''}</td></tr>`).join('')
    || '<tr><td colspan="7" class="empty">Nenhum ativo no filtro.</td></tr>'}
  </tbody></table></div></div>`;
  root.onchange = (ev) => {
    const k = ev.target.dataset.f;
    if (!k) return;
    f[k] = ev.target.value;
    render(root, {}, { go, can });
  };
  root.onclick = (ev) => {
    const t = ev.target.closest('[data-ctr]');
    if (t && can('contratos.ver')) go('contratos', { id: t.dataset.ctr });
  };
}
