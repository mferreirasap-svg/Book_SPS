// Início da aplicação: sessão, menu conforme o perfil e navegação entre telas (#/tela?param=valor).
import { $, esc, ico, toast, msg, acao, modal, closeModal } from './util.js';
import { get, post, put, setUnauthorized, isDemo } from './api.js';
import { S } from './state.js';
import * as painel from './views/painel.js';
import * as ativos from './views/ativos.js';
import * as disponibilidade from './views/disponibilidade.js';
import * as contratos from './views/contratos.js';
import * as movimentacao from './views/movimentacao.js';
import * as leituras from './views/leituras.js';
import * as faturamento from './views/faturamento.js';
import * as multas from './views/multas.js';
import * as cadastros from './views/cadastros.js';
import * as admin from './views/admin.js';

const VIEWS = [
  { sec: 'Locação' },
  { key: 'painel', title: 'Painel', perm: 'painel.ver', mod: painel },
  { key: 'contratos', title: 'Contratos', perm: 'contratos.ver', mod: contratos },
  { key: 'movimentacao', title: 'Movimentação', perm: 'mov.registrar', mod: movimentacao },
  { key: 'leituras', title: 'Leituras', perm: 'leituras.ver', mod: leituras },
  { key: 'faturamento', title: 'Faturamento', perm: 'faturamento.ver', mod: faturamento },
  { key: 'multas', title: 'Multas', perm: 'multas.ver', mod: multas },
  { sec: 'Frota' },
  { key: 'ativos', title: 'Ativos', perm: 'ativos.ver', mod: ativos },
  { key: 'disponibilidade', title: 'Disponibilidade', perm: 'ativos.ver', mod: disponibilidade },
  { sec: 'Configuração' },
  { key: 'cadastros', title: 'Famílias e regras', perm: 'contratos.ver', mod: cadastros },
  { key: 'admin', title: 'Administração', perm: ['admin.usuarios', 'admin.parametros', 'admin.instalar', 'auditoria.ver'], mod: admin },
];

export const can = (p) => (Array.isArray(p) ? p : [p]).some((x) => S.user?.perms.includes(x));

// Rota atual. No servidor, fica no endereço (#/tela?param=valor) e permite voltar e favoritar.
// No link online (modo demonstração) a navegação é interna, porque o quadro não repassa o endereço.
let rota = { key: '', params: {} };

function parseHash() {
  const [path, q = ''] = location.hash.replace(/^#\/?/, '').split('?');
  return { key: path || '', params: Object.fromEntries(new URLSearchParams(q)) };
}

export function go(key, params = {}) {
  const limpos = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)]));
  rota = { key, params: limpos };
  if (isDemo()) return render();
  const q = new URLSearchParams(limpos).toString();
  const h = `#/${key}${q ? `?${q}` : ''}`;
  if (location.hash === h) render();
  else location.hash = h;
}

function renderMenu(active) {
  let html = '';
  let pendingSec = null;
  for (const v of VIEWS) {
    if (v.sec) {
      pendingSec = v.sec;
      continue;
    }
    if (!can(v.perm)) continue;
    if (pendingSec) {
      html += `<div class="sec">${esc(pendingSec)}</div>`;
      pendingSec = null;
    }
    html += `<a href="#/${v.key}" class="item ${active === v.key ? 'on' : ''}">${ico(v.key === 'disponibilidade' ? 'disponibilidade' : v.key)}<span>${esc(v.title)}</span></a>`;
  }
  $('#menu').innerHTML = html;
}

export function setTitle(t) {
  $('#pageTitle').textContent = t;
  document.title = `${t} — Áster Rental`;
}

