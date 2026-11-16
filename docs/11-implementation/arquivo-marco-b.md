# Arquivo do marco B (seguradoras e autorizações) — plano de remoção do `main`

> Estado: **ACEITE (decisão do proprietário, 2026-11-16; ADR-037 §12).** Substitui a abordagem do «interruptor» (`INSURANCE_FEATURES_ENABLED`), que **não existe e não será criado**. Este documento é a lista verificável do que **sai** e do que **fica**; **R1–R7 FEITOS** (web, alertas, processos, ligações, módulos `insurance`/`insurer-ops`, contrato e docs ativos); **R8 (migração de limpeza `0042`) e R9 (auditoria final) PENDENTES**. Não é parecer jurídico.

## 1. Arquivo (já feito, fora do `main`)
- Ramo `archive/marco-b-seguradoras` e tag `archive-marco-b-2026-11-16`, ambos no commit **`b6ff812`** (último estado do `main` com o marco B completo: Fase A, fatias 1–5, contratos e testes). Recuperação: `git checkout archive-marco-b-2026-11-16`.
- Retoma futura = change control + ADR novo + reaplicar a partir do arquivo (não há código adormecido no `main`).
- Os ADR-021, 023 (parte seguradora), 025, 029–036 ficam como **histórico** (estado «ARQUIVADO»), nunca apagados.

## 2. O que SAI do `main` (critério: serve a seguradora, a autorização, o reembolso ou a cobertura)

### 2.1 API (`apps/api`)
| Peça | Remover |
|---|---|
| Módulo `insurer-ops` | Pasta inteira (empresas, beneficiários, importações, ligações cartão↔paciente, planos/coberturas/serviços, prestadores, `service_kind`, política, autorizações, auto-aprovação, SLA, `getCoverageFacts`, `listExpiringApprovals`, workers `insurer.*`); `tests/architecture-rules.ts` e snapshots do módulo |
| Módulo `insurance` | Pasta inteira: identidade da seguradora (contas/sessões `insurance_*`, JWT `iid`/`isid`, cookie `insurance_refresh_token`, `insuranceBearerAuth`), `admin/insurers*`, `/insurance-portal/*`, **apólices** e **pedidos de reembolso** (Fase A/4b), `GET /families/{f}/insurers` |
| `platform/actor` | `getInsuranceActor` e o terceiro `AsyncLocalStorage` (só se nada mais o usar) |
| `main/api.ts`, `main/worker.ts`, `main/attachment-files.ts` | Composição e montagem dos routers/middleware/security handlers de seguradora, `createInsurerOpsModule`/`createInsuranceModule`/`createInsurerOpsWorkerModule`, `registerWorkers`, `attachment-files.ts` |
| `clinics` | `partnerClinicDirectory` (porta de `insurer-ops`) e o que só servia `insurer_providers` |
| `clinic-receipts` | `ClinicReceiptLookup`/`claim-lookup.ts`, `attachedClaims`/`claimIdsByReceipts` (associação recibo↔reembolso) |
| `appointments`, `clinic-reports`, `clinic-patients`, `examinations` | Só ligações à cobertura/elegibilidade/seguradora (grep `insur`, `coverage`, `authoriz` por módulo); `processId` **fica** |
| `processes` | `Process.coverage`/`ProcessCoverage`, `derive-coverage-view`, `getCoverageFacts`, ramos `COVERAGE_*` de `nextStep`, categorias/ações de seguro em `readable-categories` |
| `alerts` / `notifications` | `raise-authorization-event`, os cinco `AUTHORIZATION_*` (regras, destinatários `MANAGE_INSURANCE`, `authorizationExpiringRules`), o ramo do scanner e a porta `insurerOps` |
| `documents` | `resourceType=INSURANCE_POLICY`, `listAttachable` para reembolsos, anexos de autorização |
| `access`/`audit` | Ação `MANAGE_INSURANCE`; **tipos de evento de auditoria `INSURANCE_*`/`CLAIM_*`/`INSURER_*`/`AUTHORIZATION_*` ficam no enum** (histórico de `audit_logs`), mas deixam de ser emitidos |

