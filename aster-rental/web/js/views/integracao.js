// Integração SAP B1: prontidão para produção, de-para com cadastros nativos, monitor de envios e carga de equipamentos.
import { $, $$, esc, fmtDT, DOM, toast, acao, msg, confirmar } from '../util.js';
import { get, post, put, qs } from '../api.js';
import { filtro } from '../state.js';

const ABAS = [['pront', 'Prontidão'], ['depara', 'De-para com o B1'], ['monitor', 'Monitor de integração'], ['series', 'Equipamentos do B1']];
const STATUS_INT = { OK: 'Integrado', ERR: 'Com erro', IGN: 'Ignorado' };
const TIPO_INT = { remessa: 'Remessa / retorno do bem', chamado: 'Chamada de serviço', atividade: 'Atividade do técnico' };
const OBJ_NOME = { DeliveryNotes: 'Entrega', Returns: 'Devolução', StockTransfers: 'Transferência de estoque', ServiceCalls: 'Chamada de serviço', Activities: 'Atividade' };

export async function render(root, params, c) {
  const f = filtro('integracao', { aba: 'pront', status: '' });
  if (params.aba) f.aba = params.aba;
  root.innerHTML = `<div class="card"><div class="tabs-in">${ABAS.map(([k, t]) => `<button type="button" data-aba="${k}" class="${f.aba === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div id="intBox"><div class="empty">Carregando…</div></div></div>`;
  root.onclick = (ev) => {
    const a = ev.target.closest('[data-aba]');
    if (a) {
      f.aba = a.dataset.aba;
      render(root, {}, c);
    }
  };
  const box = $('#intBox', root);
  if (f.aba === 'pront') return prontidao(box, c);
  if (f.aba === 'depara') return depara(box);
  if (f.aba === 'monitor') return monitor(box, f);
  return series(box);
}

/* ---------------- prontidão ---------------- */

async function prontidao(box, c) {
  const r = await get('/integration/readiness');
  const pct = r.total ? Math.round((r.pronto / r.total) * 100) : 0;
  const grupos = [...new Set(r.itens.map((i) => i.grupo))];
  const falta = r.falta ? [...r.falta.tabelas, ...r.falta.campos, ...r.falta.objetos] : [];
  const sel = { ok: '<span class="badge b-OK">OK</span>', pendente: '<span class="badge s-violado">Pendente</span>', opcional: '<span class="badge b-RAS">Opcional</span>' };
  box.innerHTML = `<div class="row" style="margin-bottom:8px"><div style="flex:1;min-width:220px"><b style="font-size:20px">${r.pronto} de ${r.total}</b> itens prontos para operar com o SAP B1
      <div class="bar" style="max-width:420px"><i style="width:${pct}%;background:${pct === 100 ? 'var(--teal)' : 'var(--arrow)'}"></i></div></div>
    <button type="button" data-a="atualizar">Verificar de novo</button></div>
  <p class="sub">A verificação só lê o SAP B1. Cada item mostra onde corrigir: no B1 (cadastro nativo) ou no Áster (de-para e cadastros).</p>
  ${grupos.map((g) => `<h3>${esc(g)}</h3><div class="tbl"><table><thead><tr><th style="width:110px">Situação</th><th>Verificação</th><th>Detalhe</th><th>Onde corrigir</th></tr></thead><tbody>
    ${r.itens.filter((i) => i.grupo === g).map((i) => `<tr><td>${sel[i.ok] || esc(i.ok)}</td><td>${esc(i.item)}</td><td class="wrap">${esc(i.detalhe)}</td><td>${esc(i.onde)}</td></tr>`).join('')}</tbody></table></div>`).join('')}
  <h3>Estrutura do Áster no SAP B1</h3>
  ${falta.length ? `<div class="msg warn">Faltam ${falta.length} item(ns) no banco do B1. A criação usa a Service Layer (tabelas, campos e objetos de usuário), nunca SQL direto.
      Use um superusuário, de preferência sem outros usuários conectados ao B1.</div>
    <details><summary class="sub" style="cursor:pointer">Ver a lista</summary><div class="log" style="margin-top:6px">${falta.map(esc).join('\n')}</div></details>
    ${c.can('admin.instalar') ? '<div class="row" style="margin-top:10px"><button type="button" class="primary" data-a="instalar">Criar o que falta no B1</button></div>' : ''}`
    : '<div class="msg ok">Todas as tabelas, campos e objetos do Áster existem no B1, incluindo os campos de usuário nos objetos nativos (documentos de marketing, transferência, chamada de serviço e atividade).</div>'}
  <div id="instLog"></div>`;
  box.onclick = async (ev) => {
    const a = ev.target.closest('[data-a]')?.dataset.a;
    if (a === 'atualizar') return prontidao(box, c);
    if (a === 'instalar') {
      if (!(await confirmar({ titulo: 'Criar estruturas no SAP B1', texto: `Serão criados ${falta.length} item(ns) no banco do B1 pela Service Layer. Pode ser executado de novo com segurança.`, ok: 'Criar' }))) return;
      await acao(async () => {
        const res = await post('/admin/install', {});
        $('#instLog', box).innerHTML = `<div class="log" style="margin-top:10px">${res.log.map(esc).join('\n')}</div>`;
        toast(res.errors ? `Concluído com ${res.errors} erro(s).` : 'Estruturas criadas.', res.errors ? 'err' : 'ok');
        setTimeout(() => prontidao(box, c), 1200);
      });
    }
  };
}

