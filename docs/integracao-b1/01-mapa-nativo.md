# Áster Rental × SAP Business One — mapa de integração com as telas nativas

> Princípio (o mesmo do Comex Import Control): **usar o objeto nativo do B1 sempre que ele tiver tela e regra próprias**,
> e criar estrutura de usuário (UDO/UDT) só para o que o B1 não tem. Toda gravação é pela **Service Layer**, nunca por SQL.
> Os nomes de propriedades da Service Layer abaixo devem ser conferidos no `$metadata` da versão do cliente durante a homologação.

## 1. O que é nativo e o que é do Áster

| Conceito no Áster | Objeto no B1 | Tela nativa | Por quê |
|---|---|---|---|
| Cliente, contatos | `BusinessPartners` (OCRD) | Parceiro de negócios | Cadastro único; o Áster só lê |
| Obra / local de uso | `BPAddresses` (endereço *Entregar em*) | Parceiro › Endereços | Vai como `ShipToCode` na NF e na remessa |
| Filial | `BusinessPlaces` (OBPL) | Filiais | `BPL_IDAssignedToInvoice` nos documentos |
| Vendedor, condição, projeto | `SalesPersons`, `PaymentTermsTypes`, `Projects` | Cadastros de vendas e finanças | Comissão, vencimento e **resultado por obra** no B1 |
| Item de faturamento (locação, serviço, multa) | `Items` (OITM, item de serviço) | Cadastro do item | Imposto, conta contábil e utilização vêm do item |
| **Equipamento físico** | `Items` com **nº de série** (`SerialNumberDetails`, OSRN) + **Cartão de equipamento** (OINS) | Cadastro do item › Gerenciar por nº de série; Cartão de equipamento | Estoque, rastreio do bem e histórico de serviço nativos |
| Ficha do ativo para locação | UDO `SPSLATV` (@SPS_LATV) | — | Dados que o B1 não tem: medidor, status de locação, valores, família, placa/Renavam |
| **Contrato de locação** | UDO `SPSLCTR` (@SPS_LCTR/LCT1/LCT2) | — | Franquia, excedente, pró-rata, cobrança agrupada: o contrato de serviço nativo não cobre |
| **Remessa do bem** | `DeliveryNotes` (ODLN) com nº de série **ou** `StockTransfers` (OWTR) | Entrega / Transferência de estoque | NF de remessa (CFOP pela utilização) e saída do bem do estoque |
| **Retorno do bem** | `Returns` (ORDN) **com base na entrega** ou transferência de volta | Devolução | NF de retorno ligada à remessa (base/destino nativo) |
| **Faturamento mensal** | `Drafts` (esboço de NF) / `Orders` / `Invoices` | Nota fiscal de saída | NF-e e boleto continuam no B1 (add-on fiscal e banco do cliente) |
| Boleto | `PaymentMethod` (forma de pagamento de recebimento) | Formas de pagamento | O documento já nasce com a forma de pagamento do boleto |
| Leituras de medidor, dias fora, parcelas, multas | UDTs @SPS_LMED, @SPS_LFORA, @SPS_LFAT, @SPS_LMUL | — | Regras próprias de locação |
| **Chamado de pós-venda** | `ServiceCalls` (OSCL) — espelho | Chamada de serviço | Histórico no Cartão de equipamento, relatórios de serviço nativos |
| Conversa do chamado, SLA, parada | UDO `SPSLCHA` | — | SLA por prioridade e parada que desconta da mensalidade |
| **Agenda do técnico** | `Activities` (OCLG) ligada à chamada | Atividade / Calendário | O técnico vê a OS no calendário do B1 |
| Técnico | `EmployeesInfo` (OHEM) | Cadastro de funcionários | `TechnicianCode` da chamada e responsável da atividade |
| Ordem de serviço (checklist, peças, assinatura, orçamento) | UDO `SPSLOS` | — | Execução de campo não existe no B1 |
| Cobrança de peças/serviço | `Drafts` (esboço de NF de serviço) | Nota fiscal de saída | Utilização e série de serviço próprias |
| Planos preventivos, técnicos, pesquisas | UDTs @SPS_LPLN, @SPS_LTEC, @SPS_LPES | — | Sem equivalente nativo |
| Log de integração | UDT @SPS_LINT | — | Monitor e reprocessamento |

## 2. Fluxos que geram documentos nativos

