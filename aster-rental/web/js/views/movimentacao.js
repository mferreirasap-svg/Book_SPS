// Movimentação: entrega, devolução, substituição e manutenção, com checklist e assinatura.
// Cada envio leva uma chave de idempotência: clicar duas vezes não grava duas movimentações.
import { $, $$, esc, num, fmtD, UN, DOM, options, toast, msg, uuid, hoje, confirmar, acao } from '../util.js';
import { get, post, qs } from '../api.js';
import { S } from '../state.js';
import { imprimirTermo } from '../print.js';

const LN = 'SPS_LCT1Collection';
const COMBUST = ['', 'Vazio', '1/4', '1/2', '3/4', 'Cheio'];
let F; // formulário
let ctx;

const novoForm = (p = {}) => ({ tipo: p.tipo || 'ENT', ctr: p.ctr || '', linha: p.linha || '', ativo: '', ativoNovo: '', data: hoje(), leitura: '', leituraNovo: '',
  combustivel: '', destino: 'DIS', checklist: {}, avarias: '', responsavel: '', documento: '', assinatura: '', key: uuid() });

export async function render(root, params, c) {
  ctx = c;
  if (!F || params.ctr || params.tipo) F = novoForm(params);
  const [ativos, suspensos] = await Promise.all([get('/contracts?status=ATV&size=200'), get('/contracts?status=SUS&size=200')]);
  const contratos = [...ativos.items, ...suspensos.items];
  const precisa = F.tipo === 'ENT' ? 'PEN' : 'LOC';
  const candidatos = contratos.filter((x) => (F.tipo !== 'ENT' || x.U_Status === 'ATV') && (x[LN] || []).some((l) => l.U_StatusL === precisa));
  const ctr = candidatos.find((x) => String(x.DocEntry) === String(F.ctr));
  const linhas = ctr ? ctr[LN].filter((l) => l.U_StatusL === precisa) : [];
  const linha = linhas.find((l) => String(l.LineId) === String(F.linha));
  let ativo = null;
  let opcoes = [];
  if (linha?.U_Ativo) ativo = await get(`/assets/${encodeURIComponent(linha.U_Ativo)}`);
  if (linha && (F.tipo === 'SUB' || (F.tipo === 'ENT' && !linha.U_Ativo))) {
    const av = await get(`/assets/availability${qs({ ini: F.data, fim: F.data, familia: linha.U_Familia })}`);
    opcoes = av.filter((a) => a.status === 'DIS');
    if (F.tipo === 'ENT') ativo = F.ativo ? await get(`/assets/${encodeURIComponent(F.ativo)}`).catch(() => null) : null;
  }
  const pedeChecklist = ['ENT', 'DEV', 'SUB'].includes(F.tipo);
  const itens = ativo && pedeChecklist ? (await get(`/checklist/${ativo.U_Tipo}`)).itens : [];
  const hist = await get('/movements?size=15');

  root.innerHTML = `<div class="card"><h2>Registrar movimentação</h2><div class="grid">
    <div><label>Tipo</label><select data-m="tipo">${options(DOM.tipoMov, F.tipo)}</select></div>
    <div class="span2"><label>Contrato</label><select data-m="ctr"><option value="">Selecione…</option>${candidatos.map((x) => `<option value="${x.DocEntry}" ${String(x.DocEntry) === String(F.ctr) ? 'selected' : ''}>${x.DocNum} — ${esc(x.U_CardName)}</option>`).join('')}</select></div>
    <div class="span2"><label>Item do contrato</label><select data-m="linha"><option value="">Selecione…</option>${linhas.map((l) => `<option value="${l.LineId}" ${String(l.LineId) === String(F.linha) ? 'selected' : ''}>${esc(l.U_Ativo || `Família ${l.U_Familia}`)} — ${esc(l.U_AtvDesc || '')}</option>`).join('')}</select></div>
    <div><label>Data</label><input type="date" data-m="data" value="${esc(F.data)}"></div>
    ${F.tipo === 'ENT' && linha && !linha.U_Ativo ? `<div class="span2"><label>Equipamento a entregar (família ${esc(linha.U_Familia)})</label><select data-m="ativo"><option value="">Selecione…</option>${opcoes.map((a) => `<option value="${esc(a.Code)}" ${a.Code === F.ativo ? 'selected' : ''}>${esc(a.Code)} — ${esc(a.Name)}${a.U_Placa ? ` · ${esc(a.U_Placa)}` : ''}</option>`).join('')}</select></div>` : ''}
  </div>
  ${ativo ? `<div class="msg info">${esc(ativo.Code)} · ${esc(ativo.Name)}${ativo.U_Placa ? ` · placa ${esc(ativo.U_Placa)}` : ''}${ativo.U_Serie ? ` · série ${esc(ativo.U_Serie)}` : ''} · última leitura ${num(ativo.U_Medidor, 1)} ${UN(ativo.U_Tipo)}</div>
  <div class="grid">
    <div><label>${ativo.U_Tipo === 'VEI' ? 'Hodômetro (km)' : 'Horímetro (h)'}</label><input type="number" min="0" step="0.1" inputmode="decimal" data-m="leitura" value="${esc(F.leitura)}" placeholder="${esc(ativo.U_Medidor ?? '')}"></div>
    <div><label>Combustível</label><select data-m="combustivel">${COMBUST.map((v) => `<option ${F.combustivel === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    ${['DEV', 'SUB'].includes(F.tipo) ? `<div><label>O equipamento devolvido vai para</label><select data-m="destino">${options({ DIS: 'Disponível', MAN: 'Manutenção' }, F.destino)}</select></div>` : ''}
    ${F.tipo === 'SUB' ? `<div class="span2"><label>Equipamento substituto</label><select data-m="ativoNovo"><option value="">Selecione…</option>${opcoes.map((a) => `<option value="${esc(a.Code)}" ${a.Code === F.ativoNovo ? 'selected' : ''}>${esc(a.Code)} — ${esc(a.Name)}</option>`).join('')}</select></div>
      <div><label>Leitura do substituto</label><input type="number" min="0" step="0.1" data-m="leituraNovo" value="${esc(F.leituraNovo)}"></div>` : ''}
  </div>
  ${pedeChecklist ? `<h3>Checklist</h3><table class="chk"><tbody>${itens.map((it, i) => `<tr><td>${esc(it)}</td><td style="white-space:nowrap">
    ${['OK', 'NOK', 'NA'].map((o) => `<label><input type="radio" name="chk${i}" data-chk="${esc(it)}" value="${o}" ${F.checklist[it]?.r === o ? 'checked' : ''}> ${{ OK: 'OK', NOK: 'Não OK', NA: 'N/A' }[o]}</label>`).join('')}</td>
    <td><input data-chko="${esc(it)}" value="${esc(F.checklist[it]?.o || '')}" placeholder="observação"></td></tr>`).join('')}</tbody></table>` : ''}
  <div class="grid" style="margin-top:10px">
    <div class="span2"><label>${F.tipo === 'MAN' ? 'Motivo da manutenção' : 'Avarias / observações'}</label><textarea data-m="avarias">${esc(F.avarias)}</textarea></div>
    ${pedeChecklist ? `<div><label>Responsável do cliente</label><input data-m="responsavel" value="${esc(F.responsavel)}"></div>
    <div><label>Documento (CPF/RG)</label><input data-m="documento" value="${esc(F.documento)}"></div>` : ''}
  </div>
  ${pedeChecklist ? `<h3>Assinatura do responsável</h3><canvas class="sig" id="sig" width="1040" height="320"></canvas>
    <div class="row"><button type="button" class="mini" data-a="limpar">Limpar assinatura</button></div>` : ''}
  <div id="movMsg"></div>
  <div class="row" style="margin-top:12px"><span class="spacer"></span><button type="button" data-a="reset">Limpar</button>
    <button type="button" class="primary" data-a="registrar">Registrar ${esc(DOM.tipoMov[F.tipo].toLowerCase())}</button></div>`
    : `<p class="sub" style="margin-top:12px">${candidatos.length ? 'Escolha o contrato e o item.' : 'Nenhum contrato com itens para este tipo de movimentação.'}</p>`}
  </div>
  <div class="card"><h2>Últimas movimentações</h2><div class="tbl"><table><thead><tr><th>Nº</th><th>Data</th><th>Tipo</th><th>Cliente</th><th>Equipamento</th><th class="num">Leitura</th><th>Usuário</th><th></th></tr></thead><tbody>
  ${hist.items.map((m) => `<tr><td>${m.DocNum}</td><td>${fmtD(m.U_Data)}</td><td>${esc(DOM.tipoMov[m.U_Tipo] || m.U_Tipo)}</td><td>${esc(m.U_CardName)}</td>
    <td>${esc(m.U_Ativo)}${m.U_AtivoNovo ? ` → ${esc(m.U_AtivoNovo)}` : ''}</td><td class="num">${num(m.U_Medidor, 1)}</td><td>${esc(m.U_Usuario || '')}</td>
    <td class="right"><button type="button" class="mini" data-termo="${m.DocEntry}">Termo</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Nenhuma.</td></tr>'}
  </tbody></table></div></div>`;

  assinatura(root);
  root.onchange = (ev) => {
    const k = ev.target.dataset.m;
    if (!k) return;
    ler(root);
    if (k === 'tipo') Object.assign(F, { ctr: '', linha: '', ativo: '', ativoNovo: '', checklist: {} });
    if (k === 'ctr') Object.assign(F, { linha: '', ativo: '', checklist: {} });
    if (k === 'linha') Object.assign(F, { ativo: '', ativoNovo: '', checklist: {} });
    if (['tipo', 'ctr', 'linha', 'ativo', 'data'].includes(k)) render(root, {}, ctx);
  };
  root.onclick = async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.a === 'limpar') {
      const cv = $('#sig', root);
      cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
      cv.dataset.dirty = '';
      F.assinatura = '';
    }
    if (b.dataset.a === 'reset') {
      F = novoForm();
      render(root, {}, ctx);
    }
    if (b.dataset.a === 'registrar') registrar(root);
    if (b.dataset.termo) termo(b.dataset.termo);
  };
}

function ler(root) {
  $$('[data-m]', root).forEach((e) => (F[e.dataset.m] = e.value));
  $$('[data-chk]', root).forEach((e) => {
    if (e.checked) F.checklist[e.dataset.chk] = { ...(F.checklist[e.dataset.chk] || {}), r: e.value };
  });
  $$('[data-chko]', root).forEach((e) => {
    if (e.value || F.checklist[e.dataset.chko]) F.checklist[e.dataset.chko] = { ...(F.checklist[e.dataset.chko] || {}), o: e.value };
  });
  const cv = $('#sig', root);
  if (cv?.dataset.dirty === '1') F.assinatura = cv.toDataURL('image/png');
}

function assinatura(root) {
  const cv = $('#sig', root);
  if (!cv) return;
  const g = cv.getContext('2d');
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.strokeStyle = '#1d3557';
  if (F.assinatura) {
    const img = new Image();
    img.onload = () => g.drawImage(img, 0, 0);
    img.src = F.assinatura;
    cv.dataset.dirty = '1';
  }
  let desenhando = false;
  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    return [((e.clientX - r.left) * cv.width) / r.width, ((e.clientY - r.top) * cv.height) / r.height];
  };
  cv.onpointerdown = (e) => {
    desenhando = true;
    cv.setPointerCapture(e.pointerId);
    g.beginPath();
    g.moveTo(...pos(e));
  };
  cv.onpointermove = (e) => {
    if (!desenhando) return;
    g.lineTo(...pos(e));
    g.stroke();
    cv.dataset.dirty = '1';
  };
  cv.onpointerup = cv.onpointercancel = () => (desenhando = false);
}

