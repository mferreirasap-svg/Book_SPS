// Portal do cliente (o que a empresa cliente vê): chamados, mensagens, orçamentos e equipamentos locados.
// E a tela da etiqueta QR colada no equipamento: abre chamado sem login, direto do celular na obra.
// Entradas: endereço#portal, endereço#qr-<código da etiqueta>, ou o botão "ver como o cliente" da tela interna.
import { esc, brl, num, fmtD, fmtDT, toast, msg } from './util.js';
import { api } from './api.js';
import { reduzirFoto } from './campo.js';

const CHAVE = 'aster-portal-token';
const ls = {
  get: () => {
    try {
      return localStorage.getItem(CHAVE) || '';
    } catch {
      return '';
    }
  },
  set: (v) => {
    try {
      if (v) localStorage.setItem(CHAVE, v);
      else localStorage.removeItem(CHAVE);
    } catch {
      /* sem armazenamento: o cliente entra de novo ao recarregar */
    }
  },
};

let raiz;
let token = '';
let estado = { aba: 'chamados', chamado: null, extrato: null };
let aoSair = null;
let fotos = [];

const p = (metodo, caminho, corpo) => api(metodo, `/public/portal${caminho}`, corpo, token ? { 'X-Portal-Token': token } : {});
const logo = () => document.querySelector('.login-card .logo')?.getAttribute('src') || '';
const STATUS_COR = { ABE: 'b-ABE', AND: 'b-AND', AGC: 's-vencendo', RES: 'b-CON', FEC: 'b-FEC', CAN: 'b-CAN' };

/** Mostra o portal no lugar do sistema interno. opts.qr = código da etiqueta; opts.voltar = função para voltar (demonstração). */
export function abrirPortal(opts = {}) {
  aoSair = opts.voltar || null;
  ['#login', '#app'].forEach((s) => document.querySelector(s) && (document.querySelector(s).hidden = true));
  raiz = document.querySelector('#portalApp');
  if (!raiz) {
    raiz = document.createElement('div');
    raiz.id = 'portalApp';
    document.body.appendChild(raiz);
  }
  raiz.hidden = false;
  fotos = [];
  if (opts.qr) return telaQR(opts.qr);
  token = ls.get();
  estado = { aba: 'chamados', chamado: null };
  return token ? inicio() : entrar();
}

function moldura(conteudo, { sair = false, titulo = 'Portal do cliente' } = {}) {
  raiz.innerHTML = `${aoSair ? '<div class="pt-demo">Você está vendo o portal como o cliente vê. <button type="button" class="mini" data-pt="voltar">‹ Voltar ao sistema da locadora</button></div>' : ''}
  <header class="pt-top"><img src="${esc(logo())}" alt="aster rental"><b>${esc(titulo)}</b><span class="spacer"></span>${sair ? '<button type="button" class="mini" data-pt="sair">Sair</button>' : ''}</header>
  <main class="pt-main">${conteudo}</main>`;
  raiz.onclick = async (ev) => {
    const b = ev.target.closest('[data-pt]');
    if (!b) return;
    if (b.dataset.pt === 'voltar') {
      raiz.hidden = true;
      raiz.innerHTML = '';
      return aoSair?.();
    }
    if (b.dataset.pt === 'sair') {
      await p('POST', '/logout').catch(() => {});
      token = '';
      ls.set('');
      return entrar();
    }
    return clique(b);
  };
  raiz.onchange = mudanca;
}

/* ---------------- entrar ---------------- */

function entrar(aviso = '') {
  moldura(`<div class="card pt-login"><h2>Acesse o portal</h2><p class="sub">Acompanhe seus chamados, aprove orçamentos e veja os equipamentos locados.</p>
    <label>E-mail</label><input id="ptEmail" type="email" autocomplete="username">
    <label style="margin-top:10px">Código de acesso</label><input id="ptCod" autocomplete="one-time-code" placeholder="enviado pela locadora">
    <div id="ptMsg">${aviso ? `<div class="msg warn">${esc(aviso)}</div>` : ''}</div>
    <button type="button" class="primary" data-pt="entrar" style="width:100%;margin-top:12px">Entrar</button>
    <p class="sub" style="margin-top:12px">Não tem acesso? Peça à locadora o código para o seu e-mail.${aoSair ? ' <b>Demonstração:</b> marcos@serraazul.example · código SERRA2026' : ''}</p></div>`);
  setTimeout(() => document.querySelector('#ptEmail')?.focus(), 50);
}

