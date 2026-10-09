# Estrutura inicial — sistema de gestão para locadoras (referência: LOC1)

Proposta de ponto de partida a partir da pesquisa em `01-pesquisa-loc1.md`.
Nada aqui está decidido. As decisões em aberto estão na seção 6.

## 1. Visão do produto

Um ERP vertical para locadoras (máquinas e equipamentos, veículos, eletrônicos) e para empresas
com **contratos recorrentes ou por medição**. Ele controla o ciclo completo do ativo:

```
Proposta → Contrato → Reserva/Disponibilidade → Saída (checklist) → Em uso
   → Medição/Consumo → Faturamento → Devolução/Substituição (checklist)
   → Manutenção → Disponível
```

## 2. Módulos (MVP → fases)

| # | Módulo | Equivalente LOC1 | Fase |
|---|---|---|---|
| 1 | Cadastros: clientes, ativos (patrimônio/série), categorias, tabelas de preço, acessórios | ERP core | MVP |
| 2 | Comercial: propostas em PDF, funil, atividades | CRM | MVP |
| 3 | Contratos: locação, comodato, serviço, manutenção; vigência, renovação, reajuste, pacotes | Gestão Avançada de Contratos | MVP |
| 4 | Disponibilidade e movimentação: saída, devolução, substituição, agregados, avarias | Controle de parque | MVP |
| 5 | Faturamento automático: regras por contrato, pró-rata, excedentes, lote, medição | Automação de Faturamento | MVP |
| 6 | Integração fiscal e financeira: NFS-e, boleto, contas a receber, contabilização | via SAP B1 | MVP (integração) |
| 7 | Manutenção: planos preventivos, OS corretiva, custos por ativo | Controle de Manutenção | Fase 2 |
| 8 | App de campo: checklists de entrada/saída/substituição, fotos, assinatura, picking, offline | Operações em Campo | Fase 2 |
| 9 | Frota: condutor, multas (identificação e repasse), despesas, GPS/telemetria | Gestão de Frota | Fase 2 |
| 10 | Portal do cliente: chamados, contratos, 2ª via de boleto, medições | Portal de Chamados | Fase 3 |
| 11 | Workflow e aprovações (descontos, contratos, compras) | Workflow para SAP | Fase 3 |
| 12 | BI: disponibilidade, ocupação, rentabilidade por ativo/contrato/cliente, faturamento | Painéis | Fase 3 |

## 3. Modelo de dados (entidades principais)

```
Cliente ─< Contrato ─< ItemContrato >─ Ativo ─< Movimentacao
                │            │            │
                │            └─< Medicao  ├─< OrdemServico ─< Checklist
                │                         ├─< Despesa / Multa
                └─< Faturamento ─< ItemFatura   └── Categoria ── TabelaPreco
Proposta ─> Contrato
Chamado (Cliente, Ativo, Contrato) ─> OrdemServico
```

Regras de cobrança no `ItemContrato`: periodicidade (diária, semanal, mensal), franquia
(horas/km), valor do excedente, pró-rata, dia de corte, índice de reajuste e unidade faturadora.

## 4. Arquitetura sugerida

Há dois caminhos. A escolha depende da decisão 6.1.

**A) Add-on sobre o SAP Business One (modelo LOC1)**
- O SAP B1 é o backend fiscal, financeiro e contábil. A lógica de locação fica em UDOs/UDTs ou
  num serviço próprio que conversa pela **Service Layer** (REST).
- Web app próprio (portal, app de campo, painéis) consumindo a Service Layer e uma API intermediária.
- Vantagem: reaproveita o know-how SAP e a base de clientes B1. Desvantagem: depende da licença B1.

**B) SaaS independente, com conectores**
- Backend próprio (ex.: Node/NestJS ou .NET + PostgreSQL), front web (React/Next) e app mobile
  (React Native/Flutter, com modo offline para checklists).
- Fiscal por API de terceiros (NFS-e/boleto: ex. PlugNotas, Focus NFe, Asaas, Iugu).
- Conector opcional para o SAP B1 e para outros ERPs.

**Comum aos dois**: motor de faturamento como serviço isolado (job agendado e idempotente),
armazenamento de fotos e assinaturas (S3), autenticação multi-empresa e multi-filial, e trilha
de auditoria.

## 5. Próximos passos

1. Assistir à playlist e aos vídeos do YouTube (links em `01-pesquisa-loc1.md`, seção 6) e anotar
   as telas e os fluxos.
2. Pedir uma demonstração à LOC1 ou a um parceiro para confirmar os itens da seção 8 da pesquisa.
3. Decidir os itens da seção 6 abaixo.
4. Detalhar o MVP: user stories dos módulos 1 a 6 e protótipo das telas de contrato, disponibilidade e faturamento.
5. Usar o Book de Levantamento (`index.html`) como catálogo para mapear processos e GAPs
   de locação, criando um módulo "Locação" no modelo-mestre.

## 6. Decisões tomadas

1. **Plataforma:** add-on do SAP Business One (opção A), com integração pela **Service Layer**.
2. **Segmentos:** máquinas e equipamentos **e** veículos, desde a primeira versão.
3. **Fiscal:** NF e boleto ficam no B1. O sistema só gera o documento de venda.
4. **Front-end:** páginas HTML publicadas no **Áster**, a plataforma web da SPS.

A primeira versão está em `locacao/locacao.html`, e a especificação técnica em `03-especificacao-b1.md`.
