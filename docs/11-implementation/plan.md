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
| **M7d** | **Marcação presencial pela clínica** (ADR-024, D20) | `POST /clinic-portal/patient-lookup`, `POST /clinic-portal/walk-in-appointments` em `appointments` (via porta para resolver utilizador/SELF em `family`/`identity`); `appointments.walk_in`/`booked_by_clinic_account_id`; rate limits; auditoria `CLINIC_WALKIN_*`; alerta `APPOINTMENT_CONFIRMED` quando existir (OP-22) | BR-CLN-10, FR-CLN-03 | M7, M2–M3 |
| **M11** | **Seguradoras e portal da seguradora** | `insurance` (`InsurancePolicy`, `ReimbursementClaim`, reaproveita `documents`), **`insurance-portal`** (ADR-021: `InsuranceAccount`/`insurance_sessions` separados de `users`/`ClinicAccount`; hierarquia `INSURANCE_ADMIN`/`INSURANCE_AGENT`; listar/decidir pedidos) | BR-INS (ADR-021) | M3, M5 |
| **M12** | **"Resumo com IA" em `reports`** | Extensão do módulo `reports` existente (ADR-022): consentimento opt-in (SELF/tutor, separado de `SharingGrant`), chamada ao fornecedor externo de IA com dados minimizados (BR-RPT-06), filtro de saída que bloqueia aconselhamento/diagnóstico (BR-RPT-07) antes de o resultado chegar ao utilizador, aviso obrigatório sempre ao lado dos dados em bruto (BR-RPT-04), auditoria sem dados de saúde (`AI_SUMMARY_GENERATE`) | BR-RPT-03..09 (ADR-022) | M9 (`reports`) |
| **M13** | **Administração de contas** (ADR-023, fase 3) | `admin`: pesquisa (`q`) e detalhe de utilizadores, `reset-access`; `GET /admin/clinics/{id}/accounts` + suspender/reativar (revoga `clinic_sessions`); `PATCH /admin/insurers/{id}`; auditoria `ADMIN_*` | FR-ADM-02..04, BR-ADM-01..07 | M9 (`admin`), M7 (`clinics`), M11 (seguradoras) |
| **M14** | **Clínica v2** (ADR-026, D22; **aceite**) | Ferramenta de gestão independente com consentimento do paciente; fases (a) agenda/profissionais/tipos/lista de espera, (b) confirmação 48h/24h, fluxo do dia (parte de (c)), indicadores e retorno — **contratada como etapa Q**, (c) check-in/fila/QR/pré-consulta, (d) consentimento e mensagens estruturadas, (e) preços/recibos/comprovativos e (f) perfil e `CLINIC_DOCTOR` — **contratadas como etapa R (última do M14)**. **Ordem recomendada pelo proprietário:** shell+Hoje → Serviços (tipos de consulta, preço) e profissionais → agenda por profissional com regras → pacientes + consentimento → confirmação ativa e faltas → recibos. Detalhe, entidades e endpoints em `clinic-portal-v2.md` | BR-CLN-03 (emenda), BR-CLN-11..16 (a1/a2 **contratadas** 2026-11-07), BR-CLN-17..24 (P **contratadas** 2026-11-08), BR-CLN-25..30 e BR-ALR-09 (Q **contratadas** 2026-11-08), BR-CLN-31..40 (R **contratadas** 2026-11-08; **M14 fecha**) | M7–M7d, M8, M11 (e), S3 (e); Q não depende de OP-07/OP-22 |
| **M15** | **Relatório da consulta e laudo de exame** (ADR-027, D23; **aceite**) | Duas etapas sobre o portal da clínica (M14 fechado). **Etapa S — Relatório da consulta:** `ConsultationReport` 1:1 com a marcação (consulta Vita ou visita manual), 4 secções de texto, `DRAFT → FINAL` imutável + adendas, escrito só pelo Médico (Admin/Gestor leem), `report` em `complete`, PDF gerado a pedido, leitura pelo titular/tutor na consulta (sem consentimento; `sharedWithPatient`); migração `0031` (parte relatório); módulo `clinic-reports`; editor no portal (Hoje/Agenda/Ficha) e botão na app. **Etapa T — Laudo de exame:** rascunho de resultados (`results-draft`), laudo PDF gerado ao concluir (tabela parâmetro/valor/unidade/referência + "Fora da referência" aritmético, sem interpretação) como `Document` do exame (`generated_by_system`, sem quarentena), descarregável pela clínica e visível ao paciente como o PDF atual; migração `0031` (parte exame/documents). **Ordem:** `0031` → S (relatório → PDF → `complete` com `report` → lado família) → T (rascunho → laudo → `storeGenerated`) → QA/segurança. | BR-CLN-41..50 (S: 41..46, 50; T: 47..49 e emenda a BR-EXM-02), FR-CLN-21..24, UC-CLN-32..38 (**contratadas** 2026-11-08) | M14 (R), M5 (`documents`), M7b; gate de lançamento: AIPD/DPA (M10) cobrir relatórios/laudos + OP-46 |
| **S1** | **Seguradoras: base operacional** (ADR-025, D21) | **Primeiro: contrato** (`openapi.yaml` + `endpoints.md`, validado). Papéis alargados (`insurance_account_role`), `insurer_accounts.currency`/`operational_module_enabled` (+ `PATCH /admin/insurers`), `Company`, `Beneficiary`, `Policy`, importação CSV/XLSX (≤ 5.000), cartão digital/QR, reclamar cartão + confirmação (BR-SEG-20); job `insurer.expire-policies`; migração própria; auditoria `INSURER_*` | BR-SEG-14/15/17/18/19/20; UC-SEG-01/02/03/15 | M11 |
| **S2** | **Planos, coberturas e elegibilidade** | `InsurerService`, `Plan` (versões), `PlanCoverage`, motor de elegibilidade e de saldos (`CoverageConsumption`), cálculo de comparticipação com testes de propriedade (casos do proprietário: 20.000×80 %; 500.000−120.000); ratificar arredondamento | BR-SEG-01/02/04/06..09/22; UC-SEG-04/14 | S1 |
| **S3** | **Rede de prestadores e validação na clínica** | `Provider`/`ProviderUnit`, ligação `clinic_id`, `GET /clinic-portal/insurers`, `eligibility`, `services`, rate limit e auditoria `ELIGIBILITY_CHECK`; `Encounter`; matriz `TC-AZ-SEG` da clínica (§8.4) | BR-SEG-18/22/23; UC-SEG-05/09/10 | S1, S2, M7 |
| **S4** | **Autorizações** | `AuthorizationRequest` (manual + auto-aprovação com teto por plano), eventos imutáveis, reserva de saldo, código; resposta a `INFO_REQUESTED`; anexos (`insurer_attachments`, decisão de desenho); job `insurer.expire-authorizations` | BR-SEG-03/05/07/16; UC-SEG-06/07/08 | S2, S3 |
| **S5** | **Despesas, comparticipação e dashboard** | `ExpenseClaim`/linhas, duplicados, tolerância, aprovação (reserva→usado, `DIRECT_BILLED`), bloqueio de reembolso (`reimbursement_claims.encounter_id`, BR-SEG-21), dashboard por papel, auditoria `GET .../audit` (**só se P7 for emendado**); termina em `APPROVED` (Q10) | BR-SEG-10..13/21; UC-SEG-11/12/13/16/17 | S4 |
| **S6** | **App do paciente** | Cartão digital, saldo, histórico de autorizações/despesas, várias seguradoras, notificações (`alerts`); `/families/{f}/members/{m}/insurance/*` | BR-SEG-20/23; UC-SEG-14/15 | S1, S2 |

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

