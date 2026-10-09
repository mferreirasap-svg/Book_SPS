# Macromaq: matriz de aderência da importação

Base: *Macromaq – Mapeamento Necessidade Importação v1* e *Mapeamento Uso do AddOn Importação v1*.
Para cada necessidade, a tabela compara a situação no **add-on SPS Módulo Importação (SAP B1)** com o **Controle de Importação** (`importacao.html`).

Legenda: ✅ atende · 🟡 atende em parte / com ressalva · ❌ não atende · 📄 assunto comercial ou contratual

| # | Necessidade | Add-on SAP B1 | Controle de Importação (web) | Como funciona / ressalva |
|---|---|---|---|---|
| 1.1a | Condições de pagamento por fornecedor (10/90, 30/70, 20% ADV-80%) | 🟡 campo de condição | ✅ | Cadastro *Condições de pagamento*: cada parcela tem um %, um evento (pedido, produção pronta, embarque, chegada) e um prazo em dias. O fornecedor tem uma condição padrão, e o pedido gera as parcelas sozinho. |
| 1.1b | Ao criar o pedido, o financeiro já vê valores e datas previstas | ❌ | ✅ | As parcelas aparecem em *Financeiro → Parcelas* e no *Fluxo de caixa* com vencimento previsto. |
| 1.1c | Antecipar o vencimento do saldo se a produção ficar pronta antes | ❌ (documento criado já baixado) | ✅ | O vencimento é recalculado pelo evento: ao informar a data real de "pronto", o saldo antecipa sozinho. Também dá para fixar uma data manual e voltar ao automático (↺). |
| 1.1d | SinoSure: vários documentos de saldo | ❌ | ✅ | O botão **dividir** quebra uma parcela em duas. O botão **por embarque** gera um documento de saldo para cada embarque parcial, proporcional ao valor embarcado. |
| 1.1e | Mostrar no pedido e no embarque o que foi pago | 🟡 | ✅ | O pedido mostra % pago e quanto falta. O embarque, na aba *Numerário & pagamentos*, lista as parcelas dos pedidos vinculados. |
| 1.1f | Numerário: solicitar, pagar e prestar contas | 🟡 lançamento manual | ✅ | Numerário sugerido = tributos + Siscomex + despesas pagas via despachante. A prestação de contas mostra o saldo a devolver ou a complementar. |
| 1.1g | Cálculo automático de despesas e impostos ao iniciar o embarque | ❌ | ✅ | *Tabela de despesas* parametrizada: valor fixo, % do valor aduaneiro, % do frete, valor por container, tabela de armazenagem do recinto ou demurrage. As despesas entram automaticamente conforme o modal. Calcula II, IPI, PIS, COFINS, ICMS (por dentro, com redução de base), Siscomex e AFRMM. |
| 1.1h | Armazenagem por períodos (Período 1, Período 2…) | ❌ | ✅ | Cadastro *Recintos*: 1º período (dias, % do VA, mínimo) e períodos seguintes. Projeta da chegada até a entrega. |
| 1.1i | Relatório de despesas a pagar e fluxo de caixa (antecipação 10%, saldo 90%, numerário) | ❌ | ✅ | *Financeiro → Fluxo de caixa*, por mês e por filial, com CSV. |
| 1.1j | Despesas extras / outras taxas enviadas ao financeiro | 🟡 | ✅ | Cada despesa tem previsto × realizado, favorecido, documento, vencimento e status (*Em aberto → Enviada ao financeiro → Paga*). Aparece em *Despesas a pagar* e no fluxo de caixa. |
| 1.1k | Relatórios do que foi pago e do que está pendente; detectar inconsistências | 🟡 | ✅ | Relatórios de parcelas, despesas e numerários. Alertas avisam: parcelas que não somam o total do pedido, divergência PI × CI × DUIMP/DI, taxa da DI não informada e séries incompletas. |
| 1.2a | Rateio, incluindo custos de canal vermelho | 🟡 | ✅ | Cada despesa escolhe o tratamento (compõe o VA, despesa aduaneira na base do ICMS ou custo) e o critério de rateio (valor, peso ou quantidade). "Custos de canal vermelho" já vem cadastrado. |
| 1.2b | Atualização automática das alíquotas de NCM | ❌ (nem o SAP faz) | 🟡 | Importa a tabela de NCM em CSV (`ncm;descricao;ii;ipi;pis;cofins`) e atualiza as existentes. **Não busca a TEC/TIPI sozinho**: precisa de um arquivo do despachante ou de um serviço de conteúdo tributário. Deixar isso claro para o cliente. |
| 1.2c | NF de entrada a partir do XML da DI/DUIMP ou do pedido/embarque | ❌ | 🟡 | O **Espelho da NF de entrada** sai do embarque, com valor aduaneiro, II, IPI, PIS, COFINS, despesas aduaneiras, base e valor do ICMS e nº de série, e exporta CSV. **Não lê o XML da DUIMP** e não emite a NF: a emissão continua no SAP/localização. |
| 1.2d | Tratamento tributário por unidade / regime | ❌ | ✅ | Cadastro *Filiais*: UF, regime, alíquota e redução de base do ICMS, e créditos de IPI, PIS/COFINS e ICMS. Afeta o custo líquido. O tipo de importação (própria, conta e ordem, encomenda) fica registrado. |
| 1.3a | Descrição variável do produto (torre, bateria, carregador) | ❌ (usa o cadastro do item) | ✅ | O produto tem atributos variáveis, e o item do pedido monta a descrição: "Empilhadeira elétrica 2,5 t – Torre 4,7 m, Bateria 80/302, Carregador X". |
| 1.3b | Controle de número de série | ❌ | ✅ | Os números de série são informados por item embarcado. Há alerta se faltar série em produto que controla série; a série sai no espelho da NF e na busca. |
| 2 | PCP: em produção, pronto, embarcado; com cores; atrelado ao pagamento | ❌ | ✅ | Tela *Produção (PCP)* com semáforo: atrasado, pronto em até N dias, pronto aguardando embarque. Mostra o % pago do pedido e quanto falta. Daqui se cria o embarque com os itens selecionados. |
| 5 | Pedidos parciais: vários embarques por pedido (o add-on faz só 1 para 1) | ❌ | ✅ | É N:N: um pedido pode ir em vários embarques e um embarque pode juntar vários pedidos. Controla alocado, embarcado e saldo por item, e não deixa embarcar acima do saldo. |
| 6 | Câmbio: contratos, fechamentos, protocolos, PI × CI × DI, taxas | 🟡 consolidador | ✅ | Cadastro de contratos de câmbio (vinculado e saldo). Mostra taxa contratada × taxa da DUIMP/DI (variação cambial) e a conferência PI × CI × DUIMP/DI. Registra o protocolo de registro. |
| 7 | Alertas de demurrage com cores e prioridade | ❌ | ✅ | Free time, diária por container e data de devolução. Gera alerta crítico e custo estimado. As cores aparecem no painel, nas listas e no kanban. |
| 8 | API / integração com o agente de carga | ❌ | 🟡 | Importa um CSV de status do agente (`referência;evento;data`), que atualiza ETA, ETD e etapas. **Uma API de verdade exige backend** (próxima fase). |
| 9 | KPIs personalizados | ❌ | ✅ | *Parâmetros → KPIs*: escolhe a métrica (lead time, trânsito, aduana, % canal verde, fator, demurrage, valores) e filtros (status, modal, filial, fornecedor, período). Aparecem no painel. |
| 10 | Status e campos personalizados | ❌ | ✅ | *Situações* com cor (viram colunas do kanban) e *campos personalizados* (texto, número, data, lista) em pedido e embarque. Entram no construtor de relatórios. |
| 12 | Relatórios personalizados e kanban personalizável | ❌ | ✅ | *Construtor de relatórios* (embarques, itens, produção, parcelas, despesas): escolhe colunas e filtro, salva o modelo e exporta CSV/Excel. Kanban por etapa ou por situação, com arrastar e soltar. |
| 12b | Dados controlados: numerário, PI, CI, DI, protocolo, SN | 🟡 | ✅ | Todos são campos do pedido ou do embarque, com busca. |
| 13 | Follow-up: grupo de pessoas por status | ❌ | ✅ | Matriz etapa × pessoas. Ao registrar uma etapa, oferece "Notificar grupo" (e-mail já preenchido). O botão "✉ follow-up" fica no embarque. **O envio é feito pelo cliente de e-mail do usuário**, não automático. |
| 3 | Centralização de documentos | 🟡 | 🟡 | Checklist de documentos por etapa e links para o repositório (SharePoint/Drive). **Não guarda os arquivos** em si. |
| 4 | Sem limite de usuários | 📄 | 🟡 | O protótipo roda no navegador, com um usuário por máquina e backup em JSON. **Uso multiusuário exige backend** (ex.: Supabase, como no Book). No SAP B1 cada usuário precisa de licença nominal: resposta comercial. |
| 11 | SLA de suporte | 📄 | — | Assunto de contrato. |
| 14 | Vínculo Skill × Invent | ❌ | — | Assunto de integração SAP/localização. O CSV do espelho da NF serve de base para a carga. |

