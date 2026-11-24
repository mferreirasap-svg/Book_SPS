// Faturamento: painel de parcelas com situação por cores, memória de cálculo, geração em lote e liberação.
import { $, $$, esc, brl, num, DOM, badge, options, toast, acao, modal, closeModal, confirmar, compAtual, compToMonth, monthToComp, compFmt } from '../util.js';
import { get, post, qs } from '../api.js';
import { filtro } from '../state.js';

const abertos = new Set();

export async function render(root, _p, c) {
  const f = filtro('faturamento', { comp: compAtual(), situacao: '' });
  const rows = await get(`/billing${qs({ comp: f.comp })}`);
  const lista = rows.filter((r) => !f.situacao || r.situacao === f.situacao);
  const cont = { gerada: 0, em_dia: 0, vence: 0, atrasada: 0 };
  rows.forEach((r) => cont[r.situacao]++);
  const gera = c.can('faturamento.gerar');
  const conf = c.can('faturamento.conferir');
  const liberada = (r) => !r.conferencia?.exige || (r.conferencia.liberada && !r.conferencia.mudou);
  const podeSel = (r) => gera && r.situacao !== 'gerada' && !r.avisos.length && r.parcela?.status !== 'PRO' && liberada(r);
  const aConferir = rows.filter((r) => r.situacao !== 'gerada' && r.conferencia?.exige && !liberada(r)).length;
  const detalhes = {};
  for (const id of abertos) {
    if (lista.some((r) => r.DocEntry === id)) detalhes[id] = await get(`/billing/${id}/${f.comp}`).catch(() => null);
  }
  root.innerHTML = `<div class="card"><div class="toolbar">
    <div><label>Competência</label><input type="month" id="comp" value="${compToMonth(f.comp)}"></div>
    <div><label>Situação</label><select id="sit"><option value="">Todas (${rows.length})</option>${Object.entries(DOM.situacao).map(([k, v]) => `<option value="${k}" ${f.situacao === k ? 'selected' : ''}>${v} (${cont[k]})</option>`).join('')}</select></div>
    <div class="sub" style="flex:1">${aConferir ? `<b style="color:#C25113">${aConferir} contrato(s) a conferir</b> antes de gerar (franquia/excedente). ` : ''}Total a gerar: <b>${brl(lista.filter(podeSel).reduce((s, r) => s + r.total, 0))}</b>. A NF e o boleto são emitidos no SAP B1 a partir do documento gerado.</div>
    ${gera ? '<button type="button" class="primary" data-a="lote">Gerar selecionados</button>' : ''}</div>
  <div class="tbl"><table><thead><tr><th>${gera ? '<input type="checkbox" id="todos" checked style="width:auto">' : ''}</th><th>Contrato</th><th>Cliente</th><th>Documento</th><th class="num">Dia</th>
    <th class="num">Valor</th><th>Situação</th><th>Parcela</th><th></th></tr></thead><tbody>
  ${lista.map((r) => {
    const d = detalhes[r.DocEntry];
    return `<tr><td>${podeSel(r) ? `<input type="checkbox" class="sel" value="${r.DocEntry}" checked style="width:auto">` : ''}</td>
      <td>${r.DocNum}</td><td>${esc(r.U_CardName)}</td><td>${esc(DOM.modoFat[r.U_ModoFat] || '')}</td><td class="num">${r.U_DiaFat}</td><td class="num"><b>${brl(r.total)}</b></td>
      <td><span class="badge sit-${r.situacao}">${DOM.situacao[r.situacao]}</span>${r.avisos.length ? ' <span class="badge b-MAN">pendência</span>' : ''}
        ${r.situacao !== 'gerada' && r.conferencia?.exige ? (liberada(r) ? `<span class="badge l-CON" title="por ${esc(r.conferencia.por)}">liberada</span>`
          : `<span class="badge l-PEN">${r.conferencia.mudou ? 'mudou — conferir de novo' : 'a conferir'}</span>`) : ''}
        ${r.servico ? '<span class="chip" title="Mão de obra sai em documento de serviço separado">+ serviço</span>' : ''}</td>
      <td>${r.parcela && r.parcela.status !== 'LIB' ? `${badge(r.parcela.status, DOM.statusFat)}${r.parcela.docNum ? ` <span class="sub">nº ${r.parcela.docNum}${r.parcela.docNum2 ? ` e ${r.parcela.docNum2} (serviço)` : ''}</span>` : ''}` : ''}</td>
      <td class="right" style="white-space:nowrap"><button type="button" class="mini" data-det="${r.DocEntry}">${d ? 'Ocultar' : 'Detalhar'}</button>
        ${conf && r.situacao !== 'gerada' && r.conferencia?.exige && !r.avisos.length && r.parcela?.status !== 'PRO' ? `<button type="button" class="mini ${liberada(r) ? '' : 'primary'}" data-conf="${r.DocEntry}">${liberada(r) ? 'Rever conferência' : 'Conferir…'}</button>` : ''}
        ${podeSel(r) ? `<button type="button" class="mini" data-um="${r.DocEntry}">Gerar…</button>` : ''}
        ${r.parcela && ['OK', 'ERR'].includes(r.parcela.status) && c.can('faturamento.liberar') ? `<button type="button" class="mini danger" data-lib="${esc(r.parcela.Code)}" title="Liberar refaturamento (depois de cancelar o documento no SAP B1)">Refaturar</button>` : ''}</td></tr>
      ${d ? `<tr><td></td><td colspan="8">${d.avisos.map((a) => `<div class="msg warn">${esc(a)}</div>`).join('')}${r.parcela?.erro ? `<div class="msg err">${esc(r.parcela.erro)}</div>` : ''}
        <table><thead><tr><th>Item</th><th>Descrição e memória de cálculo</th><th class="num">Qtd</th><th class="num">Preço</th><th class="num">Total</th></tr></thead><tbody>
        ${d.linhas.map((l) => `<tr><td>${esc(l.ItemCode || '—')}</td><td class="wrap">${l.servico ? '<span class="chip">serviço</span> ' : ''}${esc(l.desc)}<ul class="memo">${(l.memoria || []).map((m) => `<li>${esc(m)}</li>`).join('')}</ul></td>
          <td class="num">${num(l.qtd, l.qtd % 1 ? 2 : 0)}</td><td class="num">${brl(l.preco)}</td><td class="num">${brl(l.total)}</td></tr>`).join('')
          || `<tr><td colspan="5" class="empty">${esc(d.motivo || 'Nada a cobrar.')}</td></tr>`}
        <tr><td colspan="4" class="right"><b>Total</b></td><td class="num"><b>${brl(d.total)}</b></td></tr></tbody></table></td></tr>` : ''}`;
  }).join('') || '<tr><td colspan="9" class="empty">Nada a faturar nesta competência.</td></tr>'}
  </tbody></table></div><div id="jobLog"></div></div>`;

  const reload = () => render(root, {}, c);
  root.onchange = (ev) => {
    if (ev.target.id === 'comp' && ev.target.value) {
      f.comp = monthToComp(ev.target.value);
      abertos.clear();
      reload();
    }
    if (ev.target.id === 'sit') {
      f.situacao = ev.target.value;
      reload();
    }
    if (ev.target.id === 'todos') $$('.sel', root).forEach((x) => (x.checked = ev.target.checked));
  };
  root.onclick = async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.det) {
      const id = Number(b.dataset.det);
      abertos.has(id) ? abertos.delete(id) : abertos.add(id);
      return reload();
    }
    if (b.dataset.lib) {
      if (!(await confirmar({ titulo: 'Liberar refaturamento', texto: 'Use somente depois de cancelar o documento no SAP B1. A competência volta a poder ser faturada e as multas voltam a "a repassar".', ok: 'Liberar', perigo: true }))) return;
      return acao(async () => {
        await post(`/billing/installment/${encodeURIComponent(b.dataset.lib)}/release`);
        toast('Competência liberada para refaturamento.');
        reload();
      });
    }
    if (b.dataset.conf) return conferir(Number(b.dataset.conf), f.comp, reload);
    if (b.dataset.um) return gerarUm(Number(b.dataset.um), f.comp, rows.find((r) => r.DocEntry === Number(b.dataset.um)), reload);
    if (b.dataset.a === 'lote') {
      const ids = $$('.sel', root).filter((x) => x.checked).map((x) => Number(x.value));
      if (!ids.length) return toast('Selecione ao menos um contrato.', 'err');
      const total = lista.filter((r) => ids.includes(r.DocEntry)).reduce((s, r) => s + r.total, 0);
      if (!(await confirmar({ titulo: 'Gerar documentos no SAP B1', texto: `${ids.length} contrato(s), total de ${brl(total)}, competência ${compFmt(f.comp)}.`, ok: 'Gerar' }))) return;
      await acao(async () => {
        const { job } = await post('/billing/generate', { comp: f.comp, contratos: ids });
        await acompanhar(job, root);
        reload().then(() => acompanhar(job, root));
      });
    }
  };
}

