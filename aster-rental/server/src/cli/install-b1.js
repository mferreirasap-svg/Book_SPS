// Instala ou atualiza as estruturas do Áster Rental no SAP B1 pela linha de comando:
//   B1_MODE=servicelayer B1_SL_URL=... B1_COMPANY_DB=... B1_USER=... B1_PASSWORD=... npm run install-b1
import { config, validateConfig } from '../config.js';
import { createB1Client } from '../b1/index.js';
import { installStructures } from '../b1/installer.js';

const errors = validateConfig({ ...config, production: false });
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
const sl = createB1Client(config.b1, console);
const r = await installStructures(sl, (l) => console.log(l));
console.log(r.errors ? `\nConcluído com ${r.errors} erro(s).` : `\nEstruturas na versão ${r.version}. Reinicie as sessões da Service Layer.`);
process.exit(r.errors ? 1 : 0);
