// Escolhe o cliente do B1 conforme B1_MODE: Service Layer real ou simulada.
import { ServiceLayerClient } from './serviceLayer.js';
import { MockServiceLayer } from './mock.js';
import { demoSeed } from './seed.js';

export function createB1Client(b1cfg, log) {
  if (b1cfg.mode === 'servicelayer') return new ServiceLayerClient(b1cfg, log);
  return new MockServiceLayer({ seed: demoSeed, file: b1cfg.mockFile || undefined });
}
