# Pós-venda no Áster Rental — pesquisa de referência (Auvo)

> Material de referência de escopo. O Auvo é produto de terceiros: **não copiar telas, textos, nomes de módulos nem marca**.
> As funcionalidades abaixo foram reescritas para a realidade de uma locadora integrada ao SAP B1.

## 1. Fontes e limites da pesquisa

O site do Auvo (auvo.com, ajuda.auvo.com.br) está bloqueado na rede deste ambiente. A pesquisa usou
buscadores, que devolvem trechos das próprias páginas do fabricante, da central de ajuda e de sites de avaliação.
Itens marcados com **(confirmar)** apareceram só em material de marketing antigo e devem ser validados numa
demonstração comercial antes de virar requisito.

| Fonte | O que confirmou |
|---|---|
| auvo.com/app-de-campo, /ordem-servico-digital | OS no celular, check-in/check-out, fotos, assinatura do cliente |
| auvo.com/equipamentos, /software-assistencia-tecnica | Ficha do equipamento com QR Code, histórico de OS, orçamento aprovado na visita |
| auvo.com/auvodesk, /modulo-central-do-cliente | Chamados (tickets) com prazo de SLA, portal do cliente, abertura por QR Code |
| ajuda.auvo.com.br (cadastrar ticket, abrir tarefa pelo ticket) | Ticket criado internamente, pela página do cliente ou por e-mail; botão para gerar tarefa a partir do ticket |
| ajuda.auvo.com.br (tipos de tarefa, questionários) | Tipo de tarefa com questionário e exigências (foto, assinatura) para concluir |
| auvo.com/pesquisa-de-satisfacao, ajuda (mensurar satisfação) | Pesquisa enviada por e-mail ao concluir o serviço, automática ou manual, relatório exportável |
| blog.auvo.com (módulos, PMOC), /despesas, /modulo-financeiro | Plano de manutenção por equipamento gera tarefas recorrentes; despesas com comprovante; fatura a partir da OS **(confirmar)** |
| Capterra, GetApp, B2B Stack, Mobile Time (2018) | Pontos fracos citados: sem API no helpdesk, sem app do cliente, sincronização do app, pouca comunicação com o cliente (WhatsApp) |

## 2. Mapa funcional da referência

| Área | Funcionalidade observada | Relevância para locadora |
|---|---|---|
| Atendimento | Chamados com etapas, responsável, SLA, interações, anexos, status em lote | **Alta** — cliente liga com máquina parada |
| Atendimento | Portal do cliente / página de solicitação / e-mail / QR Code no equipamento | **Alta** — abrir chamado sem ligar |
| Campo | Ordem de serviço com tipo, questionário, fotos, assinatura, check-in/out | **Alta** — manutenção na obra do cliente |
| Campo | Agenda da equipe, prioridade, distribuição por técnico/equipe | **Alta** |
| Campo | GPS, rota, check-in automático por geolocalização | Média — exige app nativo |
| Equipamentos | Ficha + QR Code + histórico de todas as OS | **Alta** — a frota é o ativo da locadora |
| Preventiva | Plano por equipamento gerando tarefas na frequência | **Alta** — horímetro já existe no Áster |
| Comercial | Orçamento aprovado pelo cliente antes do reparo | **Alta** — avaria causada pelo cliente |
| Qualidade | Pesquisa de satisfação automática ao concluir | **Alta** |
| Financeiro | Fatura a partir da OS, despesas, estoque de peças | Média — NF e estoque ficam no SAP B1 |

## 3. O que entrou no Áster Rental (protótipo)

Novo grupo de menu **Pós-venda**:

