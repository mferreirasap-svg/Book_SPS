# Áster Rental

Gestão de locadoras de máquinas, equipamentos e veículos integrada ao **SAP Business One**.
Contratos, entregas e devoluções com checklist e assinatura, leituras de uso, motor de cobrança
(por item, agrupada, por consumo, pró-rata, tolerância), faturamento em lote no B1, multas e painéis.

NF e boleto continuam sendo emitidos no SAP B1. O Áster Rental cria o documento de venda
(rascunho de NF, pré-fatura ou NF) e acompanha a parcela.

## Arquitetura

```
Navegador (tela em web/)  ──HTTPS──►  Backend Node.js (server/)  ──TLS──►  Service Layer  ──►  SAP B1
                                      · login, perfis, auditoria            (rede privada)
                                      · regras de negócio e cobrança
                                      · banco interno SQLite (usuários, sessões, auditoria, tarefas)
```

- A tela **nunca** fala com o SAP B1 e não tem senha do B1: tudo passa pelo backend.
- Dados de negócio ficam no B1, em tabelas e objetos de usuário `SPS_L*`; documentos fiscais são nativos do B1.
- Operações com várias gravações vão num único `$batch` da Service Layer: tudo ou nada.

| Pasta | Conteúdo |
| --- | --- |
| `server/src/app.js` | Montagem da API: segurança, sessão, rotas, arquivos da tela |
| `server/src/b1/` | Cliente da Service Layer (pool de sessões, `$batch`, erros), B1 simulado, esquema e instalador |
| `server/src/domain/billing/engine.js` | Motor de cobrança (função pura, testada) |
| `server/src/services/` | Contratos, movimentações, faturamento, leituras, multas, painel |
| `server/src/routes/` | Endpoints REST em `/api` |
| `server/src/auth/` | Usuários, sessões, perfis e permissões |
| `server/test/` | Testes do motor, da camada B1 e da API de ponta a ponta |
| `web/` | Tela (HTML, CSS e JavaScript em módulos, sem etapa de build) |

## Como abrir o sistema (modo demonstração, sem SAP B1)

O sistema precisa rodar num computador com **Node.js 22.13 ou mais novo** (baixe a versão LTS em https://nodejs.org).
O endereço `http://localhost:3000` só funciona **no próprio computador onde o programa está rodando**.

**Windows:** baixe a pasta `aster-rental` e dê dois cliques em `iniciar-demo.cmd`. Na primeira vez ele instala
as dependências (alguns minutos) e depois abre o navegador sozinho.

**Linux / Mac:** `sh iniciar-demo.sh` dentro da pasta `aster-rental` e abra http://localhost:3000.

Entre com usuário **admin** e senha **Demo2026senha** (aparece também na janela preta ao iniciar).
Os dados de exemplo ficam salvos em `data/`; para começar do zero, apague essa pasta ou use
**Administração › SAP B1 › Restaurar dados de demonstração**.

### Problemas comuns

| O que acontece | Causa e solução |
| --- | --- |
| "O Áster Rental precisa do Node.js 22.13…" | Node.js antigo. Instale a versão LTS atual e rode de novo. |
| `'node' não é reconhecido` | Node.js não instalado (ou o computador não foi reiniciado depois da instalação). |
| A página `localhost:3000` não abre | O programa não está rodando nesse computador. Deixe a janela preta aberta enquanto usa. |
| Abri o `index.html` com dois cliques e a tela ficou em branco | A tela precisa do servidor. Use `iniciar-demo.cmd` e abra pelo endereço `http://localhost:3000`. |
| "Login ou senha inválidos" | Use admin / Demo2026senha. Se trocou a senha e esqueceu, apague a pasta `data/`. |
| Porta 3000 ocupada | Crie um arquivo `.env` com `PORT=3001` e abra `http://localhost:3001`. |

Para desenvolver com recarga automática: `npm install` e `npm run dev`.

## Testes

```bash
npm test
```

São 27 testes: os exemplos numéricos do motor de cobrança (casos A a F do documento de arquitetura),
filtros OData e `$batch`, e o fluxo da API (login, bloqueio por tentativas, perfis, CSRF, contrato,
entrega com idempotência, leitura, faturamento sem duplicidade, liberação, concorrência, manutenção,
multas, lote em segundo plano, auditoria e instalador).

## Implantação

1. Copie `.env.example` para `.env` e preencha (`B1_*`, `ADMIN_PASSWORD`, domínios do Áster).
2. Instale as estruturas no B1 (uma vez por banco, com superusuário):
   `npm run install-b1` ou pela tela **Administração › SAP B1**. Depois reinicie as sessões da Service Layer.
3. Suba com Docker: `docker compose up -d --build`. O volume `aster-rental-data` guarda o banco interno.
4. Coloque um proxy com HTTPS na frente (nginx, Traefik ou IIS) e publique no Áster.
5. No B1, cadastre os itens de serviço de locação e o item de repasse de multa; informe-os em **Administração › Parâmetros**.

Em produção o servidor se recusa a subir com `B1_MODE=mock` ou com cookie sem HTTPS.

### Integração com o portal Áster

O sistema pode abrir dentro do Áster (iframe) ou como link. Libere o domínio do Áster em
`FRAME_ANCESTORS` e `ALLOWED_ORIGINS`.

## Segurança (resumo)

| Requisito | Como está atendido |
| --- | --- |
| Senha do B1 fora do navegador | Usuário técnico só no backend; tela não acessa a Service Layer |
| Sessão | Cookie HttpOnly, SameSite=Strict, Secure; expira em 30 min parado e 12 h no máximo |
| Senhas | bcrypt; mínimo de 10 caracteres com letras e números; bloqueio de 15 min após 5 erros |
| Perfis | Administrador, Gestor, Comercial, Faturamento, Pátio, Operação; checados em toda rota |
| Filiais | Usuário vê e grava só nas filiais liberadas |
| CSRF | Cabeçalho obrigatório em gravações + conferência de origem |
| XSS | Texto sempre escapado; CSP sem script inline |
| Injeção OData | Filtros montados só pelo backend, com escape |
| Auditoria | Quem, quando, IP, antes e depois; assinatura e senhas não vão para o log |
| Limite de requisições | Global e mais restrito no login |
| Concorrência | Versão do registro: quem grava por cima recebe aviso (409) |
| Duplicidade | Parcela travada por contrato e competência; movimentação com chave de idempotência |

## API (principais rotas)

`/api/auth/*` · `/api/dashboard` · `/api/assets` · `/api/assets/availability` · `/api/families` · `/api/rules` ·
`/api/contracts` · `/api/contracts/:id/status` · `/api/movements` · `/api/readings` · `/api/readings/import` ·
`/api/fines` · `/api/billing` · `/api/billing/generate` · `/api/billing/installment/:code/release` · `/api/jobs/:id` · `/api/admin/*`

## Próximos passos

- Equipamento como número de série do B1, com nota de remessa e de retorno (`DeliveryNotes` e `Returns`) na entrega e na devolução.
- Fotos no checklist como anexos do B1 e modo offline no celular.
- Proposta e pré-contrato a partir de cotação e pedido do B1.
- Envio da fatura e do extrato por e-mail; manutenção preventiva com O.S.
- Teste de carga, teste de invasão e homologação com cliente piloto.