async function acompanhar(job, root) {
  for (;;) {
    const j = await get(`/jobs/${job}`);
    const log = $('#jobLog', root);
    if (log) {
      log.innerHTML = `<h3>Resultado (${j.progress} de ${j.total})</h3><div class="log">${j.result.map((r) => (r.ok
        ? `✓ Contrato ${r.contrato} ${esc(r.cliente)}: ${esc(r.docTypeName)} nº ${r.docNum} — ${brl(r.valor)}`
        : `✗ Contrato ${r.id}: ${esc(r.message)}`)).join('\n')}</div>`;
    }
    if (j.status !== 'running') return j;
    await new Promise((s) => setTimeout(s, 700));
  }
}

function gerarUm(id, comp, row, reload) {
  const m = modal(`<h2>Gerar parcela — contrato ${row.DocNum}</h2><p>${esc(row.U_CardName)} · competência ${compFmt(comp)} · valor calculado <b>${brl(row.total)}</b></p>
    <div class="grid"><div><label>Desconto (R$)</label><input type="number" min="0" step="0.01" id="gDesc" value="0"></div>
    <div><label>Acréscimo (R$)</label><input type="number" min="0" step="0.01" id="gAcr" value="0"></div></div>
    <div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="primary" data-x="1">Gerar no SAP B1</button></div>`);
  m.onclick = async (ev) => {
    const b = ev.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === '0') return closeModal();
    await acao(async () => {
      const r = await post('/billing/generate-one', { comp, contrato: id, desconto: $('#gDesc').value, acrescimo: $('#gAcr').value });
      closeModal();
      toast(`${r.docTypeName} nº ${r.docNum} gerado: ${brl(r.valor)}.`);
      reload();
    });
  };
}

