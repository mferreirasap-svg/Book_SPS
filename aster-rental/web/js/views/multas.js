// Multas de trânsito: registro com identificação automática do contrato e do condutor, e tratamento.
import { $, esc, brl, fmtD, compFmt, DOM, badge, options, toast, acao, modal, closeModal, msg, debounce, SEARCH } from '../util.js';
import { get, post, qs } from '../api.js';
import { filtro } from '../state.js';

const ACOES = { PEN: [['IND', 'Condutor indicado'], ['REP', 'Repassar ao cliente'], ['PAG', 'Paga pela locadora']],
  IND: [['REP', 'Repassar ao cliente'], ['PAG', 'Paga pela locadora']], REP: [['IND', 'Voltar p/ indicado'], ['PAG', 'Paga pela locadora']] };

export async function render(root, _p, c) {
  const f = filtro('multas', { status: '', q: '' });
  const lista = await get(`/fines${qs(f)}`);
  const ed = c.can('multas.editar');
  root.innerHTML = `<div class="card"><div class="toolbar">
    <div><label>Status</label><select id="st">${options(DOM.statusMulta, f.status, { vazio: 'Todos' })}</select></div>
    <div style="flex:1" class="search"><label>Buscar</label>${SEARCH}<input id="q" value="${esc(f.q)}" placeholder="placa, AIT, cliente"></div>
    ${ed ? '<button type="button" class="primary" data-a="nova">+ Nova multa</button>' : ''}</div>
  <p class="sub">A multa é ligada ao contrato e ao condutor que estavam com o veículo na data da infração. "A repassar" entra no próximo faturamento do contrato.</p>
  <div class="tbl"><table><thead><tr><th>Data</th><th>Placa</th><th>AIT</th><th>Descrição</th><th class="num">Valor</th><th>Contrato / cliente</th><th>Condutor</th><th>Status</th><th></th></tr></thead><tbody>
  ${lista.map((m) => `<tr><td>${fmtD(m.U_DtInfr)} ${esc(m.U_HrInfr)}</td><td>${esc(m.U_Placa)}</td><td>${esc(m.U_AIT)}</td><td>${esc(m.U_Descricao)}</td><td class="num">${brl(m.U_Valor)}</td>
    <td>${m.U_CtrEntry ? `${m.U_CtrEntry} · ${esc(m.U_CardName)}` : '<span class="muted">não identificado</span>'}</td><td>${esc(m.U_Condutor)}</td>
    <td>${badge(m.U_Status, DOM.statusMulta)}${m.U_Comp ? ` <span class="sub">${compFmt(m.U_Comp)}</span>` : ''}</td>
    <td class="right" style="white-space:nowrap">${ed ? (ACOES[m.U_Status] || []).filter(([s]) => s !== 'REP' || m.U_CtrEntry).map(([s, t]) => `<button type="button" class="mini" data-st="${s}" data-code="${esc(m.Code)}">${t}</button>`).join('') : ''}</td></tr>`).join('')
    || '<tr><td colspan="9" class="empty">Nenhuma multa.</td></tr>'}</tbody></table></div></div>`;

  const reload = () => render(root, {}, c);
  root.onchange = (ev) => {
    if (ev.target.id === 'st') {
      f.status = ev.target.value;
      reload();
    }
  };
  root.oninput = debounce((ev) => {
    if (ev.target.id === 'q') {
      f.q = ev.target.value;
      reload();
    }
  }, 400);
  root.onclick = async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.a === 'nova') return nova(reload);
    if (b.dataset.st) {
      await acao(async () => {
        await post(`/fines/${encodeURIComponent(b.dataset.code)}/status`, { status: b.dataset.st });
        toast('Multa atualizada.');
        reload();
      });
    }
  };
}

async function nova(reload) {
  const veics = (await get('/assets?tipo=VEI&size=200')).items;
  const m = modal(`<h2>Nova multa</h2><div class="grid">
    <div class="span2"><label>Veículo</label><select id="muAtv"><option value="">Selecione…</option>${veics.map((a) => `<option value="${esc(a.Code)}">${esc(a.U_Placa)} — ${esc(a.Name)}</option>`).join('')}</select></div>
    <div><label>Data da infração</label><input type="date" id="muData"></div><div><label>Hora</label><input type="time" id="muHora"></div>
    <div><label>Auto de infração (AIT)</label><input id="muAit" maxlength="30"></div><div><label>Valor (R$)</label><input type="number" min="0" step="0.01" id="muVal"></div>
    <div class="span2"><label>Descrição</label><input id="muDesc" maxlength="100"></div></div><div id="muInfo"></div>
    <div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="primary" data-x="1">Salvar</button></div>`);
  const ver = async () => {
    const a = $('#muAtv').value;
    const d = $('#muData').value;
    if (!a || !d) return msg('#muInfo', '', '');
    const r = await get(`/fines/lookup${qs({ ativo: a, data: d })}`).catch(() => null);
    msg('#muInfo', r ? 'ok' : 'warn', r ? `Contrato ${r.DocNum} — ${r.U_CardName}${r.U_Condutor ? ` — condutor: ${r.U_Condutor}` : ''}` : 'Nenhum contrato com este veículo na data. A multa fica com a locadora.');
  };
  m.onchange = (ev) => ['muAtv', 'muData'].includes(ev.target.id) && ver();
  m.onclick = async (ev) => {
    const b = ev.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === '0') return closeModal();
    try {
      await post('/fines', { ativo: $('#muAtv').value, data: $('#muData').value, hora: $('#muHora').value, ait: $('#muAit').value, valor: $('#muVal').value, descricao: $('#muDesc').value });
      closeModal();
      toast('Multa registrada.');
      reload();
    } catch (e) {
      msg('#muInfo', 'err', e.message);
    }
  };
}
