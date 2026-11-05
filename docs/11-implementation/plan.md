# Vita Family — Plano de implementação (Fase 16)

> **ATUALIZAÇÃO 2026-10-08 (ADR-014/ADR-015, decisão do proprietário):** a implementação é em **Node.js/TypeScript** (Clean Architecture: `domain/application/infrastructure/interface`), Kysely+`pg`, pg-boss, **sem Redis**, em **VPS própria** com Caddy, domínio `vitafamily.cassfrei.com`. M0 e M1, implementados anteriormente em Go (ADR-012), foram descartados e são reescritos em Node.js/TypeScript seguindo o mesmo plano de milestones abaixo. Onde este documento diz NestJS, Prisma, Redis, BullMQ, Jest ou Go, ler o equivalente de ADR-014/ADR-015.

> Estado: **v0.1 — a pasta `11-implementation/` é uma adição à estrutura do prompt** (o prompt previa a Fase 16 mas não um local para o plano). Sem datas: capacidade e prazos são **TBD** (proprietário).
> **A Fase 17 (código) só começa com a tua aprovação explícita.**

## 1. Regras de trabalho durante a implementação
1. Documentação = fonte da verdade (prompt §29). Divergência ⇒ **parar**, identificar, decidir, atualizar docs, corrigir código.
2. Alterações de comportamento só por **change control** (prompt §23).
3. Contrato primeiro: `openapi.yaml` manda; controllers/DTOs gerados ou verificados contra ele.
4. Cada milestone entrega **fatias verticais** (BD → domínio → API → testes → docs) e termina com a sua *Definition of Done*.
5. *Simple first*: nada fora do âmbito (`scope.md`); sem infraestrutura "para o futuro".
6. Explicar cada decisão técnica relevante (prompt §26): o que, porquê, alternativas, impacto.

## 2. Definition of Done (por milestone)
- Endpoints do milestone implementados conforme `endpoints.md`/`openapi.yaml`.
- Testes: unitários + integração + API dos critérios `AC-*` ligados; matriz de autorização atualizada.
- Auditoria das ações sensíveis implementada e testada.
- Migrações versionadas; sem *drift*; constraints críticas testadas.
- Gates de CI verdes (`strategy.md` §5); sem dependências com vulnerabilidades altas.
- Documentação atualizada onde a implementação revelou ajuste (via change control).
- Revisão e demonstração ao proprietário.

## 3. Estrutura do repositório
Monorepo `apps/api` (Node.js/TypeScript) · `apps/web` (futuro) · `deploy/` · `docs/` · `Makefile` — detalhe e camadas em `docs/06-architecture/decisions/ADR-015-monorepo-clean-architecture-por-modulo.md` e `conventions.md` §1.

## 4. Milestones