| Tela | O que faz | Ligação com o que já existia |
|---|---|---|
| **Chamados** | Cliente, contrato, equipamento, tipo (parado, manutenção, dúvida, reclamação, troca, retirada), origem, prioridade. SLA de primeira resposta e de solução calculado pela prioridade (parâmetros). Linha do tempo com notas internas e respostas ao cliente. Gera OS. | Contrato e ativo do Áster; "equipamento parado" eleva a prioridade |
| **Ordens de serviço** | Tipos: corretiva, preventiva, entrega técnica, vistoria, reparo de avaria. Técnico, agenda, check-in/out, horímetro, checklist por tipo, peças e serviços (cobrável ou não), fotos, laudo, assinatura. Orçamento com aprovação do cliente antes do reparo. Ao concluir: atualiza horímetro, fecha o chamado, gera rascunho de NF no SAP B1 com o que for cobrável e dispara a pesquisa. | **Equipamento parado no cliente abre "dias fora"**, que o faturamento já desconta da mensalidade |
| **Agenda** | Semana por técnico, com as OS agendadas e as sem data | — |
| **Preventivas** | Planos por família (a cada X horas/km e/ou Y dias, com checklist). Calcula vencidas e próximas com base na leitura atual e na última preventiva concluída. Gera a OS preventiva. | Usa as **leituras** e o horímetro que o Áster já registra |
| **Satisfação** | NPS (0–10), comentários, por técnico e por período. Link de resposta público por token, sem login. | Envio automático ao concluir OS/chamado (parâmetro) |
| **Técnicos e planos** | Cadastro de técnicos (ligados ao usuário do Áster) e dos planos preventivos | Perfil novo "Técnico" vê só as próprias OS |

Adaptações em telas existentes:

* **Ativos** — botão *Histórico*: linha do tempo do equipamento (contratos, movimentações, chamados, OS, leituras).
* **Movimentação** — na devolução/substituição com item "Não OK" ou avaria, opção *Abrir OS de reparo* já ligada ao contrato e ao cliente (base para cobrar a avaria).
* **Painel** — indicadores de pós-venda: chamados abertos, SLA estourado, OS do dia, preventivas vencidas, NPS dos últimos 90 dias.
* **Administração** — parâmetros de SLA por prioridade, item de serviço do SAP B1, checklists por tipo de OS, envio automático da pesquisa. Perfis novos: *Atendimento* e *Técnico*.

## 4. Onde o Áster vai além da referência (diferenciais para locadora)

1. **Parada desconta da mensalidade automaticamente** — o tempo do chamado de equipamento parado até a conclusão da OS vira "dias fora" no contrato.
2. **Avaria da devolução vira OS de reparo e cobrança** no mesmo fluxo, com orçamento aprovado e rascunho de NF no SAP B1.
3. **Preventiva pelo horímetro real da locação**, não só por calendário.
4. Tudo gravado no SAP B1 (UDOs), sem base paralela.

## 5. Estruturas novas no SAP B1 (SCHEMA_VERSION 3)

| Objeto | Tipo | Conteúdo |
|---|---|---|
| `SPSLCHA` / `@SPS_LCHA` + `@SPS_LCH1` | UDO documento + linhas | Chamado e interações |
| `SPSLOS` / `@SPS_LOS` + `@SPS_LOS1` | UDO documento + linhas | Ordem de serviço e peças/serviços |
| `@SPS_LTEC` | UDT | Técnicos |
| `@SPS_LPLN` | UDT | Planos de manutenção preventiva por família |
| `@SPS_LPES` | UDT | Pesquisas de satisfação (token, nota, comentário) |
| `OINV.U_SPS_OsEntry` | UDF | OS que originou o documento de venda |

## 6. Próximo projeto (fora do protótipo)

| Item | Observação |
|---|---|
| Portal do cliente | Abrir e acompanhar chamados, ver OS e aprovar orçamento pelo link; abertura por QR Code colado no equipamento |
| App do técnico offline | PWA com fila local, fotos em tamanho real (SAP B1 Attachments2), GPS no check-in |
| Canais | E-mail de entrada vira chamado; WhatsApp (ponto fraco citado da referência) |
| SLA em horário comercial | Hoje o prazo corre em horas corridas; calendário e feriados por filial |
| Peças | Baixa de estoque no SAP B1 (saída de mercadoria) e custo da OS por equipamento |
| Despesas do técnico | Pedágio, combustível, com comprovante |
| Contrato de manutenção | Serviço recorrente para equipamento do cliente (não locado), com cobrança mensal |
| Validação | Demonstração comercial da referência para os itens **(confirmar)**; checar contrato/NDA antes de usar material de terceiros |
