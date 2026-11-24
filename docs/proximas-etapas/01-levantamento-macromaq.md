# Áster Rental × Macromaq — levantamento das próximas etapas

> Origem: observações da Macromaq na apresentação do protótipo.
> Para cada pedido: o que entendemos, **o que precisa ser decidido com a Macromaq**, as opções e **como ficaria gravado no SAP B1**.
> Princípio mantido: o que tem tela nativa no B1 usa o objeto nativo; o resto vai em tabelas e objetos de usuário (prefixo `SPS_L`);
> dados de alto volume (fotos, posições de GPS) não vão para tabelas do B1.

## Situação no protótipo (versão 6)

Os oito pedidos já estão **funcionando no protótipo**, com o processo que consideramos mais adequado e as regras deixadas **configuráveis**
(Administração › Parâmetros e Integração SAP B1 › De-para). Cada decisão abaixo é uma proposta para validar com a Macromaq — mudar a regra é parametrização, não desenvolvimento.

| # | Pedido | Como ficou no protótipo | Regra configurável |
|---|---|---|---|
| 1 | Fotos nas movimentações | Até 6 fotos por entrega/devolução/substituição, com legenda; saem no termo impresso | — |
| 2 | Foto do horímetro | Perfil **Leiturista** (funcionário da Macromaq) lança no celular com foto obrigatória; a leitura fica **"a conferir"** e só vale no faturamento depois que o escritório aprova comparando com a foto (recusa exige motivo) | `LEIT_CONFERENCIA`, `LEIT_FOTO_OBRIG` |
| 3 | Mão de obra | Linha **"Mão de obra (operador)"** no mesmo contrato, ligada à máquina; cobrança por hora, diária ou mês, com jornada e valor de hora extra. Horas lançadas por dia (acima da jornada viram extra) e **aprovadas** antes de cobrar. Sai em **documento de serviço separado** da locação | `ITEM_MO`, `MO_DOC_SEPARADO` |
| 4 | Liberar o faturamento | Contratos com franquia/excedente ou mão de obra passam por **conferência**: linha a linha cobrar, abonar ou ajustar, com motivo; redução acima da **alçada** só com perfil gestor. Contrato pode forçar "sempre conferir" ou "liberar direto". Se o cálculo mudar depois de liberado, pede nova conferência | `FAT_CONFERENCIA`, `FAT_ALCADA_ABONO`, campo do contrato |
| 5 | Licenciamento | Obrigações por veículo (licenciamento, IPVA, seguro, tacógrafo, ANTT, AET); calendário gerado pela UF e final da placa; alertas; pagamento com comprovante e **esboço de nota de entrada de serviço** no SAP | `VEI_ALERTA_DIAS`, `VEI_FORNECEDOR`, `VEI_CONTA` |
| 6 | Financeiro no portal | Aba **Financeiro**: notas pagas, em aberto e vencidas (lidas das notas nativas do SAP) e **extrato** de cada mês com a memória de cálculo. Boleto/2ª via depende do add-on bancário (a definir) | — |
| 7 | Manutenção | Tela **Manutenção da frota**: disponibilidade, o que está na oficina e há quantos dias, custo por equipamento e por hora trabalhada, quebras e uso entre quebras. **OS interna**: equipamento vai para "manutenção" (automático ao mudar o status), peças saem por **Saída de mercadorias** do depósito da oficina, terceiros viram **Pedido de compra**, custo no **centro de custo do equipamento** | `OFI_DEP_PECAS`, `OFI_DIM`, `OFI_CUSTO_HORA` |
| 8 | Geolocalização e rota | Posição registrada **só no início e no fim de cada OS** (padrão), com termo de ciência do técnico (LGPD); distância até a obra (alerta de check-in longe); **Mapa da equipe** com a rota sugerida do dia e link para o Google Maps. Rastreio durante o expediente fica como opção. Posições ficam no banco do Áster e são apagadas após o prazo | `GEO_MODO`, `GEO_RAIO_M`, `GEO_RETENCAO_DIAS`, `GEO_BASE` |

Perfis novos/alterados: **Leiturista** (lança leituras e horas), Faturamento (confere e libera), Gestor (abona acima da alçada).
O desenho de como cada item fica gravado no SAP B1 está nas seções abaixo e será revisado na próxima etapa.

## Resumo

