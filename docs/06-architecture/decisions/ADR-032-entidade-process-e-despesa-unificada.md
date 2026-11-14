# ADR-032 — Entidade `Process` (módulo próprio `processes`) e Despesa unificada (origem prestador ou família)

**Estado:** **Proposto — aguarda aprovação do proprietário** (change control **D28**, proposto em 2026-11-14). As quatro **decisões de direção** abaixo foram tomadas pelo proprietário em 2026-11-14 (registadas em `00-product/process-flows.md` §10.1); o **desenho, a migração e as emendas a regras aprovadas** são propostas e só entram em vigor com aprovação. **Supera parcialmente ADR-021** (apenas o pedido de reembolso, `ReimbursementClaim`) **se aprovado**; adenda a ADR-025/ADR-030. Nenhum contrato (`openapi.yaml`), `schema.md`, `entities.md`, `modules.md` §3 ou código foi alterado por este ADR.

> **Estado (atualizado 2026-11-14, fonte: ordem do proprietário): ACEITE COM ÂMBITO DE CONSTRUÇÃO LIMITADO.** O proprietário ordenou "pode avançar para construção" (marco B, `11-implementation/marco-b-construcao.md`). A aceitação cobre **só** o que a construção das fatias 0–6 do marco B exige; tudo o que está listado como pendente neste ADR e em `marco-b-construcao.md` §1 **continua Proposto/não aceite** e aplica-se o **default conservador** aí documentado. Onde o texto abaixo diz "Proposto", lê-se "aceite dentro deste âmbito".
> Âmbito aceite: módulo `processes`, `Process` universal, `family_status` derivado, prazos 24–120 h (48 h) e recurso 15 dias/72 h, só no necessário às fatias 0–6. **Não aceite (marco C):** Despesa unificada, migração do `ReimbursementClaim`, nova redação de BR-INS-05, fase "contrair", ligação a registos de clínica sem ids Vita (BR-CLN-24), salvaguardas de recurso (§11a).

## Contexto
O fluxo entre apps (`00-product/process-flows.md`) exige um identificador único e uma vista única por ato (marcar, cobrir, autorizar, atender, faturar). Hoje existem entidades separadas sem ligação (`Appointment`/`ClinicVisit`, `AuthorizationRequest`, `Encounter`, `ExpenseClaim` e `ReimbursementClaim`, esta última implementada, ADR-021). Dois caminhos de despesa paralelos (despesa do prestador S5 e reembolso fora da rede) duplicariam estados, filas, regras de duplicados e dashboard; o proprietário quer uma fila única. A Q-P1 já decidiu a existência de uma entidade `Process`; ficavam em aberto o módulo dono, o prestador sem seguradora e a unificação da despesa.

## Decisão (direção DECIDIDA 2026-11-14; desenho Proposto)
1. **Módulo dono:** módulo **próprio `processes`** (não dentro de `insurance`/`insurer-ops`). Referencia os restantes módulos **só por id** e **agrega o estado** (`family_status` derivado, sem máquina própria; `process-flows.md` §13). Fronteiras propostas (a levar a `modules.md` §3 após aprovação): `processes` **não importa** módulos de domínio; recebe os factos de estado por **portas definidas na sua `application`** (p. ex. `ProcessFacts`: estado resumido de marcação, autorização, atendimento e despesa por `processId`), **implementadas pelos módulos donos** e ligadas em `main/api.ts` (mesmo padrão das notas 20/23/27); os módulos donos chamam uma porta `ProcessLinker` (definida em cada módulo, implementada por `processes`) para abrir/ligar um `Process`, por id. Sem aresta `processes` → `insurer-ops`/`clinic-*`/saúde. Teste de arquitetura equivalente ao das notas 23/27.
2. **Prestador sem seguradora:** **sim, todo o ato tem `Process`**, com ou sem seguradora (`insurer_id`/`policy_id` NULL); **histórico único para a família**. Sem seguradora, o `Process` liga marcação, atendimento e (se existirem) recibos/relatórios/laudos (ADR-026/027), nunca autorização/despesa. Resolve a D12 de `process-flows.md`.
3. **Despesa unificada:** **uma única Despesa** com `origin` = `PROVIDER` (despesa do prestador, faturação direta, S5) ou `FAMILY` (reembolso fora da rede, hoje `ReimbursementClaim`), **mesmos estados** (`SUBMITTED → IN_REVIEW → APPROVED | REJECTED | RETURNED → PAID`, mapeamento para os estados propostos em `state-machines.md`) e **fila única** na seguradora (`CLAIMS_MANAGER`). Quem regista `PAID` é a seguradora (Q-F1); no `origin=PROVIDER` o prestador confirma a receção. O Vita não paga.
4. **Limites dos prazos (valores DECIDIDOS):** decisão de autorização: **mínimo 24 h, máximo 120 h, 48 h por omissão** (configurável por seguradora e serviço dentro destes limites; Q-S1b); **recurso** pode ser pedido até **15 dias após a recusa** e é **respondido em 72 h** (prazos de BR-AUT-08, a fixar como regras; as restantes salvaguardas de recurso de §11a continuam por decidir). A urgência mantém 48 h (Q-U1, não configurável).

