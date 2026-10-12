// Movimentações: entrega, devolução, substituição, envio e retorno de manutenção.
// Cada movimentação grava movimento, contrato, ativo, leitura e dias fora numa única transação ($batch).
import { SET, LN } from '../b1/schema.js';
import { key } from '../b1/odata.js';
import { badRequest, conflict, notFound, d10, addDias, maxD, compDe, uid } from '../lib/util.js';

const TIPOS = ['ENT', 'DEV', 'SUB', 'MAN', 'RET'];

export function createMovementService({ repos, audit, contracts }) {
  async function checklistItems(tipoAtivo) {
    const cfg = await repos.settings.all();
    return String(cfg[tipoAtivo === 'VEI' ? 'CHK_VEI' : 'CHK_EQP'] || '').split('\n').map((s) => s.trim()).filter(Boolean);
  }

  async function register(req, input) {
    const tipo = input.tipo;
    if (!TIPOS.includes(tipo)) throw badRequest('Tipo de movimentação inválido.');
    const c = await repos.contracts.get(input.contrato);
    if (!c) throw notFound('Contrato');
    const l = c[LN].find((x) => Number(x.LineId) === Number(input.linha));
    if (!l) throw badRequest('Item do contrato não encontrado.');
    const data = d10(input.data);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw badRequest('Informe a data.');
    const leitura = input.leitura === '' || input.leitura == null ? null : Number(input.leitura);
    if (leitura != null && (!Number.isFinite(leitura) || leitura < 0)) throw badRequest('Leitura inválida.');

    const ativoCode = tipo === 'ENT' ? l.U_Ativo || input.ativo : l.U_Ativo;
    const at = ativoCode ? await repos.assets.get(ativoCode) : null;
    if (!at) throw badRequest(tipo === 'ENT' && !l.U_Ativo ? 'Escolha o equipamento que será entregue.' : 'Ativo do item não encontrado.');
    const medAtual = Number(at.U_Medidor) || 0;
    if (leitura != null && leitura < medAtual) throw badRequest(`Leitura menor que a última registrada (${medAtual}).`);

    if (['ENT', 'DEV', 'SUB'].includes(tipo)) {
      const itens = await checklistItems(at.U_Tipo);
      const resp = input.checklist || {};
      const falta = itens.filter((i) => !['OK', 'NOK', 'NA'].includes(resp[i]?.r));
      if (falta.length) throw badRequest(`Checklist incompleto: ${falta.join(', ')}.`);
      if (!String(input.responsavel || '').trim()) throw badRequest('Informe o responsável do cliente.');
    }
    if (input.assinatura && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.assinatura)) throw badRequest('Assinatura em formato inválido.');
    if (input.assinatura && input.assinatura.length > 300000) throw badRequest('Assinatura muito grande.');

    const ops = [];
    const ctrPath = `${SET.CTR}(${Number(c.DocEntry)})`;
    const versao = (Number(c.U_Versao) || 0) + 1;
    const mov = {
      U_Tipo: tipo, U_CtrEntry: c.DocEntry, U_CtrLine: l.LineId, U_CardName: c.U_CardName, U_Ativo: at.Code, U_AtivoNovo: '',
      U_Data: data, U_Medidor: leitura ?? medAtual, U_MedidorN: 0, U_Combust: String(input.combustivel || '').slice(0, 10),
      U_Checklist: JSON.stringify(input.checklist || {}), U_Avarias: String(input.avarias || '').slice(0, 4000),
      U_Respons: String(input.responsavel || '').slice(0, 100), U_DocResp: String(input.documento || '').slice(0, 30),
      U_DestAtivo: '', U_Assinatura: input.assinatura || '', U_Usuario: req.user.login,
    };
    const leituraFinal = (code) => {
      if (leitura != null && leitura > medAtual) {
        ops.push({ method: 'POST', path: SET.MED, body: { Code: code, Name: code, U_CtrEntry: c.DocEntry, U_CtrLine: l.LineId, U_Ativo: at.Code,
          U_Comp: compDe(data), U_Data: data, U_LeitIni: medAtual, U_LeitFim: leitura, U_Abat: 0, U_Origem: 'MOV' } });
      }
    };
    const fora = await repos.offPeriods.openFor(c.DocEntry, l.LineId);

    if (tipo === 'ENT') {
      if (c.U_Status !== 'ATV') throw badRequest('O contrato precisa estar ativo para a entrega.');
      if (l.U_StatusL !== 'PEN') throw badRequest('Este item já foi entregue.');
      if (d10(c.U_DtInicio) && data < d10(c.U_DtInicio)) throw badRequest('Data anterior ao início da vigência.');
      if (at.U_Status !== 'DIS') throw conflict(`Ativo ${at.Code} não está disponível.`);
      if (l.U_Familia && at.U_Familia !== l.U_Familia) throw badRequest(`Ativo ${at.Code} não é da família contratada.`);
      const alloc = await contracts.allocations(c.DocEntry);
      if (alloc.has(at.Code)) throw conflict(`Ativo ${at.Code} está no contrato nº ${alloc.get(at.Code)}.`);
      mov.U_DestAtivo = 'LOC';
      ops.push({ method: 'POST', path: SET.MOV, body: mov });
      ops.push({ method: 'PATCH', path: ctrPath, body: { U_Versao: versao, [LN]: [{ LineId: l.LineId, U_StatusL: 'LOC', U_DtSaida: data, U_Ativo: at.Code,
        U_AtvDesc: l.U_AtvDesc && l.U_Ativo ? l.U_AtvDesc : at.Name, U_ItemCode: l.U_ItemCode || at.U_ItemCode || '' }] } });
      ops.push({ method: 'PATCH', path: `${SET.ATV}${key(at.Code)}`, body: { U_Status: 'LOC', U_CtrAtual: c.DocEntry, U_Medidor: leitura ?? medAtual, U_Versao: (Number(at.U_Versao) || 0) + 1 } });
    } else if (tipo === 'DEV' || tipo === 'SUB') {
      if (l.U_StatusL !== 'LOC') throw badRequest('Este item não está locado.');
      if (data < d10(l.U_DtSaida)) throw badRequest('Data anterior à entrega do item.');
      if (leitura == null) throw badRequest('Informe a leitura do medidor.');
      const dest = input.destino === 'MAN' ? 'MAN' : 'DIS';
      let novo = null;
      if (tipo === 'SUB') {
        novo = await repos.assets.get(input.ativoNovo);
        if (!novo) throw badRequest('Escolha o ativo substituto.');
        if (novo.U_Status !== 'DIS') throw conflict(`Ativo ${novo.Code} não está disponível.`);
        if (l.U_Familia ? novo.U_Familia !== l.U_Familia : novo.U_Tipo !== at.U_Tipo) throw badRequest('O substituto precisa ser da mesma família.');
        const alloc = await contracts.allocations();
        if (alloc.has(novo.Code)) throw conflict(`Ativo ${novo.Code} está no contrato nº ${alloc.get(novo.Code)}.`);
        mov.U_AtivoNovo = novo.Code;
        mov.U_MedidorN = Number(input.leituraNovo) || Number(novo.U_Medidor) || 0;
      }
      mov.U_DestAtivo = dest;
      ops.push({ method: 'POST', path: SET.MOV, body: mov });
      leituraFinal(`${c.DocEntry}-${l.LineId}-${uid()}`);
      const linhas = [{ LineId: l.LineId, U_StatusL: 'DEV', U_DtDevol: data }];
      if (novo) {
        linhas.push({ U_Familia: l.U_Familia, U_Ativo: novo.Code, U_AtvDesc: novo.Name, U_ItemCode: l.U_ItemCode || novo.U_ItemCode || '', U_Regra: l.U_Regra,
          U_Grupo: l.U_Grupo, U_Valor: l.U_Valor, U_Diaria: l.U_Diaria, U_Franquia: l.U_Franquia, U_VlrExced: l.U_VlrExced, U_DtSaida: data, U_DtDevol: null,
          U_Condutor: l.U_Condutor, U_Local: l.U_Local, U_StatusL: 'LOC' });
      }
      ops.push({ method: 'PATCH', path: ctrPath, body: { U_Versao: versao, [LN]: linhas } });
      ops.push({ method: 'PATCH', path: `${SET.ATV}${key(at.Code)}`, body: { U_Status: dest, U_CtrAtual: 0, U_Medidor: leitura, U_Versao: (Number(at.U_Versao) || 0) + 1 } });
      if (novo) {
        ops.push({ method: 'PATCH', path: `${SET.ATV}${key(novo.Code)}`, body: { U_Status: 'LOC', U_CtrAtual: c.DocEntry, U_Medidor: mov.U_MedidorN,
          U_Versao: (Number(novo.U_Versao) || 0) + 1 } });
      }
      if (fora) ops.push({ method: 'PATCH', path: `${SET.FORA}${key(fora.Code)}`, body: { U_Fim: maxD(d10(fora.U_Ini), addDias(data, -1)) } });
    } else if (tipo === 'MAN') {
      if (l.U_StatusL !== 'LOC') throw badRequest('Este item não está locado.');
      if (fora) throw badRequest('Este item já está em manutenção.');
      mov.U_DestAtivo = 'MAN';
      ops.push({ method: 'POST', path: SET.MOV, body: mov });
      const code = `F-${uid()}`;
      ops.push({ method: 'POST', path: SET.FORA, body: { Code: code, Name: code, U_CtrEntry: c.DocEntry, U_CtrLine: l.LineId, U_Ativo: at.Code, U_Ini: data,
        U_Fim: null, U_Motivo: String(input.avarias || 'Manutenção').slice(0, 100) } });
      ops.push({ method: 'PATCH', path: `${SET.ATV}${key(at.Code)}`, body: { U_Status: 'MAN', U_Medidor: leitura ?? medAtual, U_Versao: (Number(at.U_Versao) || 0) + 1 } });
    } else if (tipo === 'RET') {
      if (!fora) throw badRequest('Este item não está em manutenção.');
      if (data < d10(fora.U_Ini)) throw badRequest('Data anterior ao envio para manutenção.');
      mov.U_DestAtivo = 'LOC';
      ops.push({ method: 'POST', path: SET.MOV, body: mov });
      ops.push({ method: 'PATCH', path: `${SET.FORA}${key(fora.Code)}`, body: { U_Fim: maxD(d10(fora.U_Ini), addDias(data, -1)) } });
      ops.push({ method: 'PATCH', path: `${SET.ATV}${key(at.Code)}`, body: { U_Status: 'LOC', U_Medidor: leitura ?? medAtual, U_Versao: (Number(at.U_Versao) || 0) + 1 } });
    }

    const results = await repos.sl.batch(ops);
    const created = results[0]?.body || {};
    audit.record(req, { action: `mov:${tipo}`, entity: 'contrato', id: c.DocEntry, after: { ...mov, DocEntry: created.DocEntry, linha: l.LineId } });
    return { DocEntry: created.DocEntry, DocNum: created.DocNum, tipo };
  }

  return { register, checklistItems };
}