| M | Nome | Conteúdo | Requisitos principais | Depende de |
|---|---|---|---|---|
| **M0** | **Fundações** | Repositório Node.js/TypeScript (pnpm workspaces), Docker Compose (pg/minio/clamav/mailhog, sem Redis), CI com gates, `platform` (config, Clock, erros problem+json, validação, paginação, logging com redação), health, teste de arquitetura (Clean Architecture), pipeline de contrato OpenAPI | NFR-OPS, NFR-QA, NFR-API | — |
| **M1** | **Auditoria + Identidade** | `audit`, `users`, `auth` (registo, verificação, login, refresh rotativo, recuperação, mudança de palavra-passe, termos B6, rate limiting, suspensão), e-mail (mailer) | FR-AUTH, BR-ACC, FR-AUD | M0 |
| **M2** | **Famílias e membros** | `families`: família, membros, dependentes, tutela, convites, limites; papéis | FR-FAM, FR-MEM, BR-FAM/MEM | M1 |
| **M3** | **Acesso e partilha** | `access`: `AccessPolicy` + matriz, partilha por categoria, testes gerados, "partilhado comigo"; guard de verificação; isolamento por FKs compostas | FR-PRIV, BR-PRV, NFR-SEC-04 | M2 |
| **M4** | **Registos de saúde** | `health-records` (alergias, condições, tipo sanguíneo) | FR-HP | M3 |
| **M5** | **Documentos** | `documents`: armazenamento, validação, quarentena, antivírus (worker), download mediado, quotas, outbox de ficheiros | FR-DOC, N4, Q10 | M3 |
| **M6** | **Medicação** | `prescriptions`, `medications`: planos, geração de ocorrências (DST), ações sobre tomas, adesão; `UNCONFIRMED` | FR-RX, FR-MED | M4, M5 |
| **M7** | **Consultas, clínicas e exames** | `appointments`, `clinics` (+ admin de parceiras), `examinations`, **`clinic-portal`** (D17/D18: `ClinicAccount`/`clinic_sessions` separados de `users`, ADR-020; `ClinicSlot`; confirmar/recusar pedidos; completar consulta com resultado + receita via `prescriptions`) | FR-APT, FR-EXM, FR-CLN | M5, M6 (receita emitida pela clínica) |
| **M8** | **Alertas e notificações** | `alerts` (scanner, regras, destinatários), `notifications` (push + e-mail, preferências, subscrições, retry), idempotência | FR-ALR, BR-ALR | M6, M7 |
| **M9** | **Relatórios e ciclo de vida** | `reports`, `lifecycle`: exportação, sair/remover com pacote, maioridade (avisos), bloqueio/apagamento 90 dias, eliminação de conta/família, `admin` (contas) | FR-RPT, FR-PRIV-05, R4, P4, Q7 | M6–M8 |
| **M10** | **Endurecimento e lançamento** | Carga (N9), segurança (suite completa, revisão), restauro de backup, monitorização/alertas, runbooks, AIPD e textos legais, checklist de release | NFR-*, privacidade | M0–M9 |
| **M7b** | **Exames da clínica e resultados** (ADR-023, fase 1) | `ClinicSlot.kind` + `capacity` (BR-APT-11); `Examination.slotId` com marcação direta (`SCHEDULED`) sob bloqueio do horário; `/clinic-portal/slots` (`PATCH` capacidade), `exam-agenda` (cancel, complete com resultados + PDF via `documents`, upload/remoção de PDF); alertas `EXAM_CANCELLED/RESULTS_AVAILABLE`; migrações `0018`–`0021` + **`0022`** (revisão 2026-11-04: remove `exam-requests`, `REQUESTED`/`REJECTED`, job de expiração e o índice único por `slot_id`; corrige CHECK `issued_by`; `documents.uploaded_by_clinic`); matriz `TC-AZ-CLN` e isolamento entre clínicas | FR-EXM-07..09, FR-CLN-02, BR-CLN-07/08, BR-EXM-05/06/08, BR-APT-10/11 | M5, M7, M8 |
| **M7c** | **Recomendações** (ADR-023, fase 2) | Módulo `recommendations`: `POST/GET /clinic-portal/recommendations`, `GET /families/{f}/members/{m}/recommendations`; alerta `RECOMMENDATION_ADDED`; auditoria | FR-REC-01, BR-CLN-09 | M7b (exames) e M7 (consultas), M8 |
| **M11** | **Seguradoras e portal da seguradora** | `insurance` (`InsurancePolicy`, `ReimbursementClaim`, reaproveita `documents`), **`insurance-portal`** (ADR-021: `InsuranceAccount`/`insurance_sessions` separados de `users`/`ClinicAccount`; hierarquia `INSURANCE_ADMIN`/`INSURANCE_AGENT`; listar/decidir pedidos) | BR-INS (ADR-021) | M3, M5 |
| **M12** | **"Resumo com IA" em `reports`** | Extensão do módulo `reports` existente (ADR-022): consentimento opt-in (SELF/tutor, separado de `SharingGrant`), chamada ao fornecedor externo de IA com dados minimizados (BR-RPT-06), filtro de saída que bloqueia aconselhamento/diagnóstico (BR-RPT-07) antes de o resultado chegar ao utilizador, aviso obrigatório sempre ao lado dos dados em bruto (BR-RPT-04), auditoria sem dados de saúde (`AI_SUMMARY_GENERATE`) | BR-RPT-03..09 (ADR-022) | M9 (`reports`) |
| **M13** | **Administração de contas** (ADR-023, fase 3) | `admin`: pesquisa (`q`) e detalhe de utilizadores, `reset-access`; `GET /admin/clinics/{id}/accounts` + suspender/reativar (revoga `clinic_sessions`); `PATCH /admin/insurers/{id}`; auditoria `ADMIN_*` | FR-ADM-02..04, BR-ADM-01..07 | M9 (`admin`), M7 (`clinics`), M11 (seguradoras) |

