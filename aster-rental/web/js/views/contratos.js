// Contratos: lista paginada e editor (cabeçalho, grupos de cobrança agrupada, itens, histórico).
import { $, $$, esc, brl, fmtD, compFmt, DOM, badge, options, toast, acao, msg, debounce, pager, SEARCH, SETA, confirmar, d10, hoje } from '../util.js';
import { get, post, put, qs } from '../api.js';
import { filtro, S } from '../state.js';
import { imprimirContrato, imprimirTermo } from '../print.js';

const LN = 'SPS_LCT1Collection';
const GR = 'SPS_LCT2Collection';
let ctx;
let E; // contrato em edição
let aux; // regras, famílias, ativos disponíveis, histórico

export async function render(root, params, c) {
  ctx = c;
  if (params.id || params.novo) return editor(root, params);
  const f = filtro('contratos', { status: '', q: '', page: 1 });
  const r = await get(`/contracts${qs({ ...f, size: 50 })}`);
  root.innerHTML = `<div class="card"><div class="toolbar">
    <div><label>Status</label><select data-f="status">${options(DOM.statusContrato, f.status, { vazio: 'Todos' })}</select></div>
    <div style="flex:1" class="search"><label>Buscar</label>${SEARCH}<input data-f="q" value="${esc(f.q)}" placeholder="cliente, código, obra"></div>
    ${c.can('contratos.editar') ? '<button class="primary" type="button" data-a="novo">+ Novo contrato</button>' : ''}</div>
  <div class="tbl"><table><thead><tr><th>Nº</th><th>Cliente</th><th>Obra / local</th><th>Início</th><th>Fim</th><th class="num">Itens</th><th>Documento</th><th>Status</th></tr></thead><tbody>
  ${r.items.map((x) => `<tr class="click" data-id="${x.DocEntry}"><td>${SETA}<b>${x.DocNum}</b></td><td>${esc(x.U_CardName)}</td><td>${esc(x.U_Obra)}</td>
    <td>${fmtD(x.U_DtInicio)}</td><td>${fmtD(x.U_DtFim)}</td><td class="num">${(x[LN] || []).filter((l) => l.U_StatusL !== 'DEV').length}</td>
    <td>${esc(DOM.modoFat[x.U_ModoFat] || '')}</td><td>${badge(x.U_Status, DOM.statusContrato)}</td></tr>`).join('')
    || '<tr><td colspan="8" class="empty">Nenhum contrato.</td></tr>'}</tbody></table></div>${pager(r)}</div>`;
  const reload = () => render(root, {}, ctx);
  root.onchange = (ev) => {
    if (ev.target.dataset.f === 'status') {
      f.status = ev.target.value;
      f.page = 1;
      reload();
    }
  };
  root.oninput = debounce((ev) => {
    if (ev.target.dataset.f === 'q') {
      f.q = ev.target.value;
      f.page = 1;
      reload();
    }
  }, 400);
  root.onclick = (ev) => {
    const pg = ev.target.closest('[data-page]');
    if (pg) {
      f.page = Number(pg.dataset.page);
      return reload();
    }
    if (ev.target.closest('[data-a=novo]')) return ctx.go('contratos', { novo: 1 });
    const t = ev.target.closest('[data-id]');
    if (t) ctx.go('contratos', { id: t.dataset.id });
  };
}

/* ======================= editor ======================= */
async function editor(root, params) {
  const [regras, familias] = await Promise.all([get('/rules'), get('/families')]);
  if (params.id) {
    const [c, hist] = await Promise.all([get(`/contracts/${params.id}`), get(`/contracts/${params.id}/history`)]);
    E = c;
    aux = { regras, familias, hist };
    ctx.setTitle(`Contrato ${c.DocNum}`);
  } else {
    E = { U_Tipo: 'LOC', U_Status: 'RAS', U_DtInicio: hoje(), U_DtFim: '', U_DiaFat: 1, U_Filial: S.user.branches[0] || 1, U_ModoFat: 'RAS', U_CardCode: '', U_CardName: '',
      U_Obra: '', U_Indice: '', U_Email: '', U_Obs: '', [LN]: [], [GR]: [] };
    aux = { regras, familias, hist: null };
    ctx.setTitle('Novo contrato');
  }
  const avail = await get(`/assets/availability${qs({ ini: d10(E.U_DtInicio) || hoje(), fim: d10(E.U_DtFim) || d10(E.U_DtInicio) || hoje() })}`);
  aux.ativos = Object.fromEntries(avail.map((a) => [a.Code, a]));
  draw(root);
}