| Evento no Áster | Documento no B1 | Campos principais | Se falhar |
|---|---|---|---|
| Entrega | `DeliveryNotes` (modo NF) ou `StockTransfers` pátio → clientes (modo transferência) | `CardCode`, `ShipToCode`, filial, série, linha com `ItemCode` do bem, `Quantity 1`, depósito do pátio, `Usage` de remessa, `UnitPrice` = valor do bem, `SerialNumbers[InternalSerialNumber]`, `U_SPS_CtrEntry`, `U_SPS_MovEntry` | Movimentação fica gravada; o envio vai ao Monitor com o erro |
| Devolução | `Returns` com `BaseType 15 / BaseEntry` da entrega (ou avulsa, se a entrega for anterior à integração) ou transferência de volta | `Usage` de retorno, mesmo nº de série | Idem |
| Substituição | Retorno do bem que sai + remessa do que entra | — | Idem |
| Faturamento da competência | `Drafts`/`Orders`/`Invoices` | `Series`, `PaymentMethod` (boleto), `PaymentGroupCode`, `SalesPersonCode`, `Project`, `ShipToCode`, filial, `Usage` por linha, `U_SPS_CtrEntry`, `U_SPS_Comp` | Parcela fica "com erro" e pode ser gerada de novo (trava por competência) |
| Chamado aberto / alterado | `ServiceCalls` | `CustomerCode`, `Subject`, `Description`, `ItemCode` + `InternalSerialNum` do bem, `Priority`, `Status` (-3 aberto, -2 pendente, -1 fechado), `CallType`, `Origin`, `ProblemType`, `TechnicianCode`, `Resolution`, `U_SPS_ChaEntry`, `U_SPS_Parado` | Monitor |
| OS agendada / reagendada / concluída | `Activities` + vínculo em `ServiceCallActivities` | `Activity cn_Task`, `ActivityType`, `ActivityDate/Time`, `Duration`, `HandledByEmployee`, `CardCode`, `Details`, `Notes`, `Closed`, `U_SPS_OsEntry` | Monitor |
| OS concluída com itens cobráveis | `Drafts` (esboço de NF de serviço) | Série e utilização de serviço, mais os campos do contrato | Aviso na tela; OS fica concluída |

O Áster é a origem das regras de locação. O B1 recebe o que tem tela própria. Uma falha no B1 **não desfaz** a operação no Áster (o equipamento foi entregue de fato). O envio fica no **Monitor de integração** com o erro e é reprocessado depois de corrigida a causa.

## 3. Estruturas criadas no B1 (versão 4)

* **UDOs:** `SPSLATV`, `SPSLREG`, `SPSLCTR`, `SPSLMOV`, `SPSLCHA`, `SPSLOS`.
* **UDTs:** famílias, leituras, dias fora, parcelas, multas, parâmetros, técnicos, planos, pesquisas e log de integração.
* **Campos de usuário em objetos nativos:**
  * `OINV`, que vale para todos os documentos de marketing (pedido, entrega, devolução, NF e esboço): `U_SPS_CtrEntry`, `U_SPS_Comp`, `U_SPS_OsEntry` e `U_SPS_MovEntry`.
  * `OWTR` (transferência de estoque): `U_SPS_CtrEntry` e `U_SPS_MovEntry`.
  * `OSCL` (chamada de serviço): `U_SPS_ChaEntry`, `U_SPS_CtrEntry` e `U_SPS_Parado`.
  * `OCLG` (atividade): `U_SPS_OsEntry`.

A tela **Configuração › Integração SAP B1 › Prontidão** compara o que o Áster precisa com o que existe no banco (só leitura) e cria o que falta. A criação usa um superusuário, de preferência sem outros usuários conectados.

## 4. De-para (Configuração › Integração SAP B1 › De-para)

Todas as listas vêm dos cadastros nativos; campo em branco usa o padrão do B1.

| Grupo | Parâmetro | Lista nativa |
|---|---|---|
| Faturamento | Filial padrão, utilização da NF de locação, série, forma de pagamento (boleto), condição e vendedor padrão, item de multa | Filiais, Utilização, Formas de pagamento, Condições, Vendedores, Itens |
| Remessa | Modo (não gerar / NF de remessa e retorno / transferência), depósito do pátio, depósito de bens em clientes, utilizações e séries de remessa e retorno | Depósitos, Utilização |
| Pós-venda | Criar chamada de serviço (sim/não), tipo, origem, problema, criar atividade (sim/não), tipo de atividade, item e utilização de serviço, série | Tipos/origens/problemas de chamada, Tipos de atividade |