**M11 (ADR-021, acrescentado 2026-10-16; completado por ADR-023, 2026-11-04):** inclui agora `InsurancePolicy.insurerId`, `GET /families/{f}/insurers`, `PATCH /admin/insurers/{id}`, BR-INS-09/10 e `03-use-cases/insurance.md` (fase 4 do plano de ADR-023). funcionalidade aprovada depois do plano original (M0–M10) estar
fechado; por isso aparece depois de M10 nesta tabela, mas as suas dependências reais são só M3 (`access`) e
M5 (`documents`) — pode ser agendado antes de M10 se a capacidade o permitir. Se for implementado antes de
M10, os gates de M10 (segurança, carga) devem cobrir também `insurance`/`insurance-portal`.

**M12 (ADR-022, acrescentado 2026-10-17):** depende só de M9 (`reports`, já implementado) — pode ser
agendado em qualquer momento depois de M9. **Gate de lançamento específico (ADR-022, BR-RPT-09):**
independentemente de quando for construído, não pode ficar **ativo em produção para utilizadores reais**
antes de a AIPD (M10) cobrir explicitamente este tratamento e de existir DPA assinado com o fornecedor de
IA escolhido — pode ficar implementado e testado, mas atrás de uma flag/consentimento que nunca se liga
sem essas duas condições. Contrato (`openapi.yaml`), schema de consentimento e eventual porta nova em
`reports` (ADR-016) ficam pendentes, a decidir no arranque deste milestone (ADR-022, "pendências explícitas").

### Porque esta ordem (para aprender)
- **Auditoria e autorização cedo:** são transversais; acrescentá-las no fim obriga a refazer tudo. M1 e M3 criam a base sobre a qual todo o resto se escreve.
- **Documentos antes da medicação:** receitas e exames dependem de anexos; o antivírus e o apagamento por outbox são riscos técnicos que convém resolver cedo.
- **Alertas só depois de existirem os eventos** (tomas, consultas, exames): o scanner trabalha sobre dados reais; M8 valida o requisito mais crítico (lembretes fiáveis).
- **Ciclo de vida (M9) no fim:** depende de todos os dados existirem para exportar e apagar corretamente; mas os *esqueletos* de eliminação em cascata devem ser testados desde M2 (testes de integração de FKs).