/* ---------------- área do cliente ---------------- */

async function inicio() {
  let me;
  let lista;
  let orc;
  try {
    [me, lista, orc] = await Promise.all([p('GET', '/me'), p('GET', '/chamados'), p('GET', '/orcamentos')]);
  } catch (e) {
    token = '';
    ls.set('');
    return entrar(e.status === 401 ? 'Sua sessão terminou. Entre novamente.' : e.message);
  }
  const abas = [['chamados', 'Meus chamados'], ['novo', 'Abrir chamado'], ['orcamentos', `Orçamentos${orc.length ? ` (${orc.length})` : ''}`], ['equipamentos', 'Meus equipamentos'], ['financeiro', 'Financeiro']];
  let corpo = '';
  if (estado.chamado) corpo = await telaChamado(estado.chamado);
  else if (estado.aba === 'novo') corpo = await telaNovo();
  else if (estado.aba === 'orcamentos') corpo = telaOrcamentos(orc);
  else if (estado.aba === 'equipamentos') corpo = await telaEquipamentos();
  else if (estado.aba === 'financeiro') corpo = estado.extrato ? await telaExtrato(estado.extrato) : await telaFinanceiro();
  else corpo = telaChamados(lista);
  moldura(`<p class="pt-ola">Olá, <b>${esc(me.nome)}</b> · ${esc(me.cliente)}</p>
    ${orc.length && estado.aba !== 'orcamentos' ? `<div class="msg warn">Há ${orc.length} orçamento(s) aguardando a sua aprovação. <button type="button" class="mini" data-aba="orcamentos">Ver</button></div>` : ''}
    <nav class="tabs-in">${abas.map(([k, t]) => `<button type="button" data-aba="${k}" class="${!estado.chamado && estado.aba === k ? 'on' : ''}">${t}</button>`).join('')}</nav>${corpo}`, { sair: true });
}

function telaChamados(lista) {
  if (!lista.length) return '<div class="card empty">Nenhum chamado. Use "Abrir chamado" quando precisar da locadora.</div>';
  return `<div class="pt-lista">${lista.map((c) => `<button type="button" class="pt-item" data-ch="${c.DocEntry}">
    <span class="row"><b>Nº ${c.DocNum} · ${esc(c.assunto)}</b><span class="spacer"></span><span class="badge ${STATUS_COR[c.status] || ''}">${esc(c.statusNome)}</span></span>
    <span class="sub">${esc(c.ativo || 'sem equipamento')} · aberto em ${fmtDT(c.abertura)}${c.parado ? ' · <b style="color:var(--coral)">equipamento parado</b>' : ''}</span></button>`).join('')}</div>`;
}

