// Ponto de entrada: valida a configuração e sobe o servidor HTTP.
import { config, validateConfig } from './config.js';
import { buildApp } from './app.js';

const errors = validateConfig();
if (errors.length) {
  console.error(`Configuração inválida:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

const app = await buildApp(config);
try {
  await app.listen({ host: config.host, port: config.port });
  console.log(`\n  Áster Rental rodando. Abra no navegador: http://localhost:${config.port}\n  SAP B1: ${config.b1.mode === 'mock' ? 'modo demonstração (dados de exemplo)' : config.b1.url}\n  Para parar: Ctrl+C\n`);
} catch (e) {
  app.log.error(e);
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