**M14 — estado (2026-11-07):** **(a1) catálogo** de profissionais/serviços e **(a2) regras de horário, geração idempotente e bloqueios** têm **contrato validado** (BR-CLN-11..16, FR-CLN-04..06, UC-CLN-11..13, `schema.md` §3a + migração proposta `0027`, `openapi.yaml`/`endpoints.md`, `authorization.md` §6.2, `audit.md`, AC-CLN-07..12, TC-CLN-04..07/TC-AZ-CLN-V2) e podem arrancar no backend (módulo `clinics`; job `clinics.generate-schedule`; walk-in em `appointments`). **Etapa P (contrato 2026-11-08):** `ClinicPatient`, consentimento (2 níveis, 12 meses), código/QR de ligação, histórico partilhado, pesquisa global e `/calendar` por profissional têm **contrato validado** (BR-CLN-17..24, FR-CLN-07..10, UC-CLN-14..19, `schema.md` §3d + migração proposta `0028`, `openapi.yaml`/`endpoints.md`, `authorization.md` §6.2/§6.4, `audit.md`, `modules.md` nota 24, AC-CLN-13..19, TC-CLN-08..12/TC-AZ-CLN-V3; OP-32..35) e podem arrancar (módulo `clinic-patients` com portas; ordem sugerida: `0028` + pacientes/pesquisa → visitas/walk-in → consentimento e código (família) → histórico partilhado → calendário). **Etapa Q (contrato 2026-11-08):** confirmação ativa de presença (pedido a 48 h + lembrete de 24 h existente; "Vou / Não posso"; confirmado por telefone), fluxo do dia em Hoje (Chegou/Iniciar/Concluir/Faltou, espera), indicadores (`GET /reports/summary`) e lembrete de retorno têm **contrato validado** (BR-CLN-25..30, BR-ALR-09, FR-CLN-11..14, UC-CLN-20..24, `schema.md` §3e + migração proposta `0029`, `openapi.yaml`/`endpoints.md`, `authorization.md` §6.2, `audit.md`, `modules.md` nota 25, AC-CLN-20..24, TC-CLN-13..16/TC-AZ-CLN-V4; OP-36..38) e podem arrancar (ordem sugerida: `0029` + colunas → ações do dia e confirmação por telefone → `confirmation` (família) + regras do scanner → retorno → indicadores). **Não depende de OP-07/OP-22** (usa o scanner de alertas existente). Fica para a **(a3)** (a contratar): só a lista de espera. **Etapa R (contrato 2026-11-08, última do M14):** recibos internos não fiscais (numeração sequencial por clínica, anulação, Financeiro por período, comprovativo na app e anexo ao reembolso), perfil da clínica, papel `CLINIC_DOCTOR` com matriz por papel de todas as rotas e auditoria da própria clínica têm **contrato validado** (BR-CLN-31..40, FR-CLN-15..20, UC-CLN-25..31, `schema.md` §3f + migração proposta `0030`, `openapi.yaml`/`endpoints.md`, `authorization.md` §6.2b/§6.5, `audit.md`, `modules.md` nota 26 (módulo `clinic-receipts`), AC-CLN-25..29, TC-CLN-17..20/TC-AZ-CLN-V5; OP-39..43) e podem arrancar (ordem sugerida: `0030` + perfil e papel Médico/matriz → recibos (numeração, emissão, anulação, Financeiro) → lado família + `receiptIds` no reembolso → auditoria da clínica, **esta última depende da ratificação de P7 (OP-42)**). **M14 fecha com a etapa R:** a **lista de espera (a3)**, a pré-consulta/QR de check-in (c) e as mensagens estruturadas (d) **ficam fora do M14** como backlog, em `open-points.md` (OP-39, OP-43), porque dependem de alertas da clínica (OP-07/OP-22) e/ou de ofertas com prazo, o que não é pequeno nem simples. Ordem de implementação sugerida (anteriores): `0027` + catálogo → regras/geração/job → bloqueios → duração/walk-in. **M14 (ADR-026, aceite 2026-11-07):** cada fase só arranca com o **contrato** validado (`clinic-portal-v2.md` §2) e testes de isolamento entre clínicas; gate de lançamento: AIPD (M10) a cobrir registo da clínica e consentimento + DPA. O frontend avança em mock antes do backend (`clinic-portal-v2.md` §3.5).

