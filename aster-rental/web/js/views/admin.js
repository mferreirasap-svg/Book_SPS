// Administração: usuários e perfis, parâmetros, estruturas no SAP B1 e auditoria.
import { $, $$, esc, toast, acao, modal, closeModal, msg, options, confirmar } from '../util.js';
import { get, post, put, qs } from '../api.js';
import { filtro, S } from '../state.js';

export async function render(root, _p, c) {
  const abas = [['usuarios', 'Usuários', 'admin.usuarios'], ['parametros', 'Parâmetros', 'admin.parametros'], ['b1', 'SAP B1', 'admin.instalar'], ['auditoria', 'Auditoria', 'auditoria.ver']]
    .filter(([, , p]) => c.can(p));
  const f = filtro('admin', { aba: abas[0]?.[0] });
  if (!abas.some(([k]) => k === f.aba)) f.aba = abas[0][0];
  root.innerHTML = `<div class="card"><div class="tabs-in">${abas.map(([k, t]) => `<button type="button" data-aba="${k}" class="${f.aba === k ? 'on' : ''}">${t}</button>`).join('')}</div><div id="aba"></div></div>`;
  root.onclick = (ev) => {
    const b = ev.target.closest('[data-aba]');
    if (b) {
      f.aba = b.dataset.aba;
      render(root, {}, c);
    }
  };
  const box = $('#aba', root);
  await { usuarios, parametros, b1, auditoria }[f.aba](box);
}