/* ---------------- de-para ---------------- */

const CAMPOS = [
  { sec: 'Faturamento da locação', txt: 'Vai em todo documento de faturamento (esboço, pedido ou NF). O contrato pode ter vendedor, condição, projeto e endereço próprios.' },
  { k: 'B1_FILIAL', l: 'Filial padrão', lista: 'filiais' },
  { k: 'USAGE', l: 'Utilização da NF de locação', lista: 'utilizacoes' },
  { k: 'B1_SERIE_LOC', l: 'Série da NF de locação (código da série)', tipo: 'number' },
  { k: 'B1_FORMA_PGTO', l: 'Forma de pagamento (boleto)', lista: 'formasPgto' },
  { k: 'B1_COND_PGTO', l: 'Condição de pagamento padrão', lista: 'condicoes' },
  { k: 'B1_VENDEDOR', l: 'Vendedor padrão', lista: 'vendedores' },
  { k: 'ITEM_MULTA', l: 'Item de repasse de multa', tipo: 'item' },
  { sec: 'Remessa e retorno do bem', txt: 'O bem sai do estoque do B1 com o nº de série. A NF de remessa usa o "valor do bem" do cadastro do ativo; a devolução referencia a entrega original.' },
  { k: 'B1_REMESSA', l: 'Documento na entrega e na devolução', opcoes: DOM.remessa },
  { k: 'B1_DEP_PATIO', l: 'Depósito do pátio', lista: 'depositos' },
  { k: 'B1_DEP_LOCACAO', l: 'Depósito de bens em clientes (modo transferência)', lista: 'depositos' },
  { k: 'B1_USAGE_REM', l: 'Utilização da NF de remessa', lista: 'utilizacoes' },
  { k: 'B1_USAGE_RET', l: 'Utilização da NF de retorno', lista: 'utilizacoes' },
  { k: 'B1_SERIE_REM', l: 'Série da NF de remessa', tipo: 'number' },
  { k: 'B1_SERIE_RET', l: 'Série da NF de retorno', tipo: 'number' },
  { sec: 'Pós-venda (módulo de serviço do B1)', txt: 'O chamado vira Chamada de serviço e alimenta o Cartão de equipamento; a OS agendada vira Atividade na agenda do técnico. OS com cobrança gera esboço de NF de serviço.' },
  { k: 'PV_SERVICECALL', l: 'Criar chamada de serviço nativa', opcoes: { S: 'Sim', N: 'Não (chamados só no Áster)' } },
  { k: 'PV_CALL_TIPO', l: 'Tipo de chamada', lista: 'tiposChamada' },
  { k: 'PV_CALL_ORIGEM', l: 'Origem da chamada', lista: 'origens' },
  { k: 'PV_CALL_PROBLEMA', l: 'Tipo de problema', lista: 'problemas' },
  { k: 'PV_ATIVIDADE', l: 'Criar atividade para o técnico', opcoes: { S: 'Sim', N: 'Não' } },
  { k: 'PV_ATV_TIPO', l: 'Tipo de atividade', lista: 'tiposAtividade' },
  { k: 'ITEM_SERVICO', l: 'Item de serviço padrão (mão de obra)', tipo: 'item' },
  { k: 'B1_USAGE_SRV', l: 'Utilização da NF de serviço / peças', lista: 'utilizacoes' },
  { k: 'B1_SERIE_SRV', l: 'Série da NF de serviço', tipo: 'number' },
];