No **contrato**: endereço de entrega (endereços *Entregar em* do parceiro), vendedor, condição de pagamento, projeto e filial.
No **ativo**: item do bem (controlado por nº de série), nº de série e valor do bem para a NF de remessa.
No **técnico**: funcionário do B1.

## 5. Pré-requisitos no B1 (checklist da implantação)

| # | Onde no B1 | O que configurar |
|---|---|---|
| 1 | Administração › Inicialização do sistema | Filiais (se usar), depósito do pátio e depósito "bens em clientes" (modo transferência) |
| 2 | Cadastro do item | Itens de serviço de locação por família, item de serviço técnico, item de repasse de multa |
| 3 | Cadastro do item | Um item por tipo de bem com **Gerenciar por nº de série** e criação automática do Cartão de equipamento; nº de série de cada máquina/veículo (veículo: chassi) |
| 4 | Utilização (NF) / determinação de CFOP | Locação de bens móveis, remessa em locação, retorno de locação, serviço/peças |
| 5 | Séries de numeração | Séries da NF de locação, remessa, retorno e serviço (se separadas) |
| 6 | Formas de pagamento | Forma de recebimento do boleto ligada ao banco (add-on de cobrança do cliente) |
| 7 | Parceiros de negócio | Endereços de entrega das obras; e-mail de cobrança |
| 8 | Serviço › Definições | Status, tipos, origens e problemas de chamada; tipo de atividade "Visita técnica" |
| 9 | Funcionários | Técnicos cadastrados como funcionários (função técnico) |
| 10 | Projetos (opcional) | Um projeto por obra/contrato grande, para resultado por obra |
| 11 | Usuário de integração | Usuário B1 dedicado com licença adequada e autorização nos objetos acima |

## 6. Carga inicial

* **Equipamentos:** em *Integração › Equipamentos do B1* o Áster lista os nºs de série que ainda não são ativos e cria os ativos já ligados ao item e ao nº de série. Valores, medidor e dados do veículo são completados depois em Ativos.
* **Clientes, itens e endereços** não são copiados: o Áster lê do B1 na hora.
* **Contratos em andamento:** cadastrar no Áster com a data de corte (migração). Bens entregues antes da integração não têm entrega de origem; a devolução sai avulsa, com o item e o nº de série.

## 7. Roteiro de homologação

1. Rodar *Prontidão* na base de teste do cliente e criar as estruturas.
2. Preencher o de-para; repetir a prontidão até ficar 100%.
3. Trazer 2 ou 3 equipamentos do B1; cadastrar 1 contrato com endereço de entrega.
4. Entregar: conferir a entrega/transferência no B1 (nº de série, utilização, CFOP, depósito, valor) e a NF-e no add-on fiscal.
5. Faturar a competência: conferir o esboço (série, boleto, condição, vendedor, projeto, endereço) e gerar a NF e o boleto no B1.
6. Abrir chamado e OS: conferir a chamada de serviço no Cartão de equipamento e a atividade no calendário do técnico.
7. Concluir a OS com peça cobrável: conferir o esboço de serviço.
8. Devolver: conferir a devolução ligada à entrega e o retorno do bem ao pátio.
9. Simular erro (item sem nº de série) e reprocessar pelo Monitor.

## 8. Pontos a confirmar com o cliente e o consultor fiscal

* **Valor e CFOP da NF de remessa:** a regra usada é "valor do bem" do ativo e a utilização de remessa. Validar com o contador.
* **Remessa com estoque ou só transferência:** é escolha da contabilidade da locadora (frota como estoque ou imobilizado). Se a frota for imobilizado no B1 (itens de ativo fixo), a remessa fiscal precisa de validação específica.
* **Nomes de propriedades da Service Layer:** conferir no `$metadata` da versão do cliente, principalmente em `ServiceCalls`, `Activities` (`DurationType`, `HandledByEmployee`) e `WizardPaymentMethods`.
* **Anexos:** fotos e assinatura da OS hoje ficam no registro do Áster. Próximo passo é usar `Attachments2`, os anexos nativos do B1.
* **Contrato de serviço nativo:** opcional, se o cliente quiser os prazos de SLA calculados pelo próprio B1.
