// Acesso aos dados de locação no SAP B1 via Service Layer. Toda consulta usa filtros montados
// por odata.js; listas são paginadas no B1 (requisito PER-02).
import { SET, LN, GR } from './b1/schema.js';
import { query, eq, ge, le, and, or, contains, anyOf, key } from './b1/odata.js';
import { conflict, notFound } from './lib/util.js';

const like = (q, fields) => (q ? or(fields.map((f) => contains(f, q))) : '');
const branchFilter = (branches) => (branches?.length ? anyOf('U_Filial', branches) : '');

async function paged(sl, path, opts, { page = 1, size = 50 } = {}) {
  size = Math.min(Math.max(Number(size) || 50, 1), 200);
  page = Math.max(Number(page) || 1, 1);
  const r = await sl.page(query(path, { ...opts, top: size + 1, skip: (page - 1) * size }), size + 1);
  return { items: r.value.slice(0, size), page, size, hasMore: r.value.length > size };
}

export function createRepos(sl) {
  const getOrNull = async (path) => {
    try {
      return await sl.get(path);
    } catch (e) {
      if (e.statusCode === 404) return null;
      throw e;
    }
  };

  /** Atualização com controle de versão (requisito INT-03): falha se outro usuário gravou antes. */
  const patchVersioned = async (path, current, patch, expectedVersion, headers) => {
    const atual = Number(current.U_Versao) || 0;
    if (expectedVersion != null && Number(expectedVersion) !== atual) {
      throw conflict('Este registro foi alterado por outra pessoa. Recarregue a tela e refaça a alteração.');
    }
    await sl.request('PATCH', path, { ...patch, U_Versao: atual + 1 }, headers);
    return atual + 1;
  };

  const assets = {
    list: ({ tipo, status, familia, q, branches }, pg) =>
      paged(sl, SET.ATV, {
        filter: and(tipo && eq('U_Tipo', tipo), status && eq('U_Status', status), familia && eq('U_Familia', familia),
          like(q, ['Code', 'Name', 'U_Placa', 'U_Serie', 'U_Modelo']), branchFilter(branches)),
        orderby: 'Code asc',
      }, pg),
    all: ({ branches } = {}) => sl.getAll(query(SET.ATV, { filter: branchFilter(branches), orderby: 'Code asc' })),
    get: (code) => getOrNull(`${SET.ATV}${key(code)}`),
    create: (rec) => sl.request('POST', SET.ATV, { ...rec, U_Versao: 0 }),
    update: async (code, patch, version) => {
      const cur = await assets.get(code);
      if (!cur) throw notFound('Ativo');
      await patchVersioned(`${SET.ATV}${key(code)}`, cur, patch, version);
      return { before: cur, after: await assets.get(code) };
    },
  };

  const families = {
    all: () => sl.getAll(query(SET.FAM, { orderby: 'Name asc' })),
    get: (code) => getOrNull(`${SET.FAM}${key(code)}`),
    create: (rec) => sl.request('POST', SET.FAM, rec),
    update: (code, patch) => sl.request('PATCH', `${SET.FAM}${key(code)}`, patch),
  };

  const rules = {
    all: () => sl.getAll(query(SET.REG, { orderby: 'Code asc' })),
    map: async () => Object.fromEntries((await rules.all()).map((r) => [r.Code, r])),
    get: (code) => getOrNull(`${SET.REG}${key(code)}`),
    create: (rec) => sl.request('POST', SET.REG, rec),
    update: (code, patch) => sl.request('PATCH', `${SET.REG}${key(code)}`, patch),
  };

  const contracts = {
    list: ({ status, q, cardCode, branches }, pg) =>
      paged(sl, SET.CTR, {
        filter: and(status && eq('U_Status', status), cardCode && eq('U_CardCode', cardCode),
          like(q, ['U_CardName', 'U_CardCode', 'U_Obra']), branchFilter(branches)),
        orderby: 'DocEntry desc',
      }, pg),
    /** Contratos que ainda têm itens em aberto (rascunho, ativo ou suspenso). */
    open: ({ branches } = {}) =>
      sl.getAll(query(SET.CTR, { filter: and(anyOf('U_Status', ['RAS', 'ATV', 'SUS']), branchFilter(branches)) })),
    billable: ({ branches } = {}) =>
      sl.getAll(query(SET.CTR, { filter: and(anyOf('U_Status', ['ATV', 'SUS', 'ENC']), branchFilter(branches)) })),
    get: async (id) => {
      const c = await getOrNull(`${SET.CTR}(${Number(id)})`);
      if (c) {
        c[LN] ||= [];
        c[GR] ||= [];
      }
      return c;
    },
    create: (rec) => sl.request('POST', SET.CTR, { ...rec, U_Versao: 0 }),
    update: async (id, patch, version, { replaceLines = false } = {}) => {
      const cur = await contracts.get(id);
      if (!cur) throw notFound('Contrato');
      await patchVersioned(`${SET.CTR}(${Number(id)})`, cur, patch, version, replaceLines ? { 'B1S-ReplaceCollectionsOnPatch': 'true' } : {});
      return { before: cur, after: await contracts.get(id) };
    },
  };

  const movements = {
    list: ({ ctr, ativo }, pg) =>
      paged(sl, SET.MOV, { filter: and(ctr && eq('U_CtrEntry', Number(ctr)), ativo && eq('U_Ativo', ativo)), orderby: 'DocEntry desc',
        select: ['DocEntry', 'DocNum', 'U_Tipo', 'U_CtrEntry', 'U_CtrLine', 'U_CardName', 'U_Ativo', 'U_AtivoNovo', 'U_Data', 'U_Medidor', 'U_Respons', 'U_Usuario'] }, pg),
    get: (id) => getOrNull(`${SET.MOV}(${Number(id)})`),
  };

  const readings = {
    list: ({ comp, ctr, ativo }) =>
      sl.getAll(query(SET.MED, { filter: and(comp && eq('U_Comp', comp), ctr && eq('U_CtrEntry', Number(ctr)), ativo && eq('U_Ativo', ativo)) })),
    create: (rec) => sl.request('POST', SET.MED, rec),
  };

  const offPeriods = {
    list: ({ ctr, open } = {}) =>
      sl.getAll(query(SET.FORA, { filter: and(ctr && eq('U_CtrEntry', Number(ctr)), open && eq('U_Fim', null)) })),
    openFor: async (ctr, line) =>
      (await sl.getAll(query(SET.FORA, { filter: and(eq('U_CtrEntry', Number(ctr)), eq('U_CtrLine', Number(line)), eq('U_Fim', null)) })))[0] || null,
  };

  const installments = {
    get: (code) => getOrNull(`${SET.FAT}${key(code)}`),
    byComp: (comp) => sl.getAll(query(SET.FAT, { filter: eq('U_Comp', comp) })),
    byContract: (ctr) => sl.getAll(query(SET.FAT, { filter: eq('U_CtrEntry', Number(ctr)), orderby: 'U_Comp desc' })),
    create: (rec) => sl.request('POST', SET.FAT, rec),
    patch: (code, patch) => sl.request('PATCH', `${SET.FAT}${key(code)}`, patch),
  };

  const fines = {
    list: ({ status, ctr, q }) =>
      sl.getAll(query(SET.MUL, { filter: and(status && eq('U_Status', status), ctr && eq('U_CtrEntry', Number(ctr)), like(q, ['U_Placa', 'U_AIT', 'U_CardName'])),
        orderby: 'U_DtInfr desc' })),
    toPass: (ctr) => sl.getAll(query(SET.MUL, { filter: and(eq('U_CtrEntry', Number(ctr)), eq('U_Status', 'REP')) })),
    get: (code) => getOrNull(`${SET.MUL}${key(code)}`),
    create: (rec) => sl.request('POST', SET.MUL, rec),
    patch: (code, patch) => sl.request('PATCH', `${SET.MUL}${key(code)}`, patch),
  };

  const settings = {
    all: async () => Object.fromEntries((await sl.getAll(SET.CFG)).map((r) => [r.Code, r.U_Valor ?? ''])),
    set: async (k, v) => {
      const cur = await getOrNull(`${SET.CFG}${key(k)}`);
      if (cur) await sl.request('PATCH', `${SET.CFG}${key(k)}`, { U_Valor: v });
      else await sl.request('POST', SET.CFG, { Code: k, Name: k, U_Valor: v });
    },
  };

  const partners = {
    search: (q) =>
      sl.page(query('BusinessPartners', { filter: and(eq('CardType', 'cCustomer'), like(q, ['CardName', 'CardCode', 'FederalTaxID'])),
        select: ['CardCode', 'CardName', 'FederalTaxID', 'EmailAddress'], top: 20 }), 20).then((r) => r.value),
    get: (code) => getOrNull(`BusinessPartners${key(code)}`),
  };

  const items = {
    search: (q) =>
      sl.page(query('Items', { filter: and(eq('SalesItem', 'tYES'), like(q, ['ItemName', 'ItemCode'])), select: ['ItemCode', 'ItemName'], top: 20 }), 20)
        .then((r) => r.value),
    get: (code) => getOrNull(`Items${key(code)}`),
  };

  const period = (from, to) => and(ge('U_Data', from), le('U_Data', to));

  return { sl, assets, families, rules, contracts, movements, readings, offPeriods, installments, fines, settings, partners, items, period };
}