async function registrar(root) {
  ler(root);
  const body = { tipo: F.tipo, contrato: Number(F.ctr), linha: Number(F.linha), ativo: F.ativo, ativoNovo: F.ativoNovo, data: F.data, leitura: F.leitura,
    leituraNovo: F.leituraNovo, combustivel: F.combustivel, destino: F.destino, checklist: F.checklist, avarias: F.avarias, responsavel: F.responsavel,
    documento: F.documento, assinatura: F.assinatura };
  try {
    const r = await post('/movements', body, { 'Idempotency-Key': F.key });
    toast(`${DOM.tipoMov[F.tipo]} registrada (nº ${r.DocNum}).`);
    F = novoForm();
    await render(root, {}, ctx);
    if (['ENT', 'DEV', 'SUB'].includes(r.tipo) && (await confirmar({ titulo: 'Imprimir termo', texto: 'Deseja imprimir o termo para assinatura física ou arquivo?', ok: 'Imprimir' }))) termo(r.DocEntry);
  } catch (e) {
    msg('#movMsg', 'err', e.message);
  }
}

async function termo(id) {
  await acao(async () => {
    const m = await get(`/movements/${id}`);
    const [c, at, nv] = await Promise.all([get(`/contracts/${m.U_CtrEntry}`).catch(() => null), get(`/assets/${encodeURIComponent(m.U_Ativo)}`).catch(() => null),
      m.U_AtivoNovo ? get(`/assets/${encodeURIComponent(m.U_AtivoNovo)}`).catch(() => null) : null]);
    imprimirTermo(m, { empresa: S.cfg.EMPRESA, contrato: c, ativo: at, novo: nv });
  });
}
