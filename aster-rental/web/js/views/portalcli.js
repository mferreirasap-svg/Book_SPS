// Portal do cliente — lado da locadora: acessos dos contatos dos clientes e etiquetas QR para colar nos equipamentos.
import { $, $$, esc, fmtDT, toast, acao, modal, closeModal, msg, debounce, confirmar } from '../util.js';
import { get, post, qs, isDemo } from '../api.js';
import { filtro, S } from '../state.js';
import { abrirPortal } from '../portal.js';
import qrcode from '../vendor/qrcode.js';
import { imprimirEtiquetas } from '../print.js';

const enderecoPortal = () => `${location.origin === 'null' ? '' : location.origin}${location.pathname}#portal`;
const enderecoQR = (tk) => `${location.origin === 'null' ? '' : location.origin}${location.pathname}#qr-${tk}`;
export const qrSvg = (texto) => {
  const q = qrcode(0, 'M');
  q.addData(texto);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
};
const voltar = () => {
  $('#app').hidden = false;
};

export async function render(root, _p, c) {
  const f = filtro('portalcli', { aba: 'acessos' });
  root.innerHTML = `<div class="card"><div class="row"><div class="tabs-in" style="flex:1"><button type="button" data-aba="acessos" class="${f.aba === 'acessos' ? 'on' : ''}">Acessos dos clientes</button>
    <button type="button" data-aba="qr" class="${f.aba === 'qr' ? 'on' : ''}">Etiquetas QR dos equipamentos</button></div>
    <button type="button" class="primary" data-a="ver">Ver o portal como o cliente</button></div><div id="pcBox"><div class="empty">Carregando…</div></div></div>`;
  root.onclick = (ev) => {
    const a = ev.target.closest('[data-aba]');
    if (a) {
      f.aba = a.dataset.aba;
      return render(root, {}, c);
    }
    if (ev.target.closest('[data-a=ver]')) return abrirPortal({ voltar });
    return undefined;
  };
  return f.aba === 'qr' ? etiquetas($('#pcBox', root)) : acessos($('#pcBox', root));
}

/* ---------------- acessos ---------------- */

async function acessos(box) {
  const lista = await get('/portal/accesses');
  box.innerHTML = `<div class="row" style="margin:8px 0 12px"><p class="sub" style="margin:0;flex:1">O contato do cliente entra no portal com o e-mail e um código de acesso. Ele vê só os chamados, orçamentos e equipamentos da empresa dele.
    Endereço do portal: <code>${esc(enderecoPortal())}</code></p><button type="button" class="primary" data-a="novo">+ Novo acesso</button></div>
  <div class="tbl"><table><thead><tr><th>Cliente</th><th>Contato</th><th>E-mail</th><th>Telefone</th><th>Último acesso</th><th>Situação</th><th></th></tr></thead><tbody>
  ${lista.map((a) => `<tr><td>${esc(a.U_CardName)}</td><td>${esc(a.U_Nome)}</td><td>${esc(a.U_Email)}</td><td>${esc(a.U_Fone || '')}</td><td>${a.U_UltAcesso ? fmtDT(a.U_UltAcesso) : '<span class="muted">nunca</span>'}</td>
    <td>${a.U_Ativo === 'N' ? '<span class="badge b-BAI">Desativado</span>' : a.U_Bloqueio && a.U_Bloqueio > new Date().toISOString().slice(0, 16) ? '<span class="badge s-violado">Bloqueado (tentativas)</span>' : '<span class="badge b-ATV">Ativo</span>'}</td>
    <td class="right"><button type="button" class="mini" data-cod="${esc(a.Code)}" data-nome="${esc(a.U_Nome)}">Novo código</button>
      <button type="button" class="mini ${a.U_Ativo === 'N' ? '' : 'danger'}" data-st="${esc(a.Code)}" data-ativo="${a.U_Ativo === 'N' ? '1' : '0'}">${a.U_Ativo === 'N' ? 'Ativar' : 'Desativar'}</button></td></tr>`).join('')
    || '<tr><td colspan="7" class="empty">Nenhum acesso criado.</td></tr>'}</tbody></table></div>`;
  box.onclick = async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.a === 'novo') return novoAcesso(box);
    if (b.dataset.cod) {
      if (!(await confirmar({ titulo: 'Gerar novo código', texto: `O código atual de ${b.dataset.nome} deixa de funcionar e a sessão aberta é encerrada.`, ok: 'Gerar' }))) return;
      return acao(async () => mostrarCodigo(await post(`/portal/accesses/${encodeURIComponent(b.dataset.cod)}/code`, {}), b.dataset.nome, () => acessos(box)));
    }
    if (b.dataset.st) {
      return acao(async () => {
        await post(`/portal/accesses/${encodeURIComponent(b.dataset.st)}/status`, { ativo: b.dataset.ativo === '1' });
        toast(b.dataset.ativo === '1' ? 'Acesso ativado.' : 'Acesso desativado.');
        acessos(box);
      });
    }
    return undefined;
  };
}

