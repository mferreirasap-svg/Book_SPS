// Lançamento de leitura no campo (celular): o funcionário escolhe o equipamento, digita o horímetro/hodômetro e tira a foto do mostrador.
// A leitura fica "a conferir" até o escritório comparar o número com a foto.
import { $, esc, num, fmtD, UN, DOM, badge, toast, acao, hoje } from '../util.js';
import { get, post, isDemo } from '../api.js';
import { reduzirFoto, fotoExemploMostrador } from '../campo.js';

export async function render(root, params, c) {
  const [lista, minhas] = await Promise.all([get('/readings/rented'), get('/readings/mine')]);
  const F = { ativo: params.ativo || '', foto: '' };
  const desenhar = () => {
    const a = lista.find((x) => x.ativo === F.ativo);
    root.innerHTML = `<div class="card campo-form" style="max-width:560px">
    <h2>Nova leitura</h2>
    <label>Equipamento</label><select id="lAtivo"><option value="">Escolha…</option>${lista.map((x) => `<option value="${esc(x.ativo)}" ${x.ativo === F.ativo ? 'selected' : ''}>${esc(x.ativo)}${x.placa ? ` (${esc(x.placa)})` : ''} — ${esc(x.desc || '')} · ${esc(x.cliente)}</option>`).join('')}</select>
    ${a ? `<p class="sub">${esc(a.obra || '')} · última leitura <b>${num(a.medidor, 1)} ${UN(a.tipo)}</b></p>` : ''}
    <div class="grid"><div><label>Leitura atual ${a ? `(${UN(a.tipo)})` : ''}</label><input id="lLeit" type="number" step="0.1" min="0" inputmode="decimal" style="font-size:20px"></div>
      <div><label>Data</label><input id="lData" type="date" value="${hoje()}" max="${hoje()}"></div></div>
    <label>Foto do mostrador (obrigatória)</label>
    <div class="fotos" id="lFotoBox">${F.foto ? `<figure><img src="${F.foto}" alt="Foto do mostrador"><figcaption><button type="button" class="mini" data-a="tirarFoto">Trocar</button></figcaption></figure>` : ''}</div>
    ${F.foto ? '' : `<input type="file" accept="image/*" capture="environment" id="lFoto">${isDemo() ? '<button type="button" class="mini" data-a="exemplo" style="margin-top:6px">Usar foto de exemplo (demonstração)</button>' : ''}`}
    <label>Observação</label><input id="lObs" maxlength="200" placeholder="Ex.: mostrador sujo, máquina parada…">
    <div class="dlg-actions"><button type="button" class="primary" data-a="enviar" style="width:100%;padding:12px">Enviar leitura</button></div>
    <p class="sub">A leitura é conferida pelo escritório antes de entrar no faturamento.</p></div>
    <div class="card"><h2>Minhas últimas leituras</h2><div class="tbl"><table><thead><tr><th>Data</th><th>Equipamento</th><th class="num">Leitura</th><th>Situação</th><th>Obs.</th></tr></thead><tbody>
    ${minhas.map((m) => `<tr><td>${fmtD(m.U_Data)}</td><td>${esc(m.U_Ativo)}</td><td class="num">${num(m.U_LeitFim, 1)}</td><td>${badge(m.U_Situacao || 'CON', DOM.situacaoLeit, 'l-')}</td><td class="wrap">${esc(m.U_Obs || '')}</td></tr>`).join('')
      || '<tr><td colspan="5" class="empty">Nenhuma leitura lançada por você.</td></tr>'}</tbody></table></div></div>`;
  };
  desenhar();
  const guardar = () => ({ leit: $('#lLeit')?.value, data: $('#lData')?.value, obs: $('#lObs')?.value });
  const repor = (v) => {
    if ($('#lLeit')) $('#lLeit').value = v.leit || '';
    if ($('#lData') && v.data) $('#lData').value = v.data;
    if ($('#lObs')) $('#lObs').value = v.obs || '';
  };
  root.onchange = async (ev) => {
    if (ev.target.id === 'lAtivo') {
      const v = guardar();
      F.ativo = ev.target.value;
      desenhar();
      repor(v);
    }
    if (ev.target.id === 'lFoto' && ev.target.files[0]) {
      const v = guardar();
      await acao(async () => (F.foto = await reduzirFoto(ev.target.files[0])));
      desenhar();
      repor(v);
    }
  };
  root.onclick = async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const v = guardar();
    if (b.dataset.a === 'tirarFoto') {
      F.foto = '';
      desenhar();
      return repor(v);
    }
    if (b.dataset.a === 'exemplo') {
      const a = lista.find((x) => x.ativo === F.ativo);
      if (!a || !v.leit) return toast('Escolha o equipamento e digite a leitura primeiro.', 'err');
      F.foto = fotoExemploMostrador(Number(String(v.leit).replace(',', '.')), UN(a.tipo));
      desenhar();
      return repor(v);
    }
    if (b.dataset.a === 'enviar') {
      if (!F.ativo) return toast('Escolha o equipamento.', 'err');
      if (v.leit === '') return toast('Digite a leitura.', 'err');
      if (!F.foto) return toast('Tire a foto do mostrador.', 'err');
      await acao(async () => {
        const r = await post('/readings/field', { ativo: F.ativo, leitura: v.leit, data: v.data, foto: F.foto, obs: v.obs });
        toast(r.situacao === 'PEN' ? 'Leitura enviada para conferência.' : `Leitura registrada: uso de ${num(r.uso, 1)}.`);
        render(root, {}, c);
      });
    }
  };
}
