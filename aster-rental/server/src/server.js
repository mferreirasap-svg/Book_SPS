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
  console.log(`Áster Rental em http://localhost:${config.port} (SAP B1: ${config.b1.mode === 'mock' ? 'demonstração' : config.b1.url})`);
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