**M15 — estado (2026-11-08):** **etapas S e T contratadas** (ADR-027 / D23): BR-CLN-41..50, FR-CLN-21..24, UC-CLN-32..38, `schema.md` §3g + migração proposta `0031_clinic_reports.sql`, `openapi.yaml`/`endpoints.md` (11 operações novas; `complete` de consulta e de exame alargados), `authorization.md` §6.2b/§6.6, `audit.md`, `privacy.md`, `modules.md` nota 27 (módulo `clinic-reports`), AC-CLN-30..33, TC-CLN-21..24/TC-AZ-CLN-V6; OP-44..49. Podem arrancar no backend. **Ordem sugerida — S:** `0031` (tabelas e triggers) → CRUD do rascunho e finalizar → PDF do relatório (`PdfRenderer`) → `report` em `complete` (porta `ConsultationReportFinalizer`) → adendas → leitura pela família + `Appointment.reportAvailable`. **T:** `clinic_exam_result_drafts` + rotas `results-draft` → função pura de realce → layout do laudo → `DocumentService.storeGenerated` + `generateReport` em `complete` → `report/pdf` da clínica. **Gates de cada etapa:** `pnpm gen && lint && test && build`, conformidade OpenAPI, teste de arquitetura (nota 27), testes de isolamento entre clínicas e de matriz de papéis (`TC-AZ-CLN-V6`), teste de imutabilidade do `FINAL` na BD, teste de que o PDF não contém `/JavaScript`/`/Launch`/`/URI`/`/EmbeddedFile`, teste de ausência de PII/texto em auditoria e logs. **Lançamento:** AIPD/DPA (M10) a cobrir relatórios e laudos; retenção do relatório validada juridicamente (OP-46). O frontend avança em mock (`clinic-portal-v2.md` §5).