## 5. Rastreabilidade (requisitos → milestone)
| Área de requisitos | M |
|---|---|
| FR-AUTH, BR-ACC, FR-AUD | M1 |
| FR-FAM, FR-MEM, BR-FAM, BR-MEM (exceto ciclo de vida) | M2 |
| FR-PRIV (partilha), BR-PRV, autorização | M3 |
| FR-HP | M4 |
| FR-DOC | M5 |
| FR-RX, FR-MED | M6 |
| FR-APT, FR-EXM, FR-CLN, FR-ADM-01 (clínicas), portal da clínica (D17/D18, ADR-020 — contrato, implementação (identidade, hierarquia de staff, horários, pedidos/agenda, resultado de consulta + receita, frontend) e fecho de QA/segurança concluídos) | M7 |
| FR-ALR, BR-ALR | M8 |
| FR-RPT, FR-PRIV-05, saída/remoção, maioridade, bloqueio, eliminações, FR-ADM-01 (contas) | M9 |
| NFR-PERF/AVL/OPS/SEC (verificação final) | M10 |
| BR-INS (ADR-021/ADR-023: apólice, pedidos de reembolso, portal da seguradora) | M11 |
| BR-CLN-07/08, BR-EXM-05/06/08, BR-APT-10/11 (exames da clínica com vagas, ADR-023 rev. 2026-11-04; BR-EXM-07 obsoleta) | M7b |
| BR-CLN-09 (recomendações, ADR-023) | M7c |
| BR-ADM (administração de contas, ADR-023) | M13 |
| BR-RPT-04..09 ("Resumo com IA", ADR-022) — gate de lançamento ligado à AIPD/DPA (M10) | M12 |

## 6. Riscos de implementação e mitigação
| Risco | Mitigação |
|---|---|
| Falha de isolamento entre famílias | Cenário de dois tenants em todos os testes de integração; teste automático por endpoint; FKs compostas. |
| Mistura entre o ator de User/família e o `ClinicAccount` do portal da clínica (D18) | ADR-020: segundo `ActorInfo`/`AsyncLocalStorage`, claims de JWT distintas, rotas `/clinic-portal/*` nunca partilham contexto com as restantes; teste de arquitetura verifica que `clinic-portal` não importa `auth`/`access`/`families`. |
| Mistura entre os três atores (User/família, `ClinicAccount`, `InsuranceAccount`) (ADR-021) | Terceiro `ActorInfo`/`AsyncLocalStorage` próprio, claims de JWT distintas, rotas `/insurance-portal/*` nunca partilham contexto com as restantes; teste de arquitetura verifica que `insurance-portal` não importa `auth`/`access`/`families`/`clinic-portal`. |
| Lembretes perdidos ou duplicados | Scanner idempotente + `dedupeKey`; testes com relógio; métrica de atraso e alerta crítico. |
| Erros de DST/fuso | Biblioteca de tempo robusta (IANA), casos fixos de teste, relógio injetável. |
| Prisma vs. constraints avançadas | SQL manual versionado + teste de *drift* (ADR-003). |
| Antivírus e ficheiros | Quarentena + outbox + testes EICAR; limites de quota. |
| Complexidade de ciclo de vida (maioridade, 90 dias, saída com pacote) | Fatias pequenas em M9; testes de relógio; fluxos documentados em `member.md`. |
| **Sem validação com utilizadores (D16)** | Aceite pelo proprietário; manter o MVP mínimo; instrumentar métricas de uso desde M10 sem dados de saúde. |
| Conformidade legal | AIPD, textos legais e eventual DPO **antes** do lançamento (M10). |

## 7. O que preciso de ti para arrancar a Fase 17
1. **Aprovação** para iniciar a implementação (M0) — dada; stack confirmada em ADR-014/ADR-015 (Node.js/TypeScript + pnpm, Clean Architecture).
2. **Decisões operacionais** (não alteram a especificação): fornecedor de alojamento UE; fornecedor SMTP UE; nome/domínio da API; entidade legal responsável pelo tratamento.
3. ~~Confirmar o nome do repositório/projeto e o gestor de pacotes~~ — confirmado: Node LTS + pnpm (ADR-014).

**M7b/M7c/M13 (ADR-023, acrescentado 2026-11-04):** funcionalidades aprovadas depois de M7/M9 concluídos; cada fase é entregue e validada por commits separados (`pnpm gen && pnpm lint && pnpm test && pnpm build`, conformidade OpenAPI e teste de arquitetura verdes). Ordem recomendada: M7b → M7c → M13 → M11 (fase 4). Os gates de M10 (segurança, AIPD) devem cobrir também os resultados/recomendações emitidos pela clínica (dados de saúde de terceiro).
