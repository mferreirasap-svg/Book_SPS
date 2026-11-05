// Chamados de pós-venda: abertura, SLA de resposta e solução, conversa com o cliente e abertura de OS.
import { $, esc, fmtD, fmtDT, DOM, badge, options, toast, acao, modal, closeModal, msg, debounce, pager, SEARCH, SETA, hoje } from '../util.js';
import { get, post, put, qs } from '../api.js';
import { filtro } from '../state.js';

const CH1 = 'SPS_LCH1Collection';
const FLUXO = { ABE: ['AND', 'AGC', 'RES', 'CAN'], AND: ['AGC', 'RES', 'CAN'], AGC: ['AND', 'RES', 'CAN'], RES: ['FEC', 'AND'] };
const slaBadge = (s) => (s ? badge(s, DOM.sla, 's-') : '');

export async function render(root, params, c) {
  if (params.id) return detalhe(root, params.id, c);
  const f = filtro('chamados', { situacao: 'abertos', q: '', sla: '', page: 1 });
  const r = await get(`/tickets${qs({ abertos: f.situacao === 'abertos' ? '1' : '', status: f.situacao !== 'abertos' ? f.situacao : '', q: f.q, sla: f.sla, page: f.page, size: 50 })}`);
  root.innerHTML = `<div class="card"><div class="toolbar">
    <div><label>Situação</label><select data-f="situacao"><option value="abertos" ${f.situacao === 'abertos' ? 'selected' : ''}>Em aberto</option>${options(DOM.statusCha, f.situacao)}<option value="" ${f.situacao === '' ? 'selected' : ''}>Todos</option></select></div>
    <div><label>SLA</label><select data-f="sla"><option value="">Todos</option><option value="violado" ${f.sla === 'violado' ? 'selected' : ''}>Estourado</option></select></div>
    <div style="flex:1" class="search"><label>Buscar</label>${SEARCH}<input data-f="q" value="${esc(f.q)}" placeholder="cliente, assunto, equipamento, contato"></div>
    ${c.can('chamados.editar') ? '<button class="primary" type="button" data-a="novo">+ Novo chamado</button>' : ''}</div>
  <div class="tbl"><table><thead><tr><th>Nº</th><th>Aberto em</th><th>Cliente</th><th>Assunto</th><th>Equipamento</th><th>Prioridade</th><th>Status</th><th>1ª resposta</th><th>Solução</th><th>Prazo</th></tr></thead><tbody>
  ${r.items.map((t) => `<tr class="click" data-id="${t.DocEntry}"><td>${SETA}${t.DocNum}</td><td>${fmtDT(t.U_Abertura)}</td><td>${esc(t.U_CardName)}</td>
    <td>${t.U_Parado === 'S' ? '<span class="badge p-URG">PARADO</span> ' : ''}${esc(t.U_Assunto)}</td><td>${esc(t.U_Ativo)}</td><td>${badge(t.U_Prior, DOM.prioridade, 'p-')}</td>
    <td>${badge(t.U_Status, DOM.statusCha)}</td><td>${slaBadge(t.slaResp)}</td><td>${slaBadge(t.slaSol)}</td><td>${fmtDT(t.U_PrazoSol)}</td></tr>`).join('')
    || '<tr><td colspan="10" class="empty">Nenhum chamado.</td></tr>'}</tbody></table></div>${pager(r)}
  <p class="sub">Prazos de SLA por prioridade em Administração › Parâmetros. Chamado de equipamento parado entra no mínimo como prioridade alta.</p></div>`;

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
    if (ev.target.closest('[data-a=novo]')) return novo(c);
    const tr = ev.target.closest('tr[data-id]');
    if (tr) c.go('chamados', { id: tr.dataset.id });
  };
}

