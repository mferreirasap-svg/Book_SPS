// Documentação dos veículos: licenciamento, IPVA, seguro, tacógrafo… com calendário pela placa, alertas de vencimento,
// comprovante e esboço de conta a pagar no SAP B1 para o financeiro.
import { $, esc, brl, fmtD, DOM, badge, options, toast, acao, modal, closeModal, hoje } from '../util.js';
import { get, post, qs } from '../api.js';
import { filtro } from '../state.js';
import { reduzirFoto } from '../campo.js';

export async function render(root, _p, c) {
  const f = filtro('veiculos', { situacao: 'pendentes', ativo: '' });
  const [docs, todos, veics] = await Promise.all([get(`/vehicle-docs${qs({ situacao: f.situacao, ativo: f.ativo })}`), get('/vehicle-docs'), get('/assets?tipo=VEI&size=200')]);
  const cont = { vencida: 0, vence: 0, em_dia: 0, paga: 0 };
  todos.forEach((d) => (cont[d.situacao] = (cont[d.situacao] || 0) + 1));
  const ano = hoje().slice(0, 4);
  root.innerHTML = `<div class="kpis">
    <div class="kpi ${cont.vencida ? 'alerta' : 'ok'}"><div class="l">Vencidas</div><div class="v">${cont.vencida}</div><div class="sub">veículo pode ser apreendido</div></div>
    <div class="kpi ${cont.vence ? 'atencao' : 'ok'}"><div class="l">Vencem em breve</div><div class="v">${cont.vence}</div></div>
    <div class="kpi"><div class="l">Em dia</div><div class="v">${cont.em_dia}</div></div>
    <div class="kpi"><div class="l">Pagas</div><div class="v">${cont.paga}</div></div></div>
  <div class="card"><div class="toolbar">
    <div><label>Situação</label><select id="fSit"><option value="">Todas</option><option value="pendentes" ${f.situacao === 'pendentes' ? 'selected' : ''}>Vencidas e vencendo</option>${options(DOM.sitDocVei, f.situacao)}</select></div>
    <div><label>Veículo</label><select id="fAtv"><option value="">Todos</option>${veics.items.map((v) => `<option value="${esc(v.Code)}" ${f.ativo === v.Code ? 'selected' : ''}>${esc(v.Code)} ${esc(v.U_Placa || '')}</option>`).join('')}</select></div>
    <span class="spacer"></span>
    <button type="button" data-a="cal">Gerar licenciamento e IPVA de ${ano}</button><button type="button" class="primary" data-a="novo">+ Obrigação</button></div>
  <div class="tbl"><table><thead><tr><th>Veículo</th><th>Placa</th><th>Obrigação</th><th>Exercício</th><th>Vencimento</th><th class="num">Valor</th><th>Situação</th><th>Pagamento</th><th></th></tr></thead><tbody>
  ${docs.sort((a, b) => (a.U_Venc < b.U_Venc ? -1 : 1)).map((d) => `<tr><td>${esc(d.U_Ativo)} <span class="sub">${esc(d.veiculo)}</span></td><td><b>${esc(d.placa)}</b></td>
    <td>${esc(DOM.tipoDocVei[d.U_Tipo] || d.U_Tipo)}</td><td>${esc(d.U_Exercicio)}</td><td>${fmtD(d.U_Venc)}${['vencida', 'vence'].includes(d.situacao) ? ` <span class="sub">${d.faltam < 0 ? `há ${-d.faltam} dia(s)` : `em ${d.faltam} dia(s)`}</span>` : ''}</td>
    <td class="num">${d.U_Valor ? brl(d.U_Valor) : '<span class="sub">a definir</span>'}</td><td>${badge(d.situacao, DOM.sitDocVei, 'd-')}</td>
    <td>${d.U_Status === 'PAG' ? `${fmtD(d.U_DtPag)} · ${brl(d.U_VlrPago)}${d.U_DocB1 ? ` <span class="sub">esboço nº ${d.U_DocB1}</span>` : ''}${d.U_Anexo ? ' 📎' : ''}` : esc(d.U_Obs || '')}</td>
    <td class="right" style="white-space:nowrap">${!['PAG', 'ISE'].includes(d.U_Status) ? `<button type="button" class="mini primary" data-pagar="${esc(d.Code)}">Registrar pagamento</button> <button type="button" class="mini" data-isentar="${esc(d.Code)}">Isento</button>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="9" class="empty">Nada nesta situação.</td></tr>'}</tbody></table></div>
  <p class="sub">O calendário usa a UF do veículo e o último número da placa (tabela de calendário por UF). Confira a data e o valor na guia do DETRAN/SEFAZ.</p></div>`;

  const reload = () => render(root, {}, c);
  root.onchange = (ev) => {
    if (ev.target.id === 'fSit') f.situacao = ev.target.value;
    if (ev.target.id === 'fAtv') f.ativo = ev.target.value;
    if (['fSit', 'fAtv'].includes(ev.target.id)) reload();
  };
  root.onclick = async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.a === 'cal') {
      return acao(async () => {
        const r = await post('/vehicle-docs/calendar', { ano });
        toast(`${r.criados} obrigação(ões) criada(s).${r.semCalendario.length ? ` Sem calendário para: ${r.semCalendario.join(', ')}.` : ''}`);
        reload();
      });
    }
    if (b.dataset.a === 'novo') {
      const m = modal(`<h2>Nova obrigação do veículo</h2><div class="grid">
        <div><label>Veículo</label><select id="nAtv">${veics.items.map((v) => `<option value="${esc(v.Code)}">${esc(v.Code)} ${esc(v.U_Placa || '')} — ${esc(v.Name)}</option>`).join('')}</select></div>
        <div><label>Obrigação</label><select id="nTipo">${options(DOM.tipoDocVei, 'SEG')}</select></div>
        <div><label>Exercício</label><input id="nEx" value="${ano}" maxlength="4"></div><div><label>Vencimento</label><input type="date" id="nVenc"></div>
        <div><label>Valor (R$)</label><input type="number" step="0.01" min="0" id="nVal"></div><div><label>Observação</label><input id="nObs" maxlength="200"></div></div>
        <div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="primary" data-x="1">Salvar</button></div>`);
      m.onclick = async (e) => {
        const x = e.target.closest('[data-x]');
        if (!x) return;
        if (x.dataset.x === '0') return closeModal();
        await acao(async () => {
          await post('/vehicle-docs', { ativo: $('#nAtv').value, tipo: $('#nTipo').value, exercicio: $('#nEx').value, venc: $('#nVenc').value, valor: $('#nVal').value, obs: $('#nObs').value });
          closeModal();
          reload();
        });
      };
      return;
    }
    if (b.dataset.isentar) {
      return acao(async () => {
        await post(`/vehicle-docs/${encodeURIComponent(b.dataset.isentar)}/exempt`, { obs: 'Isento' });
        reload();
      });
    }
    if (b.dataset.pagar) {
      const d = docs.find((x) => x.Code === b.dataset.pagar);
      let anexo = '';
      const m = modal(`<h2>Pagamento — ${esc(DOM.tipoDocVei[d.U_Tipo])} ${esc(d.U_Exercicio)} · ${esc(d.placa)}</h2><div class="grid">
        <div><label>Data do pagamento</label><input type="date" id="pData" value="${hoje()}"></div><div><label>Valor pago (R$)</label><input type="number" step="0.01" min="0" id="pVal" value="${d.U_Valor || ''}"></div></div>
        <label>Comprovante (foto ou print)</label><input type="file" accept="image/*" id="pAnexo">
        <label class="chk-inline"><input type="checkbox" id="pB1" checked style="width:auto"> Criar esboço de nota de entrada (serviço) no SAP B1 para o financeiro pagar</label>
        <div class="dlg-actions"><button type="button" data-x="0">Cancelar</button><button type="button" class="primary" data-x="1">Registrar</button></div>`);
      m.onchange = async (e) => {
        if (e.target.id === 'pAnexo' && e.target.files[0]) anexo = await reduzirFoto(e.target.files[0]).catch(() => '');
      };
      m.onclick = async (e) => {
        const x = e.target.closest('[data-x]');
        if (!x) return;
        if (x.dataset.x === '0') return closeModal();
        await acao(async () => {
          const r = await post(`/vehicle-docs/${encodeURIComponent(d.Code)}/pay`, { data: $('#pData').value, valor: $('#pVal').value, anexo, gerarB1: $('#pB1').checked });
          closeModal();
          toast(r.docB1 ? `Pagamento registrado. Esboço nº ${r.docB1} criado no SAP B1.` : 'Pagamento registrado.');
          reload();
        });
      };
    }
  };
}
