// Ordens de serviço: abertura, agenda, execução em campo (checklist, peças, fotos, assinatura), orçamento e conclusão.
import { $, $$, esc, brl, num, fmtD, fmtDT, UN, DOM, badge, options, toast, acao, modal, closeModal, msg, debounce, pager, confirmar, SEARCH, SETA, hoje } from '../util.js';
import { get, post, put, qs } from '../api.js';
import { filtro, S } from '../state.js';
import { padAssinatura, reduzirFoto } from '../campo.js';
import { imprimirOS } from '../print.js';

const OS1 = 'SPS_LOS1Collection';
const ABERTAS = ['ABE', 'AGE', 'EXE', 'AOR'];
let F = null; // dados de execução em edição
let pad = null;

export async function render(root, params, c) {
  if (params.id) return detalhe(root, params.id, c);
  const f = filtro('os', { situacao: 'abertas', tipo: '', tecnico: '', q: '', page: 1 });
  const [r, tecs] = await Promise.all([
    get(`/orders${qs({ abertas: f.situacao === 'abertas' ? '1' : '', status: f.situacao !== 'abertas' ? f.situacao : '', tipo: f.tipo, tecnico: f.tecnico, q: f.q, page: f.page, size: 50 })}`),
    get('/technicians'),
  ]);
  const nome = Object.fromEntries(tecs.map((t) => [t.Code, t.Name]));
  root.innerHTML = `<div class="card"><div class="toolbar">
    <div><label>Situação</label><select data-f="situacao"><option value="abertas" ${f.situacao === 'abertas' ? 'selected' : ''}>Em aberto</option>${options(DOM.statusOS, f.situacao)}<option value="" ${f.situacao === '' ? 'selected' : ''}>Todas</option></select></div>
    <div><label>Tipo</label><select data-f="tipo">${options(DOM.tipoOS, f.tipo, { vazio: 'Todos' })}</select></div>
    ${c.can('os.todas') ? `<div><label>Técnico</label><select data-f="tecnico"><option value="">Todos</option>${tecs.map((t) => `<option value="${esc(t.Code)}" ${f.tecnico === t.Code ? 'selected' : ''}>${esc(t.Name)}</option>`).join('')}</select></div>` : ''}
    <div style="flex:1" class="search"><label>Buscar</label>${SEARCH}<input data-f="q" value="${esc(f.q)}" placeholder="cliente, equipamento, descrição"></div>
    ${c.can('os.editar') ? '<button class="primary" type="button" data-a="nova">+ Nova OS</button>' : ''}</div>
  ${r.semTecnico ? '<div class="msg warn">Seu usuário não está ligado a um técnico. Peça ao gestor para vincular em Pós-venda › Técnicos e planos.</div>' : ''}
  <div class="tbl"><table><thead><tr><th>Nº</th><th>Tipo</th><th>Cliente</th><th>Equipamento</th><th>Técnico</th><th>Agenda</th><th>Prioridade</th><th>Status</th><th class="num">A cobrar</th></tr></thead><tbody>
  ${r.items.map((o) => `<tr class="click" data-id="${o.DocEntry}"><td>${SETA}${o.DocNum}</td><td>${esc(DOM.tipoOS[o.U_Tipo])}</td><td>${esc(o.U_CardName)}</td>
    <td>${o.U_Parada === 'S' && ABERTAS.includes(o.U_Status) ? '<span class="badge p-URG">PARADO</span> ' : ''}${esc(o.U_Ativo)}</td><td>${esc(nome[o.U_Tecnico] || '—')}</td>
    <td>${o.U_DtAgenda ? `${fmtD(o.U_DtAgenda)} ${esc(o.U_HrAgenda || '')}` : '—'}</td><td>${badge(o.U_Prior, DOM.prioridade, 'p-')}</td><td>${badge(o.U_Status, DOM.statusOS)}</td>
    <td class="num">${Number(o.U_Valor) ? brl(o.U_Valor) : '—'}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Nenhuma OS.</td></tr>'}</tbody></table></div>${pager(r)}</div>`;

  const reload = () => render(root, {}, c);
  root.onchange = (ev) => {
    const e = ev.target;
    if (e.dataset.f && e.tagName === 'SELECT') {
      f[e.dataset.f] = e.value;
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
    if (ev.target.closest('[data-a=nova]')) return nova(c);
    const tr = ev.target.closest('tr[data-id]');
    if (tr) c.go('os', { id: tr.dataset.id });
  };
}

export async function nova(c, pre = {}) {
  const [ativos, tecs] = await Promise.all([get('/assets?size=200'), get('/technicians')]);
  const m = modal(`<h2>Nova ordem de serviço</h2><div class="grid">
    <div><label>Tipo</label><select id="nTipo">${options(DOM.tipoOS, pre.tipo || 'COR')}</select></div>
    <div><label>Prioridade</label><select id="nPri">${options(DOM.prioridade, 'MED')}</select></div>
    <div class="span2"><label>Equipamento</label><select id="nAtv"><option value="">Selecione…</option>${ativos.items.filter((a) => a.U_Status !== 'BAI').map((a) => `<option value="${esc(a.Code)}" ${pre.ativo === a.Code ? 'selected' : ''}>${esc(a.Code)} — ${esc(a.Name)}${a.U_Status === 'LOC' ? ' (no cliente)' : ` (${esc(DOM.statusAtivo[a.U_Status])})`}</option>`).join('')}</select></div>
    <div><label>Técnico</label><select id="nTec"><option value="">(agendar depois)</option>${tecs.filter((t) => t.U_Ativo !== 'N').map((t) => `<option value="${esc(t.Code)}">${esc(t.Name)}</option>`).join('')}</select></div>
    <div><label>Data</label><input type="date" id="nData" value="${hoje()}"></div><div><label>Hora</label><input type="time" id="nHora" value="08:00"></div>
    <div><label>Duração prevista (min)</label><input type="number" id="nDur" min="0" value="120"></div>
    <div class="span2"><label>Problema / solicitação</label><textarea id="nDesc" rows="3"></textarea></div>
    <div class="span2"><label class="chk-inline"><input type="checkbox" id="nPar"> Equipamento parado no cliente: descontar da mensalidade a partir de hoje</label></div>
  </div><p class="sub">Equipamento locado puxa o cliente e o contrato automaticamente. Equipamento no pátio gera OS de uso interno.</p><div id="nMsg"></div>
  <div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="primary" data-x="1">Abrir OS</button></div>`);
  m.onclick = async (ev) => {
    const b = ev.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === '0') return closeModal();
    try {
      const r = await post('/orders', { tipo: $('#nTipo').value, prior: $('#nPri').value, ativo: $('#nAtv').value, tecnico: $('#nTec').value,
        data: $('#nTec').value ? $('#nData').value : '', hora: $('#nHora').value, duracao: $('#nDur').value, descricao: $('#nDesc').value, parada: $('#nPar').checked });
      closeModal();
      toast(`OS ${r.DocNum} aberta.`);
      c.go('os', { id: r.DocEntry });
    } catch (e) {
      msg('#nMsg', 'err', e.message);
    }
  };
}

