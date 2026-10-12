// Escolhe o cliente do B1 conforme B1_MODE: Service Layer real ou simulada.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ServiceLayerClient } from './serviceLayer.js';
import { MockServiceLayer } from './mock.js';
import { demoSeed } from './seed.js';

const fileStorage = (file) => ({
  load: () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null),
  save: (db) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(db));
  },
});

export function createB1Client(b1cfg, log) {
  if (b1cfg.mode === 'servicelayer') return new ServiceLayerClient(b1cfg, log);
  return new MockServiceLayer({ seed: demoSeed, storage: b1cfg.mockFile ? fileStorage(b1cfg.mockFile) : undefined });
}
