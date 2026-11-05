// Cadastro de técnicos (ligados ao usuário do Áster) e dos planos de manutenção preventiva por família.
import { $, esc, num, toast, modal, closeModal, msg } from '../util.js';
import { get, post, put } from '../api.js';
import { filtro } from '../state.js';

export async function render(root, _p, c) {
  const f = filtro('tecnicos', { aba: 'tec' });
  const ed = c.can('planos.editar');
  const [tecs, planos, fams] = await Promise.all([get('/technicians'), get('/plans'), get('/families')]);
  const famNome = Object.fromEntries(fams.map((x) => [x.Code, x]));
  root.innerHTML = `<div class="card"><div class="tabs-in"><button type="button" data-aba="tec" class="${f.aba === 'tec' ? 'on' : ''}">Técnicos</button>
    <button type="button" data-aba="pln" class="${f.aba === 'pln' ? 'on' : ''}">Planos preventivos</button></div>
  ${f.aba === 'tec' ? `<div class="row" style="margin-bottom:10px"><p class="sub" style="margin:0">Ligue o técnico ao usuário do Áster (perfil "Técnico de campo") para ele ver só as próprias OS.</p><span class="spacer"></span>
      ${ed ? '<button type="button" class="primary" data-novo="tec">+ Novo técnico</button>' : ''}</div>
    <div class="tbl"><table><thead><tr><th>Código</th><th>Nome</th><th>Usuário do Áster</th><th>Especialidade</th><th>Telefone</th><th>Situação</th><th></th></tr></thead><tbody>
    ${tecs.map((t) => `<tr><td>${esc(t.Code)}</td><td>${esc(t.Name)}</td><td>${esc(t.U_Login || '—')}</td><td>${esc(t.U_Especial)}</td><td>${esc(t.U_Fone)}</td>
      <td>${t.U_Ativo === 'N' ? '<span class="badge b-BAI">Inativo</span>' : '<span class="badge b-ATV">Ativo</span>'}</td>
      <td class="right">${ed ? `<button type="button" class="mini" data-ed="tec" data-code="${esc(t.Code)}">Editar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhum técnico.</td></tr>'}</tbody></table></div>`
  : `<div class="row" style="margin-bottom:10px"><p class="sub" style="margin:0">Intervalo pelo medidor (horas ou km) e/ou por dias — vence o que chegar primeiro.</p><span class="spacer"></span>
      ${ed ? '<button type="button" class="primary" data-novo="pln">+ Novo plano</button>' : ''}</div>
    <div class="tbl"><table><thead><tr><th>Código</th><th>Plano</th><th>Família</th><th class="num">A cada (medidor)</th><th class="num">A cada (dias)</th><th class="num">Avisar antes</th><th>Itens do checklist</th><th></th></tr></thead><tbody>
    ${planos.map((p) => `<tr><td>${esc(p.Code)}</td><td>${esc(p.Name)}</td><td>${esc(famNome[p.U_Familia]?.Name || p.U_Familia)}</td>
      <td class="num">${Number(p.U_IntMed) ? `${num(p.U_IntMed, 0)} ${famNome[p.U_Familia]?.U_Tipo === 'VEI' ? 'km' : 'h'}` : '—'}</td><td class="num">${Number(p.U_IntDias) || '—'}</td>
      <td class="num">${Number(p.U_Aviso) || 10}%</td><td>${String(p.U_Checklist || '').split('\n').filter(Boolean).length}</td>
      <td class="right">${ed ? `<button type="button" class="mini" data-ed="pln" data-code="${esc(p.Code)}">Editar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Nenhum plano.</td></tr>'}</tbody></table></div>`}
  </div>`;

  root.onclick = (ev) => {
    const a = ev.target.closest('[data-aba]');
    if (a) {
      f.aba = a.dataset.aba;
      return render(root, {}, c);
    }
    const n = ev.target.closest('[data-novo]');
    const e = ev.target.closest('[data-ed]');
    const reload = () => render(root, {}, c);
    if (n?.dataset.novo === 'tec') formTec(null, reload);
    if (n?.dataset.novo === 'pln') formPlano(null, fams, reload);
    if (e?.dataset.ed === 'tec') formTec(tecs.find((t) => t.Code === e.dataset.code), reload);
    if (e?.dataset.ed === 'pln') formPlano(planos.find((p) => p.Code === e.dataset.code), fams, reload);
  };
}

function salvarCom(m, path, rec, body, reload, okMsg) {
  m.onclick = async (ev) => {
    const b = ev.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === '0') return closeModal();
    try {
      if (rec) await put(`${path}/${encodeURIComponent(rec.Code)}`, body());
      else await post(path, body());
      closeModal();
      toast(okMsg);
      reload();
    } catch (e) {
      msg('#fMsg', 'err', e.message);
    }
  };
}

function formTec(t, reload) {
  const m = modal(`<h2>${t ? `Técnico ${esc(t.Code)}` : 'Novo técnico'}</h2><div class="grid">
    <div><label>Código</label><input id="tCode" value="${esc(t?.Code || '')}" ${t ? 'readonly' : ''} placeholder="T04"></div>
    <div><label>Nome</label><input id="tName" value="${esc(t?.Name || '')}"></div>
    <div><label>Usuário do Áster (login)</label><input id="tLogin" value="${esc(t?.U_Login || '')}"></div>
    <div><label>Telefone</label><input id="tFone" value="${esc(t?.U_Fone || '')}"></div>
    <div><label>E-mail</label><input id="tMail" value="${esc(t?.U_Email || '')}"></div>
    <div><label>Situação</label><select id="tAtivo"><option value="S">Ativo</option><option value="N" ${t?.U_Ativo === 'N' ? 'selected' : ''}>Inativo</option></select></div>
    <div class="span2"><label>Especialidade</label><input id="tEsp" value="${esc(t?.U_Especial || '')}"></div></div><div id="fMsg"></div>
    <div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="primary" data-x="1">Salvar</button></div>`);
  salvarCom(m, '/technicians', t, () => ({ Code: $('#tCode').value, Name: $('#tName').value, U_Login: $('#tLogin').value, U_Fone: $('#tFone').value,
    U_Email: $('#tMail').value, U_Ativo: $('#tAtivo').value, U_Especial: $('#tEsp').value, U_Filial: 1 }), reload, 'Técnico salvo.');
}

function formPlano(p, fams, reload) {
  const m = modal(`<h2>${p ? `Plano ${esc(p.Code)}` : 'Novo plano preventivo'}</h2><div class="grid">
    <div><label>Código</label><input id="pCode" value="${esc(p?.Code || '')}" ${p ? 'readonly' : ''} placeholder="PRE-RETRO-500"></div>
    <div><label>Nome</label><input id="pName" value="${esc(p?.Name || '')}"></div>
    <div><label>Família</label><select id="pFam">${fams.map((x) => `<option value="${esc(x.Code)}" ${p?.U_Familia === x.Code ? 'selected' : ''}>${esc(x.Name)}</option>`).join('')}</select></div>
    <div><label>A cada (horas ou km)</label><input type="number" min="0" id="pMed" value="${esc(p?.U_IntMed ?? 250)}"></div>
    <div><label>A cada (dias)</label><input type="number" min="0" id="pDias" value="${esc(p?.U_IntDias ?? 180)}"></div>
    <div><label>Avisar com (% do intervalo)</label><input type="number" min="0" max="50" id="pAviso" value="${esc(p?.U_Aviso ?? 10)}"></div>
    <div><label>Situação</label><select id="pAtivo"><option value="S">Ativo</option><option value="N" ${p?.U_Ativo === 'N' ? 'selected' : ''}>Inativo</option></select></div>
    <div class="span2"><label>Checklist (um item por linha)</label><textarea id="pChk" rows="7">${esc(p?.U_Checklist || '')}</textarea></div></div><div id="fMsg"></div>
    <div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="primary" data-x="1">Salvar</button></div>`);
  salvarCom(m, '/plans', p, () => ({ Code: $('#pCode').value, Name: $('#pName').value, U_Familia: $('#pFam').value, U_IntMed: $('#pMed').value, U_IntDias: $('#pDias').value,
    U_Aviso: $('#pAviso').value, U_Ativo: $('#pAtivo').value, U_Checklist: $('#pChk').value }), reload, 'Plano salvo.');
}
