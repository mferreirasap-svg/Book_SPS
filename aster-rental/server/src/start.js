// Entrada do servidor: confere a versão do Node.js antes de carregar o resto.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\nO Áster Rental precisa do Node.js 22.13 ou mais novo. Versão instalada: ${process.versions.node}.\nBaixe a versão LTS em https://nodejs.org e rode de novo.\n`);
  process.exit(1);
}
// O banco interno usa o SQLite do próprio Node, que ainda emite um aviso de "experimental".
const emit = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w?.name || a[0] || '').includes('ExperimentalWarning') || /SQLite/.test(String(w)) ? undefined : emit.call(process, w, ...a));
await import('./server.js');
