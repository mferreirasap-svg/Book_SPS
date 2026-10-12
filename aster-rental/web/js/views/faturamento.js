// Faturamento: painel de parcelas com situação por cores, memória de cálculo, geração em lote e liberação.
import { $, $$, esc, brl, num, DOM, badge, toast, acao, modal, closeModal, confirmar, compAtual, compToMonth, monthToComp, compFmt } from '../util.js';
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
  const podeSel = (r) => gera && r.situacao !== 'gerada' && !r.avisos.length && r.parcela?.status !== 'PRO';
  const detalhes = {};
  for (const id of abertos) {
    if (lista.some((r) => r.DocEntry === id)) detalhes[id] = await get(`/billing/${id}/${f.comp}`).catch(() => null);
  }
  root.innerHTML = `<div class="card"><div class="toolbar">
    <div><label>Competência</label><input type="month" id="comp" value="${compToMonth(f.comp)}"></div>
    <div><label>Situação</label><select id="sit"><option value="">Todas (${rows.length})</option>${Object.entries(DOM.situacao).map(([k, v]) => `<option value="${k}" ${f.situacao === k ? 'selected' : ''}>${v} (${cont[k]})</option>`).join('')}</select></div>
    <div class="sub" style="flex:1">Total a gerar: <b>${brl(lista.filter(podeSel).reduce((s, r) => s + r.total, 0))}</b>. A NF e o boleto são emitidos no SAP B1 a partir do documento gerado.</div>
    ${gera ? '<button type="button" class="primary" data-a="lote">Gerar selecionados</button>' : ''}</div>
  <div class="tbl"><table><thead><tr><th>${gera ? '<input type="checkbox" id="todos" checked style="width:auto">' : ''}</th><th>Contrato</th><th>Cliente</th><th>Documento</th><th class="num">Dia</th>
    <th class="num">Valor</th><th>Situação</th><th>Parcela</th><th></th></tr></thead><tbody>
  ${lista.map((r) => {
    const d = detalhes[r.DocEntry];
    return `<tr><td>${podeSel(r) ? `<input type="checkbox" class="sel" value="${r.DocEntry}" checked style="width:auto">` : ''}</td>
      <td>${r.DocNum}</td><td>${esc(r.U_CardName)}</td><td>${esc(DOM.modoFat[r.U_ModoFat] || '')}</td><td class="num">${r.U_DiaFat}</td><td class="num"><b>${brl(r.total)}</b></td>
      <td><span class="badge sit-${r.situacao}">${DOM.situacao[r.situacao]}</span>${r.avisos.length ? ' <span class="badge b-MAN">pendência</span>' : ''}</td>
      <td>${r.parcela ? `${badge(r.parcela.status, DOM.statusFat)}${r.parcela.docNum ? ` <span class="sub">nº ${r.parcela.docNum}</span>` : ''}` : ''}</td>
      <td class="right" style="white-space:nowrap"><button type="button" class="mini" data-det="${r.DocEntry}">${d ? 'Ocultar' : 'Detalhar'}</button>
        ${podeSel(r) ? `<button type="button" class="mini" data-um="${r.DocEntry}">Gerar…</button>` : ''}
        ${r.parcela && ['OK', 'ERR'].includes(r.parcela.status) && c.can('faturamento.liberar') ? `<button type="button" class="mini danger" data-lib="${esc(r.parcela.Code)}">Liberar refaturamento</button>` : ''}</td></tr>
      ${d ? `<tr><td></td><td colspan="8">${d.avisos.map((a) => `<div class="msg warn">${esc(a)}</div>`).join('')}${r.parcela?.erro ? `<div class="msg err">${esc(r.parcela.erro)}</div>` : ''}
        <table><thead><tr><th>Item</th><th>Descrição e memória de cálculo</th><th class="num">Qtd</th><th class="num">Preço</th><th class="num">Total</th></tr></thead><tbody>
        ${d.linhas.map((l) => `<tr><td>${esc(l.ItemCode || '—')}</td><td class="wrap">${esc(l.desc)}<ul class="memo">${(l.memoria || []).map((m) => `<li>${esc(m)}</li>`).join('')}</ul></td>
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
