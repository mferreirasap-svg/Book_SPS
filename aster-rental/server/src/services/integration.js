// Integração com objetos nativos do SAP B1. O Áster é a origem das regras de locação; o B1 recebe o que tem tela própria:
//   - remessa e retorno do bem (Entrega/Devolução com nº de série, ou Transferência de estoque);
//   - chamado → Chamada de serviço (ServiceCalls), que alimenta o Cartão de equipamento e os relatórios de serviço;
//   - OS agendada → Atividade (Activities) na agenda do técnico, ligada à chamada;
//   - faturamento → série, utilização, forma de pagamento (boleto), condição, vendedor, projeto e endereço de entrega.
// Cada envio fica no log (@SPS_LINT). Falha no B1 não desfaz a operação do Áster: o registro fica com erro para reprocessar.
import { SET, SCHEMA, SCHEMA_VERSION, CFG_DEFAULTS, DOM } from '../b1/schema.js';
import { query, eq, key } from '../b1/odata.js';
import { badRequest, notFound, agora, d10 } from '../lib/util.js';

const str = (v, n) => String(v ?? '').trim().slice(0, n);
const PRIORIDADE = { URG: 'scp_High', ALT: 'scp_High', MED: 'scp_Medium', BAI: 'scp_Low' };
const STATUS_CALL = { ABE: -3, AND: -3, AGC: -2, RES: -1, FEC: -1, CAN: -1 };

/** Listas de cadastros nativos usadas no de-para (Administração › Integração SAP B1). */
export const LISTAS = {
  filiais: { path: 'BusinessPlaces', sel: ['BPLID', 'BPLName'], id: 'BPLID', nome: 'BPLName', tela: 'Filiais (Inicialização da empresa)' },
  depositos: { path: 'Warehouses', sel: ['WarehouseCode', 'WarehouseName'], id: 'WarehouseCode', nome: 'WarehouseName', tela: 'Depósitos' },
  utilizacoes: { path: 'NotaFiscalUsage', sel: ['ID', 'Usage'], id: 'ID', nome: 'Usage', tela: 'Utilização (Nota fiscal)' },
  condicoes: { path: 'PaymentTermsTypes', sel: ['GroupNumber', 'PaymentTermsGroupName'], id: 'GroupNumber', nome: 'PaymentTermsGroupName', tela: 'Condições de pagamento' },
  formasPgto: { path: 'WizardPaymentMethods', sel: ['PaymentMethodCode', 'Description', 'Type'], id: 'PaymentMethodCode', nome: 'Description',
    filtro: (r) => r.Type === 'boptIncoming', tela: 'Formas de pagamento (boleto)' },
  vendedores: { path: 'SalesPersons', sel: ['SalesEmployeeCode', 'SalesEmployeeName'], id: 'SalesEmployeeCode', nome: 'SalesEmployeeName', tela: 'Vendedores' },
  projetos: { path: 'Projects', sel: ['Code', 'Name'], id: 'Code', nome: 'Name', tela: 'Projetos' },
  funcionarios: { path: 'EmployeesInfo', sel: ['EmployeeID', 'FirstName', 'LastName'], id: 'EmployeeID', nome: (r) => `${r.FirstName || ''} ${r.LastName || ''}`.trim(),
    tela: 'Cadastro de funcionários' },
  statusChamada: { path: 'ServiceCallStatus', sel: ['StatusId', 'Name'], id: 'StatusId', nome: 'Name', tela: 'Status de chamada de serviço' },
  tiposChamada: { path: 'ServiceCallTypes', sel: ['CallTypeID', 'Name'], id: 'CallTypeID', nome: 'Name', tela: 'Tipos de chamada de serviço' },
  origens: { path: 'ServiceCallOrigins', sel: ['OriginID', 'Name'], id: 'OriginID', nome: 'Name', tela: 'Origens de chamada de serviço' },
  problemas: { path: 'ServiceCallProblemTypes', sel: ['ProblemTypeID', 'Name'], id: 'ProblemTypeID', nome: 'Name', tela: 'Tipos de problema' },
  tiposAtividade: { path: 'ActivityTypes', sel: ['Code', 'Name'], id: 'Code', nome: 'Name', tela: 'Tipos de atividade' },
};