## Alternativas rejeitadas
| Alternativa | Porque não |
|---|---|
| `Process` dentro de `insurance`/`insurer-ops` | Prestador sem seguradora também tem `Process` (decisão 2); acopla o histórico da família a um módulo da seguradora; viola o isolamento (dados da seguradora nunca de saúde/agenda). |
| `processId` só derivado do atendimento | Não cobre marcação sem atendimento nem autorização prévia (Q-P1). |
| Manter `ReimbursementClaim` e Despesa separados com vista única só na UI | Duplica estados, duplicados (BR-SEG-12), filas e dashboard; `PAID` com regras diferentes (titular vs seguradora). |
| `Process` com máquina de estados própria escrita pela UI | Duplicaria estados; mantém-se derivado. |
| Prestador sem seguradora sem `Process` | Histórico da família fragmentado; dois modelos de "ato". |

## Consequências
- **Histórico único** e vista única; `family_status` simples para a família; a seguradora vê processos com autorização/despesa do seu tenant, **sem** a marcação (D9).
- Novo módulo, nova tabela e FKs `process_id` nullable nas tabelas dos módulos donos (acoplamento só ao nível de dados; sem FK composta por `insurer_id` para `processes`, que é transversal: o isolamento por seguradora continua a ser garantido nas tabelas `insurer_*`).
- A despesa unificada obriga a migrar `ReimbursementClaim` e o seu contrato (portal da seguradora e família).
- Quem marca `PAID` muda (titular → seguradora): **revê BR-INS-05**.

## Migração do `ReimbursementClaim` (proposta; nada escrito; números a atribuir após `0034`)
Estratégia expand → backfill → fachada → contract, reversível até ao último passo:
1. **Expandir:** criar `processes` (+ enums) e a tabela de despesa unificada do marco C (nome proposto: manter `insurer_expense_claims`, acrescentando `origin expense_origin NN` (`PROVIDER`/`FAMILY`), `policy_id` NULL (origem família), `submitted_by` (FK `users`, origem família) e `submitted_by_clinic_account_id` (origem prestador); `provider_id`/`encounter_id` NULLable para `origin=FAMILY`; `total` ≡ `amount`; linhas (`insurer_expense_lines`) opcionais em `origin=FAMILY`). Anexos e recibos: `reimbursement_claim_documents` e `reimbursement_claim_receipts` migram para as tabelas de anexos/recibos da despesa (mesma regra BR-CLN-36: recibo não anexado a outra despesa ativa).
2. **Backfill:** cada `reimbursement_claims` vira uma despesa `origin=FAMILY` **com o mesmo `id`** (para preservar ligações, auditoria e URLs) e um `Process` `kind=OUT_OF_NETWORK` (`family_status` derivado); mapeamento de estados `SUBMITTED→SUBMITTED`, `APPROVED→APPROVED`, `REJECTED→REJECTED` (motivo mantido), `PAID→PAID`; `decided_*` e moeda copiados (BR-INS moeda por seguradora, ADR-025/Q1). Verificação por contagem e soma de `amount` por `insurer_id`/estado antes e depois.
3. **Fachada de compatibilidade:** as rotas `/families/{f}/members/{m}/insurance/claims*` e `/insurance-portal/claims*` (ADR-021) passam a ler/escrever a despesa unificada filtrando `origin=FAMILY`, sem alterar o contrato visível durante uma versão (`/api/v1`); depois, rotas unificadas por `origin`.
4. **Contrair:** após um ciclo de release sem leituras da tabela antiga, remover `reimbursement_claims` e tabelas de associação (migração própria; só então irreversível). Até lá, backup antes do backfill (`deployment.md`).
Fase A não tem despesas S4/S5 pelo que só o `reimbursement_claims` existente tem dados reais a migrar.

