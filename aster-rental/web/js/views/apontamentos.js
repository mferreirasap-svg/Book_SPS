// Horas do operador (mão de obra no contrato): lançamento diário e aprovação. Só o aprovado entra no faturamento.
import { $, esc, num, fmtD, DOM, badge, toast, acao, modal, closeModal, compAtual, compToMonth, monthToComp, compFmt, hoje } from '../util.js';
import { get, post, qs } from '../api.js';
import { filtro } from '../state.js';

export async function render(root, _p, c) {
  const f = filtro('apontamentos', { comp: compAtual(), situacao: '' });
  const lanca = c.can('mo.apontar');
  const aprova = c.can('mo.aprovar');
  const [linhas, rows] = await Promise.all([get('/timesheet/lines'), get(`/timesheet${qs({ comp: f.comp, situacao: f.situacao })}`)]);
  const ops = Object.fromEntries((await get('/operators')).map((o) => [o.Code, o.Name]));
  const linhaDe = (a) => linhas.find((l) => l.ctr === a.U_CtrEntry && l.linha === a.U_CtrLine);
  const tot = rows.filter((a) => a.U_Situacao !== 'REC').reduce((s, a) => ({ n: s.n + Number(a.U_HrNorm), x: s.x + Number(a.U_HrExtra) }), { n: 0, x: 0 });
  const pend = rows.filter((a) => a.U_Situacao === 'LAN').length;
  root.innerHTML = `${lanca ? `<div class="card"><h2>Lançar horas do dia</h2>
    ${linhas.length ? `<div class="grid">
      <div style="grid-column:span 2"><label>Operador / contrato</label><select id="aLinha">${linhas.map((l, i) => `<option value="${i}">${esc(ops[l.operador] || l.operador || 'Operador')} — contrato ${l.DocNum} · ${esc(l.cliente)}${l.maquina ? ` · ${esc(l.maquina)}` : ''}</option>`).join('')}</select></div>
      <div><label>Data</label><input type="date" id="aData" value="${hoje()}" max="${hoje()}"></div>
      <div><label>Horas normais</label><input type="number" id="aNorm" step="0.5" min="0" max="24" inputmode="decimal"></div>
      <div><label>Horas extras</label><input type="number" id="aExtra" step="0.5" min="0" max="24" value="0" inputmode="decimal"></div>
      <div style="grid-column:span 2"><label>Observação</label><input id="aObs" maxlength="200" placeholder="Ex.: chuva parou a obra às 15h"></div></div>
      <p class="sub" id="aInfo"></p>
      <div class="dlg-actions"><button type="button" class="primary" data-a="lancar">Lançar</button></div>`
    : '<p class="empty">Nenhum contrato ativo com mão de obra. Inclua a linha "Mão de obra (operador)" no contrato.</p>'}</div>` : ''}
  <div class="card"><div class="toolbar"><div><label>Competência</label><input type="month" id="comp" value="${compToMonth(f.comp)}"></div>
    <div><label>Situação</label><select id="sit"><option value="">Todas</option>${Object.entries(DOM.situacaoApo).map(([k, v]) => `<option value="${k}" ${f.situacao === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="sub" style="flex:1">${compFmt(f.comp)}: <b>${num(tot.n, 1)} h</b> normais e <b>${num(tot.x, 1)} h</b> extras${pend ? ` · <b style="color:#C25113">${pend} a aprovar</b> (o faturamento do contrato fica travado até aprovar)` : ''}</div>
    ${aprova && pend ? '<button type="button" data-a="aprovarTodos">Aprovar todos os pendentes</button>' : ''}</div>
  <div class="tbl"><table><thead><tr><th>Data</th><th>Operador</th><th>Contrato</th><th>Máquina</th><th class="num">Normais</th><th class="num">Extras</th><th>Situação</th><th>Lançado por</th><th>Obs.</th><th></th></tr></thead><tbody>
  ${rows.sort((a, b) => (a.U_Data < b.U_Data ? 1 : -1)).map((a) => {
    const l = linhaDe(a);
    return `<tr><td>${fmtD(a.U_Data)}</td><td>${esc(a.operadorNome || '')}</td><td>${a.U_CtrEntry}${l ? ` <span class="sub">${esc(l.cliente)}</span>` : ''}</td><td>${esc(l?.maquina || '')}</td>
      <td class="num">${num(a.U_HrNorm, 1)}</td><td class="num">${num(a.U_HrExtra, 1)}</td><td>${badge(a.U_Situacao, DOM.situacaoApo, 'a-')}</td><td>${esc(a.U_LancPor)}${a.U_AprPor ? ` <span class="sub">aprov. ${esc(a.U_AprPor)}</span>` : ''}</td>
      <td class="wrap">${esc(a.U_Obs || '')}</td>
      <td class="right" style="white-space:nowrap">${aprova && a.U_Situacao === 'LAN' ? `<button type="button" class="mini primary" data-apr="${esc(a.Code)}">Aprovar</button> <button type="button" class="mini danger" data-rec="${esc(a.Code)}">Recusar</button>` : ''}</td></tr>`;
  }).join('') || '<tr><td colspan="10" class="empty">Nenhum apontamento.</td></tr>'}</tbody></table></div></div>`;

  const info = () => {
    const l = linhas[Number($('#aLinha')?.value)];
    if (l && $('#aInfo')) $('#aInfo').textContent = `Cobrança ${DOM.unidCobr[l.unid]?.toLowerCase() || ''}${l.jornada ? ` · jornada de ${num(l.jornada, 1)} h (o que passar vira hora extra)` : ''}.`;
  };
  info();
  const reload = () => render(root, {}, c);
  root.onchange = (ev) => {
    if (ev.target.id === 'aLinha') info();
    if (ev.target.id === 'comp' && ev.target.value) {
      f.comp = monthToComp(ev.target.value);
      reload();
    }
    if (ev.target.id === 'sit') {
      f.situacao = ev.target.value;
      reload();
    }
  };
  root.onclick = async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.a === 'lancar') {
      const l = linhas[Number($('#aLinha').value)];
      return acao(async () => {
        const r = await post('/timesheet', { ctr: l.ctr, linha: l.linha, data: $('#aData').value, hrNorm: $('#aNorm').value, hrExtra: $('#aExtra').value, obs: $('#aObs').value });
        toast(r.U_Situacao === 'APR' ? 'Horas lançadas e aprovadas.' : 'Horas lançadas. Aguardando aprovação.');
        reload();
      });
    }
    if (b.dataset.apr) {
      return acao(async () => {
        await post(`/timesheet/${encodeURIComponent(b.dataset.apr)}/decision`, { acao: 'aprovar' });
        toast('Apontamento aprovado.');
        reload();
      });
    }
    if (b.dataset.a === 'aprovarTodos') {
      return acao(async () => {
        const p = rows.filter((a) => a.U_Situacao === 'LAN');
        for (const a of p) await post(`/timesheet/${encodeURIComponent(a.Code)}/decision`, { acao: 'aprovar' });
        toast(`${p.length} apontamento(s) aprovado(s).`);
        reload();
      });
    }
    if (b.dataset.rec) {
      const m = modal(`<h2>Recusar apontamento</h2><label>Motivo</label><input id="rObs" maxlength="200">
        <div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="danger" data-x="1">Recusar</button></div>`);
      m.onclick = async (e) => {
        const x = e.target.closest('[data-x]');
        if (!x) return;
        if (x.dataset.x === '0') return closeModal();
        await acao(async () => {
          await post(`/timesheet/${encodeURIComponent(b.dataset.rec)}/decision`, { acao: 'recusar', obs: $('#rObs').value });
          closeModal();
          reload();
        });
      };
    }
  };
}