function novoAcesso(box) {
  const m = modal(`<h2>Novo acesso ao portal</h2><div class="grid">
    <div class="span2"><label>Cliente</label><input id="paCli" list="paCliL" placeholder="nome, código ou CNPJ"><datalist id="paCliL"></datalist></div>
    <div><label>Nome do contato</label><input id="paNome" maxlength="100"></div><div><label>Telefone</label><input id="paFone" maxlength="30"></div>
    <div class="span2"><label>E-mail (é o usuário do portal)</label><input id="paMail" type="email" maxlength="100"></div></div><div id="paMsg"></div>
    <div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="primary" data-x="1">Criar acesso</button></div>`);
  m.oninput = debounce(async (ev) => {
    if (ev.target.id !== 'paCli' || ev.target.value.length < 2) return;
    const r = await get(`/lookup/partners${qs({ q: ev.target.value.split(' — ')[0] })}`).catch(() => []);
    ($('#paCliL') || {}).innerHTML = r.map((p) => `<option value="${esc(`${p.CardCode} — ${p.CardName}`)}">`).join('');
  }, 300);
  m.onclick = async (ev) => {
    const b = ev.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === '0') return closeModal();
    try {
      const r = await post('/portal/accesses', { cardCode: $('#paCli').value.split(' — ')[0].trim(), nome: $('#paNome').value, email: $('#paMail').value, fone: $('#paFone').value });
      mostrarCodigo(r, $('#paNome').value, () => acessos(box));
    } catch (e) {
      msg('#paMsg', 'err', e.message);
    }
  };
}

/** O código aparece só aqui, uma vez: a locadora copia a mensagem e manda ao cliente (e-mail ou WhatsApp). */
function mostrarCodigo({ email, codigo }, nome, depois) {
  const texto = `Olá, ${nome}! Seu acesso ao portal de chamados da ${S.cfg.EMPRESA || 'locadora'}:\n${enderecoPortal()}\nE-mail: ${email}\nCódigo de acesso: ${codigo}`;
  const m = modal(`<h2>Código de acesso</h2><p>Envie ao cliente. Por segurança, o código <b>não aparece de novo</b>; se ele perder, gere um novo.</p>
    <div class="pt-codigo">${esc(codigo)}</div><label>Mensagem pronta</label><textarea id="pcTxt" rows="5" readonly>${esc(texto)}</textarea>
    <div class="dlg-actions"><button type="button" data-x="copiar">Copiar mensagem</button><button type="button" class="primary" data-x="ok">Concluir</button></div>`);
  m.onclick = async (ev) => {
    const b = ev.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === 'copiar') {
      try {
        await navigator.clipboard.writeText(texto);
        toast('Mensagem copiada.');
      } catch {
        $('#pcTxt').select();
        toast('Selecione e copie a mensagem (Ctrl+C).');
      }
      return;
    }
    closeModal();
    depois();
  };
}

/* ---------------- etiquetas QR ---------------- */

async function etiquetas(box) {
  const ativos = (await get('/assets?size=200')).items.filter((a) => a.U_Status !== 'BAI');
  box.innerHTML = `<p class="sub" style="margin:8px 0 12px">Cole a etiqueta no equipamento. Quem está na obra aponta a câmera do celular e abre o chamado sem precisar de login: o equipamento, o cliente e a obra já vêm preenchidos.
    ${isDemo() ? 'Na demonstração, use “Testar” para ver a tela que abre no celular.' : ''}</p>
  <div class="row" style="margin-bottom:8px"><label class="chk-inline"><input type="checkbox" id="qrTodos"> Selecionar todos</label><span class="spacer"></span>
    <button type="button" class="primary" data-a="gerar">Gerar etiquetas dos selecionados</button></div>
  <div class="tbl"><table><thead><tr><th></th><th>Código</th><th>Equipamento</th><th>Placa / série</th><th>Situação</th></tr></thead><tbody>
  ${ativos.map((a) => `<tr><td><input type="checkbox" data-qr="${esc(a.Code)}"></td><td>${esc(a.Code)}</td><td>${esc(a.Name)}</td><td>${esc(a.U_Placa || a.U_Serie || '')}</td>
    <td>${a.U_Status === 'LOC' ? 'no cliente' : 'no pátio'}</td></tr>`).join('')}</tbody></table></div><div id="qrRes"></div>`;
  box.onchange = (ev) => {
    if (ev.target.id === 'qrTodos') $$('[data-qr]', box).forEach((e) => (e.checked = ev.target.checked));
  };
  box.onclick = async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.testar) return abrirPortal({ qr: b.dataset.testar, voltar });
    if (b.dataset.a === 'imprimir') return imprimirEtiquetas(box._etiquetas, { empresa: S.cfg.EMPRESA });
    if (b.dataset.a !== 'gerar') return undefined;
    const sel = $$('[data-qr]', box).filter((e) => e.checked).map((e) => e.dataset.qr);
    if (!sel.length) return toast('Selecione ao menos um equipamento.', 'err');
    return acao(async () => {
      const r = await post('/portal/qr-labels', { ativos: sel });
      const porCodigo = Object.fromEntries(ativos.map((a) => [a.Code, a]));
      box._etiquetas = r.map((x) => ({ ...x, nome: porCodigo[x.ativo]?.Name || '', placa: porCodigo[x.ativo]?.U_Placa || '', svg: qrSvg(enderecoQR(x.token)) }));
      $('#qrRes', box).innerHTML = `<div class="row" style="margin:14px 0 8px"><h3 style="margin:0">Etiquetas</h3><span class="spacer"></span><button type="button" class="primary" data-a="imprimir">Imprimir etiquetas</button></div>
        <div class="qr-grade">${box._etiquetas.map((e) => `<div class="qr-etq">${e.svg}<b>${esc(e.ativo)}</b><span>${esc(e.nome)}</span>
          <button type="button" class="mini" data-testar="${esc(e.token)}">Testar</button></div>`).join('')}</div>`;
    });
  };
}