export function createIntegrationService({ repos, audit }) {
  const sl = repos.sl;
  const cfg = async () => ({ ...CFG_DEFAULTS, ...(await repos.settings.all()) });
  const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));
  const getOrNull = async (path) => {
    try {
      return await sl.get(path);
    } catch (e) {
      if (e.statusCode === 404) return null;
      throw e;
    }
  };

  /* ---------------- log de integração ---------------- */

  async function registrar({ tipo, ref, objeto, status, docEntry = 0, docNum = 0, erro = '', user = 'sistema' }) {
    const code = `${tipo}|${ref}`.slice(0, 50);
    const atual = await getOrNull(`${SET.INT}${key(code)}`);
    const rec = { U_Tipo: tipo, U_Ref: String(ref), U_Objeto: objeto, U_Status: status, U_DocEntry: docEntry || 0, U_DocNum: docNum || 0,
      U_Erro: str(erro, 254), U_Data: agora(), U_Usuario: user, U_Tentativas: (Number(atual?.U_Tentativas) || 0) + 1 };
    try {
      if (atual) await sl.request('PATCH', `${SET.INT}${key(code)}`, rec);
      else await sl.request('POST', SET.INT, { Code: code, Name: code, ...rec });
    } catch {
      /* o log nunca derruba a operação */
    }
  }

  /** Executa um envio ao B1 e registra o resultado. Nunca lança erro: devolve { ok, ... } para a tela avisar. */
  async function enviar(req, tipo, ref, objeto, fn) {
    try {
      const r = await fn();
      if (r?.ignorado) {
        await registrar({ tipo, ref, objeto, status: 'IGN', erro: r.ignorado, user: req?.user?.login });
        return { ok: true, ignorado: r.ignorado };
      }
      await registrar({ tipo, ref, objeto, status: 'OK', docEntry: r?.docEntry, docNum: r?.docNum, user: req?.user?.login });
      return { ok: true, objeto, ...r };
    } catch (e) {
      await registrar({ tipo, ref, objeto, status: 'ERR', erro: e.message, user: req?.user?.login });
      return { ok: false, objeto, erro: e.message };
    }
  }

  async function listLog({ status, tipo } = {}) {
    const rows = await sl.getAll(query(SET.INT, { filter: [status && eq('U_Status', status), tipo && eq('U_Tipo', tipo)].filter(Boolean).join(' and ') || undefined }));
    return rows.sort((a, b) => (a.U_Data < b.U_Data ? 1 : -1)).slice(0, 500);
  }

  async function reprocessar(req, code) {
    const r = await getOrNull(`${SET.INT}${key(code)}`);
    if (!r) throw notFound('Registro de integração');
    const fn = { remessa: movimento, chamado, atividade }[r.U_Tipo];
    if (!fn) throw badRequest('Este tipo de integração não pode ser reprocessado.');
    const out = await fn(req, r.U_Ref, { reprocesso: true });
    audit.record(req, { action: 'reprocessar', entity: 'integracao', id: code, after: out });
    return out;
  }

  /* ---------------- extras dos documentos de venda ---------------- */

  /** Campos nativos do documento de faturamento a partir do contrato e do de-para. */
  function extrasDocumento(c0, contrato, { servico = false } = {}) {
    const doc = {};
    const serie = num(servico ? c0.B1_SERIE_SRV : c0.B1_SERIE_LOC);
    if (serie) doc.Series = serie;
    if (c0.B1_FORMA_PGTO) doc.PaymentMethod = c0.B1_FORMA_PGTO;
    const cond = num(contrato?.U_CondPgto) ?? num(c0.B1_COND_PGTO);
    if (cond != null && cond !== 0) doc.PaymentGroupCode = cond;
    const vend = num(contrato?.U_SlpCode) || num(c0.B1_VENDEDOR);
    if (vend && vend > 0) doc.SalesPersonCode = vend;
    if (contrato?.U_Projeto) doc.Project = contrato.U_Projeto;
    if (contrato?.U_EndEntrega) doc.ShipToCode = contrato.U_EndEntrega;
    if (!Number(contrato?.U_Filial) && num(c0.B1_FILIAL)) doc.BPL_IDAssignedToInvoice = num(c0.B1_FILIAL);
    return doc;
  }
  const usoLinha = (c0, servico) => num(servico ? c0.B1_USAGE_SRV : c0.USAGE);

  /* ---------------- remessa e retorno do bem ---------------- */

  /** Documento nativo da movimentação: entrega, devolução ou substituição. Manutenção não gera documento fiscal. */
  async function movimento(req, movEntry, { reprocesso = false } = {}) {
    const m = await repos.movements.get(movEntry);
    if (!m) throw notFound('Movimentação');
    const c0 = await cfg();
    return enviar(req, 'remessa', m.DocEntry, c0.B1_REMESSA === 'TRANSF' ? 'StockTransfers' : m.U_Tipo === 'ENT' ? 'DeliveryNotes' : 'Returns', async () => {
      if (!['ENT', 'DEV', 'SUB'].includes(m.U_Tipo)) return { ignorado: 'Manutenção não gera documento fiscal.' };
      if (c0.B1_REMESSA === 'NAO') return { ignorado: 'Remessa desligada nos parâmetros (o bem não sai do estoque no B1).' };
      if (m.U_DocEntryB1 && !reprocesso) return { docEntry: m.U_DocEntryB1, docNum: m.U_DocNumB1 };
      const c = await repos.contracts.get(m.U_CtrEntry);
      if (!c) throw new Error('Contrato da movimentação não encontrado.');
      const docs = [];
      // Substituição: retorno do equipamento que sai e remessa do que entra.
      if (m.U_Tipo === 'DEV' || m.U_Tipo === 'SUB') docs.push(await gerarDoc(c0, c, m, m.U_Ativo, 'RET'));
      if (m.U_Tipo === 'ENT') docs.push(await gerarDoc(c0, c, m, m.U_Ativo, 'REM'));
      if (m.U_Tipo === 'SUB' && m.U_AtivoNovo) docs.push(await gerarDoc(c0, c, m, m.U_AtivoNovo, 'REM'));
      const ult = docs[docs.length - 1];
      await sl.request('PATCH', `${SET.MOV}(${Number(m.DocEntry)})`, { U_DocTipo: docs.map((d) => d.tipo).join('+').slice(0, 20), U_DocEntryB1: ult.docEntry, U_DocNumB1: ult.docNum });
      return { docEntry: ult.docEntry, docNum: ult.docNum, documentos: docs };
    });
  }

  async function gerarDoc(c0, c, m, ativoCode, sentido) {
    const at = await repos.assets.get(ativoCode);
    if (!at) throw new Error(`Ativo ${ativoCode} não encontrado.`);
    if (!at.U_ItemBem) throw new Error(`Ativo ${at.Code} sem "item do bem no B1": cadastre o item com nº de série em Ativos.`);
    if (!at.U_Serie) throw new Error(`Ativo ${at.Code} sem nº de série.`);
    const patio = c0.B1_DEP_PATIO;
    if (!patio) throw new Error('Informe o depósito do pátio nos parâmetros de integração.');
    const serie = [{ InternalSerialNumber: at.U_Serie, Quantity: 1 }];
    const comum = { U_SPS_CtrEntry: c.DocEntry, U_SPS_MovEntry: m.DocEntry,
      Comments: `Locação - contrato ${c.DocNum} - ${DOM.tipoMov[m.U_Tipo]} nº ${m.DocNum} - ${at.Code}`.slice(0, 254) };
    if (Number(c.U_Filial) || num(c0.B1_FILIAL)) comum.BPL_IDAssignedToInvoice = Number(c.U_Filial) || num(c0.B1_FILIAL);

    if (c0.B1_REMESSA === 'TRANSF') {
      if (!c0.B1_DEP_LOCACAO) throw new Error('Informe o depósito "em locação" nos parâmetros de integração.');
      const [de, para] = sentido === 'REM' ? [patio, c0.B1_DEP_LOCACAO] : [c0.B1_DEP_LOCACAO, patio];
      const body = { CardCode: c.U_CardCode, DocDate: d10(m.U_Data), FromWarehouse: de, ToWarehouse: para, Comments: comum.Comments, U_SPS_CtrEntry: c.DocEntry,
        U_SPS_MovEntry: m.DocEntry, StockTransferLines: [{ ItemCode: at.U_ItemBem, Quantity: 1, FromWarehouseCode: de, WarehouseCode: para, SerialNumbers: serie }] };
      const r = await sl.request('POST', 'StockTransfers', body);
      return { tipo: 'TRANSF', objeto: 'StockTransfers', docEntry: r.DocEntry, docNum: r.DocNum, ativo: at.Code };
    }

    const serieDoc = num(sentido === 'REM' ? c0.B1_SERIE_REM : c0.B1_SERIE_RET);
    const linha = { Quantity: 1, WarehouseCode: patio, SerialNumbers: serie };
    const uso = num(sentido === 'REM' ? c0.B1_USAGE_REM : c0.B1_USAGE_RET);
    if (uso) linha.Usage = uso;
    if (sentido === 'RET') {
      // Devolução referenciando a entrega original, quando ela foi gerada pelo Áster (mantém o vínculo nativo base/destino).
      const base = await entregaDoAtivo(c.DocEntry, at.Code);
      if (base) Object.assign(linha, { BaseType: 15, BaseEntry: base, BaseLine: 0 });
      else Object.assign(linha, { ItemCode: at.U_ItemBem, UnitPrice: Number(at.U_VlrBem) || 0 });
    } else Object.assign(linha, { ItemCode: at.U_ItemBem, UnitPrice: Number(at.U_VlrBem) || 0 });
    const body = { CardCode: c.U_CardCode, DocDate: d10(m.U_Data), ...comum, DocumentLines: [linha] };
    if (serieDoc) body.Series = serieDoc;
    if (c.U_EndEntrega) body.ShipToCode = c.U_EndEntrega;
    const obj = sentido === 'REM' ? 'DeliveryNotes' : 'Returns';
    const r = await sl.request('POST', obj, body);
    return { tipo: sentido === 'REM' ? 'ENTREGA' : 'DEVOLUCAO', objeto: obj, docEntry: r.DocEntry, docNum: r.DocNum, ativo: at.Code };
  }

  /** Última entrega (DeliveryNotes) gerada para o ativo no contrato. */
  async function entregaDoAtivo(ctr, ativo) {
    const movs = (await repos.movements.list({ ctr, ativo }, { size: 100 })).items;
    for (const mv of movs) {
      const full = await repos.movements.get(mv.DocEntry);
      if (['ENT', 'SUB'].includes(full.U_Tipo) && /ENTREGA/.test(full.U_DocTipo || '') && (full.U_Tipo === 'ENT' ? full.U_Ativo : full.U_AtivoNovo) === ativo) return full.U_DocEntryB1;
    }
    return null;
  }

  /* ---------------- chamado → chamada de serviço ---------------- */

  async function chamado(req, chaEntry) {
    const c0 = await cfg();
    const t = await repos.tickets.get(chaEntry);
    if (!t) throw notFound('Chamado');
    return enviar(req, 'chamado', t.DocEntry, 'ServiceCalls', async () => {
      if (c0.PV_SERVICECALL !== 'S') return { ignorado: 'Chamada de serviço nativa desligada nos parâmetros.' };
      const at = t.U_Ativo ? await repos.assets.get(t.U_Ativo) : null;
      const os = t.U_OsEntry ? await repos.orders.get(t.U_OsEntry) : null;
      const tec = os?.U_Tecnico ? await repos.technicians.get(os.U_Tecnico) : null;
      const body = {
        Subject: str(t.U_Assunto, 254), Description: str(`${t.U_Descricao || ''}${t.U_Contato ? `\nContato: ${t.U_Contato} ${t.U_Fone || ''}` : ''}`, 8000),
        Priority: PRIORIDADE[t.U_Prior] || 'scp_Medium', Status: STATUS_CALL[t.U_Status] ?? -3,
        U_SPS_ChaEntry: t.DocEntry, U_SPS_CtrEntry: t.U_CtrEntry || 0, U_SPS_Parado: t.U_Parado === 'S' ? 'S' : 'N',
      };
      if (at?.U_ItemBem) Object.assign(body, { ItemCode: at.U_ItemBem, InternalSerialNum: at.U_Serie || undefined });
      for (const [campo, p] of [['CallType', 'PV_CALL_TIPO'], ['Origin', 'PV_CALL_ORIGEM'], ['ProblemType', 'PV_CALL_PROBLEMA']]) if (num(c0[p]) != null) body[campo] = num(c0[p]);
      if (Number(tec?.U_EmpID)) body.TechnicianCode = Number(tec.U_EmpID);
      if (os?.U_Laudo && ['RES', 'FEC', 'CAN'].includes(t.U_Status)) body.Resolution = str(os.U_Laudo, 8000);
      if (t.U_Status === 'CAN') body.Resolution = 'Chamado cancelado no Áster Rental.';
      if (t.U_CallID) {
        await sl.request('PATCH', `ServiceCalls(${Number(t.U_CallID)})`, body);
        return { docEntry: t.U_CallID, docNum: t.U_CallID };
      }
      const r = await sl.request('POST', 'ServiceCalls', { CustomerCode: t.U_CardCode, ...body });
      await sl.request('PATCH', `${SET.CHA}(${Number(t.DocEntry)})`, { U_CallID: r.ServiceCallID });
      return { docEntry: r.ServiceCallID, docNum: r.ServiceCallID };
    });
  }

  /* ---------------- OS → atividade na agenda do técnico ---------------- */

  async function atividade(req, osEntry) {
    const c0 = await cfg();
    const os = await repos.orders.get(osEntry);
    if (!os) throw notFound('Ordem de serviço');
    return enviar(req, 'atividade', os.DocEntry, 'Activities', async () => {
      if (c0.PV_ATIVIDADE !== 'S') return { ignorado: 'Atividade nativa desligada nos parâmetros.' };
      if (!os.U_DtAgenda || !os.U_Tecnico) return { ignorado: 'OS sem agenda: a atividade é criada quando houver técnico e data.' };
      const tec = await repos.technicians.get(os.U_Tecnico);
      if (!Number(tec?.U_EmpID)) throw new Error(`Técnico ${os.U_Tecnico} sem funcionário do B1 vinculado (Técnicos e planos).`);
      const body = {
        Activity: 'cn_Task', ActivityDate: d10(os.U_DtAgenda), ActivityTime: `${os.U_HrAgenda || '08:00'}:00`, EndDueDate: d10(os.U_DtAgenda),
        Duration: Number(os.U_Duracao) || 120, DurationType: 'du_Minuts', HandledByEmployee: Number(tec.U_EmpID),
        Details: str(`OS ${os.DocNum} — ${DOM.tipoOS[os.U_Tipo]} — ${os.U_Ativo}`, 100), Notes: str(`${os.U_Local || ''}\n${os.U_Descricao || ''}`, 8000),
        Closed: ['CON', 'CAN'].includes(os.U_Status) ? 'tYES' : 'tNO', U_SPS_OsEntry: os.DocEntry,
      };
      if (os.U_CardCode) body.CardCode = os.U_CardCode;
      if (num(c0.PV_ATV_TIPO) != null) body.ActivityType = num(c0.PV_ATV_TIPO);
      let code = Number(os.U_ActCode) || 0;
      if (code) await sl.request('PATCH', `Activities(${code})`, body);
      else {
        code = (await sl.request('POST', 'Activities', body)).ActivityCode;
        await sl.request('PATCH', `${SET.OS}(${Number(os.DocEntry)})`, { U_ActCode: code });
      }
      // Liga a atividade à chamada de serviço do chamado, como na aba "Atividades" da tela nativa.
      const t = os.U_ChaEntry ? await repos.tickets.get(os.U_ChaEntry) : null;
      if (t?.U_CallID) {
        const call = await getOrNull(`ServiceCalls(${Number(t.U_CallID)})`);
        if (call && !(call.ServiceCallActivities || []).some((a) => Number(a.ActivityCode) === code)) {
          await sl.request('PATCH', `ServiceCalls(${Number(t.U_CallID)})`, { ServiceCallActivities: [{ ActivityCode: code }] });
        }
      }
      return { docEntry: code, docNum: code };
    });
  }

  /* ---------------- listas nativas, estrutura e prontidão ---------------- */

  async function listas(kinds) {
    const out = {};
    await Promise.all(kinds.filter((k) => LISTAS[k]).map(async (k) => {
      const L = LISTAS[k];
      try {
        const rows = (await sl.getAll(query(L.path, { select: L.sel }))).filter(L.filtro || (() => true));
        out[k] = rows.map((r) => ({ id: r[L.id], nome: typeof L.nome === 'function' ? L.nome(r) : r[L.nome] }));
      } catch (e) {
        out[k] = { erro: `${L.tela}: ${e.message}` };
      }
    }));
    return out;
  }

  async function enderecos(cardCode) {
    const bp = await getOrNull(`BusinessPartners${key(cardCode)}?$select=CardCode,BPAddresses`);
    return (bp?.BPAddresses || []).filter((a) => a.AddressType === 'bo_ShipTo').map((a) => ({ id: a.AddressName, nome: [a.AddressName, a.Street, a.City].filter(Boolean).join(' — ') }));
  }

  /** O que falta criar no B1 (tabelas, campos e objetos), sem alterar nada. */
  async function estrutura() {
    const falta = { tabelas: [], campos: [], objetos: [] };
    const tabs = new Set((await sl.getAll(query('UserTablesMD', { select: ['TableName'] }))).map((t) => t.TableName));
    for (const t of SCHEMA.tables) if (!tabs.has(t.TableName)) falta.tabelas.push(`@${t.TableName} — ${t.TableDescription}`);
    for (const [tabela, campos] of Object.entries(SCHEMA.fields)) {
      const tem = new Set((await sl.getAll(query('UserFieldsMD', { filter: eq('TableName', tabela), select: ['Name'] }))).map((f) => f.Name));
      for (const f of campos) if (!tem.has(f.n)) falta.campos.push(`${tabela}.U_${f.n} — ${f.d}`);
    }
    const objs = new Set((await sl.getAll(query('UserObjectsMD', { select: ['Code'] }))).map((o) => o.Code));
    for (const u of SCHEMA.udos) if (!objs.has(u.Code)) falta.objetos.push(`${u.Code} — ${u.Name}`);
    return falta;
  }

  /** Lista de verificação para ir a produção: estrutura, de-para e cadastros nativos usados pelo Áster. */
  async function prontidao() {
    const c0 = await cfg();
    const itens = [];
    const add = (grupo, item, ok, detalhe = '', onde = '') => itens.push({ grupo, item, ok: ok === true ? 'ok' : ok === false ? 'pendente' : ok, detalhe, onde });
    const existe = async (path) => Boolean(await getOrNull(path).catch(() => null));
    const naLista = async (lista, valor) => {
      if (valor === '' || valor == null) return false;
      const l = (await listas([lista]))[lista];
      return Array.isArray(l) ? l.some((x) => String(x.id) === String(valor)) : false;
    };

    let falta = null;
    try {
      falta = await estrutura();
      const n = falta.tabelas.length + falta.campos.length + falta.objetos.length;
      add('Estrutura', 'Tabelas, campos e objetos do Áster no B1', n === 0, n ? `${n} item(ns) a criar` : `versão ${SCHEMA_VERSION}`, 'Integração › Estrutura');
    } catch (e) {
      add('Estrutura', 'Conexão com a Service Layer', false, e.message, 'Administração › SAP B1');
    }
    add('Estrutura', 'Versão das estruturas registrada', String(c0.SCHEMA_VERSION) === String(SCHEMA_VERSION), `instalada ${c0.SCHEMA_VERSION || '0'} · esperada ${SCHEMA_VERSION}`);

    // Faturamento
    const ativos = await repos.assets.all();
    const itensFat = [...new Set(ativos.map((a) => a.U_ItemCode).filter(Boolean))];
    const semItem = [];
    for (const i of itensFat) if (!(await existe(`Items${key(i)}`))) semItem.push(i);
    add('Faturamento', 'Itens de serviço de locação cadastrados', itensFat.length > 0 && !semItem.length, semItem.length ? `não encontrados: ${semItem.join(', ')}` : `${itensFat.length} item(ns)`, 'Estoque › Cadastro do item');
    add('Faturamento', 'Item de repasse de multa', c0.ITEM_MULTA ? await existe(`Items${key(c0.ITEM_MULTA)}`) : 'opcional', c0.ITEM_MULTA || 'não informado', 'Parâmetros');
    add('Faturamento', 'Utilização da NF de locação', await naLista('utilizacoes', c0.USAGE), c0.USAGE || 'usa a do item', 'Integração › De-para');
    add('Faturamento', 'Forma de pagamento (boleto)', await naLista('formasPgto', c0.B1_FORMA_PGTO), c0.B1_FORMA_PGTO || 'não informada', 'Integração › De-para');
    add('Faturamento', 'Filial padrão', c0.B1_FILIAL ? await naLista('filiais', c0.B1_FILIAL) : 'opcional', c0.B1_FILIAL || 'empresa sem filiais', 'Integração › De-para');

    // Remessa e retorno
    if (c0.B1_REMESSA === 'NAO') add('Remessa', 'Documento de remessa do bem', 'opcional', 'desligado: o bem não movimenta estoque no B1', 'Integração › De-para');
    else {
      add('Remessa', 'Depósito do pátio', await naLista('depositos', c0.B1_DEP_PATIO), c0.B1_DEP_PATIO || 'não informado', 'Integração › De-para');
      if (c0.B1_REMESSA === 'TRANSF') add('Remessa', 'Depósito de bens em clientes', await naLista('depositos', c0.B1_DEP_LOCACAO), c0.B1_DEP_LOCACAO || 'não informado', 'Integração › De-para');
      else {
        add('Remessa', 'Utilização da NF de remessa', await naLista('utilizacoes', c0.B1_USAGE_REM), c0.B1_USAGE_REM || 'não informada', 'Integração › De-para');
        add('Remessa', 'Utilização da NF de retorno', await naLista('utilizacoes', c0.B1_USAGE_RET), c0.B1_USAGE_RET || 'não informada', 'Integração › De-para');
      }
      const frota = ativos.filter((a) => a.U_Status !== 'BAI');
      const semBem = frota.filter((a) => !a.U_ItemBem || !a.U_Serie).map((a) => a.Code);
      add('Remessa', 'Ativos com item do bem e nº de série', !semBem.length, semBem.length ? `${semBem.length} sem vínculo: ${semBem.slice(0, 6).join(', ')}${semBem.length > 6 ? '…' : ''}` : `${frota.length} ativo(s)`, 'Ativos › Editar');
      const bens = [...new Set(frota.map((a) => a.U_ItemBem).filter(Boolean))];
      const semSerie = [];
      for (const i of bens) {
        const it = await getOrNull(`Items${key(i)}`).catch(() => null);
        if (!it || it.ManageSerialNumbers !== 'tYES') semSerie.push(i);
      }
      add('Remessa', 'Itens dos bens controlados por nº de série', !semSerie.length, semSerie.length ? `revisar: ${semSerie.join(', ')}` : `${bens.length} item(ns)`, 'Estoque › Cadastro do item › Gerenciar por nº de série');
    }

    // Pós-venda
    if (c0.PV_SERVICECALL === 'S') {
      add('Pós-venda', 'Tipo de chamada', await naLista('tiposChamada', c0.PV_CALL_TIPO), c0.PV_CALL_TIPO || 'não informado', 'Integração › De-para');
      add('Pós-venda', 'Origem da chamada', await naLista('origens', c0.PV_CALL_ORIGEM), c0.PV_CALL_ORIGEM || 'não informada', 'Integração › De-para');
      add('Pós-venda', 'Tipo de problema', c0.PV_CALL_PROBLEMA ? await naLista('problemas', c0.PV_CALL_PROBLEMA) : 'opcional', c0.PV_CALL_PROBLEMA || '—', 'Integração › De-para');
    } else add('Pós-venda', 'Chamada de serviço nativa', 'opcional', 'desligada: chamados ficam só no Áster', 'Integração › De-para');
    if (c0.PV_ATIVIDADE === 'S') {
      const tecs = (await repos.technicians.all()).filter((t) => t.U_Ativo !== 'N');
      const sem = tecs.filter((t) => !Number(t.U_EmpID)).map((t) => t.Name);
      add('Pós-venda', 'Técnicos ligados a funcionários do B1', !sem.length, sem.length ? `sem vínculo: ${sem.join(', ')}` : `${tecs.length} técnico(s)`, 'Pós-venda › Técnicos e planos');
      add('Pós-venda', 'Tipo de atividade', c0.PV_ATV_TIPO ? await naLista('tiposAtividade', c0.PV_ATV_TIPO) : 'opcional', c0.PV_ATV_TIPO || '—', 'Integração › De-para');
    }
    const erros = (await listLog({ status: 'ERR' })).length;
    add('Monitor', 'Envios com erro aguardando reprocessamento', erros === 0, erros ? `${erros} registro(s)` : 'nenhum', 'Integração › Monitor');
    return { itens, falta, pronto: itens.filter((i) => i.ok === 'ok').length, total: itens.filter((i) => i.ok !== 'opcional').length };
  }

  /* ---------------- trazer equipamentos dos nºs de série do B1 ---------------- */

  async function seriesDisponiveis({ item, q } = {}) {
    const [series, ativos] = await Promise.all([
      sl.getAll(query('SerialNumberDetails', { filter: item ? eq('ItemCode', item) : undefined, select: ['DocEntry', 'ItemCode', 'ItemDescription', 'SerialNumber', 'MfrSerialNo'] })),
      repos.assets.all(),
    ]);
    const jaTem = new Set(ativos.map((a) => `${a.U_ItemBem}|${a.U_Serie}`));
    const termo = String(q || '').toLowerCase();
    return series.filter((s) => !jaTem.has(`${s.ItemCode}|${s.SerialNumber}`))
      .filter((s) => !termo || `${s.ItemCode} ${s.ItemDescription} ${s.SerialNumber}`.toLowerCase().includes(termo)).slice(0, 300);
  }

  async function importarSeries(req, linhas) {
    if (!Array.isArray(linhas) || !linhas.length) throw badRequest('Selecione ao menos um nº de série.');
    const [fams, ativos] = await Promise.all([repos.families.all(), repos.assets.all()]);
    const proximo = {};
    for (const a of ativos) {
      const m = /^(EQP|VEI)-(\d+)$/.exec(a.Code);
      if (m) proximo[m[1]] = Math.max(proximo[m[1]] || 0, Number(m[2]));
    }
    const out = [];
    for (const l of linhas.slice(0, 200)) {
      try {
        const fam = fams.find((f) => f.Code === l.familia);
        if (!fam) throw new Error('Escolha a família.');
        const pref = fam.U_Tipo === 'VEI' ? 'VEI' : 'EQP';
        proximo[pref] = (proximo[pref] || 0) + 1;
        const code = `${pref}-${String(proximo[pref]).padStart(4, '0')}`;
        const rec = { Code: code, Name: str(l.nome || l.ItemDescription || l.SerialNumber, 100), U_Tipo: fam.U_Tipo, U_Familia: fam.Code, U_Categoria: '',
          U_ItemCode: str(l.itemFat, 50), U_ItemBem: str(l.ItemCode, 50), U_Serie: str(l.SerialNumber, 50), U_Status: 'DIS', U_CtrAtual: 0, U_Medidor: 0,
          U_ValorMes: 0, U_ValorDia: 0, U_VlrBem: 0, U_Filial: Number(l.filial) || num((await cfg()).B1_FILIAL) || 1 };
        await repos.assets.create(rec);
        out.push({ ok: true, code, serie: l.SerialNumber });
      } catch (e) {
        out.push({ ok: false, serie: l.SerialNumber, message: e.message });
      }
    }
    audit.record(req, { action: 'importar_series', entity: 'ativo', after: out });
    return out;
  }

  return { movimento, chamado, atividade, extrasDocumento, usoLinha, listas, enderecos, estrutura, prontidao, listLog, reprocessar, seriesDisponiveis, importarSeries };
}
