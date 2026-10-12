// Ativos: consulta paginada, cadastro, edição e mudança de status (manutenção, baixa).
import { $, $$, esc, brl, num, UN, DOM, badge, options, toast, acao, modal, closeModal, confirmar, debounce, pager, SEARCH, msg } from '../util.js';
import { get, post, put, qs } from '../api.js';
import { filtro } from '../state.js';

let ctx;
let fams = [];

export async function render(root, params, c) {
  ctx = c;
  const f = filtro('ativos', { tipo: '', status: '', familia: '', q: '', page: 1 });
  if (params.familia) f.familia = params.familia;
  fams = await get('/families');
  const r = await get(`/assets${qs({ ...f, size: 50 })}`);
  root.innerHTML = `<div class="card"><div class="toolbar">
    <div><label>Tipo</label><select data-f="tipo">${options(DOM.tipoAtivo, f.tipo, { vazio: 'Todos' })}</select></div>
    <div><label>Família</label><select data-f="familia"><option value="">Todas</option>${fams.map((x) => `<option value="${esc(x.Code)}" ${f.familia === x.Code ? 'selected' : ''}>${esc(x.Name)}</option>`).join('')}</select></div>
    <div><label>Status</label><select data-f="status">${options({ DIS: 'Disponível', LOC: 'Locado', MAN: 'Manutenção', BAI: 'Baixado' }, f.status, { vazio: 'Todos' })}</select></div>
    <div style="flex:1" class="search"><label>Buscar</label>${SEARCH}<input data-f="q" value="${esc(f.q)}" placeholder="código, descrição, placa, série, modelo"></div>
    ${c.can('ativos.editar') ? '<button class="primary" data-a="novo" type="button">+ Novo ativo</button>' : ''}</div>
  <div class="tbl"><table><thead><tr><th>Código</th><th>Descrição</th><th>Família</th><th>Placa / série</th><th class="num">Medidor</th><th class="num">Valor mês</th><th>Status</th><th></th></tr></thead><tbody>
  ${r.items.map((a) => `<tr><td><b>${esc(a.Code)}</b></td><td>${esc(a.Name)}</td><td>${esc(fams.find((x) => x.Code === a.U_Familia)?.Name || a.U_Familia || '')}</td>
    <td>${esc(a.U_Placa || a.U_Serie)}</td><td class="num">${num(a.U_Medidor, 0)} ${UN(a.U_Tipo)}</td><td class="num">${brl(a.U_ValorMes)}</td><td>${badge(a.U_Status, DOM.statusAtivo)}</td>
    <td class="right">${c.can('ativos.editar') ? `<button class="mini" type="button" data-a="editar" data-code="${esc(a.Code)}">Editar</button>` : ''}
      ${a.U_Status === 'DIS' && c.can('ativos.editar') ? `<button class="mini" type="button" data-a="st" data-st="MAN" data-code="${esc(a.Code)}" data-v="${a.U_Versao}">Manutenção</button>` : ''}
      ${a.U_Status === 'MAN' && !a.U_CtrAtual && c.can('ativos.editar') ? `<button class="mini" type="button" data-a="st" data-st="DIS" data-code="${esc(a.Code)}" data-v="${a.U_Versao}">Liberar</button>` : ''}
      ${['DIS', 'MAN'].includes(a.U_Status) && !a.U_CtrAtual && c.can('ativos.baixar') ? `<button class="mini danger" type="button" data-a="st" data-st="BAI" data-code="${esc(a.Code)}" data-v="${a.U_Versao}">Baixar</button>` : ''}
      ${a.U_Status === 'BAI' && c.can('ativos.baixar') ? `<button class="mini" type="button" data-a="st" data-st="DIS" data-code="${esc(a.Code)}" data-v="${a.U_Versao}">Reativar</button>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="8" class="empty">Nenhum ativo encontrado.</td></tr>'}
  </tbody></table></div>${pager(r)}</div>`;

  const reload = () => render(root, {}, ctx);
  const onFilter = (el) => {
    f[el.dataset.f] = el.value;
    f.page = 1;
    reload();
  };
  root.onchange = (ev) => ev.target.dataset.f && ev.target.tagName === 'SELECT' && onFilter(ev.target);
  root.oninput = debounce((ev) => ev.target.dataset.f === 'q' && onFilter(ev.target), 400);
  root.onclick = async (ev) => {
    const pg = ev.target.closest('[data-page]');
    if (pg) {
      f.page = Number(pg.dataset.page);
      return reload();
    }
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === 'novo') return form(null, reload);
    if (b.dataset.a === 'editar') return form(await get(`/assets/${encodeURIComponent(b.dataset.code)}`), reload);
    if (b.dataset.a === 'st') {
      const st = b.dataset.st;
      if (st === 'BAI' && !(await confirmar({ titulo: 'Baixar ativo', texto: `O ativo ${b.dataset.code} sai de operação e deixa de aparecer na disponibilidade.`, ok: 'Baixar', perigo: true }))) return;
      await acao(async () => {
        await post(`/assets/${encodeURIComponent(b.dataset.code)}/status`, { status: st, U_Versao: Number(b.dataset.v) });
        toast('Status atualizado.');
        reload();
      });
    }
  };
}