**S1–S6 (ADR-025, acrescentado 2026-11-05):** módulo operacional de seguradoras; aprovado depois de M11/M13. Cada marco fecha com `pnpm gen && lint && test && build`, **conformidade OpenAPI**, teste de arquitetura (`modules.md` §3 nota 23), **testes de isolamento entre seguradoras** (BR-SEG-14, `vita-qa-security`) e revisão ao proprietário. **Gates e pendências antes de S1:** (1) redigir e validar o contrato `openapi.yaml` (o esboço de `endpoints.md` não é contrato); (2) decisão do proprietário sobre **Q4** (assumido: seguradora do cartão); (3) ratificar arredondamento (BR-SEG-08); (4) desenho de anexos (`documents` vs. `insurer_attachments`); (5) confirmar com o proprietário a vista de auditoria da seguradora face a P7 (`audit.md` §2); (6) pendência jurídica (Lei 22/11, AIPD, alojamento — Q1) antes do lançamento, juntamente com os gates de M10, que devem cobrir também o módulo operacional (dados de terceiros).

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
| BR-CLN-41..46, 50 (relatório da consulta, ADR-027) | M15 (S) |
| BR-CLN-47..49 e emenda a BR-EXM-02 (rascunho de resultados e laudo gerado, ADR-027) | M15 (T) |
| BR-SEG-14/15/17..20 (base, importação, cartão; ADR-025) | S1 |
| BR-SEG-01/02/04/06..09/22 (planos, elegibilidade, saldos) | S2 |
| BR-SEG-18/22/23 (rede, validação na clínica) | S3 |
| BR-SEG-03/05/07/16 (autorizações) | S4 |
| BR-SEG-10..13/21 (despesas, dashboard) | S5 |
| BR-SEG-20/23 (app do paciente) | S6 |
| BR-RPT-04..09 ("Resumo com IA", ADR-022) — gate de lançamento ligado à AIPD/DPA (M10) | M12 |

## 6. Riscos de implementação e mitigação
| Risco | Mitigação |
|---|---|
| Falha de isolamento entre famílias | Cenário de dois tenants em todos os testes de integração; teste automático por endpoint; FKs compostas. |
| Mistura entre o ator de User/família e o `ClinicAccount` do portal da clínica (D18) | ADR-020: segundo `ActorInfo`/`AsyncLocalStorage`, claims de JWT distintas, rotas `/clinic-portal/*` nunca partilham contexto com as restantes; teste de arquitetura verifica que `clinic-portal` não importa `auth`/`access`/`families`. |
| Mistura entre os três atores (User/família, `ClinicAccount`, `InsuranceAccount`) (ADR-021) | Terceiro `ActorInfo`/`AsyncLocalStorage` próprio, claims de JWT distintas, rotas `/insurance-portal/*` nunca partilham contexto com as restantes; teste de arquitetura verifica que `insurance-portal` não importa `auth`/`access`/`families`/`clinic-portal`. |
| Fuga entre seguradoras / enumeração de beneficiários pela clínica (ADR-025) | FK compostas `(insurer_id, id)` em todas as tabelas `insurer_*` (sem RLS, Q13), dois tenants em todos os testes de integração, teste automático por endpoint, resposta de elegibilidade mínima + rate limit + auditoria, QR rotativo/revogável. |
| Erros monetários em limites/comparticipação (ADR-025) | `numeric`, arredondamento ratificado, testes de propriedade e casos do proprietário; atualização de `CoverageConsumption` sob bloqueio de linha. |
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