## Impactos propostos (nada alterado)
- **Módulos (`modules.md` §3):** novo módulo `processes`; `insurance` perde `ReimbursementClaim` para a despesa unificada (dona: `insurer-ops` ou o módulo de despesas do marco C, a decidir com ADR-016); portas `ProcessFacts`/`ProcessLinker`; testes de arquitetura.
- **Contratos (`openapi.yaml`/`endpoints.md`):** `GET /families/{f}/members/{m}/processes*` (família), vista do prestador e da seguradora; despesa com `origin`; rotas de reembolso mantidas como fachada. Recurso: campos de prazo.
- **Schema (`schema.md`, `entities.md`):** `processes`, `process_id` nullable nas tabelas ligadas, `expense_origin`; mapeamento de `family_status` em `state-machines.md`. Registos de clínica sem ids Vita (BR-CLN-24) só por tabela-ponte do lado Vita (a rever antes de migrar).
- **Permissões (`authorization.md`):** leitura de `Process` por vínculo (família `SELF`/`TUTOR_OF` conforme categoria, prestador os seus, seguradora só o seu tenant sem agenda); `PAID` só pela seguradora (papel financeiro, `FINANCE_MANAGER`); papel `SUPERVISOR` (§8.2c, pendente). Isolamento 404 sem enumeração.
- **Regras:** BR-INS-05 (ver abaixo), BR-AUT-08 (prazos de recurso), BR-SEG-12 (duplicados em ambas as origens), BR-DSP-07; `BR-SEG-10` (exceção urgência, já proposta em §11a).
- **Auditoria:** `process.*` e `expense.*` (origem no `metadata`), catálogo de `audit.md` por atualizar.

## Como fica ADR-021 (parcialmente superado) e BR-INS-05
- ADR-021 mantém-se em vigor para: cartão de apólice (`InsurancePolicy`), portal da seguradora e `InsuranceAccount`. **Superado apenas** o pedido de reembolso autónomo (`ReimbursementClaim`) como entidade separada e a regra de `PAID` marcado pelo titular.
- **BR-INS-05 (proposta de nova redação):** "Estados da despesa de origem família: `SUBMITTED → IN_REVIEW → APPROVED | REJECTED | RETURNED → PAID`. `REJECTED` exige motivo. **`PAID` é registado pela seguradora**; o titular/tutor não o marca; o Vita só regista e não paga (Q-F1)." Texto atual (`business-rules.md` l.261) intocado até aprovação.

## Riscos
- Migração de dados reais (reembolsos existentes) e das tabelas de recibos/anexos: mitigar com `id` preservado, fachada e verificação de somas.
- Acoplamento do novo módulo por FKs em muitas tabelas: mitigar com colunas NULLable, sem FK composta, e ligação por portas.
- Quebra de contrato para o frontend durante a transição: mitigar com a fachada.
- Mudança de quem marca `PAID` sem consentimento do utilizador habituado ao fluxo atual: comunicar; testes TC-INS a rever.
- Dependências abertas: C2, C9 (medição por `processId`), parecer jurídico (`process-flows.md` §10.2).