const editavel = () => E.U_Status !== 'ENC' && ctx.can('contratos.editar');

function draw(root) {
  const novo = !E.DocEntry;
  const ed = editavel();
  const ro = ed ? '' : 'disabled';
  const regrasItem = aux.regras.filter((r) => r.U_Tipo !== 'AGRUP');
  const regrasGrupo = aux.regras.filter((r) => ['AGRUP', 'CONS'].includes(r.U_Tipo));
  const entregue = E[LN].some((l) => l.U_StatusL !== 'PEN');
  const h = (k, t = 'text', o = '') => `<input type="${t}" data-h="${k}" value="${esc(t === 'date' ? d10(E[k]) : E[k] ?? '')}" ${ro} ${o}>`;
  const opcoesAtivo = (l) => {
    const lista = Object.values(aux.ativos).filter((a) => (a.status === 'DIS' && (!l.U_Familia || a.U_Familia === l.U_Familia)) || a.Code === l.U_Ativo);
    return `<option value="">${l.U_Familia ? '(definir na entrega)' : '—'}</option>${lista.map((a) => `<option value="${esc(a.Code)}" ${a.Code === l.U_Ativo ? 'selected' : ''}>${esc(a.Code)} — ${esc(a.Name)}</option>`).join('')}`;
  };
  const acoes = (l) => {
    if (novo || !ctx.can('mov.registrar') || !l.LineId) return '';
    const b = (tipo, t, cls = '') => `<button type="button" class="mini ${cls}" data-mov="${tipo}" data-line="${l.LineId}">${t}</button>`;
    if (l.U_StatusL === 'PEN' && E.U_Status === 'ATV') return b('ENT', 'Entregar', 'teal');
    if (l.U_StatusL === 'LOC') {
      const emMan = (aux.hist?.foras || []).some((f) => f.U_CtrLine === l.LineId && !f.U_Fim);
      return emMan ? b('RET', 'Retorno manut.') : `${b('DEV', 'Devolver')}${b('SUB', 'Substituir')}${b('MAN', 'Manutenção')}`;
    }
    return '';
  };

  root.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">${novo ? 'Novo contrato' : `Contrato ${E.DocNum}`}</h2>${badge(E.U_Status, DOM.statusContrato)}
    <span class="spacer"></span><button type="button" data-a="voltar">← Voltar</button>
    ${!novo ? '<button type="button" data-a="imprimir">Imprimir</button>' : ''}
    ${ed ? '<button type="button" class="primary" data-a="salvar">Salvar</button>' : ''}
    ${!novo && ctx.can('contratos.ativar') && E.U_Status === 'RAS' ? '<button type="button" class="teal" data-st="ATV">Ativar</button>' : ''}
    ${!novo && ctx.can('contratos.ativar') && E.U_Status === 'ATV' ? '<button type="button" data-st="SUS">Suspender</button>' : ''}
    ${!novo && ctx.can('contratos.ativar') && E.U_Status === 'SUS' ? '<button type="button" class="teal" data-st="ATV">Reativar</button>' : ''}
    ${!novo && ctx.can('contratos.ativar') && ['ATV', 'SUS'].includes(E.U_Status) ? '<button type="button" class="danger" data-st="ENC">Encerrar</button>' : ''}
  </div><div id="ctrMsg"></div>
  <div class="grid" style="margin-top:10px">
    <div class="span2"><label>Cliente (SAP B1)</label><input data-h="_bp" list="dlBP" value="${esc(E.U_CardCode ? `${E.U_CardCode}${E.U_CardName ? ` — ${E.U_CardName}` : ''}` : '')}" ${ed && !entregue ? '' : 'disabled'} placeholder="nome, código ou CNPJ"><datalist id="dlBP"></datalist></div>
    <div><label>Tipo</label><select data-h="U_Tipo" ${ro}>${options(DOM.tipoContrato, E.U_Tipo)}</select></div>
    <div><label>Documento gerado no B1</label><select data-h="U_ModoFat" ${ro}>${options(DOM.modoFat, E.U_ModoFat)}</select></div>
    <div><label>Início da vigência</label>${h('U_DtInicio', 'date')}</div>
    <div><label>Fim da vigência</label>${h('U_DtFim', 'date')}</div>
    <div><label>Data de corte (migração)</label>${h('U_DtCorte', 'date')}</div>
    <div><label>Dia de faturamento</label>${h('U_DiaFat', 'number', 'min="1" max="31"')}</div>
    <div><label>Filial (BPLId)</label>${h('U_Filial', 'number')}</div>
    <div><label>E-mail de cobrança</label>${h('U_Email', 'email')}</div>
    <div class="span2"><label>Obra / local de uso</label>${h('U_Obra', 'text', 'maxlength="100"')}</div>
    <div><label>Índice de reajuste</label>${h('U_Indice', 'text', 'placeholder="IGP-M, IPCA…"')}</div>
    <div class="span2"><label>Observações</label><textarea data-h="U_Obs" ${ro}>${esc(E.U_Obs || '')}</textarea></div>
  </div>

  <h3>Cobrança agrupada <span class="sub">(um valor e uma franquia para vários equipamentos)</span></h3>
  <div class="tbl"><table><thead><tr><th>Grupo</th><th>Descrição</th><th>Regra</th><th>Item faturamento</th><th class="num">Mensalidade</th><th class="num">Franquia</th><th class="num">R$ excedente</th><th></th></tr></thead><tbody>
  ${E[GR].map((g, i) => `<tr><td><input class="w80" data-g="${i}" data-k="U_Grupo" value="${esc(g.U_Grupo)}" ${ro} maxlength="20"></td>
    <td><input data-g="${i}" data-k="U_Descr" value="${esc(g.U_Descr)}" ${ro}></td>
    <td><select data-g="${i}" data-k="U_Regra" ${ro}>${regrasGrupo.map((r) => `<option value="${esc(r.Code)}" ${r.Code === g.U_Regra ? 'selected' : ''}>${esc(r.Name)}</option>`).join('')}</select></td>
    <td><input class="w110" list="dlItens" data-g="${i}" data-k="U_ItemCode" value="${esc(g.U_ItemCode)}" ${ro}></td>
    <td class="num"><input class="w110" type="number" step="0.01" min="0" data-g="${i}" data-k="U_Valor" value="${esc(g.U_Valor ?? 0)}" ${ro}></td>
    <td class="num"><input class="w110" type="number" step="0.1" min="0" data-g="${i}" data-k="U_Franquia" value="${esc(g.U_Franquia ?? 0)}" ${ro}></td>
    <td class="num"><input class="w80" type="number" step="0.01" min="0" data-g="${i}" data-k="U_VlrExced" value="${esc(g.U_VlrExced ?? 0)}" ${ro}></td>
    <td>${ed && !E[LN].some((l) => l.U_Grupo === g.U_Grupo) ? `<button type="button" class="mini danger" data-rmg="${i}">Remover</button>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="8" class="empty">Sem grupos. Os itens são cobrados um a um.</td></tr>'}</tbody></table></div>
  ${ed ? '<div class="row" style="margin-top:6px"><button type="button" class="mini" data-a="addg">+ Grupo</button></div>' : ''}

  <h3>Itens</h3>
  <div class="tbl"><table><thead><tr><th>Família</th><th>Equipamento</th><th>Cobrança</th><th>Item fat.</th><th class="num">Mensalidade</th><th class="num">Diária</th>
    <th class="num">Franquia</th><th class="num">R$ exced.</th><th>Condutor / local</th><th>Entrega</th><th>Devolução</th><th>Status</th><th></th></tr></thead><tbody>
  ${E[LN].map((l, i) => {
    const le = ed && l.U_StatusL !== 'DEV' ? '' : 'disabled';
    const fixo = l.U_StatusL !== 'PEN' ? 'disabled' : le;
    const emGrupo = !!l.U_Grupo;
    const v = (k, cls = 'w110', step = '0.01') => `<input class="${cls}" type="number" min="0" step="${step}" data-l="${i}" data-k="${k}" value="${esc(l[k] ?? 0)}" ${emGrupo ? 'disabled' : le}>`;
    return `<tr><td><select data-l="${i}" data-k="U_Familia" ${fixo}><option value=""></option>${aux.familias.map((f) => `<option value="${esc(f.Code)}" ${f.Code === l.U_Familia ? 'selected' : ''}>${esc(f.Name)}</option>`).join('')}</select></td>
      <td><select data-l="${i}" data-k="U_Ativo" ${fixo}>${opcoesAtivo(l)}</select></td>
      <td><select data-l="${i}" data-k="_cob" ${le}>${E[GR].map((g) => `<option value="G:${esc(g.U_Grupo)}" ${l.U_Grupo === g.U_Grupo ? 'selected' : ''}>Grupo ${esc(g.U_Grupo)}</option>`).join('')}
        ${regrasItem.map((r) => `<option value="R:${esc(r.Code)}" ${!l.U_Grupo && r.Code === l.U_Regra ? 'selected' : ''}>${esc(r.Name)}</option>`).join('')}</select></td>
      <td><input class="w110" list="dlItens" data-l="${i}" data-k="U_ItemCode" value="${esc(l.U_ItemCode || '')}" ${le}></td>
      <td class="num">${v('U_Valor')}</td><td class="num">${v('U_Diaria', 'w80')}</td><td class="num">${v('U_Franquia', 'w80', '0.1')}</td><td class="num">${v('U_VlrExced', 'w80')}</td>
      <td><input class="w180" data-l="${i}" data-k="U_Condutor" value="${esc(l.U_Condutor || l.U_Local || '')}" ${le} placeholder="condutor ou local"></td>
      <td>${fmtD(l.U_DtSaida)}</td><td>${fmtD(l.U_DtDevol)}</td><td>${badge(l.U_StatusL || 'PEN', DOM.statusLinha)}</td>
      <td class="right" style="white-space:nowrap">${ed && (l.U_StatusL || 'PEN') === 'PEN' ? `<button type="button" class="mini danger" data-rml="${i}">Remover</button>` : ''}${acoes(l)}</td></tr>`;
  }).join('') || '<tr><td colspan="13" class="empty">Nenhum item. Use "+ Item".</td></tr>'}</tbody></table><datalist id="dlItens"></datalist></div>
  ${ed ? '<div class="row" style="margin-top:6px"><button type="button" class="mini" data-a="addl">+ Item</button></div>' : ''}
  ${aux.hist ? historico() : ''}</div>`;
  bind(root);
}

function historico() {
  const h = aux.hist;
  return `<h3>Parcelas</h3><div class="tbl"><table><thead><tr><th>Competência</th><th>Documento</th><th class="num">Valor</th><th>Status</th></tr></thead><tbody>
    ${h.parcelas.map((p) => `<tr><td>${compFmt(p.U_Comp)}</td><td>${esc(DOM.modoFat[p.U_DocType] || '')} ${p.U_DocNum ? `nº ${p.U_DocNum}` : ''}</td><td class="num">${brl(p.U_Valor)}</td>
      <td>${badge(p.U_Status, DOM.statusFat)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nenhuma parcela gerada.</td></tr>'}</tbody></table></div>
  <h3>Movimentações</h3><div class="tbl"><table><thead><tr><th>Nº</th><th>Data</th><th>Tipo</th><th>Equipamento</th><th>Responsável</th><th>Usuário</th><th></th></tr></thead><tbody>
    ${h.movimentos.map((m) => `<tr><td>${m.DocNum}</td><td>${fmtD(m.U_Data)}</td><td>${esc(DOM.tipoMov[m.U_Tipo] || m.U_Tipo)}</td><td>${esc(m.U_Ativo)}${m.U_AtivoNovo ? ` → ${esc(m.U_AtivoNovo)}` : ''}</td>
      <td>${esc(m.U_Respons)}</td><td>${esc(m.U_Usuario)}</td><td class="right"><button type="button" class="mini" data-termo="${m.DocEntry}">Termo</button></td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">Nenhuma movimentação.</td></tr>'}</tbody></table></div>
  ${h.multas.length ? `<h3>Multas</h3><div class="tbl"><table><thead><tr><th>Data</th><th>Placa</th><th>AIT</th><th class="num">Valor</th><th>Status</th></tr></thead><tbody>
    ${h.multas.map((m) => `<tr><td>${fmtD(m.U_DtInfr)}</td><td>${esc(m.U_Placa)}</td><td>${esc(m.U_AIT)}</td><td class="num">${brl(m.U_Valor)}</td><td>${badge(m.U_Status, DOM.statusMulta)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}

function lerFormulario(root) {
  $$('[data-h]', root).forEach((e) => {
    const k = e.dataset.h;
    if (k === '_bp') {
      if (e.disabled) return;
      const [code, ...nome] = e.value.split('—');
      E.U_CardCode = code.trim();
      E.U_CardName = nome.join('—').trim() || E.U_CardName;
    } else E[k] = e.value;
  });
  $$('[data-g]', root).forEach((e) => (E[GR][Number(e.dataset.g)][e.dataset.k] = e.value));
  $$('[data-l]', root).forEach((e) => {
    const l = E[LN][Number(e.dataset.l)];
    if (e.dataset.k === '_cob') {
      const [t, v] = e.value.split(':');
      l.U_Grupo = t === 'G' ? v : '';
      l.U_Regra = t === 'R' ? v : E[GR].find((g) => g.U_Grupo === v)?.U_Regra || '';
    } else if (e.dataset.k === 'U_Condutor') {
      const ativo = aux.ativos[l.U_Ativo];
      if (ativo?.U_Tipo === 'VEI' || !l.U_Ativo) l.U_Condutor = e.value;
      else l.U_Local = e.value;
    } else l[e.dataset.k] = e.value;
  });
}

function preencherPadrao(l) {
  const a = aux.ativos[l.U_Ativo];
  if (!a) return;
  l.U_Familia ||= a.U_Familia || '';
  l.U_AtvDesc = a.Name;
}

function bind(root) {
  root.oninput = debounce(async (ev) => {
    const t = ev.target;
    if (t.dataset.h === '_bp') {
      const r = await get(`/lookup/partners${qs({ q: t.value })}`).catch(() => []);
      $('#dlBP', root).innerHTML = r.map((p) => `<option value="${esc(p.CardCode)} — ${esc(p.CardName)}">${esc(p.FederalTaxID || '')}</option>`).join('');
    }
    if (t.dataset.k === 'U_ItemCode') {
      const r = await get(`/lookup/items${qs({ q: t.value })}`).catch(() => []);
      $('#dlItens', root).innerHTML = r.map((x) => `<option value="${esc(x.ItemCode)}">${esc(x.ItemName)}</option>`).join('');
    }
  }, 300);
  root.onchange = (ev) => {
    const k = ev.target.dataset.k;
    if (['U_Familia', 'U_Ativo', '_cob', 'U_Grupo'].includes(k)) {
      lerFormulario(root);
      if (k === 'U_Ativo') preencherPadrao(E[LN][Number(ev.target.dataset.l)]);
      if (k === 'U_Familia') E[LN][Number(ev.target.dataset.l)].U_Ativo = '';
      draw(root);
    }
  };
  root.onclick = async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'voltar') return ctx.go('contratos');
    if (a === 'imprimir') return imprimirContrato(E, { empresa: S.cfg.EMPRESA, regras: Object.fromEntries(aux.regras.map((r) => [r.Code, r])), ativos: aux.ativos });
    if (a === 'addl') {
      lerFormulario(root);
      E[LN].push({ U_Familia: '', U_Ativo: '', U_Regra: (aux.regras.find((r) => r.Code === 'MENSAL') || aux.regras.find((r) => r.U_Tipo === 'ITEM'))?.Code || '', U_Grupo: '', U_Valor: 0, U_Diaria: 0, U_Franquia: 0, U_VlrExced: 0, U_StatusL: 'PEN' });
      return draw(root);
    }
    if (a === 'addg') {
      lerFormulario(root);
      E[GR].push({ U_Grupo: `G${E[GR].length + 1}`, U_Descr: '', U_Regra: aux.regras.find((r) => r.U_Tipo === 'AGRUP')?.Code || '', U_ItemCode: '', U_Valor: 0, U_Franquia: 0, U_VlrExced: 0 });
      return draw(root);
    }
    if (b.dataset.rml) {
      lerFormulario(root);
      E[LN].splice(Number(b.dataset.rml), 1);
      return draw(root);
    }
    if (b.dataset.rmg) {
      lerFormulario(root);
      E[GR].splice(Number(b.dataset.rmg), 1);
      return draw(root);
    }
    if (b.dataset.mov) return ctx.go('movimentacao', { tipo: b.dataset.mov, ctr: E.DocEntry, linha: b.dataset.line });
    if (b.dataset.termo) {
      return acao(async () => {
        const m = await get(`/movements/${b.dataset.termo}`);
        const [at, nv] = await Promise.all([get(`/assets/${encodeURIComponent(m.U_Ativo)}`).catch(() => null),
          m.U_AtivoNovo ? get(`/assets/${encodeURIComponent(m.U_AtivoNovo)}`).catch(() => null) : null]);
        imprimirTermo(m, { empresa: S.cfg.EMPRESA, contrato: E, ativo: at, novo: nv });
      });
    }
    if (a === 'salvar') return salvar(root);
    if (b.dataset.st) return mudarStatus(root, b.dataset.st);
  };
}

async function salvar(root) {
  lerFormulario(root);
  try {
    const salvo = await (E.DocEntry ? put(`/contracts/${E.DocEntry}`, E) : post('/contracts', E));
    toast('Contrato salvo.');
    ctx.go('contratos', { id: salvo.DocEntry });
  } catch (e) {
    msg('#ctrMsg', 'err', e.message);
    window.scrollTo(0, 0);
  }
}

async function mudarStatus(root, st) {
  lerFormulario(root);
  const textos = {
    ATV: ['Ativar contrato', 'Os equipamentos ficam reservados e o contrato passa a ser faturado a partir das entregas.'],
    SUS: ['Suspender contrato', 'Novas entregas ficam bloqueadas. Os itens já entregues continuam sendo cobrados.'],
    ENC: ['Encerrar contrato', 'Itens que nunca foram entregues serão removidos. O contrato não poderá mais ser alterado.'],
  };
  const [titulo, texto] = textos[st];
  if (!(await confirmar({ titulo, texto, ok: titulo.split(' ')[0], perigo: st === 'ENC' }))) return;
  try {
    await post(`/contracts/${E.DocEntry}/status`, { status: st, U_Versao: E.U_Versao });
    toast('Status atualizado.');
    ctx.go('contratos', { id: E.DocEntry });
  } catch (e) {
    msg('#ctrMsg', 'err', e.message);
    window.scrollTo(0, 0);
  }
}
