// Monta repositórios e serviços de negócio. Usado pelo servidor e pela demonstração no navegador,
// para que as regras sejam exatamente as mesmas nos dois.
import { createRepos } from '../repos.js';
import { createContractService } from './contracts.js';
import { createMovementService } from './movements.js';
import { createBillingService } from './billing.js';
import { createOperationsService } from './operations.js';

export function createServices({ sl, audit, jobs }) {
  const repos = createRepos(sl);
  const contracts = createContractService({ repos, audit });
  const movements = createMovementService({ repos, audit, contracts });
  const billing = createBillingService({ repos, audit, jobs });
  const operations = createOperationsService({ repos, audit, billing });
  return { repos, contracts, movements, billing, operations };
}