async function telaChamado(id) {
  const c = await p('GET', `/chamados/${id}`);
  return `<div class="card"><button type="button" class="mini" data-aba="chamados">‹ Meus chamados</button>
    <h2 style="margin-top:10px">Nº ${c.DocNum} · ${esc(c.assunto)}</h2>
    <p><span class="badge ${STATUS_COR[c.status] || ''}">${esc(c.statusNome)}</span> <span class="sub">${esc(c.tipo || '')} · ${esc(c.ativo || '')} · aberto em ${fmtDT(c.abertura)}</span></p>
    ${c.visita ? `<div class="msg info">Visita técnica agendada: <b>${fmtD(c.visita.data)} às ${esc(c.visita.hora)}</b>${c.visita.tecnico ? ` com ${esc(c.visita.tecnico)}` : ''}.</div>` : ''}
    ${c.laudo ? `<div class="msg ok"><b>Serviço realizado:</b> ${esc(c.laudo)}</div>` : ''}
    ${c.descricao ? `<p style="white-space:pre-wrap">${esc(c.descricao)}</p>` : ''}
    ${c.fotos.length ? `<div class="fotos">${c.fotos.map((f) => `<figure><img src="${f.src}" alt="${esc(f.legenda || 'foto')}"><figcaption>${esc(f.legenda || '')}</figcaption></figure>`).join('')}</div>` : ''}
    <h3>Conversa</h3><div class="pt-conversa">${c.mensagens.map((m) => `<div class="pt-msg ${m.cliente ? 'eu' : ''}"><div class="sub">${esc(m.autor)} · ${fmtDT(m.data)}</div>${esc(m.texto)}</div>`).join('')
      || '<p class="sub">A equipe de atendimento vai responder por aqui.</p>'}</div>
    ${['FEC', 'CAN'].includes(c.status) ? '<p class="sub">Chamado encerrado. Se o problema voltar, abra um novo chamado.</p>'
      : `<label style="margin-top:10px">Escrever para a locadora</label><textarea id="ptTxt" rows="3"></textarea><div id="ptMsg"></div>
      <div class="row" style="margin-top:8px"><span class="spacer"></span><button type="button" class="primary" data-pt="responder" data-id="${c.DocEntry}">Enviar mensagem</button></div>`}</div>`;
}

async function telaNovo() {
  const eq = await p('GET', '/equipamentos');
  return `<div class="card"><h2>Abrir chamado</h2>
    <label>Equipamento</label><select id="ptAtv"><option value="">(não se refere a um equipamento)</option>${eq.map((e) => `<option value="${esc(e.ativo)}">${esc(e.ativo)} — ${esc(e.nome)}${e.placa ? ` · ${esc(e.placa)}` : ''} · ${esc(e.obra || '')}</option>`).join('')}</select>
    ${formProblema()}
    <label style="margin-top:10px">Assunto</label><input id="ptAss" maxlength="150" placeholder="ex.: retroescavadeira com vazamento">
    <div id="ptMsg"></div><button type="button" class="primary" data-pt="abrir" style="width:100%;margin-top:12px">Enviar chamado</button></div>`;
}

const formProblema = () => `<label style="margin-top:10px">O que aconteceu?</label>
  <div class="pt-opcoes">${[['PAR', 'Equipamento parado'], ['MAN', 'Precisa de manutenção'], ['DUV', 'Dúvida / outro']].map(([v, t], i) => `<label class="chk-inline"><input type="radio" name="ptTipo" value="${v}" ${i === 1 ? 'checked' : ''}> ${t}</label>`).join('')}</div>
  <label style="margin-top:10px">Descreva o problema</label><textarea id="ptDesc" rows="3" maxlength="4000"></textarea>
  <label style="margin-top:10px">Fotos (até 3)</label><input type="file" id="ptFoto" accept="image/*" capture="environment">
  <div class="fotos" id="ptFotos">${fotosHtml()}</div>`;
const fotosHtml = () => fotos.map((f, i) => `<figure><img src="${f.src}" alt="foto ${i + 1}"><figcaption><button type="button" class="mini danger" data-pt="tirarFoto" data-i="${i}">remover</button></figcaption></figure>`).join('');

