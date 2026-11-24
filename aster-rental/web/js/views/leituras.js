// Leituras de horímetro/hodômetro: lançamento por item, importação de planilha e consulta da competência.
import { $, esc, num, fmtD, fmtDT, UN, DOM, badge, toast, acao, modal, closeModal, compAtual, compToMonth, monthToComp, compFmt, hoje } from '../util.js';
import { get, post, qs } from '../api.js';
import { filtro } from '../state.js';

export async function render(root, _p, c) {
  const f = filtro('leituras', { comp: compAtual() });
  const confere = c.can('leituras.conferir');
  const [pend, feitas, aConferir] = await Promise.all([get('/readings/pending'), get(`/readings${qs({ comp: f.comp })}`), confere ? get('/readings/review') : []]);
  const medidor = Object.fromEntries(pend.map((p) => [p.U_Ativo, p.U_Medidor]));
  const usoMes = (ctr, line) => feitas.filter((m) => m.U_CtrEntry === ctr && m.U_CtrLine === line).reduce((s, m) => s + Math.max(0, m.U_LeitFim - m.U_LeitIni - (m.U_Abat || 0)), 0);
  const pode = c.can('leituras.registrar');
  root.innerHTML = `${confere ? `<div class="card"><h2>Leituras do campo a conferir ${aConferir.length ? `<span class="badge b-MAN">${aConferir.length}</span>` : ''}</h2>
    <p class="sub">Lançadas no celular com foto do mostrador. Compare o número com a foto: ao aprovar, a leitura entra no faturamento e atualiza o medidor do equipamento.</p>
    <div class="tbl"><table><thead><tr><th>Foto</th><th>Equipamento</th><th>Data</th><th class="num">Última conferida</th><th class="num">Informada</th><th class="num">Uso</th><th>Lançada por</th><th>Obs.</th><th></th></tr></thead><tbody>
    ${aConferir.map((m) => {
      const ult = medidor[m.U_Ativo] ?? m.U_LeitIni;
      const uso = m.U_LeitFim - ult;
      return `<tr><td>${m.U_Foto ? `<img src="${m.U_Foto}" alt="foto do mostrador" class="thumb" data-ver="${esc(m.Code)}">` : '<span class="sub">sem foto</span>'}</td>
      <td><b>${esc(m.U_Ativo)}</b></td><td>${fmtD(m.U_Data)}</td><td class="num">${num(ult, 1)}</td><td class="num"><b>${num(m.U_LeitFim, 1)}</b></td>
      <td class="num">${uso < 0 ? '<span class="badge p-URG">menor</span>' : num(uso, 1)}</td><td>${esc(m.U_LancPor)}</td><td class="wrap">${esc(m.U_Obs || '')}</td>
      <td class="right" style="white-space:nowrap"><button type="button" class="mini primary" data-conf="${esc(m.Code)}">Aprovar</button> <button type="button" class="mini danger" data-rec="${esc(m.Code)}">Recusar</button></td></tr>`;
    }).join('') || '<tr><td colspan="9" class="empty">Nenhuma leitura aguardando conferência.</td></tr>'}</tbody></table></div></div>` : ''}
  <div class="card"><div class="toolbar"><div><label>Competência</label><input type="month" id="comp" value="${compToMonth(f.comp)}"></div>
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
  <div class="card"><h2>Leituras de ${compFmt(f.comp)}</h2><div class="tbl"><table><thead><tr><th>Data</th><th>Contrato</th><th>Equipamento</th><th class="num">Inicial</th><th class="num">Final</th><th class="num">Abatimento</th><th class="num">Uso</th><th>Origem</th><th>Situação</th></tr></thead><tbody>
  ${feitas.sort((a, b) => (a.U_Data < b.U_Data ? 1 : -1)).map((m) => `<tr><td>${fmtD(m.U_Data)}</td><td>${m.U_CtrEntry}</td><td>${esc(m.U_Ativo)}</td><td class="num">${num(m.U_LeitIni, 1)}</td>
    <td class="num">${num(m.U_LeitFim, 1)}</td><td class="num">${num(m.U_Abat, 1)}</td><td class="num"><b>${num(m.U_LeitFim - m.U_LeitIni - (m.U_Abat || 0), 1)}</b></td>
    <td>${esc({ MAN: 'Manual', PLA: 'Planilha', MOV: 'Movimentação', CAM: 'Campo (foto)', OS: 'Ordem de serviço' }[m.U_Origem] || m.U_Origem || '')}</td>
    <td>${badge(m.U_Situacao || 'CON', DOM.situacaoLeit, 'l-')}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Nenhuma leitura.</td></tr>'}
  </tbody></table></div></div>`;

  root.onchange = (ev) => {
    if (ev.target.id === 'comp' && ev.target.value) {
      f.comp = monthToComp(ev.target.value);
      render(root, {}, c);
    }
    if (ev.target.id === 'csvFile' && ev.target.files[0]) ev.target.files[0].text().then((t) => ($('#csvText').value = t));
  };
  root.onclick = async (ev) => {
    const img = ev.target.closest('[data-ver]');
    if (img) {
      const m = aConferir.find((x) => x.Code === img.dataset.ver);
      const mm = modal(`<h2>${esc(m.U_Ativo)} — leitura informada ${num(m.U_LeitFim, 1)}</h2><img src="${m.U_Foto}" alt="foto do mostrador" style="width:100%;border-radius:6px">
        <p class="sub">Lançada por ${esc(m.U_LancPor)} em ${fmtD(m.U_Data)}.</p><div class="dlg-actions"><button type="button" data-x>Fechar</button></div>`);
      mm.onclick = (e) => e.target.closest('[data-x]') && closeModal();
      return;
    }
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.conf) {
      return acao(async () => {
        await post(`/readings/${encodeURIComponent(b.dataset.conf)}/review`, { acao: 'aprovar' });
        toast('Leitura conferida.');
        render(root, {}, c);
      });
    }
    if (b.dataset.rec) {
      const mm = modal(`<h2>Recusar leitura</h2><label>Motivo (o funcionário verá na lista dele)</label><input id="recObs" maxlength="200" placeholder="Ex.: foto ilegível, número diferente do mostrador">
        <div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="danger" data-x="1">Recusar</button></div>`);
      mm.onclick = async (e) => {
        const x = e.target.closest('[data-x]');
        if (!x) return;
        if (x.dataset.x === '0') return closeModal();
        await acao(async () => {
          await post(`/readings/${encodeURIComponent(b.dataset.rec)}/review`, { acao: 'recusar', obs: $('#recObs').value });
          closeModal();
          toast('Leitura recusada.');
          render(root, {}, c);
        });
      };
      return;
    }
    if (b.dataset.reg != null) {
      const i = b.dataset.reg;
      const p = pend[i];
      if ($(`#lt${i}`).value === '') return toast('Informe a leitura atual.', 'err');
      await acao(async () => {
        const r = await post('/readings', { ativo: p.U_Ativo, leitura: $(`#lt${i}`).value, abatimento: $(`#ab${i}`).value, data: $(`#dt${i}`).value, comp: f.comp });
        toast(r.preventivas?.length ? `Leitura registrada. A preventiva venceu: OS ${r.preventivas.map((x) => x.DocNum).join(', ')} aberta para agendar.` : 'Leitura registrada.');
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
