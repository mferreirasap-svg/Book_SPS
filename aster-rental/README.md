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

## Pacote de apresentação (localhost, sem instalar nada)

`npm run pacote` gera `Aster-Rental-apresentacao.zip`, com:
- `Aster Rental.html`: o sistema inteiro num arquivo, que roda sem internet.
- `Abrir Aster Rental.cmd`: no Windows, abre em http://localhost:8080 pelo PowerShell que já vem no sistema.
- O atalho para Mac.
- O roteiro da apresentação.

No modo simulado, a base nova recebe dados de apresentação (`server/src/b1/apresentacao.js`), montados pelas próprias regras do sistema:
- contratos em várias situações;
- entregas e devoluções com documentos no B1;
- faturamento de meses anteriores;
- chamados, OS e pesquisas com histórico;
- um erro de integração proposital, para mostrar o reprocessamento.

`DEMO_DADOS=basico` usa só a base mínima. Administração › SAP B1 › Restaurar dados de demonstração volta ao início.

## Demonstração online (sem instalar nada)

Link: https://claude.ai/artifact/CFpHB5EPyuaWBds43PEYcy (usuário `admin`, senha `Demo2026senha`).

A mesma tela roda sem servidor: quando `/api/health` não responde, `web/js/api.js` carrega
`web/js/demo/backend.js`, que executa no navegador as mesmas rotas e serviços do servidor
(`server/src/routes`, `server/src/services`) sobre a Service Layer simulada. Os dados ficam só no
navegador de quem abriu (localStorage). A impressão vira pré-visualização.

Para gerar os arquivos publicados: `npm run build-demo` (saída em `dist-demo/`, fora do Git).

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

## Pós-venda

Menu **Pós-venda** (referência de escopo e decisões em `docs/pos-venda/01-pesquisa-auvo.md`):

| Tela | Resumo |
|---|---|
| Chamados | Abertura por telefone, e-mail, WhatsApp ou portal; SLA de 1ª resposta e de solução por prioridade; conversa com o cliente; gera OS |
| Ordens de serviço | Corretiva, preventiva, entrega técnica, vistoria e reparo de avaria; técnico e agenda; checklist, peças e serviços, fotos, laudo e assinatura; orçamento aprovado pelo cliente; relatório |
| Agenda da equipe | Semana por técnico e fila sem agenda |
| Preventivas | Planos por família (horas/km e dias); vencidas e próximas pela leitura atual; gera a OS com o checklist do plano |
| Satisfação (NPS) | Link público por token (`#/pesquisa/<código>`), NPS geral e por técnico; nota 0–6 abre chamado de reclamação |
| Técnicos e planos | Técnico ligado ao usuário (perfil "Técnico de campo" vê só as próprias OS) e planos preventivos |

Integrações com o que já existia:
- **Equipamento parado no cliente** vira "dias fora" no contrato, e o faturamento já desconta esses dias. A parada fecha quando a OS é concluída. Conserto no mesmo dia não gera desconto.
- **Concluir a OS** atualiza o horímetro (com leitura para o consumo do contrato), resolve o chamado, cria **rascunho de NF no SAP B1** com os itens cobráveis aprovados (`U_SPS_OsEntry`) e envia a pesquisa.
- **Devolução ou substituição com avaria** pode abrir a OS de reparo já ligada ao contrato e ao cliente.
- **Ativos › Histórico** reúne contratos, movimentações, chamados, OS e leituras do equipamento.

Estruturas novas no B1 (versão 3): `SPSLCHA` (chamados e interações), `SPSLOS` (OS e itens), `@SPS_LTEC`, `@SPS_LPLN` e `@SPS_LPES`. Rode a instalação de novo em Administração › SAP B1.

## Portal do cliente

**Locadora:** menu **Pós-venda › Portal do cliente**.
- Cria o acesso do contato do cliente: e-mail + código de 8 caracteres, mostrado uma única vez.
- Gera e imprime as etiquetas QR dos equipamentos.
- O botão "Ver o portal como o cliente" abre a visão do cliente.

**Cliente:** endereço `#portal`.
- Vê os próprios chamados e conversa com a locadora. As notas internas nunca aparecem para ele.
- Abre chamado com fotos.
- Aprova ou recusa orçamentos.
- Vê os equipamentos locados, com a próxima preventiva.

**Etiqueta QR:** endereço `#qr-<código>`. Quem está na obra abre o chamado sem login, com equipamento, cliente e obra já preenchidos.

**Segurança:**
- Só o resumo SHA-256 do código e da sessão fica gravado (UDT `@SPS_LPOR`).
- Bloqueio de 15 minutos depois de 5 tentativas erradas.
- Sessão com prazo (parâmetro `PORTAL_HORAS`).
- Desativar o acesso derruba a sessão aberta.
- Cada cliente só vê os dados do próprio CardCode.

**Demonstração:** `marcos@serraazul.example` / `SERRA2026`.

Preventivas: botão "Gerar OS de todas as vencidas". Com o parâmetro `PREV_AUTO = S`, a leitura que vence uma preventiva já abre a OS.

## Campo, faturamento conferido, frota e mapa (versão 6 — pedidos da Macromaq)

Detalhes e decisões a validar: `docs/proximas-etapas/01-levantamento-macromaq.md`.

- **Fotos nas movimentações:** até 6 por entrega/devolução/substituição; saem no termo.
- **Leitura de campo:** menu *Lançar leitura (campo)*, pensado para celular (perfil **Leiturista**). Foto do mostrador obrigatória;
  a leitura fica "a conferir" e o escritório aprova em *Leituras* comparando com a foto (`LEIT_CONFERENCIA`, `LEIT_FOTO_OBRIG`).