/** Conferência do faturamento: decide linha a linha (cobrar, abonar ou ajustar) com motivo e libera a parcela para gerar. */
async function conferir(id, comp, reload) {
  const d = await get(`/billing/${id}/${comp}`);
  const linhas = d.todas || d.linhas;
  const dec = linhas.map((l, i) => {
    const a = (d.ajustes || []).find((x) => Number(x.U_Linha) === i && x.U_Descr === l.desc);
    return { tipo: a?.U_Tipo || 'COB', valor: a ? Number(a.U_VlrFinal) : l.total, motivo: a?.U_Motivo || '', obs: a?.U_Obs || '' };
  });
  const totalFinal = () => linhas.reduce((s, l, i) => s + (dec[i].tipo === 'ABO' ? 0 : dec[i].tipo === 'AJU' ? Number(dec[i].valor) || 0 : l.total), 0);
  const m = modal(`<h2>Conferir faturamento — contrato ${d.contrato.DocNum}</h2>
    <p>${esc(d.contrato.U_CardName)} · competência ${compFmt(comp)}. Confira as leituras, a franquia e o excedente. Abonos e ajustes exigem motivo; reduções acima de ${brl(d.alcada)} precisam de um gestor.</p>
    <div class="tbl"><table><thead><tr><th>Linha</th><th class="num">Calculado</th><th>Decisão</th><th class="num">Valor final</th><th>Motivo</th></tr></thead><tbody>
    ${linhas.map((l, i) => `<tr><td class="wrap">${l.servico ? '<span class="chip">serviço</span> ' : ''}${esc(l.desc)}<ul class="memo">${(l.memoria || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></td>
      <td class="num">${brl(l.total)}</td><td><select data-c="${i}" data-k="tipo">${options(DOM.ajusteFat, dec[i].tipo)}</select></td>
      <td class="num"><input type="number" step="0.01" min="0" class="w110" data-c="${i}" data-k="valor" value="${dec[i].valor}" ${dec[i].tipo === 'AJU' ? '' : 'disabled'}></td>
      <td><select data-c="${i}" data-k="motivo" ${dec[i].tipo === 'COB' ? 'disabled' : ''}>${options(DOM.motivoAjuste, dec[i].motivo, { vazio: '—' })}</select>
        <input data-c="${i}" data-k="obs" value="${esc(dec[i].obs)}" placeholder="observação" maxlength="200" ${dec[i].tipo === 'COB' ? 'hidden' : ''}></td></tr>`).join('')}
    <tr><td class="right"><b>Total</b></td><td class="num">${brl(d.total)}</td><td></td><td class="num"><b id="cTot">${brl(totalFinal())}</b></td><td></td></tr></tbody></table></div>
    <div id="cMsg"></div>
    <div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="primary" data-x="1">Liberar para faturar</button></div>`, { largo: true });
  m.onchange = (e) => {
    const el = e.target.closest('[data-c]');
    if (!el) return;
    const i = Number(el.dataset.c);
    dec[i][el.dataset.k] = el.value;
    if (el.dataset.k === 'tipo') {
      const linha = el.closest('tr');
      linha.querySelector('[data-k="valor"]').disabled = el.value !== 'AJU';
      linha.querySelector('[data-k="motivo"]').disabled = el.value === 'COB';
      linha.querySelector('[data-k="obs"]').hidden = el.value === 'COB';
      if (el.value !== 'AJU') linha.querySelector('[data-k="valor"]').value = el.value === 'ABO' ? 0 : linhas[i].total;
      dec[i].valor = Number(linha.querySelector('[data-k="valor"]').value);
    }
    $('#cTot').textContent = brl(totalFinal());
  };
  m.onclick = async (e) => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === '0') return closeModal();
    const ajustes = dec.map((a, i) => ({ linha: i, ...a })).filter((a) => a.tipo !== 'COB');
    try {
      const r = await post('/billing/liberar', { comp, contrato: id, ajustes });
      closeModal();
      toast(`Parcela liberada: ${brl(r.liberado)}${r.liberado !== r.calculado ? ` (calculado ${brl(r.calculado)})` : ''}.`);
      reload();
    } catch (err) {
      $('#cMsg').innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
    }
  };
}
