// Instalador das estruturas do Áster Rental no B1 (requisito INT-10).
// Pode rodar de novo sem erro: cria o que falta e registra a versão instalada em @SPS_LCFG.
import { SCHEMA, SCHEMA_VERSION, CFG_DEFAULTS, SET, fieldMD } from './schema.js';
import { query, eq, key } from './odata.js';

export async function installStructures(sl, log = () => {}) {
  let errors = 0;
  const step = async (label, fn) => {
    try {
      const r = await fn();
      log(`${r === 'exists' ? '=' : '+'} ${label}${r === 'exists' ? ' já existe' : ' criado'}`);
    } catch (e) {
      errors++;
      log(`✗ ${label}: ${e.message}`);
    }
  };
  const exists = async (path) => {
    try {
      await sl.get(path);
      return true;
    } catch (e) {
      if (e.statusCode === 404 || e.b1Status === 404) return false;
      throw e;
    }
  };

  for (const t of SCHEMA.tables) {
    await step(`tabela @${t.TableName}`, async () => {
      if (await exists(`UserTablesMD${key(t.TableName)}`)) return 'exists';
      await sl.request('POST', 'UserTablesMD', t);
    });
  }
  for (const [table, fields] of Object.entries(SCHEMA.fields)) {
    let names = [];
    try {
      names = (await sl.getAll(query('UserFieldsMD', { filter: eq('TableName', table), select: ['Name', 'TableName'] }))).map((f) => f.Name);
    } catch (e) {
      errors++;
      log(`✗ campos de ${table}: ${e.message}`);
      continue;
    }
    for (const f of fields) {
      await step(`campo ${table}.U_${f.n}`, async () => {
        if (names.includes(f.n)) return 'exists';
        await sl.request('POST', 'UserFieldsMD', fieldMD(table, f));
      });
    }
  }
  for (const u of SCHEMA.udos) {
    await step(`objeto ${u.Code}`, async () => {
      if (await exists(`UserObjectsMD${key(u.Code)}`)) return 'exists';
      await sl.request('POST', 'UserObjectsMD', u);
    });
  }
  for (const [k, v] of Object.entries(CFG_DEFAULTS)) {
    if (k === 'SCHEMA_VERSION') continue;
    await step(`parâmetro ${k}`, async () => {
      if (await exists(`${SET.CFG}${key(k)}`)) return 'exists';
      await sl.request('POST', SET.CFG, { Code: k, Name: k, U_Valor: v });
    });
  }
  if (!errors) {
    await step(`versão das estruturas ${SCHEMA_VERSION}`, async () => {
      if (await exists(`${SET.CFG}${key('SCHEMA_VERSION')}`)) await sl.request('PATCH', `${SET.CFG}${key('SCHEMA_VERSION')}`, { U_Valor: String(SCHEMA_VERSION) });
      else await sl.request('POST', SET.CFG, { Code: 'SCHEMA_VERSION', Name: 'SCHEMA_VERSION', U_Valor: String(SCHEMA_VERSION) });
    });
  }
  return { errors, version: SCHEMA_VERSION };
}