function telaOrcamentos(lista) {
  if (!lista.length) return '<div class="card empty">Nenhum orçamento aguardando aprovação.</div>';
  return lista.map((o) => `<div class="card"><h2>Orçamento da OS ${o.DocNum} · ${esc(o.ativo)}</h2>
    <p class="sub">${esc(o.tipo)}${o.problema ? ` · ${esc(String(o.problema).replace(/\s*\n+\s*/g, ' — '))}` : ''}</p>${o.laudo ? `<p>${esc(o.laudo)}</p>` : ''}
    <div class="tbl"><table><thead><tr><th>Item</th><th class="num">Qtd</th><th class="num">Valor</th></tr></thead><tbody>
    ${o.itens.map((i) => `<tr><td>${esc(i.descr)}</td><td class="num">${num(i.qtd, Number.isInteger(Number(i.qtd)) ? 0 : 1)}</td><td class="num">${brl(i.total)}</td></tr>`).join('')}
    <tr><td colspan="2"><b>Total</b></td><td class="num"><b>${brl(o.valor)}</b></td></tr></tbody></table></div>
    <div class="row" style="margin-top:10px"><span class="spacer"></span><button type="button" class="danger" data-pt="orc" data-acao="recusar" data-id="${o.DocEntry}">Recusar</button>
    <button type="button" class="primary" data-pt="orc" data-acao="aprovar" data-id="${o.DocEntry}">Aprovar orçamento</button></div></div>`).join('');
}

async function telaEquipamentos() {
  const eq = await p('GET', '/equipamentos');
  if (!eq.length) return '<div class="card empty">Nenhum equipamento locado no momento.</div>';
  const prev = (x) => {
    if (!x) return '';
    if (x.aberta) return '<span class="badge b-AGE">Manutenção preventiva programada</span>';
    if (x.status === 'vencida') return '<span class="badge v-vencida">Manutenção preventiva a agendar</span>';
    if (x.status === 'proxima') return '<span class="badge v-proxima">Manutenção preventiva em breve</span>';
    return '';
  };
  return `<div class="pt-lista">${eq.map((e) => `<div class="pt-item"><span class="row"><b>${esc(e.ativo)} · ${esc(e.nome)}</b><span class="spacer"></span>${prev(e.preventiva)}</span>
    <span class="sub">${e.placa ? `placa ${esc(e.placa)} · ` : ''}contrato ${e.contrato} · ${esc(e.obra || '')} · com vocês desde ${fmtD(e.desde)} · ${e.tipo === 'VEI' ? 'hodômetro' : 'horímetro'} ${num(e.medidor, 0)}</span></div>`).join('')}</div>
    <p class="sub">Problema com algum equipamento? Use "Abrir chamado" ou aponte a câmera do celular para a etiqueta QR colada nele.</p>`;
}

const SIT_FIN = { pago: ['Pago', 'b-CON'], aberto: ['Em aberto', 'b-AGE'], vencido: ['Vencido', 'v-vencida'] };
const compTxt = (c) => (c ? `${String(c).slice(4, 6)}/${String(c).slice(0, 4)}` : '');