| # | Pedido | Tamanho | Depende de decisão? | Estruturas novas no SAP |
|---|---|---|---|---|
| 1 | Fotos nas movimentações | Pequeno | Pouco (pasta de anexos) | Anexos nativos + 1 campo por objeto |
| 2 | Foto do horímetro pelo funcionário | Médio | Sim (quem, quando, conferência) | Campos na tabela de leituras |
| 3 | Mão de obra (operador) | Médio | **Sim, várias** (contrato, cobrança, fiscal) | Campos no contrato + 2 tabelas |
| 4 | Liberar o que vai para faturamento | Médio | Sim (quem libera, alçada) | 1 campo no contrato + 1 tabela |
| 5 | Licenciamento dos veículos | Médio | Sim (obrigações, contas a pagar) | 1 objeto de usuário |
| 6 | Faturamento e financeiro no portal | Médio | Sim (add-on de boleto e NF-e) | Nenhuma (lê documentos nativos) |
| 7 | Módulo de manutenção (oficina) | Grande | **Sim, várias** (estoque, custos) | Campos em documentos nativos + centro de custo |
| 8 | Geolocalização e rota dos técnicos | Grande | **Sim** (LGPD, app, mapas) | Campos na OS e no endereço do cliente; posições fora do B1 |

---

## 1. Fotos nas movimentações (entrega, devolução, substituição)

**Entendimento:** registrar o estado do equipamento com fotos na entrega e na devolução, como prova em caso de avaria.

**Decidir com a Macromaq**
- Quantas fotos por movimentação; se alguma foto é obrigatória (ex.: frente, laterais, horímetro, avaria).
- Se as fotos saem no termo impresso.

**Gravação no SAP**
- **Anexos nativos do B1** (`Attachments2` / tabela ATC1). Os arquivos ficam na **pasta de anexos** definida em *Parâmetros gerais › Caminho*, não no banco.
- Campo `U_AtcEntry` (número do anexo) em `@SPS_LMOV`. O mesmo campo serve para a OS (`@SPS_LOS`) e para o chamado (`@SPS_LCHA`), que no protótipo ainda guardam a foto dentro do registro.
- **Ponto técnico:** guardar a foto dentro do registro, como no protótipo, não serve para produção, porque o banco cresce rápido.

## 2. Foto do horímetro tirada pelo funcionário da Macromaq

**Entendimento:** um funcionário da Macromaq lança a leitura do horímetro ou hodômetro pelo celular, com a foto do painel. Isso facilita o lançamento e serve de prova para o cliente.

**Decidir com a Macromaq**
- **Quem lança:**
  - motorista da entrega;
  - técnico em visita;
  - operador da Macromaq que fica na obra;
  - pessoal do pátio.
- Cada um teria um perfil no Áster que só enxerga a tela de leituras.
- **Quando lança:** fechamento mensal (até que dia, antes do faturamento), semanal, ou a cada visita.
- **Conferência:** a leitura vale direto, ou fica **pendente** até alguém do escritório conferir com a foto?
- Se o cliente precisa ver a foto (portal) ou assinar a leitura.

**Opções**
- **A (sugerida):** perfil "Leiturista". Lança pelo celular, e a leitura fica pendente até a conferência; só a leitura conferida entra no faturamento.
- **B:** lançou, valeu. A foto fica como prova.

**Gravação no SAP** (tabela de leituras `@SPS_LMED`, que já existe)
- Novos campos:
  - `U_AtcEntry` (foto, em anexo nativo);
  - `U_Situacao` (pendente, conferida, recusada);
  - `U_LancPor`;
  - `U_ConfPor`;
  - `U_DtConf`;
  - `U_Obs`.
- O faturamento passa a considerar só as leituras conferidas, se a opção A for escolhida.

## 3. Mão de obra (operador junto com a máquina)

**Entendimento:** em alguns contratos a Macromaq aluga a máquina **com operador**. Ainda não sabemos se a mão de obra é **um contrato separado** ou **um item no mesmo contrato da máquina**.

**Ponto fiscal (confirmar com o contador da Macromaq):** locação de bem móvel **não tem ISS** (Súmula Vinculante 31 do STF). Já a **mão de obra do operador é serviço**: normalmente sai em **nota de serviço (NFS-e)**, separada da fatura de locação. Isso pesa na escolha da opção abaixo.