## Erros do add-on encontrados no uso (para o time de desenvolvimento do add-on)

| ID | Gravidade | Problema | Observação |
|---|---|---|---|
| ADD-01 | Crítica | "Gerar Lançamento" com balanço fechado gera LCM duplicado a cada clique | Bloquear o botão / validar se o LCM já existe |
| ADD-02 | Crítica | Consolidador de impostos duplica linhas (2 × 35.000 = 70.000) | Janela "Pedido de compra – **dividido**": provavelmente lê o pedido original e a parte dividida |
| ADD-03 | Crítica | Consolidador com PTAX 0,00 e II calculado sobre USD 35.000 (4.900 = 14%) | Indica imposto calculado sem converter para reais; confirmar |
| ADD-04 | Crítica | Adiantamento não calcula pelo % informado | Câmbio pago / saldo ficam 0,00 |
| ADD-05 | Alta | Tela de pagamento mostra NF da aba despesas ainda em aberto | |
| ADD-06 | Média | Erro genérico se faltar a data de lançamento no Adto Despachante | Trocar por uma validação com mensagem clara |
| ADD-07 | Média | Oferta de compra criada pelo módulo não traz o PN | |
| ADD-08 | Baixa | Campos sobrepostos (%Adto), layout perdido, problema com fonte 9 | |

## O que falta para produção

1. **Backend multiusuário** (Supabase: login, perfis, dados compartilhados e trilha de auditoria), seguindo o padrão do Book.
2. **Leitura do XML da DUIMP** para preencher taxa, valores e tributos realizados.
3. **API / webhook** para o agente de carga e **e-mail automático** de follow-up (hoje é por mailto).
4. **Integração com o SAP B1** (pedido, NF de entrada e lançamentos), se o controle for continuar fora do add-on.