### 2.2 Rotas e jobs
- Rotas: `/admin/insurers*`; `/insurance-portal/*` (~53 operações: auth, agents, claims, companies, beneficiaries, imports, link-requests, policies, plans, services, catalog-types, service-kinds, policy-settings, partner-clinics, providers, authorizations*); `/clinic-portal/insurers*`; `/clinic-portal/authorizations*`; `/families/{f}/insurers`; `/families/{f}/members/{m}/insurance-policies*` (incl. `reimbursement-claims*`); `/families/{f}/members/{m}/insurance/{card-claims,cards}*`.
- Jobs `pg-boss`: todos os `insurer.*` (expirar pedidos de informação, SLA, etc.) e o ramo `AUTHORIZATION_*` do scanner de alertas. Verificação: o `worker` arranca sem registar nenhum `insurer.*`.

### 2.3 Web (`apps/web`)
- Páginas: `pages/insurance/**` (login, agentes, reembolsos, `ops/*`, `authorizations/*`); `pages/clinic/authorizations/**` e `pages/clinic/insurers/**`.
- Navegação e rotas: entrada «Seguradoras» em `clinicNav.ts`, rotas/guards/paths de seguradora (`router.tsx`, `guards.tsx`, `paths.ts`), `InsuranceShell`, `InsuranceAuthContext`, `insuranceApiClient`, `PortalSidebar`/`AdminShell` (itens de seguradoras).
- Vistas da família: `InsuranceCardsSection` (cartões, cobertura), vista de cobertura/«autorização» em processos, cartões `AUTHORIZATION_*` em `AlertCard`, apólices/reembolsos.
- Serviços/tipos: `insurance*.service.ts`, `insurerOps`, `insurerAuthorizations`, `clinicAuthorizations`, `clinicInsurers`, `insuranceCard`, `partners` (parte de seguradoras) e `types/{insurance,insurerOps,insurerAuthorizations,insuranceCard}`; `lib/insurerFormat`, `coverageLabels`.
- Mocks e testes: `mocks/handlers/insurance*.ts`, dados/`db.ts` de seguradora, `routes/{insuranceCards,insurerOps,insurerAuthorizations,clinicAuthorizations}.flows.test.tsx` e as partes de seguradora de `flows.test.tsx`, `processes.flows.test.tsx`, `publicSite.flows.test.tsx`; textos de seguradora no site público.

### 2.4 Contrato (`docs/05-api/openapi.yaml`, `endpoints.md`, `errors.md`)
**FEITO (R6, 2026-11-16): removidas 100 operações em 78 caminhos (contagem exata; as «~78» eram o número de caminhos) e 113 schemas (`openapi.yaml`: 312 → 212 operações; 308 → 195 schemas).** Removido: os caminhos de §2.2; tags `Insurance` e `Insurance Portal`; `securitySchemes.insuranceBearerAuth`; schemas de seguradora, apólice, reembolso, beneficiário, plano, serviço, `service_kind`, política, autorização, anexos, métricas; `Process.coverage`/`ProcessCoverage` e `nextStep` `COVERAGE_*`; `AlertType` `AUTHORIZATION_*`; `DocumentResourceType` `INSURANCE_POLICY`; códigos de erro exclusivos (não existiam: nenhum código do catálogo era exclusivo). **Exceção decidida no R6:** os cinco `AUTHORIZATION_*` de `AlertType` **mantêm-se** no contrato como «legado inerte» (o código ainda os tipa/traduz para ler alertas históricos); `ProcessActPhase` mantém-se (usado por `ClinicProcess.phase` e pelo teste de contrato). `processId` em consulta/exame fica. `pnpm gen` regenera `src/generated` e os tipos do web; os testes de contrato têm de passar.

### 2.5 Docs ativos — **FEITO (R7, 2026-11-16)**: movidos para `docs/_arquivo/marco-b/` (índice em `_arquivo/marco-b/README.md`; secções retiradas de docs ativos em `_arquivo/marco-b/extratos/`).
Mover para `docs/_arquivo/marco-b/` (com cabeçalho «ARQUIVADO; ver tag `archive-marco-b-2026-11-16`»): `03-use-cases/{insurance,insurer-operations}.md`, `insurer-module/`, `11-implementation/{insurer-phase-a,marco-b-construcao}.md`, `00-product/{business-model,real-flow-research}.md` (partes de seguradora; `digital-card.md` e `process-flows.md` idem se só tratarem de seguradora), secções BR-INS/BR-SEG (`business-rules.md`), UC-SEG, AC e TC de seguradora, entidades/estados/relacionamentos/`schema.md` de seguradora (as tabelas ficam descritas numa secção única «Tabelas inertes», §3), `authorization.md` (atores/ações de seguradora), `audit.md`, `privacy.md`, `modules.md` (módulos `insurance`/`insurer-ops`, notas 23/31–33), `alerts.md` (`AUTHORIZATION_*`). ADRs ficam no lugar (histórico).