async function depara(box) {
  const kinds = [...new Set(CAMPOS.map((x) => x.lista).filter(Boolean))];
  const [p, L] = await Promise.all([get('/admin/settings'), get(`/b1/lists?k=${kinds.join(',')}`)]);
  const campo = (x) => {
    const v = p[x.k] ?? '';
    if (x.opcoes) return `<select data-p="${x.k}">${Object.entries(x.opcoes).map(([k, t]) => `<option value="${esc(k)}" ${String(v) === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    const lista = L[x.lista];
    if (Array.isArray(lista)) {
      const tem = lista.some((o) => String(o.id) === String(v));
      return `<select data-p="${x.k}"><option value="">(não informado)</option>${lista.map((o) => `<option value="${esc(o.id)}" ${String(o.id) === String(v) ? 'selected' : ''}>${esc(o.nome)} (${esc(o.id)})</option>`).join('')}
        ${v && !tem ? `<option value="${esc(v)}" selected>${esc(v)} — não encontrado no B1</option>` : ''}</select>`;
    }
    const aviso = lista?.erro ? `<div class="sub" style="color:var(--coral)">${esc(lista.erro)}</div>` : '';
    return `<input data-p="${x.k}" ${x.tipo === 'number' ? 'type="number"' : ''} ${x.tipo === 'item' ? 'list="dlItensB1"' : ''} value="${esc(v)}" placeholder="${x.tipo === 'number' ? 'padrão do B1' : ''}">${aviso}`;
  };
  let html = '';
  for (const x of CAMPOS) {
    if (x.sec) html += `${html ? '</div>' : ''}<h3>${esc(x.sec)}</h3><p class="sub">${esc(x.txt)}</p><div class="grid">`;
    else html += `<div><label>${esc(x.l)}</label>${campo(x)}</div>`;
  }
  box.innerHTML = `<p class="sub">As listas vêm dos cadastros nativos do SAP B1 (filiais, depósitos, utilizações, formas e condições de pagamento, vendedores, projetos, chamadas de serviço e atividades).
    O que fica em branco usa o padrão do B1 (do item, do cliente ou da série).</p>${html}</div><datalist id="dlItensB1"></datalist>
    <div id="dpMsg"></div><div class="row" style="margin-top:12px"><span class="spacer"></span><button type="button" class="primary" data-a="salvar">Salvar de-para</button></div>`;
  box.oninput = async (ev) => {
    if (ev.target.getAttribute('list') !== 'dlItensB1' || ev.target.value.length < 2) return;
    const r = await get(`/lookup/items${qs({ q: ev.target.value })}`).catch(() => []);
    $('#dlItensB1', box).innerHTML = r.map((i) => `<option value="${esc(i.ItemCode)}">${esc(i.ItemName)}</option>`).join('');
  };
  box.onclick = async (ev) => {
    if (!ev.target.closest('[data-a=salvar]')) return;
    const body = {};
    $$('[data-p]', box).forEach((e) => (body[e.dataset.p] = e.value));
    try {
      await put('/admin/settings', body);
      toast('De-para salvo. Confira a prontidão.');
    } catch (e) {
      msg('#dpMsg', 'err', e.message);
    }
  };
}

/* ---------------- monitor ---------------- */

async function monitor(box, f) {
  const rows = await get(`/integration/log${qs({ status: f.status })}`);
  box.innerHTML = `<div class="toolbar"><div><label>Situação</label><select id="mnSt"><option value="">Todas</option>${Object.entries(STATUS_INT).map(([k, t]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <p class="sub" style="flex:1;margin:0">Cada envio ao SAP B1 fica registrado. Uma falha no B1 não desfaz a operação no Áster: corrija a causa (cadastro, de-para) e reprocesse.</p></div>
  <div class="tbl"><table><thead><tr><th>Data</th><th>Integração</th><th>Registro no Áster</th><th>Objeto no B1</th><th>Situação</th><th class="num">Nº no B1</th><th>Erro</th><th class="num">Tentativas</th><th></th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td>${fmtDT(r.U_Data)}</td><td>${esc(TIPO_INT[r.U_Tipo] || r.U_Tipo)}</td>
    <td>${r.U_Tipo === 'remessa' ? `movimentação ${esc(r.U_Ref)}` : r.U_Tipo === 'chamado' ? `<a href="#/chamados?id=${esc(r.U_Ref)}">chamado ${esc(r.U_Ref)}</a>` : `<a href="#/os?id=${esc(r.U_Ref)}">OS ${esc(r.U_Ref)}</a>`}</td>
    <td>${esc(OBJ_NOME[r.U_Objeto] || r.U_Objeto)}</td><td><span class="badge ${r.U_Status === 'OK' ? 'b-OK' : r.U_Status === 'ERR' ? 's-violado' : 'b-RAS'}">${esc(STATUS_INT[r.U_Status] || r.U_Status)}</span></td>
    <td class="num">${Number(r.U_DocNum) || '—'}</td><td class="wrap">${esc(r.U_Erro || '')}</td><td class="num">${r.U_Tentativas || 1}</td>
    <td class="right">${r.U_Status === 'ERR' ? `<button type="button" class="mini primary" data-retry="${esc(r.Code)}">Reprocessar</button>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="9" class="empty">Nenhum envio registrado.</td></tr>'}</tbody></table></div>`;
  box.onchange = (ev) => {
    if (ev.target.id === 'mnSt') {
      f.status = ev.target.value;
      monitor(box, f);
    }
  };
  box.onclick = async (ev) => {
    const b = ev.target.closest('[data-retry]');
    if (!b) return;
    await acao(async () => {
      const r = await post(`/integration/log/${encodeURIComponent(b.dataset.retry)}/retry`, {});
      toast(r.ok ? 'Reprocessado com sucesso.' : `Ainda com erro: ${r.erro}`, r.ok ? 'ok' : 'err');
      monitor(box, f);
    });
  };
}

/* ---------------- equipamentos do B1 ---------------- */

async function series(box) {
  const [lista, fams, ativos] = await Promise.all([get('/integration/serials'), get('/families'), get('/assets?size=200')]);
  // Sugere a família e o item de faturamento pelo que já existe no Áster com o mesmo item do bem.
  const porItem = {};
  for (const a of ativos.items) if (a.U_ItemBem && !porItem[a.U_ItemBem]) porItem[a.U_ItemBem] = a;
  box.innerHTML = `<p class="sub">Números de série cadastrados no SAP B1 que ainda não são ativos do Áster. Ao trazer, o ativo nasce ligado ao item e ao nº de série, pronto para a NF de remessa.
    Complete depois valores, medidor e dados do veículo em Ativos.</p>
  <div class="tbl"><table><thead><tr><th><input type="checkbox" id="srTodos"></th><th>Item do bem</th><th>Descrição</th><th>Nº de série</th><th>Família no Áster</th><th>Item de faturamento</th></tr></thead><tbody>
  ${lista.map((s, i) => {
    const ref = porItem[s.ItemCode];
    return `<tr><td><input type="checkbox" data-sel="${i}"></td><td>${esc(s.ItemCode)}</td><td>${esc(s.ItemDescription || '')}</td><td>${esc(s.SerialNumber)}</td>
      <td><select data-fam="${i}"><option value="">Selecione…</option>${fams.map((x) => `<option value="${esc(x.Code)}" ${ref?.U_Familia === x.Code ? 'selected' : ''}>${esc(x.Name)}</option>`).join('')}</select></td>
      <td><input data-itf="${i}" value="${esc(ref?.U_ItemCode || '')}" class="w140"></td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty">Todos os nºs de série do B1 já estão no Áster.</td></tr>'}</tbody></table></div>
  <div id="srMsg"></div>${lista.length ? '<div class="row" style="margin-top:10px"><span class="spacer"></span><button type="button" class="primary" data-a="trazer">Trazer selecionados</button></div>' : ''}`;
  box.onchange = (ev) => {
    if (ev.target.id === 'srTodos') $$('[data-sel]', box).forEach((e) => (e.checked = ev.target.checked));
  };
  box.onclick = async (ev) => {
    if (!ev.target.closest('[data-a=trazer]')) return;
    const linhas = $$('[data-sel]', box).filter((e) => e.checked).map((e) => {
      const i = Number(e.dataset.sel);
      return { ...lista[i], nome: lista[i].ItemDescription, familia: $(`[data-fam="${i}"]`, box).value, itemFat: $(`[data-itf="${i}"]`, box).value };
    });
    if (!linhas.length) return msg('#srMsg', 'warn', 'Selecione ao menos um nº de série.');
    try {
      const r = await post('/integration/serials/import', { linhas });
      const ok = r.filter((x) => x.ok);
      const err = r.filter((x) => !x.ok);
      toast(`${ok.length} ativo(s) criado(s)${ok.length ? `: ${ok.map((x) => x.code).join(', ')}` : ''}.`);
      if (err.length) msg('#srMsg', 'err', err.map((x) => `${x.serie}: ${x.message}`).join(' · '));
      else series(box);
    } catch (e) {
      msg('#srMsg', 'err', e.message);
    }
  };
}