**Decidir com a Macromaq**
- **Como cobram hoje:**
  - por hora trabalhada, diária ou valor mensal;
  - jornada contratada (ex.: 8 h/dia, 44 h/semana);
  - hora extra, noturna, fim de semana e feriado (percentuais);
  - mínimo garantido.
- **Despesas do operador:** deslocamento, alimentação e hospedagem são cobradas à parte?
- **Quem é o operador:** funcionário CLT da Macromaq ou terceirizado? Fica fixo numa máquina ou troca?
- **Apontamento de horas:** diário de bordo assinado pelo cliente? Quem lança e quem aprova?
- **Nota:** sai **uma nota de serviço separada** da fatura de locação, ou tudo junto?

**Opções**

| Opção | Como fica | Vantagens | Desvantagens |
|---|---|---|---|
| **A — Item no mesmo contrato (sugerida)** | O contrato da máquina ganha linhas do tipo "Mão de obra", ligadas à máquina. No faturamento, a mão de obra sai **em documento separado** (série e utilização de serviço). | Uma negociação, um contrato, a visão completa do cliente. A nota de serviço sai correta. | Contrato com dois tipos de cobrança. |
| B — Contrato separado (tipo "Serviço", que já existe no Áster) | Um contrato de locação e outro de mão de obra, ligados pelo número. | Separação total, fiscal e comercial. | Dois cadastros para o mesmo cliente e a mesma obra; mais trabalho no comercial. |

**Gravação no SAP**
- **Itens do contrato** (`@SPS_LCT1`), novos campos:
  - `U_TipoLinha` (equipamento ou mão de obra);
  - `U_LinhaRef` (máquina a que o operador está ligado);
  - `U_Operador`;
  - `U_UnidCobr` (hora, dia ou mês);
  - `U_Jornada`;
  - `U_PctExtra`.
- **Nova tabela `@SPS_LOPE` — Operadores:** liga ao **cadastro de funcionários nativo** (`EmployeesInfo`), com habilitações (CNH, NR-11/NR-12) e validade.
- **Novo objeto `SPSLAPO` — Apontamento de horas:**
  - data, contrato, linha e operador;
  - horas normais e extras;
  - assinatura do cliente;
  - situação (lançado, aprovado).
- **Faturamento:** item de serviço próprio no SAP (ex.: `SLOC-MO`). Se a nota for separada, gera um segundo documento com a série e a utilização de serviço.

## 4. Liberar o que vai para faturamento

**Entendimento:** há contratos **recorrentes** (mensalidade fixa, que pode faturar direto) e contratos com **franquia, excedente e consumo**. Nestes, a Macromaq quer **conferir e decidir** o que cobra antes de gerar a nota: por exemplo, abonar um excedente.

**Decidir com a Macromaq**
- Quais contratos passam por conferência: marcados um a um, ou automaticamente todo contrato com franquia ou consumo?
- **Quem pode** liberar e abonar (comercial, gestor, financeiro).
- Se o abono acima de um valor ou percentual precisa de **segunda aprovação**.
- Motivos padrão de abono (cortesia, falha do equipamento, erro de leitura, negociação).
- Se o cliente precisa **aprovar o extrato** antes da nota (pelo portal).

**Como ficaria:** a parcela passa por *Calculada → Em conferência → Liberada → Documento gerado no SAP*. Na conferência, cada linha pode ser **cobrada, abonada ou ajustada**, sempre com motivo e usuário.

**Gravação no SAP**
- Contrato (`@SPS_LCTR`): campo `U_Conferir` (sim ou não, com padrão por tipo de cobrança).
- Parcela (`@SPS_LFAT`): novas situações (em conferência, liberada) e os campos `U_LibPor` e `U_DtLib`.
- **Nova tabela `@SPS_LFAJ` — Ajustes de faturamento:**
  - parcela e linha;
  - tipo (abono ou ajuste);
  - valor e motivo;
  - usuário e aprovador;
  - data.

  É a trilha que o cliente e a auditoria vão pedir.

## 5. Licenciamento dos veículos

**Entendimento:** controlar os vencimentos e os custos da documentação de cada veículo, com alerta antes de vencer.