## 3. O que FICA (e porquê)
| Peça | Decisão |
|---|---|
| **Migrações já aplicadas (`0024`, `0025`, `0030` parte reembolso, `0033`–`0037`, `0039`–`0041`)** | **Nunca se editam nem se apagam do repositório** (o `migrate-runner` e ambientes existentes dependem delas). Nota: não existe `0038` (lacuna de numeração, já presente). Todas as tabelas de seguradora (`insurers`, `insurer_*`, `insurance_*`, `reimbursement_*`, `guide_types`, `expense_types`, `policy_setting_definitions`, `insurer_authorization*`, `insurer_attachments`) **ficam inertes**: sem código que as leia/escreva |
| Migração de limpeza (`0042_drop_insurer_marco_b.sql`) | **FEITA (R8): o proprietário confirmou que não há dados reais.** Descrição original: nova migração forward-only que faz `DROP` das tabelas inertes e do `documents.insurance_policy_id`/`reimbursement_claim_receipts`, sem tocar nas anteriores; valores de enum (`audit_event`, `alert_type`, `document_resource_type`, `actor_type`) **não se removem** (o Postgres não o permite sem recriar o tipo; ficam inertes). Se houver dados: ficam inertes e entram na AIPD (retenção/apagamento; ver risco abaixo) |
| Risco das tabelas inertes | As FKs para `family_members` são `CASCADE`/`SET NULL` (verificado em `0025`, `0033`, `0039`): apagar membros/famílias continua a funcionar e o apagamento dos dados inertes acompanha-o. Não há dados novos a entrar. Os documentos de cartão de apólice (`documents`) mantêm-se sob o ciclo de vida normal |
| Módulo `processes` | **Fica** como **episódio de cuidado** (UC-PRC, 4 estados simples, `originType` incl. `BOOKING` no MK3), **sem coverage**: sai só o que está em §2.1. Migração `0036` fica (não referencia seguradoras; `0039` é que referencia `processes`) |
| `clinics`, portal da clínica (agenda, pacientes, recibos, relatório, pedido de exame, consentimento), `appointments`, `examinations`, `prescriptions` | **Ficam**, sem as ligações de §2.1 |
| `clinic-receipts` método de pagamento `INSURANCE` (enum em `0030`) | **Fica** como etiqueta de recibo (texto/enum), sem qualquer operação |
| **Seguro pessoal registado pela família** | **Critério de manutenção:** mantém-se (como dado de saúde/registo do utilizador) **só se** não depender de entidade `Insurer`, de ator seguradora, de portal, de pedido de reembolso, de código de cartão/cobertura nem de ação de operação. A implementação atual (`insurance_policies` com FK a seguradora parceira e a `reimbursement_claims`) **não cumpre** o critério e sai com o módulo `insurance`. Um «seguro pessoal» simples (seguradora em **texto livre**, nº de apólice, validade, foto do cartão como documento) é **backlog**: entra só com contrato novo (change control), por exemplo em `health-records`, sem MK0 |
| `access` | Ação `MANAGE_INSURANCE` sai (nenhum módulo a usa); resto inalterado |
| `audit_logs` histórico | Fica; o enum não encolhe |

