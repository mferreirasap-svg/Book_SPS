// Utilitários da tela: formatação pt-BR, diálogos, avisos e rótulos.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const num = (n, d = 2) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const d10 = (v) => (v ? String(v).slice(0, 10) : '');
export const fmtD = (v) => (v ? d10(v).split('-').reverse().join('/') : '');
const pad = (n) => String(n).padStart(2, '0');
export const hoje = () => {
  const t = new Date();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};
export const compAtual = () => hoje().slice(0, 7).replace('-', '');
export const compFmt = (c) => (c ? `${c.slice(4, 6)}/${c.slice(0, 4)}` : '');
export const compToMonth = (c) => `${c.slice(0, 4)}-${c.slice(4, 6)}`;
export const monthToComp = (m) => m.replace('-', '');
export const UN = (tipo) => (tipo === 'VEI' ? 'km' : 'h');
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export const DOM = {
  tipoAtivo: { EQP: 'Máquina/Equipamento', VEI: 'Veículo' },
  statusAtivo: { DIS: 'Disponível', LOC: 'Locado', MAN: 'Manutenção', RES: 'Reservado', BAI: 'Baixado' },
  tipoContrato: { LOC: 'Locação', COM: 'Comodato', SRV: 'Serviço' },
  statusContrato: { RAS: 'Rascunho', ATV: 'Ativo', SUS: 'Suspenso', ENC: 'Encerrado' },
  statusLinha: { PEN: 'Aguardando entrega', LOC: 'Locado', DEV: 'Devolvido' },
  modoFat: { RAS: 'Rascunho de NF', PRE: 'Pré-fatura (pedido)', FAT: 'Fatura direta (NF)' },
  tipoRegra: { ITEM: 'Por item', AGRUP: 'Agrupada', CONS: 'Por consumo', SEM: 'Sem cobrança' },
  proRata: { LIN: 'Linear', PCT: 'Tabela em %', DIA: 'Tabela em diárias' },
  tipoMov: { ENT: 'Entrega', DEV: 'Devolução', SUB: 'Substituição', MAN: 'Envio à manutenção', RET: 'Retorno da manutenção' },
  statusFat: { PRO: 'Em processamento', OK: 'Gerada', CAN: 'Cancelada', ERR: 'Com erro' },
  situacao: { gerada: 'Gerada', em_dia: 'Em dia', vence: 'Vence em breve', atrasada: 'Atrasada' },
  statusMulta: { PEN: 'Pendente', IND: 'Condutor indicado', REP: 'A repassar', FAT: 'Faturada', PAG: 'Paga pela locadora' },
};

export const badge = (code, map, cls = 'b-') => `<span class="badge ${cls}${esc(code)}">${esc(map[code] || code || '—')}</span>`;
export const options = (map, sel, { vazio } = {}) =>
  (vazio != null ? `<option value="">${esc(vazio)}</option>` : '') +
  Object.entries(map).map(([k, v]) => `<option value="${esc(k)}" ${String(sel ?? '') === k ? 'selected' : ''}>${esc(v)}</option>`).join('');

let toastT;
export function toast(text, tipo = 'ok') {
  const e = $('#toast');
  e.textContent = text;
  e.style.background = tipo === 'err' ? '#B03A2E' : '#2E3B43';
  e.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => e.classList.remove('on'), tipo === 'err' ? 6000 : 2800);
}

export function msg(el, tipo, text) {
  (typeof el === 'string' ? $(el) : el).innerHTML = text ? `<div class="msg ${tipo}">${esc(text)}</div>` : '';
}

let busyN = 0;
export async function busy(fn) {
  busyN++;
  $('#busy').hidden = false;
  try {
    return await fn();
  } finally {
    if (--busyN === 0) $('#busy').hidden = true;
  }
}

/** Executa uma ação e mostra o erro ao usuário, com o código da requisição para o suporte. */
export async function acao(fn) {
  try {
    return await busy(fn);
  } catch (e) {
    if (e.status !== 401) toast(`${e.message}${e.requestId ? ` (código ${e.requestId.slice(0, 8)})` : ''}`, 'err');
    return undefined;
  }
}

export function modal(html) {
  $('#modal').innerHTML = html;
  $('#modalBg').hidden = false;
  return $('#modal');
}
export function closeModal() {
  $('#modalBg').hidden = true;
  $('#modal').innerHTML = '';
}

/** Confirmação com resumo do impacto, em janela própria (requisito USA-06). */
export function confirmar({ titulo, texto, ok = 'Confirmar', perigo = false }) {
  return new Promise((resolve) => {
    const m = modal(`<h2>${esc(titulo)}</h2><p>${esc(texto)}</p>
      <div class="dlg-actions"><button type="button" data-r="0">Cancelar</button><button type="button" class="${perigo ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div>`);
    m.onclick = (ev) => {
      const b = ev.target.closest('[data-r]');
      if (!b) return;
      m.onclick = null;
      closeModal();
      resolve(b.dataset.r === '1');
    };
  });
}

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export const ICON = {
  painel: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  ativos: 'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  disponibilidade: 'M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z',
  contratos: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  movimentacao: 'M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z',
  leituras: 'M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.27-10.44zm-9.79 6.84a2 2 0 0 0 2.83 0l5.66-8.49-8.49 5.66a2 2 0 0 0 0 2.83z',
  faturamento: 'M18 17H6v-2h12v2zm0-4H6v-2h12v2zm0-4H6V7h12v2zM3 22l1.5-1.5L6 22l1.5-1.5L9 22l1.5-1.5L12 22l1.5-1.5L15 22l1.5-1.5L18 22l1.5-1.5L21 22V2l-1.5 1.5L18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2 4.5 3.5 3 2v20z',
  multas: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  cadastros: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
  admin: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
};
export const ico = (k) => `<svg class="ico" viewBox="0 0 24 24"><path d="${ICON[k]}"/></svg>`;
export const SETA = '<svg class="go" viewBox="0 0 24 24"><path d="M3 9.5h9V5l9 7-9 7v-4.5H3z"/></svg>';
export const SEARCH = '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.18-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>';

export function pager(p) {
  if (!p || (p.page === 1 && !p.hasMore)) return '';
  return `<div class="pager">Página ${p.page}<button type="button" class="mini" data-page="${p.page - 1}" ${p.page <= 1 ? 'disabled' : ''}>‹ Anterior</button>
    <button type="button" class="mini" data-page="${p.page + 1}" ${p.hasMore ? '' : 'disabled'}>Próxima ›</button></div>`;
}
