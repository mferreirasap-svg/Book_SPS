// Monta a versão de demonstração online (sem servidor) em dist-demo/.
// Copia a tela (web/) e os módulos do servidor que o backend de demonstração usa no navegador.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
const out = join(root, 'dist-demo');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const d of ['css', 'img', 'js']) cpSync(join(web, d), join(out, d), { recursive: true });

// Segue os imports do backend de demonstração e copia cada módulo do servidor alcançado.
const visto = new Set();
function seguir(file) {
  if (visto.has(file)) return;
  visto.add(file);
  const src = readFileSync(file, 'utf8');
  for (const [, spec] of src.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!spec) continue;
    if (spec.startsWith('node:') || !spec.startsWith('.')) throw new Error(`${relative(root, file)} importa "${spec}", que não roda no navegador.`);
    // No dist, js/demo/../../server aponta para dist-demo/server; no repositório, para ./server.
    seguir(resolve(dirname(file), spec).replace(join(web, 'server'), join(root, 'server')));
  }
  if (file.startsWith(join(root, 'server'))) {
    const dest = join(out, relative(root, file));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, src);
  }
}
seguir(join(web, 'js', 'demo', 'backend.js'));

// Página do link: sem doctype/html/head/body (o publicador acrescenta) e com título curto.
let html = readFileSync(join(web, 'index.html'), 'utf8');
html = html
  .replace(/<!DOCTYPE html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body>\s*/gi, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<title>[^<]*<\/title>/, '<title>Áster Rental</title>');
writeFileSync(join(out, 'index.html'), html);

if (!existsSync(join(out, 'server'))) throw new Error('Nenhum módulo do servidor copiado.');
console.log(`dist-demo pronto: ${visto.size} módulos seguidos.`);