async function novo(c, pre = {}) {
  const ativos = (await get('/assets?size=200')).items.filter((a) => a.U_Status !== 'BAI');
  const m = modal(`<h2>Novo chamado</h2><div class="grid">
    <div class="span2"><label>Cliente</label><input id="chCli" list="chCliL" placeholder="digite o nome, código ou CNPJ" value="${esc(pre.cliente || '')}"><datalist id="chCliL"></datalist></div>
    <div class="span2"><label>Equipamento</label><select id="chAtv"><option value="">(não se aplica)</option>${ativos.map((a) => `<option value="${esc(a.Code)}" ${pre.ativo === a.Code ? 'selected' : ''}>${esc(a.Code)} — ${esc(a.Name)}${a.U_Placa ? ` · ${esc(a.U_Placa)}` : ''}${a.U_Status === 'LOC' ? ' (locado)' : ''}</option>`).join('')}</select></div>
    <div><label>Tipo</label><select id="chTipo">${options(DOM.tipoCha, 'MAN')}</select></div>
    <div><label>Prioridade</label><select id="chPri">${options(DOM.prioridade, 'MED')}</select></div>
    <div><label>Origem</label><select id="chOri">${options(DOM.origemCha, 'TEL')}</select></div>
    <div><label class="chk-inline"><input type="checkbox" id="chPar"> Equipamento parado</label></div>
    <div class="span2"><label>Assunto</label><input id="chAss" maxlength="150"></div>
    <div class="span2"><label>Descrição</label><textarea id="chDesc" rows="3"></textarea></div>
    <div><label>Contato</label><input id="chCon" maxlength="100"></div><div><label>Telefone</label><input id="chFone" maxlength="30"></div>
    <div class="span2"><label>E-mail (recebe a pesquisa de satisfação)</label><input id="chMail" type="email" maxlength="100" placeholder="padrão: e-mail do cadastro do cliente"></div>
  </div><div id="chMsg"></div>
  <div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="primary" data-x="1">Abrir chamado</button></div>`);
  const lista = new Map();
  m.oninput = debounce(async (ev) => {
    if (ev.target.id !== 'chCli' || ev.target.value.length < 2) return;
    const r = await get(`/lookup/partners${qs({ q: ev.target.value.split(' — ')[0] })}`).catch(() => []);
    r.forEach((p) => lista.set(`${p.CardCode} — ${p.CardName}`, p));
    $('#chCliL').innerHTML = r.map((p) => `<option value="${esc(`${p.CardCode} — ${p.CardName}`)}">`).join('');
  }, 300);
  m.onchange = (ev) => {
    if (ev.target.id === 'chTipo' && ev.target.value === 'PAR') $('#chPar').checked = true;
  };
  m.onclick = async (ev) => {
    const b = ev.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === '0') return closeModal();
    const cli = $('#chCli').value.trim();
    const cardCode = lista.get(cli)?.CardCode || cli.split(' — ')[0].trim();
    try {
      const r = await post('/tickets', { cardCode, ativo: $('#chAtv').value, tipo: $('#chTipo').value, prior: $('#chPri').value, origem: $('#chOri').value,
        parado: $('#chPar').checked, assunto: $('#chAss').value, descricao: $('#chDesc').value, contato: $('#chCon').value, fone: $('#chFone').value, email: $('#chMail').value });
      closeModal();
      toast(`Chamado ${r.DocNum} aberto.`);
      c.go('chamados', { id: r.DocEntry });
    } catch (e) {
      msg('#chMsg', 'err', e.message);
    }
  };
}

