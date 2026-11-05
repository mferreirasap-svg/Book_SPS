// Pesquisa de satisfação: NPS geral e por técnico, respostas e link de resposta do cliente.
import { $, esc, num, fmtD, fmtDT, toast, modal, closeModal, msg } from '../util.js';
import { get, post, isDemo } from '../api.js';
import { filtro } from '../state.js';

const addDias = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const hojeIso = () => new Date().toISOString().slice(0, 10);

const npsCor = (n) => (n == null ? 'var(--muted)' : n >= 50 ? 'var(--teal)' : n >= 0 ? 'var(--amber)' : 'var(--coral)');
const barra = (r) => (r.respostas ? `<div class="npsbar" title="promotores ${r.promotores} · neutros ${r.neutros} · detratores ${r.detratores}">
  <i style="width:${(r.promotores / r.respostas) * 100}%;background:var(--teal)"></i><i style="width:${(r.neutros / r.respostas) * 100}%;background:#C9D2D8"></i>
  <i style="width:${(r.detratores / r.respostas) * 100}%;background:var(--coral)"></i></div>` : '');

export const linkPesquisa = (code) => `${location.origin}${location.pathname}#/pesquisa/${code}`;

export async function render(root, _p, c) {
  const f = filtro('satisfacao', { dias: '90' });
  const d = await get(`/surveys${f.dias ? `?de=${addDias(hojeIso(), -Number(f.dias))}` : ''}`);
  const r = d.resumo;
  root.innerHTML = `<div class="kpis">
    <div class="kpi"><div class="l">NPS</div><div class="nps" style="color:${npsCor(r.nps)}">${r.nps ?? '—'}</div>${barra(r)}</div>
    <div class="kpi"><div class="l">Nota média</div><div class="v">${r.media != null ? num(r.media, 1) : '—'}</div><div class="sub">de 0 a 10</div></div>
    <div class="kpi"><div class="l">Respostas</div><div class="v">${r.respostas}</div><div class="sub">${r.enviadas} enviadas · ${r.enviadas ? num((r.respostas / r.enviadas) * 100, 0) : 0}% de retorno</div></div>
    <div class="kpi"><div class="l">Promotores · neutros · detratores</div><div class="v" style="font-size:19px">${r.promotores} · ${r.neutros} · ${r.detratores}</div></div></div>
  <div class="card"><div class="toolbar"><div><label>Período</label><select id="saDias">${[['30', '30 dias'], ['90', '90 dias'], ['365', '12 meses'], ['', 'Tudo']]
    .map(([v, t]) => `<option value="${v}" ${f.dias === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
    <p class="sub">NPS = % de promotores (nota 9–10) − % de detratores (0–6). Nota de 0 a 6 abre automaticamente um chamado de reclamação.</p>
    <h3>Por técnico</h3><div class="tbl"><table><thead><tr><th>Técnico</th><th class="num">Respostas</th><th class="num">Média</th><th class="num">NPS</th><th style="min-width:160px">Distribuição</th></tr></thead><tbody>
    ${d.porTecnico.map((t) => `<tr><td>${esc(t.nome)}</td><td class="num">${t.respostas}</td><td class="num">${t.media != null ? num(t.media, 1) : '—'}</td>
      <td class="num"><b style="color:${npsCor(t.nps)}">${t.nps ?? '—'}</b></td><td>${barra(t)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sem respostas.</td></tr>'}</tbody></table></div>
    <h3>Pesquisas</h3><div class="tbl"><table><thead><tr><th>Enviada</th><th>Cliente</th><th>Origem</th><th>Técnico</th><th class="num">Nota</th><th>Comentário</th><th></th></tr></thead><tbody>
    ${d.itens.map((p) => `<tr><td>${fmtD(p.U_Enviada)}</td><td>${esc(p.U_CardName)}</td>
      <td>${p.U_OsEntry ? `<a href="#/os?id=${p.U_OsEntry}">OS ${p.U_OsEntry}</a>` : ''} ${p.U_ChaEntry ? `<a href="#/chamados?id=${p.U_ChaEntry}">chamado ${p.U_ChaEntry}</a>` : ''}</td>
      <td>${esc(p.tecnicoNome)}</td><td class="num">${Number(p.U_Nota) >= 0 ? `<b style="color:${p.U_Nota >= 9 ? 'var(--teal)' : p.U_Nota >= 7 ? 'var(--amber)' : 'var(--coral)'}">${p.U_Nota}</b>` : '<span class="muted">aguardando</span>'}</td>
      <td class="wrap">${esc(p.U_Comentario || '')}${p.U_Respondida ? `<div class="sub">${fmtDT(p.U_Respondida)}</div>` : ''}</td>
      <td class="right">${Number(p.U_Nota) < 0 ? `<button type="button" class="mini" data-link="${esc(p.Code)}">Copiar link</button><button type="button" class="mini" data-resp="${esc(p.Code)}">Responder como cliente</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">Nenhuma pesquisa no período.</td></tr>'}</tbody></table></div>
    <p class="sub">${isDemo() ? 'Na demonstração não há envio de e-mail: use "Responder como cliente" para ver a tela que o cliente recebe.' : 'O link vai por e-mail ao concluir a OS (parâmetro em Administração). "Copiar link" serve para mandar por WhatsApp.'}</p></div>`;

  root.onchange = (ev) => {
    if (ev.target.id === 'saDias') {
      f.dias = ev.target.value;
      render(root, {}, c);
    }
  };
  root.onclick = async (ev) => {
    const l = ev.target.closest('[data-link]');
    if (l) {
      const url = linkPesquisa(l.dataset.link);
      try {
        await navigator.clipboard.writeText(url);
        toast('Link copiado.');
      } catch {
        const m = modal(`<h2>Link da pesquisa</h2><input id="saLink" value="${esc(url)}" readonly><div class="dlg-actions"><button type="button" class="primary" data-close>Fechar</button></div>`);
        $('#saLink').select();
        m.onclick = (e) => e.target.closest('[data-close]') && closeModal();
      }
      return;
    }
    const rp = ev.target.closest('[data-resp]');
    if (rp) {
      const m = modal('<div id="pubBox"></div><div class="dlg-actions"><button type="button" data-close>Fechar</button></div>');
      m.onclick = (e) => e.target.closest('[data-close]') && (closeModal(), render(root, {}, c));
      formularioPesquisa($('#pubBox'), rp.dataset.resp);
    }
  };
}

/** Formulário que o cliente vê pelo link (também usado na página pública, sem login). */
export async function formularioPesquisa(box, code) {
  let info;
  try {
    info = await get(`/public/survey/${encodeURIComponent(code)}`);
  } catch (e) {
    box.innerHTML = `<h2>Pesquisa de satisfação</h2><div class="msg err">${esc(e.status === 404 ? 'Link inválido ou expirado.' : e.message)}</div>`;
    return;
  }
  if (info.respondida) {
    box.innerHTML = `<h2>Pesquisa de satisfação</h2><div class="msg ok">Esta pesquisa já foi respondida. Obrigado!</div>`;
    return;
  }
  let nota = null;
  box.innerHTML = `<h2>${esc(info.empresa || 'Pesquisa de satisfação')}</h2>
    <p>Olá, ${esc(info.cliente)}.${info.os ? ` Como foi o atendimento da <b>OS ${info.os.numero}</b> (${esc(info.os.tipo.toLowerCase())} do equipamento ${esc(info.os.equipamento)}${info.os.data ? `, em ${fmtD(info.os.data)}` : ''})${info.tecnico ? ` com o técnico ${esc(info.tecnico)}` : ''}?` : ' Como foi o nosso atendimento?'}</p>
    <label>De 0 a 10, quanto você recomendaria nossa empresa a um colega?</label>
    <div class="notas">${Array.from({ length: 11 }, (_, i) => `<button type="button" data-nota="${i}">${i}</button>`).join('')}</div>
    <div class="row sub"><span>0 = nada provável</span><span class="spacer"></span><span>10 = com certeza</span></div>
    <label style="margin-top:10px">Quer comentar? (opcional)</label><textarea id="pubCom" rows="3" maxlength="2000"></textarea>
    <div id="pubMsg"></div><div class="row" style="margin-top:10px"><span class="spacer"></span><button type="button" class="primary" data-enviar>Enviar resposta</button></div>`;
  box.onclick = async (ev) => {
    const n = ev.target.closest('[data-nota]');
    if (n) {
      nota = Number(n.dataset.nota);
      box.querySelectorAll('[data-nota]').forEach((b) => b.classList.toggle('on', b === n));
      return;
    }
    if (!ev.target.closest('[data-enviar]')) return;
    if (nota == null) return msg('#pubMsg', 'err', 'Escolha uma nota de 0 a 10.');
    try {
      await post(`/public/survey/${encodeURIComponent(code)}`, { nota, comentario: $('#pubCom').value });
      box.innerHTML = `<h2>Obrigado!</h2><div class="msg ok">Sua resposta foi registrada.${nota <= 6 ? ' Nossa equipe de pós-venda vai entrar em contato.' : ''}</div>`;
    } catch (e) {
      msg('#pubMsg', 'err', e.message);
    }
  };
}