## Pendências para o proprietário
Aprovar o ADR (módulo `processes`, `Process` universal, despesa unificada, migração e nova redação de BR-INS-05); confirmar o nome/dono da tabela de despesa unificada; confirmar os prazos (24/120/48 h; recurso 15 dias/72 h) e as restantes salvaguardas de recurso (§11a); decidir o momento da fase "contrair".

## Atualização 2026-11-14 (decisões do proprietário após parecer de revisor independente)
Histórico acima mantido. Decidido:
- **Módulo `processes` próprio, com tabela própria** (a vista derivada sugerida pelo revisor foi rejeitada). Salvaguardas incorporadas: `deriveFamilyStatus(facts)` função pura com tabela de verdade testada; os módulos de origem publicam factos pequenos e estáveis ("ato avançou: fase, quando"), sem acoplamento bidirecional amplo.
- **A migração do `ReimbursementClaim` para a Despesa unificada (origin PROVIDER|FAMILY) sobe do marco C para o B** (fatia 2b: expand, backfill, fachada, contrair; testes de contagens e somas; "contrair" só após verificação e autorização). Origem FAMILY aceita no mínimo "valor + anexos"; tipo de despesa, NIF, motivo e linhas são opcionais ou preenchidos pela seguradora; a família nunca escolhe I/P/C/EAD/T/E/PO/M/SD. **Pré-requisito:** corrigir a moeda por defeito (EUR vs AOA), com única fonte = moeda da seguradora. Nova redação de BR-INS-05 entra no contrato da fatia 2b.
- Núcleo da despesa: `SUBMITTED → IN_REVIEW → APPROVED | REJECTED | RETURNED → PAID`; `validada` = flag `autoChecked`.
- Estados simplificados e requisitos de engenharia (`evaluateCoverage`, `AutoApprovalRule[]`, `service_kind`, `insurer_policy_settings`, `channel`): ver `11-implementation/marco-b-construcao.md` §6–§7.
- **Riscos novos:** migração de dados reais antecipada (somas/contagens, moeda, anexos de recibos, fachada); contrato do marco B maior; dois fluxos de despesa em transição; mitigação = fatia própria, passos reversíveis, cópia de dados reais para ensaio.

## Atualização 2026-11-14 (contrato da fatia 1 — `Process` mínimo)
Contrato escrito por `vita-architect` (`openapi.yaml`, `endpoints.md`, `schema.md` §4b, `entities.md`, `modules.md` nota 29, `authorization.md` §6.8, `audit.md`, `business-rules.md` §16 BR-PRC-01..11, `state-machines.md`, `test-cases.md` §8c, `acceptance-criteria.md`, `03-use-cases/processes.md`, migração proposta `0036`). Decisões de desenho tomadas **por defeito** (a confirmar pelo proprietário; qualquer uma muda só o ponto indicado):
1. **Modelo pull para o estado:** `processes` não guarda cópia do estado do ato; lê o facto `ActFact { source, phase, scheduledAt?, changedAt }` pela porta `ProcessFacts` (definida em `processes/application`, implementada por `appointments` e `examinations`). Evita deriva entre cópias; custo: o filtro `status` da lista é aplicado depois da derivação (varrimento em lotes, máx. 200 por pedido) — aceitável pelo volume por membro. Alternativa rejeitada: factos empurrados e persistidos em `processes` (cópia a reconciliar).
2. **`ProcessLinker` só para abrir/apagar** (`open`/`discard`), definida em cada módulo dono (sem partilha por import) e implementada por `processes`; o dono guarda `process_id` na sua linha (`appointments`, `examinations`). `processes` é o único módulo que não é importado por nenhum outro (só `main/`).
3. **Âncora do processo:** `origin_type`+`origin_id` (UNIQUE) — consulta ou exame. Um processo iniciado por autorização antes de haver marcação (Q-P1) exigirá, na fatia 3, tornar a origem opcional ou acrescentar `AUTHORIZATION` a `process_origin_type`; **risco registado**, não resolvido aqui.
4. **Rotas por membro** (`/families/{f}/members/{m}/processes*`), não `GET /processes/{id}` solto (conventions §3.4: repositórios exigem família). Substitui o rascunho de `marco-b-construcao.md` §4 fatia 1.
5. **Autorização por categoria da origem** (APPOINTMENTS/EXAMS), sem ação nova em `access`; detalhe não legível ⇒ 404.
6. **Estado visível:** `NO_SHOW` mostra-se "Cancelado" com `nextStep=RESCHEDULE` (família); `PENDING` (pedido à clínica sem resposta) mostra-se "Marcado" com `AWAIT_CLINIC_RESPONSE`.
7. **Backfill de todos os atos anteriores** (substitui "marcações antigas ficam sem processo" de `process-flows.md` §13) e `NOT NULL` só mais tarde.
8. **Clínica:** `GET /clinic-portal/processes/{id}` mínimo, só Admin/Gestor; o Médico fica de fora na fatia 1 (o filtro por profissional não existe em `processes`).
Fatias 2–6 e fronteira com este contrato: ver `marco-b-construcao.md` §4 (Fatia 1, "Contrato fechado").