function form(a, reload) {
  const novo = !a;
  a ||= { U_Tipo: 'EQP', U_Filial: 1, U_Medidor: 0 };
  const i = (k, l, o = '') => `<div><label>${l}</label><input data-af="${k}" value="${esc(a[k] ?? '')}" ${o}></div>`;
  const m = modal(`<h2>${novo ? 'Novo ativo' : `Ativo ${esc(a.Code)}`}</h2><div class="grid">
    <div><label>Tipo</label><select data-af="U_Tipo">${options(DOM.tipoAtivo, a.U_Tipo)}</select></div>
    ${i('Code', 'Código', novo ? 'placeholder="ex.: EQP-0010"' : 'readonly')}
    <div class="span2"><label>Descrição</label><input data-af="Name" value="${esc(a.Name || '')}" maxlength="100"></div>
    <div><label>Família</label><select data-af="U_Familia"><option value=""></option>${fams.map((x) => `<option value="${esc(x.Code)}" ${a.U_Familia === x.Code ? 'selected' : ''}>${esc(x.Name)}</option>`).join('')}</select></div>
    ${i('U_Categoria', 'Categoria')}
    <div><label>Item de faturamento (B1)</label><input data-af="U_ItemCode" list="dlItens" value="${esc(a.U_ItemCode || '')}"><datalist id="dlItens"></datalist></div>
    ${i('U_Marca', 'Marca')}${i('U_Modelo', 'Modelo')}${i('U_Ano', 'Ano', 'maxlength="4"')}${i('U_Serie', 'Nº série / patrimônio')}
    <div class="vei">${'<label>Placa</label>'}<input data-af="U_Placa" value="${esc(a.U_Placa || '')}" maxlength="7"></div>
    <div class="vei"><label>Chassi</label><input data-af="U_Chassi" value="${esc(a.U_Chassi || '')}" maxlength="30"></div>
    <div class="vei"><label>Renavam</label><input data-af="U_Renavam" value="${esc(a.U_Renavam || '')}" maxlength="20"></div>
    <div><label id="lblMed">Medidor</label><input type="number" step="0.1" min="0" data-af="U_Medidor" value="${esc(a.U_Medidor ?? 0)}" ${novo ? '' : 'readonly'}></div>
    <div><label>Valor mensal (R$)</label><input type="number" step="0.01" min="0" data-af="U_ValorMes" value="${esc(a.U_ValorMes ?? '')}"></div>
    <div><label>Valor diária (R$)</label><input type="number" step="0.01" min="0" data-af="U_ValorDia" value="${esc(a.U_ValorDia ?? '')}"></div>
    <div><label>Filial (BPLId)</label><input type="number" data-af="U_Filial" value="${esc(a.U_Filial ?? '')}"></div>
    <div class="span2"><label>Observações</label><textarea data-af="U_Obs">${esc(a.U_Obs || '')}</textarea></div>
  </div><div id="afMsg"></div>
  <div class="dlg-actions"><button type="button" data-x="cancel">Cancelar</button><button type="button" class="primary" data-x="ok">Salvar</button></div>`);
  const sync = () => {
    const vei = $('[data-af=U_Tipo]', m).value === 'VEI';
    $$('.vei', m).forEach((e) => (e.hidden = !vei));
    $('#lblMed', m).textContent = vei ? 'Hodômetro (km)' : 'Horímetro (h)';
  };
  sync();
  m.onchange = (ev) => ev.target.dataset.af === 'U_Tipo' && sync();
  m.oninput = debounce(async (ev) => {
    if (ev.target.dataset.af !== 'U_ItemCode') return;
    const its = await get(`/lookup/items${qs({ q: ev.target.value })}`).catch(() => []);
    $('#dlItens', m).innerHTML = its.map((x) => `<option value="${esc(x.ItemCode)}">${esc(x.ItemName)}</option>`).join('');
  });
  m.onclick = async (ev) => {
    const b = ev.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === 'cancel') return closeModal();
    const o = { U_Versao: a.U_Versao };
    $$('[data-af]', m).forEach((e) => (o[e.dataset.af] = e.value));
    try {
      if (novo) await post('/assets', o);
      else await put(`/assets/${encodeURIComponent(a.Code)}`, o);
      closeModal();
      toast('Ativo salvo.');
      reload();
    } catch (e) {
      msg('#afMsg', 'err', e.message);
    }
  };
}