async function usuarios(box) {
  const [users, perf] = await Promise.all([get('/admin/users'), get('/admin/profiles')]);
  box.innerHTML = `<div class="toolbar"><div class="sub" style="flex:1">Cada usuário tem um perfil. Filiais vazias = todas. O usuário do SAP B1 serve para licenciamento e rastreio.</div>
    <button type="button" class="primary" data-u="novo">+ Novo usuário</button></div>
  <div class="tbl"><table><thead><tr><th>Login</th><th>Nome</th><th>Perfil</th><th>Usuário B1</th><th>Filiais</th><th>Situação</th><th></th></tr></thead><tbody>
  ${users.map((u) => `<tr><td><b>${esc(u.login)}</b></td><td>${esc(u.name)}</td><td>${esc(u.profileName)}</td><td>${esc(u.b1User || '')}</td><td>${esc(u.branches.join(', ') || 'todas')}</td>
    <td>${u.active ? '<span class="badge b-ATV">Ativo</span>' : '<span class="badge b-ENC">Inativo</span>'}</td><td class="right"><button type="button" class="mini" data-u="${u.id}">Editar</button></td></tr>`).join('')}
  </tbody></table></div>
  <h3>Perfis</h3><div class="tbl"><table><thead><tr><th>Perfil</th><th>Permissões</th></tr></thead><tbody>
  ${perf.profiles.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td style="white-space:normal">${p.perms.map((k) => `<span class="chip">${esc(perf.permissions[k])}</span>`).join(' ')}</td></tr>`).join('')}</tbody></table></div>`;
  box.onclick = (ev) => {
    const b = ev.target.closest('[data-u]');
    if (!b) return;
    const u = b.dataset.u === 'novo' ? null : users.find((x) => String(x.id) === b.dataset.u);
    formUsuario(u, perf, () => usuarios(box));
  };
}

function formUsuario(u, perf, reload) {
  const novo = !u;
  u ||= { profile: 'comercial', branches: [], active: true };
  const m = modal(`<h2>${novo ? 'Novo usuário' : `Usuário ${esc(u.login)}`}</h2><div class="grid">
    <div><label>Login</label><input id="uLogin" value="${esc(u.login || '')}" ${novo ? '' : 'readonly'}></div>
    <div><label>Nome</label><input id="uName" value="${esc(u.name || '')}"></div>
    <div><label>E-mail</label><input id="uEmail" type="email" value="${esc(u.email || '')}"></div>
    <div><label>Perfil</label><select id="uProf">${options(Object.fromEntries(perf.profiles.map((p) => [p.code, p.name])), u.profile)}</select></div>
    <div><label>Usuário no SAP B1</label><input id="uB1" value="${esc(u.b1User || '')}"></div>
    <div><label>Filiais (BPLId, separadas por vírgula)</label><input id="uBr" value="${esc(u.branches.join(','))}" placeholder="vazio = todas"></div>
    <div><label>${novo ? 'Senha inicial' : 'Nova senha (opcional)'}</label><input id="uPass" type="password" autocomplete="new-password"></div>
    ${novo ? '' : `<div><label>Situação</label><select id="uAct">${options({ 1: 'Ativo', 0: 'Inativo' }, u.active ? '1' : '0')}</select></div>`}</div>
    <p class="sub">Senha com pelo menos 10 caracteres, letras e números.</p><div id="uMsg"></div>
    <div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="primary" data-x="1">Salvar</button></div>`);
  m.onclick = async (ev) => {
    const b = ev.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === '0') return closeModal();
    const body = { login: $('#uLogin').value.trim(), name: $('#uName').value, email: $('#uEmail').value, profile: $('#uProf').value, b1User: $('#uB1').value,
      branches: $('#uBr').value.split(',').map((s) => Number(s.trim())).filter(Boolean) };
    if ($('#uPass').value) body.password = $('#uPass').value;
    if (!novo) body.active = $('#uAct').value === '1';
    try {
      if (novo) await post('/admin/users', body);
      else await put(`/admin/users/${u.id}`, body);
      closeModal();
      toast('Usuário salvo.');
      reload();
    } catch (e) {
      msg('#uMsg', 'err', e.message);
    }
  };
}

async function parametros(box) {
  const p = await get('/admin/settings');
  box.innerHTML = `<div class="grid">
    <div class="span2"><label>Nome da locadora (impressos)</label><input data-p="EMPRESA" value="${esc(p.EMPRESA)}"></div>
    <div><label>Item para repasse de multa (SAP B1)</label><input data-p="ITEM_MULTA" value="${esc(p.ITEM_MULTA)}"></div>
    <div><label>Utilização fiscal nas linhas (opcional)</label><input data-p="USAGE" type="number" value="${esc(p.USAGE)}" placeholder="padrão do item"></div>
    <div><label>Avisar parcela a vencer com quantos dias</label><input data-p="DIAS_ALERTA_FAT" type="number" min="0" value="${esc(p.DIAS_ALERTA_FAT)}"></div>
    <div class="span2"><label>Checklist de máquinas e equipamentos (um item por linha)</label><textarea data-p="CHK_EQP" rows="7">${esc(p.CHK_EQP)}</textarea></div>
    <div class="span2"><label>Checklist de veículos (um item por linha)</label><textarea data-p="CHK_VEI" rows="7">${esc(p.CHK_VEI)}</textarea></div>
  </div><div class="row" style="margin-top:12px"><span class="spacer"></span><button type="button" class="primary" data-a="salvar">Salvar parâmetros</button></div>`;
  box.onclick = async (ev) => {
    if (!ev.target.closest('[data-a=salvar]')) return;
    const body = {};
    $$('[data-p]', box).forEach((e) => (body[e.dataset.p] = e.value));
    await acao(async () => {
      await put('/admin/settings', body);
      S.cfg = await get('/settings/public');
      toast('Parâmetros salvos.');
    });
  };
}

async function b1(box) {
  const st = await get('/admin/b1-status');
  box.innerHTML = `<div class="msg ${st.ok ? 'ok' : 'err'}">${st.ok ? `Conectado ao SAP B1 (${esc(st.mode === 'mock' ? 'modo demonstração' : st.company)}). Versão das estruturas: ${esc(st.schemaVersion)}.` : `Falha na conexão: ${esc(st.error)}`}</div>
    <p class="sub">A instalação cria ou completa as tabelas, campos e objetos de usuário do Áster Rental no SAP B1. Pode ser executada de novo com segurança. Use um superusuário, de preferência sem usuários conectados ao B1.</p>
    <div class="row"><button type="button" class="teal" data-a="instalar">Instalar / atualizar estruturas</button>
    ${st.mode === 'mock' ? '<button type="button" class="danger" data-a="reset">Restaurar dados de demonstração</button>' : ''}</div><div id="instLog"></div>`;
  box.onclick = async (ev) => {
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === 'instalar') {
      if (!(await confirmar({ titulo: 'Instalar estruturas', texto: 'Criar ou completar as estruturas do Áster Rental no SAP B1?', ok: 'Instalar' }))) return;
      await acao(async () => {
        const r = await post('/admin/install');
        $('#instLog', box).innerHTML = `<div class="log">${esc(r.log.join('\n'))}\n\n${r.errors ? `Concluído com ${r.errors} erro(s).` : 'Concluído sem erros.'}</div>`;
      });
    }
    if (b.dataset.a === 'reset') {
      if (!(await confirmar({ titulo: 'Restaurar demonstração', texto: 'Apaga tudo o que foi cadastrado na demonstração e volta aos dados de exemplo.', ok: 'Restaurar', perigo: true }))) return;
      await acao(async () => {
        await post('/admin/demo-reset');
        toast('Dados de demonstração restaurados.');
      });
    }
  };
}

async function auditoria(box) {
  const f = filtro('auditoria', { entity: '', user: '' });
  const rows = await get(`/admin/audit${qs({ ...f, limit: 300 })}`);
  box.innerHTML = `<div class="toolbar"><div><label>Entidade</label><select id="aEnt">${options({ contrato: 'Contrato', ativo: 'Ativo', parcela: 'Parcela', multa: 'Multa', regra: 'Regra', familia: 'Família', usuario: 'Usuário', parametros: 'Parâmetros', b1: 'SAP B1' }, f.entity, { vazio: 'Todas' })}</select></div>
    <div><label>Usuário</label><input id="aUser" value="${esc(f.user)}"></div><button type="button" data-a="filtrar">Filtrar</button></div>
  <div class="tbl"><table><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>Registro</th><th>IP</th><th></th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td>${esc(new Date(r.at).toLocaleString('pt-BR'))}</td><td>${esc(r.user_login)}</td><td>${esc(r.action)}</td><td>${esc(r.entity)}</td><td>${esc(r.entity_id || '')}</td>
    <td>${esc(r.ip)}</td><td>${r.before_json || r.after_json ? `<button type="button" class="mini" data-det="${r.id}">Detalhes</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhum registro.</td></tr>'}
  </tbody></table></div>`;
  box.onclick = (ev) => {
    if (ev.target.closest('[data-a=filtrar]')) {
      f.entity = $('#aEnt').value;
      f.user = $('#aUser').value.trim();
      return auditoria(box);
    }
    const b = ev.target.closest('[data-det]');
    if (!b) return;
    const r = rows.find((x) => String(x.id) === b.dataset.det);
    const fmt = (j) => (j ? esc(JSON.stringify(JSON.parse(j), null, 2)) : '—');
    modal(`<h2>${esc(r.action)} · ${esc(r.entity)} ${esc(r.entity_id || '')}</h2><h3>Antes</h3><div class="log">${fmt(r.before_json)}</div><h3>Depois</h3><div class="log">${fmt(r.after_json)}</div>
      <div class="dlg-actions"><button type="button" class="primary" data-close>Fechar</button></div>`).onclick = (e) => e.target.closest('[data-close]') && closeModal();
  };
}