**Decidir com a Macromaq**
- **Obrigações:**
  - licenciamento anual (pelo final da placa e UF);
  - IPVA (cota única ou parcelas);
  - seguro da frota;
  - tacógrafo e aferição do Inmetro;
  - ANTT/RNTRC;
  - AET;
  - outras.
- Se os veículos são de **várias UFs** (os calendários mudam).
- **Quem paga e como lança no SAP:**
  - nota de entrada de serviço;
  - lançamento contábil;
  - só controle, sem lançamento.
- Se algum custo é **repassado** ao cliente.
- Com quantos dias de antecedência avisar, e quem recebe o aviso.

**Gravação no SAP**
- **Novo objeto `SPSLDOC` — Obrigações do veículo:**
  - ativo e tipo;
  - exercício e vencimento;
  - valor;
  - situação (a vencer, vencida, paga);
  - data de pagamento;
  - anexo (CRLV, guia, comprovante).
- **Integração opcional:** gera a conta a pagar no SAP (nota de entrada de serviço ou lançamento), com o campo `U_SPS_DocVei` ligando ao registro.
- **Calendário por UF e final de placa:** tabela de parâmetros `@SPS_LCAL`, atualizada uma vez por ano.

## 6. Faturamento e financeiro no portal do cliente

**Entendimento:** no portal, o cliente vê as notas, os títulos em aberto, vencidos e pagos, e baixa boleto e nota.

**Decidir com a Macromaq**
- **Qual add-on** gera o **boleto** e qual emite a **NF-e/NFS-e**. É dele que vêm o PDF do boleto, o XML e o DANFE.
- Mostrar só os documentos de locação gerados pelo Áster, ou **toda a conta do cliente** no SAP.
- Mostrar juros e multa de títulos vencidos, ou só o valor original.
- Se o cliente pode baixar o **extrato do contrato** (memória de cálculo da parcela).

**Gravação no SAP:** **nada novo**. O portal só lê dados nativos:
- **notas de saída** (`Invoices`);
- **parcelas e vencimentos** (`DocumentInstallments`);
- **recebimentos** (`IncomingPayments`);
- **esboços e pedidos** gerados pelo Áster.

O PDF do boleto e da nota vem do caminho ou do anexo que o add-on grava. Para isso precisamos conhecer o add-on.

## 7. Módulo de manutenção (oficina da frota)

**Entendimento:** gestão da manutenção da frota da própria Macromaq. Hoje o protótipo trata a manutenção ligada ao cliente (chamado, OS na obra, preventiva). Falta a **oficina**:
- OS interna;
- peças do estoque;
- serviços de terceiros;
- custo por equipamento;
- indicadores.

**Decidir com a Macromaq**
- **Oficina própria, terceirizada ou as duas?**
- **Peças:**
  - Ficam em **depósito no SAP**?
  - Como baixam hoje: saída de mercadoria, requisição ou não baixam?
- **Terceiros:** pedido de compra → nota de entrada? Precisam de aprovação?
- **Mecânicos:** apontam horas? A hora do mecânico entra no custo?
- **Custo por equipamento:**
  - usar **centro de custo / regra de distribuição** do SAP por equipamento ou por família;
  - ou só um relatório do Áster.
- **Controles extras:**
  - pneus (controle individual, recapagem);
  - combustível e lubrificantes;
  - garantia de peças e de fornecedores.
- **Indicadores desejados:** disponibilidade da frota, tempo parado, custo por hora trabalhada, MTBF (tempo médio entre falhas), ranking de quebra.

**Gravação no SAP**
- **OS interna:** reaproveita o objeto de OS do Áster (`SPSLOS`) com o tipo "Manutenção interna" e o campo `U_Oficina` (própria ou terceiro).
- **Peças:**
  - **Saída de mercadorias nativa** (`InventoryGenExits`) com o campo `U_SPS_OsEntry`;
  - ou **solicitação de transferência** do depósito de peças para a oficina.
- **Terceiros:** **pedido de compra** e **nota de entrada nativos** (`PurchaseOrders`, `PurchaseInvoices`) com o campo `U_SPS_OsEntry`.
- **Custo por equipamento:** **centro de custo nativo** (`ProfitCenters`, numa dimensão "Equipamento"), informado nas linhas da saída de mercadoria e da nota de entrada. Assim o custo aparece também na contabilidade.
- **Indicadores:** calculados no Áster a partir das OS, dos documentos acima e das leituras de horímetro.