## Atualização 2026-11-14 (fatia 1 implementada, commit aefe606)
Implementação confirmada contra o código; alinhamentos de contrato (decisões do proprietário, seguir o recomendado):
- **Query inválida em `GET …/processes` = `400 MALFORMED_REQUEST`** (convenção da plataforma: parâmetros de pedido validados pelo validador do contrato e traduzidos pelo `error-middleware`), não `422 VALIDATION_ERROR`. `openapi.yaml`, `endpoints.md`, `errors.md` e TC-PRC-15 corrigidos.
- **`ProcessLinker.open/discard` ganham o campo `by`** (ator de auditoria: `actorType`, `actorUserId?`, `actorClinicAccountId?`, `requestId`, `ip?`, `userAgent?`), para que `PROCESS_OPEN/DISCARD` fiquem atribuídos ao ator real sem `processes` importar módulos donos.
- **`ProcessFacts.getActFacts` devolve entradas `{originType, originId, fact}`** (e não `ActFact[]` solto), para correlacionar sem ambiguidade; atos inexistentes são omitidos.
- `modules.md` §3 (linhas de `processes`, `appointments`, `examinations`) e nota 29 passam de "declarativo" a **implementado**.

## Atualização 2026-11-14 (contrato da fatia 3 — ADR-034; resolve o risco 3 da atualização da fatia 1)
- **Processo aberto por autorização, sem marcação:** `process_origin_type` ganha `AUTHORIZATION` (`originId` = primeiro pedido da cadeia) e `process_kind` ganha `AUTHORIZED` (`ADD VALUE`); o pedido pode, em alternativa, ligar-se ao `Process` do ato por `processId`. `ProcessLinker.open` (definida em `insurer-ops`) mantém a assinatura com `by`; acrescenta-se `findForClinic` (leitura) para validar o `processId`.
- **Estado de cobertura por porta:** `ProcessFacts.getCoverageFacts(trx, familyId, processIds[])`, implementada por `insurer-ops`; `deriveFamilyStatus({act?, coverage?})` mantém-se pura; `nextStep.actor=INSURER`, códigos `AWAIT_INSURER_DECISION|AWAIT_CLINIC_INFORMATION|COVERAGE_NOT_APPROVED`, `dueAt?`. 1 `Process` : N pedidos.
- **BR-PRC-07:** apagar o ato apaga o `Process` e deixa `process_id = NULL` no pedido (o pedido mantém-se na seguradora; antes ficava a questão em aberto «um processo com autorização não se apaga com o ato»: **decidido por defeito** a favor do direito de apagar da família, PROPOSTO).
- Leitura da família de processos `AUTHORIZATION` por `MANAGE_INSURANCE` (§8.5), sem categoria de dados de saúde. Detalhe e alternativas em ADR-034.