- **Mão de obra:** linha de operador no contrato (hora, diária ou mês; jornada; hora extra). Horas lançadas e aprovadas em
  *Horas do operador*; cobradas em documento de serviço separado (`ITEM_MO`, `MO_DOC_SEPARADO`). Operadores em *Técnicos e planos*.
- **Conferência do faturamento:** contratos variáveis passam por *Conferir…* (cobrar/abonar/ajustar com motivo, alçada `FAT_ALCADA_ABONO`)
  antes de gerar (`FAT_CONFERENCIA`; o contrato pode forçar "sempre conferir" ou "liberar direto").
- **Documentação de veículos:** licenciamento/IPVA pelo calendário da UF e final da placa, alertas, comprovante e esboço de nota de entrada no B1.
- **Manutenção da frota:** disponibilidade, custo por equipamento e por hora, quebras; OS interna com baixa de peças (Saída de mercadorias),
  terceiros (Pedido de compra) e centro de custo do equipamento. Ativo enviado para "Manutenção" abre a OS interna.
- **Mapa da equipe:** posição no início/fim da OS (termo LGPD), alerta de check-in longe da obra, rota sugerida e link para o Google Maps
  (`GEO_MODO`, `GEO_RAIO_M`, `GEO_RETENCAO_DIAS`, `GEO_BASE`). As posições ficam no banco do Áster, fora do SAP.
- **Portal do cliente › Financeiro:** notas pagas, em aberto e vencidas, e extrato do mês.

Demonstração: `leiturista` / `Demo2026senha` mostra a visão do funcionário de campo.

## Integração com o SAP B1 (telas nativas)

Mapa completo, pré-requisitos e roteiro de homologação em `docs/integracao-b1/01-mapa-nativo.md`.
Resumo: o B1 recebe o que tem tela própria, e o Áster guarda só as regras de locação.

| Evento no Áster | Objeto nativo no B1 |
|---|---|
| Entrega / devolução / substituição | Entrega (NF de remessa) e Devolução ligada à entrega, com nº de série; ou Transferência de estoque |
| Faturamento | Esboço, pedido ou NF com série, boleto (forma de pagamento), condição, vendedor, projeto e endereço de entrega do contrato |
| Chamado | Chamada de serviço (Cartão de equipamento, relatórios de serviço) |
| OS agendada | Atividade do técnico, ligada à chamada |
| OS com cobrança | Esboço de NF de serviço |

Tela **Configuração › Integração SAP B1**:
- **Prontidão**: verifica, sem gravar nada, as estruturas, o de-para e os cadastros nativos, e cria o que falta.
- **De-para**: listas vindas do B1.
- **Monitor**: falha no B1 não desfaz a operação do Áster; o envio fica para reprocessar.
- **Equipamentos do B1**: cria ativos a partir dos números de série.

## API (principais rotas)

`/api/auth/*` · `/api/dashboard` · `/api/assets` · `/api/assets/availability` · `/api/families` · `/api/rules` ·
`/api/contracts` · `/api/contracts/:id/status` · `/api/movements` · `/api/readings` · `/api/readings/import` ·
`/api/fines` · `/api/billing` · `/api/billing/generate` · `/api/billing/installment/:code/release` · `/api/jobs/:id` · `/api/admin/*` ·
`/api/tickets` · `/api/tickets/:id/interactions` · `/api/tickets/:id/order` · `/api/orders` · `/api/orders/:id/{schedule,start,quote,conclude,cancel}` ·
`/api/preventive` · `/api/technicians` · `/api/plans` · `/api/surveys` · `/api/assets/:code/history` · `/api/aftersales/dashboard` ·
`/api/public/survey/:code` (sem login) ·
`/api/b1/lists` · `/api/b1/addresses/:card` · `/api/integration/{structure,readiness,log,serials}` · `/api/integration/log/:code/retry` · `/api/integration/serials/import` ·
`/api/readings/{field,review,rented,mine}` · `/api/readings/:code/review` · `/api/timesheet` · `/api/operators` · `/api/billing/liberar` ·
`/api/vehicle-docs` · `/api/vehicle-docs/{calendar,:code/pay,:code/exempt}` · `/api/maintenance/indicators` · `/api/geo/{policy,accept,position,map}` · `/api/alerts` ·
`/api/portal/accesses` · `/api/portal/qr-labels` · `/api/public/portal/*` e `/api/public/qr/:tk` (portal do cliente, sem login interno) · `/api/preventive/overdue`

## Próximos passos

- Equipamento como número de série do B1, com nota de remessa e de retorno (`DeliveryNotes` e `Returns`) na entrega e na devolução.
- Fotos (movimentação, leitura, OS, comprovantes) como anexos nativos do B1 (`Attachments2`) e modo offline no celular.
- Proposta e pré-contrato a partir de cotação e pedido do B1.
- Envio da fatura, do extrato e da pesquisa de satisfação por e-mail (hoje a pesquisa é gerada e o link pode ser copiado).
- Pós-venda, próxima etapa: app do técnico offline, SLA em horário comercial, mapa com serviço de mapas licenciado e contrato de manutenção de equipamento do cliente.
- Boleto/2ª via no portal, conforme o add-on bancário da Macromaq.
- Teste de carga, teste de invasão e homologação com cliente piloto.