## 8. Geolocalização e rota dos técnicos

**Entendimento:** ver no mapa onde cada técnico está (os celulares são da empresa) e montar a rota das visitas do dia.

**Decidir com a Macromaq**
- **LGPD:**
  - rastrear **só durante o expediente** ou **só durante as OS** (início, deslocamento, fim);
  - **termo de ciência** assinado pelo funcionário;
  - por quanto tempo guardar as posições.
- **Aplicativo no celular:**
  - Para rastrear com a tela desligada é preciso um **app instalado** (Android/iOS).
  - Sem app, dá para registrar a posição só quando o técnico abre a OS (início e fim), pelo navegador.
- **Mapas:**
  - Google Maps é pago por uso, com melhor rota e trânsito;
  - OpenStreetMap é gratuito, com rota mais simples.
- **Endereço das obras:** as obras têm endereço completo no SAP? Podemos guardar a coordenada (latitude/longitude) da obra?
- O cliente deve ver "técnico a caminho" no portal?

**Opções**
- **Etapa 1 (sem app):**
  - posição no **início e no fim da OS**, com prova de presença na obra;
  - mapa com as OS do dia;
  - rota sugerida para o técnico abrir no Google Maps ou Waze.
- **Etapa 2 (com app):** posição a cada X minutos no expediente, mapa ao vivo da equipe e "técnico a caminho" no portal.

**Gravação no SAP**
- **OS** (`@SPS_LOS`): `U_LatIni`, `U_LonIni`, `U_LatFim`, `U_LonFim` e a distância até a obra.
- **Endereço do cliente** (endereços do parceiro de negócio nativo, CRD1): `U_SPS_Lat`, `U_SPS_Lon`.
- **Posições contínuas** (etapa 2): **fora do B1**, no banco do Áster. É muito volume para tabelas de usuário, e o histórico é apagado no prazo definido pela LGPD.

---

## Estruturas novas no SAP (se tudo for aprovado)

| Tipo | Nome | Para quê |
|---|---|---|
| Anexo nativo | `Attachments2` | Fotos de movimentação, leitura, OS, chamado e documentos do veículo |
| Objeto de usuário | `SPSLAPO` | Apontamento de horas do operador |
| Objeto de usuário | `SPSLDOC` | Obrigações dos veículos (licenciamento, IPVA, seguro…) |
| Tabela de usuário | `@SPS_LOPE` | Operadores (ligados ao cadastro de funcionários) |
| Tabela de usuário | `@SPS_LFAJ` | Ajustes e abonos de faturamento (trilha) |
| Tabela de usuário | `@SPS_LCAL` | Calendário de licenciamento por UF e final de placa |
| Campos de usuário | `@SPS_LMOV`, `@SPS_LMED`, `@SPS_LCT1`, `@SPS_LCTR`, `@SPS_LFAT`, `@SPS_LOS` | Anexos, conferência de leitura, mão de obra, liberação, GPS |
| Campos em objetos nativos | Saída de mercadorias, pedido de compra, nota de entrada (`U_SPS_OsEntry`); endereços do parceiro (`U_SPS_Lat`/`U_SPS_Lon`) | Custo da oficina por OS; coordenadas das obras |
| Cadastro nativo | Centros de custo (dimensão "Equipamento") | Custo de manutenção por equipamento na contabilidade |

Tudo entra no instalador do Áster (Integração SAP B1 › Prontidão), que cria só o que falta, pela Service Layer.

## Sugestão de pauta para a próxima reunião com a Macromaq

1. **Mão de obra:** como cobram hoje, contrato junto ou separado, nota de serviço separada (levar a dúvida fiscal ao contador deles).
2. **Faturamento:** quais contratos passam por conferência, quem libera e a alçada de abono.
3. **Leituras:** quem lança, quando, e se há conferência.
4. **Licenciamento:** lista de obrigações, UFs e como lançam as despesas no SAP.
5. **Portal financeiro:** qual add-on de boleto e de NF-e.
6. **Oficina:** estoque de peças no SAP, terceiros, centro de custo por equipamento.
7. **Geolocalização:** política de LGPD, app ou não, serviço de mapas.

**Pode começar já** (independe das decisões): fotos nas movimentações (1) e a estrutura de conferência e liberação do faturamento (4), deixando as regras configuráveis.