const lerJSON = (s, d) => {
  try {
    return JSON.parse(s || '');
  } catch {
    return d;
  }
};

async function detalhe(root, id, c) {
  const o = await get(`/orders/${id}`);
  if (!F || F.id !== o.DocEntry || F.versao !== o.U_Versao) {
    F = { id: o.DocEntry, versao: o.U_Versao, laudo: o.U_Laudo || '', medidor: o.U_Medidor || '', respons: o.U_Respons || '', docResp: o.U_DocResp || '',
      checklist: lerJSON(o.U_Checklist, {}), fotos: lerJSON(o.U_Fotos, []), assinatura: o.U_Assinatura || '',
      itens: (o[OS1] || []).map((i) => ({ tipo: i.U_Tipo, itemCode: i.U_ItemCode, descr: i.U_Descr, qtd: i.U_Qtd, preco: i.U_Preco, cobrar: i.U_Cobrar })), sujo: false };
  }
  const aberta = ABERTAS.includes(o.U_Status);
  const exec = aberta && (c.can('os.executar') || c.can('os.editar'));
  const total = F.itens.filter((i) => i.cobrar === 'S').reduce((s, i) => s + (Number(i.qtd) || 0) * (Number(i.preco) || 0), 0);
  const custo = F.itens.reduce((s, i) => s + (Number(i.qtd) || 0) * (Number(i.preco) || 0), 0);
  const un = UN(o.ativo?.U_Tipo);
  const ro = exec ? '' : 'disabled';

  root.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">OS ${o.DocNum} — ${esc(DOM.tipoOS[o.U_Tipo])}</h2><span class="spacer"></span>
    <button type="button" class="mini" data-a="imprimir">Relatório</button><button type="button" class="mini" data-a="voltar">‹ Voltar à lista</button></div>
    <div class="row" style="margin:8px 0 12px">${badge(o.U_Status, DOM.statusOS)} ${badge(o.U_Prior, DOM.prioridade, 'p-')}
      ${o.U_Parada === 'S' ? `<span class="badge p-URG">PARADO DESDE ${fmtD(o.U_DtParada)}${aberta ? '' : ' (encerrado)'}</span>` : ''}
      ${o.U_Orc ? `<span class="chip">Orçamento: ${esc(DOM.orcamento[o.U_Orc])}${o.U_OrcAprov ? ` por ${esc(o.U_OrcAprov)}` : ''}</span>` : ''}
      ${o.U_DocNum ? `<span class="chip">Rascunho de NF nº ${o.U_DocNum} no SAP B1</span>` : ''}</div>
    <div class="head-info">
      <div><b>Cliente</b>${esc(o.U_CardName)}</div><div><b>Equipamento</b>${esc(o.U_Ativo)} ${esc(o.ativo?.Name || '')}</div>
      <div><b>Placa / série</b>${esc(o.ativo?.U_Placa || o.ativo?.U_Serie || '—')}</div><div><b>Local</b>${esc(o.U_Local || '—')}</div>
      <div><b>Técnico</b>${esc(o.tecnicoNome || '—')}</div><div><b>Agenda</b>${o.U_DtAgenda ? `${fmtD(o.U_DtAgenda)} ${esc(o.U_HrAgenda)} · ${o.U_Duracao} min` : 'sem data'}</div>
      <div><b>Contrato</b>${o.U_CtrEntry ? `<a href="#/contratos?id=${o.U_CtrEntry}">nº ${o.U_CtrEntry}</a>` : '—'}</div>
      <div><b>Chamado</b>${o.U_ChaEntry ? `<a href="#/chamados?id=${o.U_ChaEntry}">nº ${o.U_ChaEntry}</a>` : '—'}</div>
      <div><b>Início / fim</b>${o.U_CheckIn ? fmtDT(o.U_CheckIn) : '—'}${o.U_CheckOut ? ` → ${fmtDT(o.U_CheckOut)}` : ''}</div>
      ${o.U_Plano ? `<div><b>Plano preventivo</b>${esc(o.U_Plano)}</div>` : ''}
      ${o.pesquisa ? `<div><b>Pesquisa de satisfação</b>${Number(o.pesquisa.U_Nota) >= 0 ? `nota <b style="display:inline;color:var(--ink);font-size:14px">${o.pesquisa.U_Nota}</b>` : 'aguardando resposta'}</div>` : ''}
    </div>
    ${o.U_Descricao ? `<div class="msg info" style="white-space:pre-wrap">${esc(o.U_Descricao)}</div>` : ''}
    <div class="row" style="margin-top:10px">
      ${['ABE', 'AGE'].includes(o.U_Status) && c.can('os.editar') ? '<button type="button" data-a="agendar">Agendar / trocar técnico</button>' : ''}
      ${['ABE', 'AGE'].includes(o.U_Status) && exec ? '<button type="button" class="teal" data-a="iniciar">Iniciar atendimento</button>' : ''}
      ${o.U_Status === 'AOR' && exec ? '<button type="button" class="primary" data-a="aprovar">Registrar aprovação do cliente</button><button type="button" class="danger" data-a="recusar">Cliente recusou</button>' : ''}
      ${aberta && c.can('os.editar') ? '<span class="spacer"></span><button type="button" class="danger" data-a="cancelar">Cancelar OS</button>' : ''}</div></div>

  <div class="card"><h2>Execução</h2><div class="grid">
    <div><label>${o.ativo?.U_Tipo === 'VEI' ? 'Hodômetro (km)' : 'Horímetro (h)'} — último ${num(o.ativo?.U_Medidor, 0)} ${un}</label><input type="number" min="0" step="0.1" data-e="medidor" value="${esc(F.medidor || '')}" ${ro}></div>
    <div><label>Responsável do cliente</label><input data-e="respons" value="${esc(F.respons)}" ${ro}></div>
    <div><label>Documento (CPF/RG)</label><input data-e="docResp" value="${esc(F.docResp)}" ${ro}></div>
  </div>
  <h3>Checklist${o.U_Plano ? ' do plano preventivo' : ''}</h3><table class="chk"><tbody>${o.checklistItens.map((it, i) => `<tr><td>${esc(it)}</td><td style="white-space:nowrap">
    ${['OK', 'NOK', 'NA'].map((v) => `<label><input type="radio" name="oc${i}" data-chk="${esc(it)}" value="${v}" ${F.checklist[it]?.r === v ? 'checked' : ''} ${ro}> ${{ OK: 'OK', NOK: 'Não OK', NA: 'N/A' }[v]}</label>`).join('')}</td>
    <td><input data-chko="${esc(it)}" value="${esc(F.checklist[it]?.o || '')}" placeholder="observação" ${ro}></td></tr>`).join('')}</tbody></table>

  <h3>Peças e serviços</h3><div class="tbl"><table><thead><tr><th>Tipo</th><th>Item SAP B1</th><th>Descrição</th><th class="num">Qtd</th><th class="num">Preço</th><th class="num">Total</th><th title="Sim para mau uso ou avaria; não para garantia e desgaste normal">Cobrar do cliente</th><th></th></tr></thead><tbody>
  ${F.itens.map((i, n) => `<tr><td><select data-i="${n}" data-k="tipo" ${ro}>${options(DOM.tipoItemOS, i.tipo)}</select></td>
    <td><input data-i="${n}" data-k="itemCode" value="${esc(i.itemCode)}" class="w110" list="osItens" ${ro}></td>
    <td><input data-i="${n}" data-k="descr" value="${esc(i.descr)}" ${ro}></td>
    <td><input type="number" min="0" step="0.01" data-i="${n}" data-k="qtd" value="${esc(i.qtd)}" class="w80" ${ro}></td>
    <td><input type="number" min="0" step="0.01" data-i="${n}" data-k="preco" value="${esc(i.preco)}" class="w110" ${ro}></td>
    <td class="num">${brl((Number(i.qtd) || 0) * (Number(i.preco) || 0))}</td>
    <td><select data-i="${n}" data-k="cobrar" ${ro}>${options({ N: 'Não', S: 'Sim' }, i.cobrar)}</select></td>
    <td>${exec ? `<button type="button" class="mini danger" data-del="${n}">×</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Nenhuma peça ou serviço.</td></tr>'}
  </tbody></table></div><datalist id="osItens"></datalist>
  <div class="row" style="margin-top:8px">${exec ? '<button type="button" class="mini" data-a="addItem">+ Peça ou serviço</button>' : ''}<span class="spacer"></span>
    <span class="sub">Custo total ${brl(custo)} · <b>a cobrar do cliente ${brl(total)}</b></span>
    ${exec && total > 0 && o.U_Orc !== 'APR' && o.U_Status !== 'AOR' ? '<button type="button" class="primary" data-a="orcamento">Enviar orçamento para aprovação</button>' : ''}</div>

  <div class="grid" style="margin-top:12px"><div class="span2"><label>Laudo / serviço executado</label><textarea data-e="laudo" rows="4" ${ro}>${esc(F.laudo)}</textarea></div></div>
  <h3>Fotos (até 4)</h3><div class="fotos">${F.fotos.map((f, n) => `<figure><img src="${f.src}" alt="${esc(f.legenda || `foto ${n + 1}`)}">
    <figcaption><input data-foto="${n}" value="${esc(f.legenda || '')}" placeholder="legenda" ${ro}>${exec ? `<button type="button" class="mini danger" data-delfoto="${n}">×</button>` : ''}</figcaption></figure>`).join('')}
    ${exec && F.fotos.length < 4 ? '<label class="chk-inline" style="align-self:center"><input type="file" accept="image/*" capture="environment" id="osFoto" style="max-width:240px"></label>' : ''}</div>
    ${!F.fotos.length && !exec ? '<p class="sub">Sem fotos.</p>' : ''}
  <h3>Assinatura do responsável</h3>${exec ? '<canvas class="sig" id="osSig" width="1040" height="320"></canvas><div class="row"><button type="button" class="mini" data-a="limparSig">Limpar assinatura</button></div>'
    : F.assinatura ? `<img src="${F.assinatura}" alt="assinatura" style="max-width:320px;border:1px solid var(--line);border-radius:4px">` : '<p class="sub">Sem assinatura.</p>'}
  <div id="osMsg"></div>
  ${exec ? `<div class="row" style="margin-top:12px"><span class="spacer"></span><button type="button" data-a="salvar">Salvar rascunho</button>
    ${o.U_Status !== 'AOR' ? '<button type="button" class="primary" data-a="concluir">Concluir OS</button>' : ''}</div>` : ''}
  </div>`;

  pad = exec ? padAssinatura($('#osSig', root), F.assinatura) : null;
  const ler = () => {
    $$('[data-e]', root).forEach((e) => (F[e.dataset.e] = e.value));
    $$('[data-chk]', root).forEach((e) => {
      if (e.checked) F.checklist[e.dataset.chk] = { ...(F.checklist[e.dataset.chk] || {}), r: e.value };
    });
    $$('[data-chko]', root).forEach((e) => {
      if (e.value || F.checklist[e.dataset.chko]) F.checklist[e.dataset.chko] = { ...(F.checklist[e.dataset.chko] || {}), o: e.value };
    });
    $$('[data-i]', root).forEach((e) => (F.itens[Number(e.dataset.i)][e.dataset.k] = e.value));
    $$('[data-foto]', root).forEach((e) => (F.fotos[Number(e.dataset.foto)].legenda = e.value));
    if (pad) F.assinatura = pad.valor() || F.assinatura;
  };
  const corpo = () => ({ laudo: F.laudo, medidor: F.medidor, respons: F.respons, docResp: F.docResp, checklist: F.checklist, fotos: F.fotos, assinatura: F.assinatura,
    itens: F.itens, U_Versao: o.U_Versao });
  const redesenha = () => detalhe(root, id, c);

  root.oninput = debounce(async (ev) => {
    if (ev.target.dataset.k !== 'itemCode' || ev.target.value.length < 2) return;
    const r = await get(`/lookup/items${qs({ q: ev.target.value })}`).catch(() => []);
    $('#osItens').innerHTML = r.map((i) => `<option value="${esc(i.ItemCode)}">${esc(i.ItemName)}</option>`).join('');
  }, 300);
  root.onchange = async (ev) => {
    const e = ev.target;
    if (e.id === 'osFoto' && e.files?.[0]) {
      ler();
      try {
        F.fotos.push({ src: await reduzirFoto(e.files[0]), legenda: '' });
        redesenhaLocal();
      } catch (err) {
        toast(err.message, 'err');
      }
      return;
    }
    if (e.dataset.k && ['qtd', 'preco', 'cobrar'].includes(e.dataset.k)) {
      ler();
      redesenhaLocal();
    }
    if (e.dataset.k === 'itemCode' && e.value) {
      const opt = [...$('#osItens').options].find((x) => x.value === e.value);
      const n = Number(e.dataset.i);
      if (opt && !F.itens[n].descr) {
        ler();
        F.itens[n].descr = opt.textContent;
        redesenhaLocal();
      }
    }
  };
  // Redesenha mantendo o que foi digitado: F só é descartado quando a versão da OS no servidor muda.
  const redesenhaLocal = () => detalhe(root, id, c);

  root.onclick = async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.del != null) {
      ler();
      F.itens.splice(Number(b.dataset.del), 1);
      return redesenhaLocal();
    }
    if (b.dataset.delfoto != null) {
      ler();
      F.fotos.splice(Number(b.dataset.delfoto), 1);
      return redesenhaLocal();
    }
    const a = b.dataset.a;
    if (a === 'voltar') {
      F = null;
      return c.go('os');
    }
    if (a === 'imprimir') {
      ler();
      return imprimirOS({ ...o, U_Laudo: F.laudo, U_Respons: F.respons, U_DocResp: F.docResp, U_Medidor: F.medidor, U_Checklist: JSON.stringify(F.checklist),
        U_Assinatura: F.assinatura, fotos: F.fotos, itens: F.itens }, { empresa: S.cfg.EMPRESA });
    }
    if (a === 'addItem') {
      ler();
      F.itens.push({ tipo: 'PEC', itemCode: '', descr: '', qtd: 1, preco: 0, cobrar: o.U_Tipo === 'REP' ? 'S' : 'N' });
      return redesenhaLocal();
    }
    if (a === 'limparSig') {
      pad?.limpar();
      F.assinatura = '';
      return;
    }
    if (a === 'agendar') return agendar(o, root, c);
    if (a === 'iniciar') {
      return acao(async () => {
        await post(`/orders/${id}/start`, { U_Versao: o.U_Versao });
        toast('Atendimento iniciado.');
        F = null;
        redesenha();
      });
    }
    if (a === 'salvar' || a === 'orcamento') {
      ler();
      try {
        await put(`/orders/${id}`, corpo());
        F = null;
        if (a === 'orcamento') {
          const o2 = await get(`/orders/${id}`);
          await post(`/orders/${id}/quote`, { acao: 'enviar', U_Versao: o2.U_Versao });
          toast('Orçamento enviado. Registre a aprovação do cliente para concluir.');
        } else toast('Rascunho salvo.');
        redesenha();
      } catch (e) {
        msg('#osMsg', 'err', e.message);
      }
      return;
    }
    if (a === 'aprovar' || a === 'recusar') return orcamento(o, a, root, c);
    if (a === 'cancelar') return cancelar(o, root, c);
    if (a === 'concluir') {
      ler();
      const cobrar = F.itens.filter((i) => i.cobrar === 'S').reduce((s, i) => s + (Number(i.qtd) || 0) * (Number(i.preco) || 0), 0);
      const ok = await confirmar({ titulo: `Concluir OS ${o.DocNum}`, ok: 'Concluir',
        texto: [o.U_Parada === 'S' ? 'A parada do equipamento será encerrada e os dias parados descontados do contrato.' : '',
          cobrar > 0 ? `Será criado um rascunho de NF de ${brl(cobrar)} no SAP B1.` : 'Nada a cobrar do cliente.',
          o.U_ChaEntry ? `O chamado ${o.U_ChaEntry} será marcado como resolvido.` : '', 'A pesquisa de satisfação é enviada ao cliente.'].filter(Boolean).join(' ') });
      if (!ok) return;
      try {
        const r = await post(`/orders/${id}/conclude`, corpo());
        F = null;
        toast(`OS ${r.DocNum} concluída.${r.documento ? ` Rascunho de NF nº ${r.documento.numero} criado.` : ''}`);
        if (r.avisoDocumento) toast(r.avisoDocumento, 'err');
        redesenha();
      } catch (e) {
        msg('#osMsg', 'err', e.message);
        if (pad) F.assinatura = pad.valor() || F.assinatura;
      }
    }
  };
}

async function agendar(o, root, c) {
  const tecs = (await get('/technicians')).filter((t) => t.U_Ativo !== 'N');
  const m = modal(`<h2>Agendar OS ${o.DocNum}</h2><div class="grid">
    <div class="span2"><label>Técnico</label><select id="agTec"><option value="">Selecione…</option>${tecs.map((t) => `<option value="${esc(t.Code)}" ${o.U_Tecnico === t.Code ? 'selected' : ''}>${esc(t.Name)} — ${esc(t.U_Especial || '')}</option>`).join('')}</select></div>
    <div><label>Data</label><input type="date" id="agData" value="${esc(String(o.U_DtAgenda || hoje()).slice(0, 10))}"></div>
    <div><label>Hora</label><input type="time" id="agHora" value="${esc(o.U_HrAgenda || '08:00')}"></div>
    <div><label>Duração (min)</label><input type="number" id="agDur" min="0" value="${esc(o.U_Duracao || 120)}"></div></div><div id="agMsg"></div>
    <div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="primary" data-x="1">Agendar</button></div>`);
  m.onclick = async (ev) => {
    const b = ev.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === '0') return closeModal();
    try {
      await post(`/orders/${o.DocEntry}/schedule`, { tecnico: $('#agTec').value, data: $('#agData').value, hora: $('#agHora').value, duracao: $('#agDur').value, U_Versao: o.U_Versao });
      closeModal();
      toast('OS agendada.');
      F = null;
      detalhe(root, o.DocEntry, c);
    } catch (e) {
      msg('#agMsg', 'err', e.message);
    }
  };
}

function orcamento(o, acaoOrc, root, c) {
  const m = modal(`<h2>${acaoOrc === 'aprovar' ? 'Aprovação' : 'Recusa'} do orçamento — ${brl(o.U_Valor)}</h2>
    <label>Nome de quem ${acaoOrc === 'aprovar' ? 'aprovou' : 'recusou'} no cliente</label><input id="orNome" maxlength="100">
    <p class="sub">${acaoOrc === 'aprovar' ? 'Os itens cobráveis entram no rascunho de NF ao concluir a OS.' : 'Para concluir, marque os itens como não cobráveis ou remova-os.'}</p><div id="orMsg"></div>
    <div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="${acaoOrc === 'aprovar' ? 'primary' : 'danger'}" data-x="1">Registrar</button></div>`);
  m.onclick = async (ev) => {
    const b = ev.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === '0') return closeModal();
    try {
      await post(`/orders/${o.DocEntry}/quote`, { acao: acaoOrc, nome: $('#orNome').value, U_Versao: o.U_Versao });
      closeModal();
      F = null;
      toast(acaoOrc === 'aprovar' ? 'Orçamento aprovado.' : 'Recusa registrada.');
      detalhe(root, o.DocEntry, c);
    } catch (e) {
      msg('#orMsg', 'err', e.message);
    }
  };
}

function cancelar(o, root, c) {
  const m = modal(`<h2>Cancelar OS ${o.DocNum}</h2><label>Motivo</label><textarea id="caMot" rows="3"></textarea>
    ${o.U_Parada === 'S' ? '<p class="sub">A parada do equipamento será encerrada hoje.</p>' : ''}<div id="caMsg"></div>
    <div class="dlg-actions"><button type="button" data-x="0">Voltar</button><button type="button" class="danger" data-x="1">Cancelar OS</button></div>`);
  m.onclick = async (ev) => {
    const b = ev.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === '0') return closeModal();
    try {
      await post(`/orders/${o.DocEntry}/cancel`, { motivo: $('#caMot').value });
      closeModal();
      F = null;
      toast('OS cancelada.');
      detalhe(root, o.DocEntry, c);
    } catch (e) {
      msg('#caMsg', 'err', e.message);
    }
  };
}