async function detalhe(root, id, c) {
  const t = await get(`/tickets/${id}`);
  const ed = c.can('chamados.editar') && !['FEC', 'CAN'].includes(t.U_Status);
  const prox = FLUXO[t.U_Status] || [];
  root.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">Chamado ${t.DocNum} — ${esc(t.U_Assunto)}</h2><span class="spacer"></span>
    <button type="button" class="mini" data-a="voltar">‹ Voltar à lista</button></div>
    <div class="row" style="margin:8px 0 12px">${badge(t.U_Status, DOM.statusCha)} ${badge(t.U_Prior, DOM.prioridade, 'p-')} ${t.U_Parado === 'S' ? '<span class="badge p-URG">EQUIPAMENTO PARADO</span>' : ''}
      <span class="chip">${esc(DOM.tipoCha[t.U_Tipo] || '')}</span><span class="chip">${esc(DOM.origemCha[t.U_Origem] || '')}</span></div>
    <div class="head-info">
      <div><b>Cliente</b>${esc(t.U_CardName)} (${esc(t.U_CardCode)})</div><div><b>Contato</b>${esc(t.U_Contato || '—')} ${esc(t.U_Fone || '')}</div>
      <div><b>E-mail</b>${esc(t.U_Email || '—')}</div><div><b>Equipamento</b>${esc(t.U_Ativo || '—')}</div>
      <div><b>Contrato</b>${t.U_CtrEntry ? `<a href="#/contratos?id=${t.U_CtrEntry}">nº ${t.U_CtrEntry}</a>` : '—'}</div><div><b>Responsável</b>${esc(t.U_Respons || '—')}</div>
      <div><b>Aberto em</b>${fmtDT(t.U_Abertura)}</div>
      <div><b>1ª resposta até ${fmtDT(t.U_PrazoResp)}</b>${t.U_DtResp ? fmtDT(t.U_DtResp) : 'aguardando'} ${slaBadge(t.slaResp)}</div>
      <div><b>Solução até ${fmtDT(t.U_PrazoSol)}</b>${t.U_DtSol ? fmtDT(t.U_DtSol) : 'em aberto'} ${slaBadge(t.slaSol)}</div>
      <div><b>Ordem de serviço</b>${t.os ? `<a href="#/os?id=${t.os.DocEntry}">OS ${t.os.DocNum}</a> ${badge(t.os.U_Status, DOM.statusOS)}${t.os.U_DtAgenda ? ` ${fmtD(t.os.U_DtAgenda)}` : ''}` : '—'}</div>
    </div>
    ${t.U_Descricao ? `<div class="msg info" style="white-space:pre-wrap">${esc(t.U_Descricao)}</div>` : ''}
    <div class="row" style="margin-top:10px">${ed && c.can('os.editar') && (!t.os || ['CON', 'CAN'].includes(t.os.U_Status)) ? '<button type="button" class="primary" data-a="os">Abrir ordem de serviço</button>' : ''}
      ${ed ? '<button type="button" data-a="editar">Editar prioridade e contato</button>' : ''}</div></div>
  <div class="card"><h2>Atendimento</h2>
    <ul class="timeline">${(t[CH1] || []).map((i) => `<li class="${i.U_Publico === 'S' ? 'pub' : ''}"><div class="meta">${fmtDT(i.U_Data)} · ${esc(i.U_Usuario)} · ${i.U_Publico === 'S' ? 'resposta ao cliente' : 'nota interna'}</div>
      <div class="txt">${esc(i.U_Texto)}</div></li>`).join('') || '<li><div class="meta">Sem interações ainda.</div></li>'}</ul>
    ${ed || (t.U_Status === 'RES' && c.can('chamados.editar')) ? `<div class="grid" style="margin-top:10px">
      <div class="span2"><label>Mensagem</label><textarea id="itTxt" rows="3" placeholder="Escreva a resposta ao cliente ou uma nota interna"></textarea></div>
      <div><label>Novo status</label><select id="itSt"><option value="">(manter ${esc(DOM.statusCha[t.U_Status])})</option>${prox.map((s) => `<option value="${s}">${esc(DOM.statusCha[s])}</option>`).join('')}</select></div>
      <div><label class="chk-inline" style="margin-top:24px"><input type="checkbox" id="itPub"> Resposta ao cliente (conta como 1ª resposta)</label></div></div>
      <div id="itMsg"></div><div class="row"><span class="spacer"></span><button type="button" class="primary" data-a="enviar">Registrar</button></div>` : ''}
  </div>`;

  root.onclick = async (ev) => {
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'voltar') return c.go('chamados');
    if (a === 'enviar') {
      try {
        await post(`/tickets/${id}/interactions`, { texto: $('#itTxt').value, status: $('#itSt').value, publico: $('#itPub').checked, U_Versao: t.U_Versao });
        toast('Atendimento registrado.');
        detalhe(root, id, c);
      } catch (e) {
        msg('#itMsg', 'err', e.message);
      }
    }
    if (a === 'os') return abrirOS(t, root, c);
    if (a === 'editar') return editar(t, root, c);
  };
}

async function abrirOS(t, root, c) {
  const tecs = (await get('/technicians')).filter((x) => x.U_Ativo !== 'N');
  const m = modal(`<h2>Abrir OS do chamado ${t.DocNum}</h2><div class="grid">
    <div><label>Tipo</label><select id="osTipo">${options(DOM.tipoOS, ['PAR', 'MAN'].includes(t.U_Tipo) ? 'COR' : t.U_Tipo === 'TRO' ? 'INS' : 'VIS')}</select></div>
    <div><label>Técnico</label><select id="osTec"><option value="">(agendar depois)</option>${tecs.map((x) => `<option value="${esc(x.Code)}">${esc(x.Name)} — ${esc(x.U_Especial || '')}</option>`).join('')}</select></div>
    <div><label>Data</label><input type="date" id="osData" value="${hoje()}"></div><div><label>Hora</label><input type="time" id="osHora" value="14:00"></div>
    ${t.U_CtrEntry ? `<div class="span2"><label class="chk-inline"><input type="checkbox" id="osPar" ${t.U_Parado === 'S' ? 'checked' : ''}> Descontar a parada da mensalidade a partir de</label>
      <input type="date" id="osDtPar" value="${String(t.U_Abertura).slice(0, 10)}" style="max-width:200px"></div>` : ''}
  </div><p class="sub">Com o desconto marcado, o período parado vira "dias fora" no contrato e o faturamento não cobra esses dias. Conserto no mesmo dia não gera desconto.</p>
  <div id="osMsg"></div><div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="primary" data-x="1">Abrir OS</button></div>`);
  m.onclick = async (ev) => {
    const b = ev.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === '0') return closeModal();
    try {
      const r = await post(`/tickets/${t.DocEntry}/order`, { tipo: $('#osTipo').value, tecnico: $('#osTec').value, data: $('#osTec').value ? $('#osData').value : '',
        hora: $('#osHora').value, parada: Boolean($('#osPar')?.checked), dtParada: $('#osDtPar')?.value });
      closeModal();
      toast(`OS ${r.DocNum} aberta.`);
      detalhe(root, t.DocEntry, c);
    } catch (e) {
      msg('#osMsg', 'err', e.message);
    }
  };
}

function editar(t, root, c) {
  const m = modal(`<h2>Chamado ${t.DocNum}</h2><div class="grid">
    <div><label>Prioridade</label><select id="edPri">${options(DOM.prioridade, t.U_Prior)}</select></div>
    <div><label>Tipo</label><select id="edTipo">${options(DOM.tipoCha, t.U_Tipo)}</select></div>
    <div><label>Responsável (usuário)</label><input id="edResp" value="${esc(t.U_Respons)}"></div>
    <div><label>Contato</label><input id="edCon" value="${esc(t.U_Contato)}"></div><div><label>Telefone</label><input id="edFone" value="${esc(t.U_Fone)}"></div>
    <div class="span2"><label>E-mail</label><input id="edMail" value="${esc(t.U_Email)}"></div></div>
    <p class="sub">Mudar a prioridade recalcula os prazos de SLA a partir da abertura.</p><div id="edMsg"></div>
    <div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="primary" data-x="1">Salvar</button></div>`);
  m.onclick = async (ev) => {
    const b = ev.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === '0') return closeModal();
    await acao(async () => {
      await put(`/tickets/${t.DocEntry}`, { prior: $('#edPri').value, tipo: $('#edTipo').value, respons: $('#edResp').value, contato: $('#edCon').value,
        fone: $('#edFone').value, email: $('#edMail').value, U_Versao: t.U_Versao });
      closeModal();
      toast('Chamado atualizado.');
      detalhe(root, t.DocEntry, c);
    });
  };
}

export { novo as novoChamado };