async function render() {
  if (!S.user) return;
  const { key, params } = rota;
  const allowed = VIEWS.filter((v) => v.key && can(v.perm));
  const view = allowed.find((v) => v.key === key) || allowed[0];
  if (!view) {
    $('#view').innerHTML = '<div class="card empty">Seu perfil não tem acesso a nenhuma tela. Fale com o administrador.</div>';
    return;
  }
  renderMenu(view.key);
  setTitle(view.title);
  document.body.classList.remove('side-open');
  const root = $('#view');
  root.onclick = root.onchange = root.oninput = root.onsubmit = null;
  root.innerHTML = '<div class="empty">Carregando…</div>';
  S.view = view.key;
  try {
    await view.mod.render(root, params, { go, can, setTitle });
  } catch (e) {
    if (e.status !== 401) root.innerHTML = `<div class="card"><div class="msg err">${esc(e.message)}</div></div>`;
  }
}

function showLogin() {
  S.user = null;
  if (isDemo()) msg('#lgMsg', 'info', 'Demonstração online: entre com usuário admin e senha Demo2026senha. Os dados ficam só neste navegador.');
  $('#app').hidden = true;
  $('#login').hidden = false;
  closeModal();
  setTimeout(() => $('#lgUser').focus(), 50);
}

async function startApp(me) {
  if (!isDemo()) rota = parseHash();
  S.user = me.user;
  S.b1Mode = me.b1Mode;
  S.cfg = await get('/settings/public').catch(() => ({}));
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#userName').textContent = me.user.name;
  $('#userProfile').textContent = me.user.profileName;
  $('#modeBadge').hidden = me.b1Mode !== 'mock';
  await render();
}

setUnauthorized(() => {
  if (S.user) toast('Sessão expirada. Entre novamente.', 'err');
  showLogin();
});

$('#loginForm').onsubmit = async (ev) => {
  ev.preventDefault();
  msg('#lgMsg', 'info', 'Entrando…');
  try {
    const r = await post('/auth/login', { login: $('#lgUser').value.trim(), password: $('#lgPass').value });
    $('#lgPass').value = '';
    msg('#lgMsg', '', '');
    await startApp(r);
  } catch (e) {
    msg('#lgMsg', 'err', e.message);
  }
};

$('#btnLogout').onclick = async () => {
  await post('/auth/logout').catch(() => {});
  showLogin();
};
$('#btnReload').onclick = () => render();
$('#sideToggle').onclick = () => document.body.classList.add('side-closed');
$('#sideOpen').onclick = () => {
  document.body.classList.remove('side-closed');
  document.body.classList.toggle('side-open');
};
$('#modalBg').addEventListener('click', (e) => {
  if (e.target.id === 'modalBg') closeModal();
});
$('#btnPass').onclick = () => {
  const m = modal(`<h2>Trocar senha</h2><div class="grid">
    <div class="span2"><label>Senha atual</label><input type="password" id="pwA" autocomplete="current-password"></div>
    <div><label>Nova senha</label><input type="password" id="pwN" autocomplete="new-password"></div>
    <div><label>Repita a nova senha</label><input type="password" id="pwR" autocomplete="new-password"></div></div>
    <p class="sub">Mínimo de 10 caracteres, com letras e números.</p><div id="pwMsg"></div>
    <div class="dlg-actions"><button type="button" data-x="cancel">Cancelar</button><button type="button" class="primary" data-x="ok">Salvar</button></div>`);
  m.onclick = async (ev) => {
    const b = ev.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === 'cancel') return closeModal();
    if ($('#pwN').value !== $('#pwR').value) return msg('#pwMsg', 'err', 'As senhas não conferem.');
    await acao(async () => {
      await put('/me/password', { atual: $('#pwA').value, nova: $('#pwN').value });
      closeModal();
      toast('Senha alterada.');
    });
  };
};

window.addEventListener('hashchange', () => {
  if (isDemo()) return;
  rota = parseHash();
  render();
});
// Links do menu e de navegação interna (#/tela) passam pelo roteador.
document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[href^="#/"]');
  if (!a) return;
  ev.preventDefault();
  const [k, q = ''] = a.getAttribute('href').slice(2).split('?');
  go(k, Object.fromEntries(new URLSearchParams(q)));
});
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.status !== 401) toast(e.reason?.message || 'Erro inesperado.', 'err');
});

get('/auth/me').then(startApp).catch(showLogin);
