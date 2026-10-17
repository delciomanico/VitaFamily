# ADR-022 — Resumo de tendências com IA em relatórios (exceção estrita a BR-RPT-03)

**Estado:** Aceite — decisão **do proprietário** (2026-10-17, change control), depois de ser avisado
explicitamente de que reverte uma regra fundacional (`BR-RPT-03`, prompt §19) e a frase do objetivo do
MVP (`scope.md` §1: "...sem qualquer diagnóstico") e a lista `[OUT]` de IA (`scope.md` §3). Confirmou que
quer avançar, com os limites abaixo — o nível **mais conservador** das opções discutidas (rejeitou a opção
intermédia de a IA sugerir "quando procurar um médico").

## Contexto

O proprietário pediu "relatórios inteligentes com análise de IA para insights" sobre os dados que a
família já introduziu (séries de exames, adesão à medicação). Isto não é um relatório que passou a
interpretar — é uma funcionalidade nova, deliberadamente isolada do resto de `reports` (UC-RPT-01/02/03),
porque muda duas decisões fundacionais:

1. **BR-RPT-03** ("Relatórios não contêm interpretação clínica") deixa de ser absoluta; passa a ter uma
   exceção única, estrita e identificada.
2. O objetivo do MVP (`scope.md` §1) e a lista `[OUT]` ("IA/chatbot médico... análise médica avançada",
   `scope.md` §3) deixam de excluir toda a IA — só esta funcionalidade, com o âmbito definido abaixo, entra;
   diagnóstico e IA médica geral continuam de fora.

Decidiu-se registar isto por ADR (em vez de só mexer em `business-rules.md`) porque a mudança tem
consequências que atravessam várias áreas da documentação (produto, segurança/RGPD, autorização,
auditoria) e porque introduz, pela primeira vez no projeto, o envio de dados de saúde a um subcontratante
fora da VPS.

## Decisão

| Tema | Escolha |
|---|---|
| Nome da funcionalidade | **"Resumo com IA"** (reaproveita o vocabulário já usado em `reports.md` — UC-RPT-03 já se chama "Resumo de adesão à medicação"; evita introduzir "relatório inteligente" como segundo termo para a mesma ideia). Estende o módulo `reports` existente (M9); **não é um módulo novo**. |
| Limite do conteúdo (não negociável) | A IA só **contextualiza tendências nos dados que a família já tem**, em linguagem simples (ex.: "O colesterol subiu nos últimos 3 exames.", "A adesão à medicação caiu em outubro."). **Nunca**: sugestão de ação clínica, "consulte um médico", juízo sobre se um valor é normal/perigoso, ou qualquer forma de diagnóstico. É o nível mais conservador das opções discutidas — mais estrito do que "sugerir quando procurar um médico" (opção intermédia, rejeitada). |
| Aviso obrigatório | Todo resultado gerado por IA mostra sempre, de forma visível e **não dispensável**: *"Gerado por IA a partir dos seus dados; não é um conselho médico."* — e é sempre apresentado ao lado dos dados em bruto que o geraram; nunca texto de IA isolado sem a fonte visível. |
| Motor | **API de um fornecedor externo** (Anthropic ou OpenAI — escolha entre os dois fica para mais tarde, antes da implementação). Decisão consciente do proprietário: dados de saúde saem da VPS para um terceiro. Alternativa de um modelo autoalojado na VPS foi considerada e rejeitada por decisão do proprietário (custo/capacidade de correr um modelo útil para isto na VPS própria não compensa face ao ganho de privacidade nesta fase); registar como decisão revisível. |
| Minimização | Só se envia ao fornecedor a **série estruturada** necessária à tendência pedida (valores, unidades, datas de um parâmetro de exame; estatística de adesão por período) — **nunca** documentos/imagens anexados, notas de texto livre, ou o nome do membro (envia-se por referência interna/pseudónimo, nunca PII direta). |
| Consentimento | **Opt-in explícito**, desligado por omissão, por **SELF** (adulto) ou **tutor pelo dependente** — modelo de consentimento próprio, **diferente** do `SharingGrant` por categoria (D13/R5): aqui não é partilha dentro da família, é envio a um terceiro nomeado. Texto do consentimento tem de nomear o fornecedor e dizer explicitamente que os dados saem para fora da Vita Family. Vive em `privacy.md` (decisão funcional) e, do lado do código (fora do âmbito deste ADR), numa secção de definições de privacidade do utilizador. |
| Guardrails de defesa em profundidade | Além da instrução ao modelo (prompt), a resposta devolvida **tem de passar por um filtro de saída** que bloqueia frases de aconselhamento/diagnóstico antes de ser mostrada ao utilizador — não se confia só no comportamento do modelo. Requisito de implementação a cumprir no milestone que construir esta funcionalidade (ver `plan.md`); sem este filtro implementado e testado, a funcionalidade não pode ser ligada em produção. |
| Auditoria | Cada geração é registada (quem pediu, quando, que tipo de resumo) — **nunca** os dados de saúde enviados nem a resposta da IA (mesmo padrão de `audit.md` §2.2: metadata nunca contém dados de saúde). |
| Quem pode pedir | Mesma regra de "Exportar dados" (`authorization.md` §4): **SELF**; tutor pelo dependente. Decidido por ser a relação mais próxima já existente (ação sobre os próprios dados ou os do dependente, nunca de terceiros partilhados) — revisível por change control se o proprietário quiser estender a `OTHER` com partilha. |
| **Gate de lançamento (bloqueador, não negociável)** | O código desta funcionalidade pode ser construído, mas **não pode ficar ativo em produção para utilizadores reais** antes de: (a) a AIPD (`docs/README.md` §Pendências, `privacy.md` §6) cobrir explicitamente este tratamento (novo subcontratante de dados de saúde, categoria especial RGPD); e (b) existir um **DPA** (acordo de processamento de dados) assinado com o fornecedor de IA escolhido. Este gate amarra-se à pendência de AIPD já existente — não é uma pendência nova e paralela, é uma condição adicional da mesma pendência. |

