// Leituras de horímetro/hodômetro: lançamento por item, importação de planilha e consulta da competência.
import { $, esc, num, fmtD, UN, toast, acao, compAtual, compToMonth, monthToComp, compFmt, hoje } from '../util.js';
import { get, post, qs } from '../api.js';
import { filtro } from '../state.js';

export async function render(root, _p, c) {
  const f = filtro('leituras', { comp: compAtual() });
  const [pend, feitas] = await Promise.all([get('/readings/pending'), get(`/readings${qs({ comp: f.comp })}`)]);
  const usoMes = (ctr, line) => feitas.filter((m) => m.U_CtrEntry === ctr && m.U_CtrLine === line).reduce((s, m) => s + Math.max(0, m.U_LeitFim - m.U_LeitIni - (m.U_Abat || 0)), 0);
  const pode = c.can('leituras.registrar');
  root.innerHTML = `<div class="card"><div class="toolbar"><div><label>Competência</label><input type="month" id="comp" value="${compToMonth(f.comp)}"></div>
    <div class="sub" style="flex:1">A leitura atual menos a última leitura é o uso do período. O uso acima da franquia vira excedente no faturamento.</div></div>
  <div class="tbl"><table><thead><tr><th>Contrato</th><th>Cliente</th><th>Equipamento</th><th class="num">Franquia/mês</th><th class="num">Uso em ${compFmt(f.comp)}</th>
    <th class="num">Última leitura</th>${pode ? '<th>Leitura atual</th><th>Abatimento</th><th>Data</th><th></th>' : ''}</tr></thead><tbody>
  ${pend.map((p, i) => `<tr><td>${p.DocNum}</td><td>${esc(p.U_CardName)}</td><td><b>${esc(p.U_Ativo)}</b> <span class="sub">${esc(p.U_AtvDesc || '')}</span></td>
    <td class="num">${p.U_Grupo ? `grupo ${esc(p.U_Grupo)}` : `${num(p.U_Franquia, 0)} ${UN(p.U_Tipo)}`}</td><td class="num">${num(usoMes(p.DocEntry, p.LineId), 1)} ${UN(p.U_Tipo)}</td>
    <td class="num">${num(p.U_Medidor, 1)}</td>
    ${pode ? `<td><input class="w110" type="number" min="0" step="0.1" inputmode="decimal" id="lt${i}"></td><td><input class="w80" type="number" min="0" step="0.1" id="ab${i}" value="0"></td>
    <td><input class="w140" type="date" id="dt${i}" value="${hoje()}"></td><td><button type="button" class="mini primary" data-reg="${i}">Registrar</button></td>` : ''}</tr>`).join('')
    || `<tr><td colspan="${pode ? 10 : 6}" class="empty">Nenhum equipamento locado.</td></tr>`}</tbody></table></div></div>
  ${pode ? `<div class="card"><h2>Importar planilha</h2><p class="sub">Uma linha por equipamento: <b>ativo;leitura;data;abatimento</b> (data e abatimento opcionais). Aceita arquivo CSV exportado do Excel.</p>
    <div class="inline-form"><input type="file" id="csvFile" accept=".csv,.txt" style="max-width:320px"><button type="button" data-a="importar" class="primary">Importar</button></div>
    <textarea id="csvText" placeholder="EQP-0001;4800;${fmtD(hoje())}" style="margin-top:8px"></textarea><div id="impRes"></div></div>` : ''}
  <div class="card"><h2>Leituras de ${compFmt(f.comp)}</h2><div class="tbl"><table><thead><tr><th>Data</th><th>Contrato</th><th>Equipamento</th><th class="num">Inicial</th><th class="num">Final</th><th class="num">Abatimento</th><th class="num">Uso</th><th>Origem</th></tr></thead><tbody>
  ${feitas.sort((a, b) => (a.U_Data < b.U_Data ? 1 : -1)).map((m) => `<tr><td>${fmtD(m.U_Data)}</td><td>${m.U_CtrEntry}</td><td>${esc(m.U_Ativo)}</td><td class="num">${num(m.U_LeitIni, 1)}</td>
    <td class="num">${num(m.U_LeitFim, 1)}</td><td class="num">${num(m.U_Abat, 1)}</td><td class="num"><b>${num(m.U_LeitFim - m.U_LeitIni - (m.U_Abat || 0), 1)}</b></td>
    <td>${esc({ MAN: 'Manual', PLA: 'Planilha', MOV: 'Movimentação' }[m.U_Origem] || m.U_Origem || '')}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Nenhuma leitura.</td></tr>'}
  </tbody></table></div></div>`;

  root.onchange = (ev) => {
    if (ev.target.id === 'comp' && ev.target.value) {
      f.comp = monthToComp(ev.target.value);
      render(root, {}, c);
    }
    if (ev.target.id === 'csvFile' && ev.target.files[0]) ev.target.files[0].text().then((t) => ($('#csvText').value = t));
  };
  root.onclick = async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.reg != null) {
      const i = b.dataset.reg;
      const p = pend[i];
      if ($(`#lt${i}`).value === '') return toast('Informe a leitura atual.', 'err');
      await acao(async () => {
        await post('/readings', { ativo: p.U_Ativo, leitura: $(`#lt${i}`).value, abatimento: $(`#ab${i}`).value, data: $(`#dt${i}`).value, comp: f.comp });
        toast('Leitura registrada.');
        render(root, {}, c);
      });
    }
    if (b.dataset.a === 'importar') {
      await acao(async () => {
        const r = await post('/readings/import', { csv: $('#csvText').value, comp: f.comp });
        const erros = r.filter((x) => !x.ok);
        toast(`${r.filter((x) => x.ok).length} leitura(s) importada(s), ${erros.length} com erro.`, erros.length ? 'err' : 'ok');
        await render(root, {}, c);
        if (erros.length) $('#impRes').innerHTML = `<div class="msg warn">${erros.map((e) => `Linha ${e.linha}: ${esc(e.message)}`).join('<br>')}</div>`;
      });
    }
  };
}