## 4. Ordem de remoção (passos pequenos; cada passo termina com `pnpm gen && lint && test && build` verdes e `make test`; um commit/PR por passo, revisão do `vita-architect` contra este documento)
| # | Passo | Dono | Verificação específica |
|---|---|---|---|
| R0 | **Docs:** este plano, ADR-037 aceite, README/roadmap/plan (feito neste change) | `vita-architect` | Revisão do proprietário |
| R1 ✔ | **Web:** remover páginas, rotas, nav, contextos, serviços, tipos, mocks e testes de seguradora (§2.3); a app compila sem chamar rotas de seguradora | frontend — **sem agente atribuído; proposta: `vita-marketplace`** (lacuna 1) | `grep -ri "insur\|authoriz\|coverage" apps/web/src` só devolve texto não relacionado (revisto à mão); testes do web verdes |
| R2 ✔ | **Alertas/notificações:** retirar `AUTHORIZATION_*`, `raise-authorization-event`, ramo do scanner e porta `insurerOps` de `alerts` | `vita-alerts` | Scanner e testes verdes; `grep AUTHORIZATION_` só em migrações e enums |
| R3 ✔ | **Processos:** retirar `coverage`, `getCoverageFacts`, `COVERAGE_*` e categorias de seguro; ajustar DTO/matriz de leitura | `vita-health` | `read-matrix` e `processes.test` verdes; `Process` sem campo `coverage` |
| R4 ✔ | **Ligações a clinics/clinic-receipts/appointments/clinic-reports/clinic-patients/documents/access:** remover portas e adaptadores de seguradora (§2.1); `documents` deixa de aceitar `INSURANCE_POLICY` | `vita-health` (appointments/examinations/reports/clinics), `vita-documents` (documents), `vita-family` (access/clinic-patients) | Testes de cada módulo; `tests/architecture.test.ts` verde |
| R5 ✔ | **Remover `insurer-ops` e `insurance`** (um só passo: dependem entre si por portas) + `main/api.ts`, `main/worker.ts`, `attachment-files.ts`, `platform/actor`, `tests/architecture-rules.ts` | `vita-platform` (com `vita-identity` para a identidade da seguradora) | Arranque da API e do worker sem rotas/jobs de seguradora (teste de arranque + `GET` a rota removida = `404`); arquitetura verde |
| R6 ✔ | **Contrato (feito 2026-11-16):** remover operações/schemas/tags/segurança de seguradora de `openapi.yaml`, `endpoints.md`, `errors.md`; `pnpm gen` | `vita-architect` (contrato) + `vita-platform` (gen) | `pnpm gen` sem diferenças residuais; validação do OpenAPI e testes de contrato verdes |
| R7 ✔ | **Docs (feito 2026-11-16):** mover docs ativos para `docs/_arquivo/marco-b/`, atualizar `README.md`, `modules.md`, `schema.md` («Tabelas inertes»), `authorization.md`, estado dos ADR-021/025/029–036 («ARQUIVADO») | `vita-architect` | `grep` de `insurer`/`BR-SEG` fora de `_arquivo`/ADR/histórico = 0 |
| R8 ✔ | **Migração de limpeza `0042_drop_insurer_marco_b.sql` (feito 2026-11-16, proprietário: sem dados reais; testada em Postgres 16 descartável; tabelas, colunas de `documents`/`audit_logs` e enums próprios removidos; valores de enums partilhados ficam; `AuditAction` sem os valores de seguradora)** | `vita-platform` + `vita-qa-security` | `migrate-runner.test`, `db/verify`, aplicar em cópia da BD; sem editar migrações anteriores |
| R9 | **Auditoria final:** `grep` em `apps/` e `docs/`; revisão de privacidade das tabelas inertes; atualizar a AIPD | `vita-qa-security` + `vita-architect` | Relatório de divergências vazio |

Regras do plano: nenhum passo mistura remoção com funcionalidade nova; as migrações do mercado (MK1+) numeram-se a partir da `0043` (R8 feito: a `0042` é a limpeza); MK0 só começa depois de R1–R6 (R7 pode correr em paralelo).

## 5. Perguntas ao proprietário
1. *(Respondida: não há dados reais; R8 feito.)* Há **dados reais** (seguradoras, apólices, reembolsos, beneficiários, autorizações) em algum ambiente (VPS/produção)? Se **não**, autoriza a migração de limpeza `0042` (DROP das tabelas inertes)? Se **sim**, mantêm-se inertes e queres prazo de apagamento?
2. O «seguro pessoal» simples (texto livre + foto do cartão, sem operação de seguradora) entra já no MVP/MK0 ou fica em backlog (default: backlog)?
3. Aprovas `vita-marketplace` como dono também do frontend do mercado e deste passo R1, ou prefere um agente `vita-web` separado?

## 6. Lacunas
Não há agente atribuído ao frontend (`apps/web`); a lista de §2.1 em módulos transversais (`appointments`, `clinic-*`, `examinations`) vem de `grep` e tem de ser confirmada passo a passo; o número exato de operações do OpenAPI (~78) deve ser contado no R6; fora de `apps/api` e `apps/web` (por exemplo `deploy/`, variáveis de ambiente, `docs/10-operations`) não foi pesquisada a referência a seguradoras (`INSURANCE_*` não existe em `platform/config`). **R6/R7:** o grep final de `insurer`/`BR-SEG` fora de `_arquivo`/ADR/histórico não é zero por menções declarativas do arquivo (README, `plan.md`, `scope.md`, `roadmap.md`, `marketplace-profissionais.md`, este documento), etiquetas `INSURANCE` do método de pagamento do recibo e referências de seção em ADR a documentos entretanto arquivados; ver relatório do R7 e R9.
