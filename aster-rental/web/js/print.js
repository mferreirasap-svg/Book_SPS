// Impressão do contrato e do termo de entrega/devolução (o navegador oferece "Salvar como PDF").
import { esc, brl, num, fmtD, UN, DOM } from './util.js';

function imprimir(titulo, corpo) {
  const css = `body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:24px}h1{font-size:17px;margin:0 0 4px}
    h2{font-size:13px;margin:16px 0 6px;border-bottom:1px solid #999}table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #bbb;padding:4px 6px;text-align:left}th{background:#eee}.r{text-align:right}
    .ass{margin-top:48px;display:flex;gap:40px}.ass div{flex:1;border-top:1px solid #000;padding-top:4px;text-align:center}`;
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const d = f.contentWindow.document;
  d.open();
  d.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${css}</style></head><body>${corpo}</body></html>`);
  d.close();
  setTimeout(() => {
    f.contentWindow.focus();
    f.contentWindow.print();
    setTimeout(() => f.remove(), 2000);
  }, 300);
}

export function imprimirContrato(c, { empresa = '', regras = {}, ativos = {} } = {}) {
  const linhas = (c.SPS_LCT1Collection || []).filter((l) => l.U_StatusL !== 'DEV');
  const grupos = c.SPS_LCT2Collection || [];
  imprimir(`Contrato ${c.DocNum}`, `<h1>Contrato de ${esc((DOM.tipoContrato[c.U_Tipo] || '').toLowerCase())} nº ${c.DocNum}</h1><div>${esc(empresa)}</div>
    <h2>Partes</h2><p><b>Locadora:</b> ${esc(empresa)}<br><b>Locatário:</b> ${esc(c.U_CardName)} (${esc(c.U_CardCode)})<br><b>Local de uso:</b> ${esc(c.U_Obra || '')}</p>
    <h2>Condições</h2><p>Vigência de ${fmtD(c.U_DtInicio)} a ${fmtD(c.U_DtFim) || 'prazo indeterminado'} · Faturamento no dia ${c.U_DiaFat} ·
      Reajuste: ${esc(c.U_Indice || '—')} · Cobrança enviada para ${esc(c.U_Email || '—')}</p>
    ${grupos.length ? `<h2>Cobrança agrupada</h2><table><tr><th>Grupo</th><th class="r">Mensalidade</th><th class="r">Franquia</th><th class="r">Excedente</th></tr>
      ${grupos.map((g) => `<tr><td>${esc(g.U_Descr || g.U_Grupo)}</td><td class="r">${brl(g.U_Valor)}</td><td class="r">${num(g.U_Franquia, 0)}</td><td class="r">${brl(g.U_VlrExced)}</td></tr>`).join('')}</table>` : ''}
    <h2>Equipamentos</h2><table><tr><th>Equipamento</th><th>Regra</th><th class="r">Mensalidade</th><th class="r">Diária</th><th class="r">Franquia</th><th class="r">Excedente</th></tr>
    ${linhas.map((l) => {
      const a = ativos[l.U_Ativo] || {};
      return `<tr><td>${esc(l.U_Ativo || `Família ${l.U_Familia}`)} ${esc(l.U_AtvDesc || '')}${a.U_Placa ? ` · placa ${esc(a.U_Placa)}` : ''}${a.U_Serie ? ` · série ${esc(a.U_Serie)}` : ''}</td>
        <td>${esc(l.U_Grupo ? `Grupo ${l.U_Grupo}` : regras[l.U_Regra]?.Name || l.U_Regra)}</td><td class="r">${l.U_Grupo ? '—' : brl(l.U_Valor)}</td>
        <td class="r">${l.U_Grupo ? '—' : brl(l.U_Diaria)}</td><td class="r">${l.U_Grupo ? '—' : `${num(l.U_Franquia, 0)} ${UN(a.U_Tipo)}`}</td><td class="r">${l.U_Grupo ? '—' : brl(l.U_VlrExced)}</td></tr>`;
    }).join('')}</table>
    ${c.U_Obs ? `<h2>Observações</h2><p>${esc(c.U_Obs)}</p>` : ''}
    <div class="ass"><div>${esc(empresa || 'Locadora')}</div><div>${esc(c.U_CardName)}</div></div>`);
}

export function imprimirTermo(m, { empresa = '', contrato = null, ativo = null, novo = null } = {}) {
  let chk = {};
  try {
    chk = JSON.parse(m.U_Checklist || '{}');
  } catch {
    chk = {};
  }
  const titulo = `Termo de ${(DOM.tipoMov[m.U_Tipo] || '').toLowerCase()} nº ${m.DocNum}`;
  imprimir(titulo, `<h1>${esc(titulo)}</h1><div>${esc(empresa)} · ${fmtD(m.U_Data)}</div>
    <h2>Contrato</h2><p>Nº ${contrato ? contrato.DocNum : m.U_CtrEntry} — ${esc(m.U_CardName)}${contrato?.U_Obra ? `<br>Local: ${esc(contrato.U_Obra)}` : ''}</p>
    <h2>Equipamento</h2><p>${esc(m.U_Ativo)} — ${esc(ativo?.Name || '')}${ativo?.U_Placa ? ` · placa ${esc(ativo.U_Placa)}` : ''}${ativo?.U_Serie ? ` · série ${esc(ativo.U_Serie)}` : ''}<br>
      Leitura: ${num(m.U_Medidor, 1)} ${UN(ativo?.U_Tipo)} · Combustível: ${esc(m.U_Combust || '—')}
      ${m.U_AtivoNovo ? `<br><b>Substituído por:</b> ${esc(m.U_AtivoNovo)} ${esc(novo?.Name || '')} · leitura ${num(m.U_MedidorN, 1)}` : ''}</p>
    ${Object.keys(chk).length ? `<h2>Checklist</h2><table><tr><th>Item</th><th>Situação</th><th>Observação</th></tr>
      ${Object.entries(chk).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc({ OK: 'OK', NOK: 'Não OK', NA: 'N/A' }[v.r] || '')}</td><td>${esc(v.o || '')}</td></tr>`).join('')}</table>` : ''}
    ${m.U_Avarias ? `<h2>Avarias / observações</h2><p>${esc(m.U_Avarias)}</p>` : ''}
    <div class="ass"><div>${esc(empresa || 'Locadora')}<br><small>${esc(m.U_Usuario || '')}</small></div>
      <div>${m.U_Assinatura && /^data:image\/png;base64,/.test(m.U_Assinatura) ? `<img src="${m.U_Assinatura}" style="max-height:70px;display:block;margin:-80px auto 4px">` : ''}
      ${esc(m.U_Respons || '')}${m.U_DocResp ? ` — ${esc(m.U_DocResp)}` : ''}</div></div>`);
}