async function telaFinanceiro() {
  const f = await p('GET', '/financeiro');
  const r = f.resumo;
  return `<div class="kpis"><div class="kpi ${r.vencido ? 'alerta' : 'ok'}"><div class="l">Vencido</div><div class="v" style="font-size:19px">${brl(r.vencido)}</div></div>
    <div class="kpi"><div class="l">A vencer</div><div class="v" style="font-size:19px">${brl(r.aberto)}</div></div>
    <div class="kpi"><div class="l">Pago nos últimos 12 meses</div><div class="v" style="font-size:19px">${brl(r.pago12m)}</div></div></div>
  <div class="card"><h2>Notas e títulos</h2><div class="tbl"><table><thead><tr><th>NF</th><th>Emissão</th><th>Vencimento</th><th>Referente a</th><th class="num">Valor</th><th class="num">Saldo</th><th>Situação</th><th></th></tr></thead><tbody>
  ${f.titulos.map((t) => `<tr><td>${t.numero}</td><td>${fmtD(t.emissao)}</td><td>${fmtD(t.vencimento)}</td>
    <td>${t.contrato ? `Contrato ${t.contrato}${t.competencia ? ` · ${compTxt(t.competencia)}` : ''}` : t.os ? `Assistência técnica (OS ${t.os})` : esc(t.descricao)}</td>
    <td class="num">${brl(t.total)}</td><td class="num">${brl(t.saldo)}</td><td><span class="badge ${SIT_FIN[t.situacao][1]}">${SIT_FIN[t.situacao][0]}</span></td>
    <td class="right" style="white-space:nowrap">${t.contrato && t.competencia ? `<button type="button" class="mini" data-pt="extrato" data-ctr="${t.contrato}" data-comp="${esc(t.competencia)}">Extrato</button>` : ''}
      ${t.linhaDigitavel && t.situacao !== 'pago' ? `<button type="button" class="mini" data-pt="copiar" data-txt="${esc(t.linhaDigitavel)}">Copiar linha digitável</button>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="8" class="empty">Nenhuma nota emitida.</td></tr>'}</tbody></table></div>
  <p class="sub">Dúvidas sobre valores? Abra um chamado do tipo "Dúvida / solicitação" citando o número da NF.</p></div>`;
}

async function telaExtrato({ ctr, comp }) {
  const e = await p('GET', `/extrato/${ctr}/${comp}`);
  return `<div class="card"><button type="button" class="mini" data-pt="voltarFin">‹ Financeiro</button>
    <h2 style="margin-top:10px">Extrato — contrato ${e.contrato} · ${compTxt(e.competencia)}</h2><p class="sub">${esc(e.obra || '')} · NF nº ${e.documento}${e.documentoServico ? ` e NF de serviço nº ${e.documentoServico}` : ''}</p>
    <div class="tbl"><table><thead><tr><th>Descrição e cálculo</th><th class="num">Qtd</th><th class="num">Preço</th><th class="num">Total</th></tr></thead><tbody>
    ${e.linhas.filter((l) => !l.abonada).map((l) => `<tr><td class="wrap">${esc(l.desc)}<ul class="memo">${l.memoria.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></td>
      <td class="num">${num(l.qtd, Number.isInteger(Number(l.qtd)) ? 0 : 2)}</td><td class="num">${brl(l.preco)}</td><td class="num">${brl(l.total)}</td></tr>`).join('')}
    <tr><td colspan="3"><b>Total</b></td><td class="num"><b>${brl(e.valor)}</b></td></tr></tbody></table></div></div>`;
}

/* ---------------- etiqueta QR (sem login) ---------------- */

async function telaQR(tk) {
  let info;
  try {
    info = await api('GET', `/public/qr/${encodeURIComponent(tk)}`);
  } catch (e) {
    return moldura(`<div class="card"><div class="msg err">${esc(e.status === 404 ? 'Etiqueta não reconhecida. Confira o código ou fale com a locadora.' : e.message)}</div></div>`, { titulo: 'Abrir chamado' });
  }
  if (!info.locado) {
    return moldura(`<div class="card"><h2>${esc(info.equipamento)}</h2><div class="msg warn">Este equipamento não está locado no momento. Fale com ${esc(info.empresa || 'a locadora')} pelo telefone.</div></div>`, { titulo: 'Abrir chamado' });
  }
  moldura(`<div class="card"><p class="sub">${esc(info.empresa)}</p><h2>${esc(info.equipamento)}</h2>
    <p class="sub">${esc(info.codigo)}${info.placa ? ` · placa ${esc(info.placa)}` : ''} · ${esc(info.cliente)} · ${esc(info.obra)}</p>
    <label style="margin-top:6px">Seu nome</label><input id="ptNome" maxlength="100" autocomplete="name">
    <label style="margin-top:10px">Telefone para contato</label><input id="ptFone" maxlength="30" inputmode="tel" autocomplete="tel">
    ${formProblema()}
    <div id="ptMsg"></div><button type="button" class="primary" data-pt="qr" data-tk="${esc(tk)}" style="width:100%;margin-top:12px">Enviar chamado</button></div>`, { titulo: 'Abrir chamado' });
}

/* ---------------- ações ---------------- */

async function mudanca(ev) {
  if (ev.target.id !== 'ptFoto' || !ev.target.files?.[0]) return;
  if (fotos.length >= 3) return toast('Envie no máximo 3 fotos.', 'err');
  try {
    fotos.push({ src: await reduzirFoto(ev.target.files[0], 900, 0.55), legenda: '' });
    document.querySelector('#ptFotos').innerHTML = fotosHtml();
    ev.target.value = '';
  } catch (e) {
    toast(e.message, 'err');
  }
}

const problema = () => ({
  tipo: document.querySelector('input[name=ptTipo]:checked')?.value || 'MAN',
  descricao: document.querySelector('#ptDesc').value,
  fotos,
});

async function clique(b) {
  const a = b.dataset.pt;
  try {
    if (a === 'entrar') {
      const r = await api('POST', '/public/portal/login', { email: document.querySelector('#ptEmail').value, codigo: document.querySelector('#ptCod').value });
      token = r.token;
      ls.set(token);
      estado = { aba: 'chamados', chamado: null };
      return inicio();
    }
    if (a === 'tirarFoto') {
      fotos.splice(Number(b.dataset.i), 1);
      document.querySelector('#ptFotos').innerHTML = fotosHtml();
      return;
    }
    if (a === 'abrir') {
      const pr = problema();
      const r = await p('POST', '/chamados', { ativo: document.querySelector('#ptAtv').value, assunto: document.querySelector('#ptAss').value || 'Chamado aberto pelo portal',
        parado: pr.tipo === 'PAR', ...pr });
      fotos = [];
      toast(`Chamado nº ${r.DocNum} enviado. A equipe já foi avisada.`);
      estado = { aba: 'chamados', chamado: r.DocEntry };
      return inicio();
    }
    if (a === 'responder') {
      await p('POST', `/chamados/${b.dataset.id}/mensagens`, { texto: document.querySelector('#ptTxt').value });
      toast('Mensagem enviada.');
      return inicio();
    }
    if (a === 'extrato') {
      estado = { ...estado, extrato: { ctr: b.dataset.ctr, comp: b.dataset.comp } };
      return inicio();
    }
    if (a === 'voltarFin') {
      estado = { ...estado, extrato: null };
      return inicio();
    }
    if (a === 'copiar') {
      try {
        await navigator.clipboard.writeText(b.dataset.txt);
        toast('Linha digitável copiada.');
      } catch {
        toast(b.dataset.txt);
      }
      return;
    }
    if (a === 'orc') {
      await p('POST', `/orcamentos/${b.dataset.id}`, { acao: b.dataset.acao });
      toast(b.dataset.acao === 'aprovar' ? 'Orçamento aprovado. A locadora já pode executar o serviço.' : 'Orçamento recusado. A locadora vai entrar em contato.');
      return inicio();
    }
    if (a === 'qr') {
      const pr = problema();
      const r = await api('POST', `/public/qr/${encodeURIComponent(b.dataset.tk)}`, { nome: document.querySelector('#ptNome').value, fone: document.querySelector('#ptFone').value,
        parado: pr.tipo === 'PAR', ...pr });
      fotos = [];
      return moldura(`<div class="card"><h2>Chamado enviado</h2><div class="msg ok">Protocolo <b>nº ${r.protocolo}</b>. A equipe da locadora vai retornar até <b>${fmtDT(r.prazo)}</b>.</div>
        <p class="sub">Guarde o número do protocolo. Se o equipamento estiver parado, não tente consertar: aguarde o técnico.</p></div>`, { titulo: 'Abrir chamado' });
    }
  } catch (e) {
    if (e.status === 401 && token) {
      token = '';
      ls.set('');
      return entrar('Sua sessão terminou. Entre novamente.');
    }
    const box = document.querySelector('#ptMsg');
    if (box) msg(box, 'err', e.message);
    else toast(e.message, 'err');
  }
}

// Abas e itens da lista (fora de [data-pt]).
document.addEventListener('click', (ev) => {
  if (!raiz || raiz.hidden || !raiz.contains(ev.target)) return;
  const aba = ev.target.closest('[data-aba]');
  if (aba) {
    estado = { aba: aba.dataset.aba, chamado: null, extrato: null };
    fotos = [];
    return inicio();
  }
  const ch = ev.target.closest('[data-ch]');
  if (ch) {
    estado = { ...estado, chamado: Number(ch.dataset.ch) };
    return inicio();
  }
  return undefined;
});
