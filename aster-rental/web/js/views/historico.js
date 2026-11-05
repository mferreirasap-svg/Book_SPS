// Histórico do equipamento: contratos, movimentações, chamados, ordens de serviço e leituras numa linha do tempo.
import { esc, brl, num, fmtD, UN, DOM, badge, modal, closeModal } from '../util.js';
import { get } from '../api.js';

const ROTULO = { contrato: 'Contrato', movimento: 'Movimentação', chamado: 'Chamado', os: 'Ordem de serviço', leitura: 'Leitura' };

export async function abrirHistorico(code, go) {
  const h = await get(`/assets/${encodeURIComponent(code)}/history`);
  const a = h.ativo;
  const r = h.resumo;
  const m = modal(`<div class="row"><h2 style="margin:0">Histórico — ${esc(a.Code)} ${esc(a.Name)}</h2><span class="spacer"></span>${badge(a.U_Status, DOM.statusAtivo)}</div>
    <p class="sub">${esc(a.U_Placa || a.U_Serie || '')} · leitura atual ${num(a.U_Medidor, 0)} ${UN(a.U_Tipo)}</p>
    <div class="kpis" style="margin-top:8px">
      <div class="kpi"><div class="l">Corretivas / reparos</div><div class="v">${r.corretivas}</div></div>
      <div class="kpi"><div class="l">Preventivas</div><div class="v">${r.preventivas}</div></div>
      <div class="kpi"><div class="l">Chamados</div><div class="v">${r.chamados}</div></div>
      <div class="kpi"><div class="l">Peças e serviços</div><div class="v" style="font-size:18px">${brl(r.custoPecasServicos)}</div><div class="sub">cobrado de clientes ${brl(r.cobradoClientes)}</div></div></div>
    <ul class="timeline" style="max-height:52vh;overflow:auto">${h.eventos.map((e) => `<li class="t-${e.tipo}"><div class="meta">${fmtD(e.data) || 'sem data'} · ${ROTULO[e.tipo]}</div>
      <div>${e.ref.os ? `<a href="#/os?id=${e.ref.os}" data-fecha>${esc(e.titulo)}</a>` : e.ref.chamado ? `<a href="#/chamados?id=${e.ref.chamado}" data-fecha>${esc(e.titulo)}</a>`
        : e.ref.contrato ? `<a href="#/contratos?id=${e.ref.contrato}" data-fecha>${esc(e.titulo)}</a>` : esc(e.titulo)}</div>
      <div class="sub">${esc(e.detalhe)}</div></li>`).join('') || '<li><div class="meta">Sem registros.</div></li>'}</ul>
    <div class="dlg-actions"><button type="button" class="primary" data-x>Fechar</button></div>`);
  m.onclick = (ev) => {
    if (ev.target.closest('[data-x]') || ev.target.closest('[data-fecha]')) closeModal();
  };
  return go;
}