### Porquê reverter BR-RPT-03 só para este caso, e não em geral

BR-RPT-03 protege a família de receber um julgamento clínico automatizado sem supervisão médica — o risco
que o prompt §19 e o objetivo do MVP (`scope.md` §1) sempre quiseram evitar. Essa proteção continua válida
para os relatórios normais (UC-RPT-01/02/03) e **por omissão** para qualquer resumo com IA que não cumpra
os limites desta decisão. A exceção aqui é estreita porque: (1) o conteúdo permitido é só descrição
estatística da tendência já visível nos números que a família introduziu, nunca uma opinião sobre o que
esses números significam clinicamente; (2) está sempre ao lado dos dados em bruto, para que o utilizador
possa verificar por si; (3) tem aviso obrigatório e não dispensável; (4) tem um filtro de saída que
bloqueia frases fora do limite, independentemente do que o modelo tenha gerado. Não se reverte a regra em
geral — cria-se uma exceção nomeada, auditável e tecnicamente demarcada.

### Porquê API externa em vez de modelo autoalojado

Um modelo autoalojado manteria os dados na VPS (sem subcontratante novo, sem DPA, sem dados de saúde a
saírem para terceiros) — a opção que protegeria melhor a privacidade. O proprietário foi informado deste
compromisso e decidiu conscientemente usar uma API externa, por ser a via mais rápida de obter qualidade
de linguagem natural aceitável sem assumir a operação de infraestrutura de IA própria. Esta decisão é
revisível: se mais tarde um modelo autoalojado se tornar viável e preferível, substitui-se o fornecedor
por um novo ADR, sem alterar o resto desta decisão (limites de conteúdo, consentimento, auditoria).

### Porquê o nível mais conservador (sem sugestão de "procurar um médico")

A opção intermédia (a IA sugerir quando procurar um médico) foi apresentada e rejeitada pelo proprietário:
mesmo uma sugestão de ação, sem diagnóstico explícito, já é uma forma de aconselhamento clínico implícito
e desloca responsabilidade para a IA numa área sensível (saúde, incluindo de menores e dependentes). O
nível escolhido — descrever a tendência nos números, nada mais — é o que fica dentro do limite que
`scope.md` §1 sempre quis proteger, mesmo com a exceção aberta por este ADR.

## Consequências

- Primeiro subcontratante de **dados de saúde** (categoria especial, RGPD) do projeto; entra explicitamente
  amarrado à AIPD pendente (`docs/README.md`, `privacy.md` §6) como pré-condição de lançamento desta
  funcionalidade especificamente — não bloqueia o resto do MVP, só esta.
- Introduz um segundo modelo de consentimento (além de `SharingGrant`), específico para envio a terceiro.
- **Já atualizado por esta revisão:** `01-requirements/business-rules.md` (BR-RPT-03 revista + BR-RPT-04..09
  novas), `00-product/scope.md` (§1, §2, §3), `00-product/roadmap.md` (nota de change control, mesmo
  critério do OCR em 2026-10-17), `08-security/privacy.md` (subcontratante, consentimento, minimização,
  gate AIPD/DPA), `08-security/authorization.md` (§4: quem pode pedir), `08-security/audit.md` (§3: nova
  ação `AI_SUMMARY_GENERATE`), `docs/README.md` (registo da decisão + reforço da pendência de AIPD),
  `11-implementation/plan.md` (novo milestone, mesmo critério de M11/ADR-021).
- **Pendências explícitas para quando a implementação arrancar** (mesmo critério do ADR-021):
  - `05-api/openapi.yaml` + `endpoints.md`: contrato do(s) endpoint(s) de pedido de resumo, schema de
    resposta (texto + aviso obrigatório + referência aos dados brutos), erros (ex.: consentimento ausente,
    fornecedor indisponível).
  - `07-database/schema.md`/`04-domain/entities.md`: tabela(s) de consentimento (separada de
    `sharing_grants`) e, se necessário, registo do resumo gerado (sem o conteúdo da resposta da IA nem os
    dados enviados — só o necessário para o mostrar de novo ao utilizador, a decidir na implementação).
  - `06-architecture/modules.md` §3: se a implementação justificar uma porta nova em `reports` (ex.
    `AiSummaryProvider`) e a dependência ao fornecedor externo — decisão de arquitetura do módulo
    (`conventions.md` §2) a registar quando a implementação arrancar (ADR-016).
  - Escolha final entre Anthropic/OpenAI e assinatura do DPA correspondente.
  - Texto exato do ecrã de consentimento (fica com o proprietário/jurista, como os restantes textos legais
    de `privacy.md` §7).
