# Áster Rental — especificação técnica (SAP Business One + Áster)

Este documento descreve o app `locacao/locacao.html`.

## 1. Decisões

| Tema | Decisão |
|---|---|
| Plataforma | Add-on do **SAP Business One**. Os dados de locação ficam no próprio B1, em UDTs e UDOs. |
| Segmentos | **Máquinas e equipamentos** (horímetro) e **veículos** (hodômetro, placa, condutor, multas). |
| Fiscal e financeiro | **NF e boleto são emitidos no B1**. O app gera o documento de venda (rascunho de NF, pedido ou NF) e o B1 faz o resto. |
| Front-end | Página HTML única publicada no **Áster**, a plataforma web da SPS. |
| Integração | **Service Layer** do B1 (REST/OData), chamada direto do navegador. |

## 2. Arquitetura

```
Navegador ── Áster (hospeda locacao.html)
    │
    └── fetch /b1s/v1/... ──► Service Layer ──► SAP B1 (HANA/SQL)
                               UDOs SPSLATV, SPSLCTR, SPSLMOV
                               UDTs @SPS_LMED, @SPS_LFAT, @SPS_LMUL, @SPS_LCFG
                               Drafts / Orders / Invoices (com U_SPS_CtrEntry, U_SPS_Comp)
```

- O login usa o usuário e a senha do próprio B1 (`POST /Login`). A sessão fica no cookie `B1SESSION`, e a senha não é gravada.
- O app guarda no navegador só a URL, o banco e o usuário, para facilitar o próximo login.

### Conexão do navegador com a Service Layer (obrigatório resolver na implantação)

A página roda no domínio do Áster e a Service Layer roda em outro host. Há duas opções:

1. **Proxy reverso (recomendado).** Publicar a Service Layer sob o mesmo domínio do Áster, por exemplo
   `https://aster.sps.com.br/b1s/v1` → `https://servidor-b1:50000/b1s/v1`, com nginx, IIS ARR ou o próprio
   backend do Áster. No login, a URL fica `/b1s/v1`. Isso evita CORS e problemas de cookie de terceiros.
2. **CORS direto.** Habilitar no `b1s.conf` da Service Layer: `"CorsEnable": true` e
   `"CorsAllowedOrigins": "https://<domínio do Áster>"`. O cookie da sessão precisa de `SameSite=None; Secure`,
   e alguns navegadores bloqueiam cookies de terceiros. Por isso essa opção é menos robusta.

Se o login falhar com "Failed to fetch", a causa é quase sempre uma dessas duas configurações.

## 3. Objetos criados no B1

A aba **Configuração › Instalar estruturas** cria tudo pela Service Layer, usando `UserTablesMD`,
`UserFieldsMD` e `UserObjectsMD`. O processo pode ser repetido: o que já existe é ignorado. Rode com um
superusuário e, depois, saia e entre de novo.

| Tabela | Tipo | Objeto (UDO) | Uso |
|---|---|---|---|
| `@SPS_LATV` | Dados mestre | `SPSLATV` | Ativos: máquinas, equipamentos e veículos |
| `@SPS_LCTR` / `@SPS_LCT1` | Documento + linhas | `SPSLCTR` | Contratos e itens locados |
| `@SPS_LMOV` | Documento | `SPSLMOV` | Saída, devolução e substituição, com checklist e assinatura |
| `@SPS_LMED` | Sem objeto | — | Medições de horímetro/hodômetro por competência |
| `@SPS_LFAT` | Sem objeto | — | Controle de faturamento (contrato + competência), que também serve de trava |
| `@SPS_LMUL` | Sem objeto | — | Multas de trânsito |
| `@SPS_LCFG` | Sem objeto | — | Parâmetros do app |
| `OINV` (docs de marketing) | UDF | — | `U_SPS_CtrEntry` e `U_SPS_Comp` ligam o documento ao contrato |

A lista completa de campos está na constante `SCHEMA` de `locacao.html`.

## 4. Fluxo operacional

```
Ativo (Disponível)
  → Contrato (Rascunho → Ativo)      ativo aparece como "Reservado"
  → Saída (checklist + assinatura)   ativo "Locado", item com data de saída
  → Medições mensais                 uso = leitura atual − última leitura
  → Faturamento da competência       documento no B1 → NF/boleto no B1
  → Devolução / Substituição         medição final automática; ativo volta "Disponível" ou vai p/ "Manutenção"
  → Encerramento do contrato
```

## 5. Regras de faturamento

- **Período cobrado de cada item:** da data de saída até a **véspera da devolução** (mínimo de 1 dia),
  limitado à competência e à vigência do contrato. Assim, numa substituição, o dia da troca é cobrado só uma vez.
- **Cobrança mensal:** valor mensal × (dias no período ÷ dias do mês).
- **Cobrança diária:** valor da diária × dias.
- **Excedente:** uso medido na competência − franquia. A franquia é proporcional aos dias, a menos que o
  parâmetro diga o contrário. O excedente é multiplicado pelo valor por h/km e sai numa linha separada,
  com o mesmo item de faturamento.
- **Multas** com status "A repassar" entram como linha do *Item para repasse de multa*.
- **Documento gerado** (parâmetro): rascunho de NF de saída (`Drafts`, `DocObjectCode=oInvoices`, que é o padrão),
  pedido de venda (`Orders`) ou NF de saída (`Invoices`). Vão no documento:
  - a filial do contrato (`BPL_IDAssignedToInvoice`);
  - a utilização (`Usage`), se configurada;
  - o texto de cada linha em `FreeText`.
- **Sem faturamento duplicado:** antes de criar o documento, o app grava `@SPS_LFAT` com
  `Code = <DocEntry do contrato>-<AAAAMM>`. Como a chave é única, um segundo faturamento da mesma competência é
  recusado pelo próprio B1, mesmo com dois usuários ao mesmo tempo. Se a criação do documento falhar, o registro
  vira "Cancelado". Para refaturar depois de cancelar o documento no B1, use **Liberar refaturamento**.

## 6. Publicação no Áster

1. Rodar **Instalar estruturas** uma vez por banco, com o modo SAP B1 e um superusuário.
2. Configurar o proxy reverso ou o CORS (seção 2).
3. Cadastrar no B1 os itens de serviço de locação e o item de repasse de multa, e informá-los em **Configuração**.
4. Subir `locacao/locacao.html` no Áster. O arquivo não depende de nenhum outro: CSS e JS vão embutidos e não há bibliotecas externas.
5. Para treinar ou demonstrar, use o modo **Demonstração** no login. Ele simula a Service Layer com dados fictícios guardados no navegador.

## 7. Limitações conhecidas desta versão

- As operações de movimentação fazem várias chamadas em sequência (movimento → contrato → ativo), sem
  transação única. Próximo passo: usar `$batch` com *changeset* da Service Layer.
- Todos os registros são carregados na entrada. Isso atende bem algumas centenas de ativos e contratos.
  Com volumes maiores, trocar por consultas paginadas e filtradas (`$filter`) ou por `SQLQueries`.
- Fotos do checklist ainda não estão implementadas. Próximo passo: `Attachments2`. A assinatura é gravada como imagem PNG em campo memo.
- Ainda não há reajuste automático por índice, ordens de serviço de manutenção, portal do cliente nem
  propostas comerciais. Ver o roadmap em `02-estrutura-inicial.md`.
- Permissões são as do usuário B1 logado. Ainda não há perfis próprios do app.
