// Famílias de equipamento e regras de cobrança.
import { $, $$, esc, DOM, badge, options, toast, modal, closeModal, msg } from '../util.js';
import { get, post, put } from '../api.js';
import { filtro } from '../state.js';

export async function render(root, _p, c) {
  const f = filtro('cadastros', { aba: 'regras' });
  const ed = c.can('cadastros.editar');
  const [fams, regras] = await Promise.all([get('/families'), get('/rules')]);
  root.innerHTML = `<div class="card"><div class="tabs-in"><button type="button" data-aba="regras" class="${f.aba === 'regras' ? 'on' : ''}">Regras de cobrança</button>
    <button type="button" data-aba="familias" class="${f.aba === 'familias' ? 'on' : ''}">Famílias de equipamento</button></div>
  ${f.aba === 'regras' ? `<div class="toolbar"><div class="sub" style="flex:1">A regra define como o item é cobrado: por item, agrupado, por consumo ou sem cobrança, e como o mês incompleto é calculado.</div>
    ${ed ? '<button type="button" class="primary" data-novo="regra">+ Nova regra</button>' : ''}</div>
    <div class="tbl"><table><thead><tr><th>Código</th><th>Nome</th><th>Tipo</th><th>Pró-rata</th><th>Franquia proporcional</th><th class="num">Tolerância</th><th>Meses não faturáveis</th><th></th></tr></thead><tbody>
    ${regras.map((r) => `<tr><td><b>${esc(r.Code)}</b></td><td>${esc(r.Name)}</td><td>${esc(DOM.tipoRegra[r.U_Tipo])}</td><td>${esc(DOM.proRata[r.U_ProRata])}</td>
      <td>${r.U_FranqProp === 'N' ? 'Não' : 'Sim'}</td><td class="num">${r.U_Toler || 0} dia(s)</td><td>${esc(r.U_MesesNF || '—')}</td>
      <td class="right">${ed ? `<button type="button" class="mini" data-ed-regra="${esc(r.Code)}">Editar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
  : `<div class="toolbar"><div class="sub" style="flex:1">A família agrupa modelos equivalentes. Um contrato pode reservar uma família e escolher o equipamento na entrega.</div>
    ${ed ? '<button type="button" class="primary" data-novo="familia">+ Nova família</button>' : ''}</div>
    <div class="tbl"><table><thead><tr><th>Código</th><th>Nome</th><th>Tipo</th><th>Características</th><th></th></tr></thead><tbody>
    ${fams.map((x) => `<tr><td><b>${esc(x.Code)}</b></td><td>${esc(x.Name)}</td><td>${badge(x.U_Tipo, DOM.tipoAtivo, 'chip ')}</td><td>${esc(x.U_Caract || '')}</td>
      <td class="right">${ed ? `<button type="button" class="mini" data-ed-fam="${esc(x.Code)}">Editar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`}</div>`;
  const reload = () => render(root, {}, c);
  root.onclick = (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.aba) {
      f.aba = b.dataset.aba;
      return reload();
    }
    if (b.dataset.novo === 'regra') return formRegra(null, reload);
    if (b.dataset.edRegra) return formRegra(regras.find((r) => r.Code === b.dataset.edRegra), reload);
    if (b.dataset.novo === 'familia') return formFamilia(null, reload);
    if (b.dataset.edFam) return formFamilia(fams.find((x) => x.Code === b.dataset.edFam), reload);
  };
}

function formFamilia(x, reload) {
  const novo = !x;
  x ||= { U_Tipo: 'EQP' };
  const m = modal(`<h2>${novo ? 'Nova família' : `Família ${esc(x.Code)}`}</h2><div class="grid">
    <div><label>Código</label><input id="fCode" value="${esc(x.Code || '')}" ${novo ? '' : 'readonly'} maxlength="30"></div>
    <div><label>Tipo</label><select id="fTipo">${options(DOM.tipoAtivo, x.U_Tipo)}</select></div>
    <div class="span2"><label>Nome</label><input id="fName" value="${esc(x.Name || '')}" maxlength="100"></div>
    <div class="span2"><label>Características</label><input id="fCar" value="${esc(x.U_Caract || '')}" placeholder="ex.: linha amarela, diesel, 4x4" maxlength="254"></div></div>
    <div id="fMsg"></div><div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="primary" data-x="1">Salvar</button></div>`);
  m.onclick = async (ev) => {
    const b = ev.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === '0') return closeModal();
    const body = { Code: $('#fCode').value, Name: $('#fName').value, U_Tipo: $('#fTipo').value, U_Caract: $('#fCar').value };
    try {
      if (novo) await post('/families', body);
      else await put(`/families/${encodeURIComponent(x.Code)}`, body);
      closeModal();
      toast('Família salva.');
      reload();
    } catch (e) {
      msg('#fMsg', 'err', e.message);
    }
  };
}

function formRegra(r, reload) {
  const novo = !r;
  r ||= { U_Tipo: 'ITEM', U_ProRata: 'LIN', U_FranqProp: 'S', U_Toler: 0, U_MesesNF: '', U_Tabela: '[]' };
  let tabela = [];
  try {
    tabela = JSON.parse(r.U_Tabela || '[]');
  } catch {
    tabela = [];
  }
  const linhasTabela = () => tabela.map((t, i) => `<tr><td><input type="number" min="1" max="31" class="w80" data-t="${i}" data-k="ate" value="${t.ate}"></td>
    <td><input type="number" min="0" step="0.01" class="w110" data-t="${i}" data-k="valor" value="${t.valor}"></td><td><button type="button" class="mini danger" data-rmt="${i}">Remover</button></td></tr>`).join('');
  const m = modal(`<h2>${novo ? 'Nova regra de cobrança' : `Regra ${esc(r.Code)}`}</h2><div class="grid">
    <div><label>Código</label><input id="rCode" value="${esc(r.Code || '')}" ${novo ? '' : 'readonly'} maxlength="50"></div>
    <div class="span2"><label>Nome</label><input id="rName" value="${esc(r.Name || '')}" maxlength="100"></div>
    <div><label>Tipo de cobrança</label><select id="rTipo">${options(DOM.tipoRegra, r.U_Tipo)}</select></div>
    <div><label>Mês incompleto (pró-rata)</label><select id="rPro">${options(DOM.proRata, r.U_ProRata)}</select></div>
    <div><label>Franquia proporcional aos dias</label><select id="rFr">${options({ S: 'Sim', N: 'Não' }, r.U_FranqProp)}</select></div>
    <div><label>Tolerância (dias fora sem desconto)</label><input type="number" min="0" max="31" id="rTol" value="${esc(r.U_Toler || 0)}"></div>
    <div><label>Meses não faturáveis</label><input id="rMeses" value="${esc(r.U_MesesNF || '')}" placeholder="ex.: 1,2"></div></div>
  <div id="tabBox"><h3>Tabela de pró-rata</h3><p class="sub" id="tabHint"></p><table><thead><tr><th>Até (dias)</th><th id="tabCol">Valor</th><th></th></tr></thead><tbody id="tabBody">${linhasTabela()}</tbody></table>
    <button type="button" class="mini" data-a="addt">+ Faixa</button></div>
  <div id="rMsg"></div><div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="primary" data-x="1">Salvar</button></div>`);
  const sync = () => {
    const p = $('#rPro').value;
    $('#tabBox').hidden = p === 'LIN';
    $('#tabCol').textContent = p === 'PCT' ? '% da mensalidade' : 'Nº de diárias cobradas';
    $('#tabHint').textContent = p === 'PCT' ? 'Ex.: até 15 dias = 50% da mensalidade.' : 'Sem faixa, cobra uma diária por dia, limitado à mensalidade.';
  };
  const lerTabela = () => $$('[data-t]', m).forEach((e) => (tabela[Number(e.dataset.t)][e.dataset.k] = Number(e.value)));
  sync();
  m.onchange = (ev) => ev.target.id === 'rPro' && sync();
  m.onclick = async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.a === 'addt' || b.dataset.rmt) {
      lerTabela();
      if (b.dataset.a === 'addt') tabela.push({ ate: Math.min(31, (tabela.at(-1)?.ate || 0) + 5), valor: 100 });
      else tabela.splice(Number(b.dataset.rmt), 1);
      $('#tabBody').innerHTML = linhasTabela();
      return;
    }
    if (b.dataset.x === '0') return closeModal();
    if (b.dataset.x !== '1') return;
    lerTabela();
    const body = { Code: $('#rCode').value, Name: $('#rName').value, U_Tipo: $('#rTipo').value, U_ProRata: $('#rPro').value, U_FranqProp: $('#rFr').value,
      U_Toler: $('#rTol').value, U_MesesNF: $('#rMeses').value, U_Tabela: tabela };
    try {
      if (novo) await post('/rules', body);
      else await put(`/rules/${encodeURIComponent(r.Code)}`, body);
      closeModal();
      toast('Regra salva.');
      reload();
    } catch (e) {
      msg('#rMsg', 'err', e.message);
    }
  };
}
