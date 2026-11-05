# Vita Family — Esquema da base de dados (Fase 12)

> Estado: **v0.5** — ADR-023 revisto (2026-11-04): `clinic_slots.capacity`, exames marcados diretamente (`SCHEDULED`; `REQUESTED`/`REJECTED` obsoletos), contagem controlada em vez de índice único, `documents.uploaded_by_clinic`, CHECK `issued_by` corrigida (migração `0022`). v0.4 — ADR-023 (D19): `clinic_slots.kind`, `examinations` (estados `REQUESTED`/`REJECTED`, `slot_id`, emissão pela clínica), `recommendations`, `documents.uploaded_by_clinic_account_id`, `insurance_policies.insurer_id`, correção da CHECK de `reimbursement_claims`, `audit_logs.actor_insurance_account_id`, novos `alert_type`/`alert_source`. v0.3 acrescenta o portal da seguradora parceira (ADR-021): `insurer_accounts`, `insurance_accounts`, `insurance_sessions`, `insurance_policies`, `reimbursement_claims`, `reimbursement_claim_documents`, `documents.resource_type = INSURANCE_POLICY`. Mantém v0.2 (portal da clínica, D17/D18): `clinic_accounts`, `clinic_sessions`, `clinic_slots`, estados `REQUESTED`/`REJECTED` de `appointments`, colunas de resultado da consulta e `prescriptions.issued_by`. PostgreSQL 16. Nomes em `snake_case`, tabelas no plural. Derivado de `04-domain/entities.md`.
> Convenções: `id uuid PK default gen_random_uuid()`; `created_at`/`updated_at timestamptz not null default now()` em todas (omitidas abaixo); enums como tipos `ENUM` do Postgres; `NN` = NOT NULL; `FK→t(c)`; `CASCADE` = ON DELETE CASCADE.
> Isolamento: toda a tabela de dados de família tem `family_id`. Os filhos usam **FK composta** `(family_id, member_id) → family_members(family_id, id)` para impedir, na própria BD, que um registo aponte para um membro de outra família (ADR-008).

## 1. Identidade e acesso

**users**
`email citext NN UNIQUE` · `password_hash text NN` · `name text NN` · `birth_date date NN` · `timezone text NN` (IANA) · `status user_status NN default 'PENDING_VERIFICATION'` · `platform_role platform_role NN default 'NONE'` · `email_verified_at timestamptz` · `terms_accepted_version text NN` · `terms_accepted_at timestamptz NN` · `suspended_at timestamptz` · `suspension_reason text`
CHECK `birth_date <= current_date`.

**auth_tokens** — `user_id FK→users CASCADE` · `type auth_token_type NN` · `token_hash text NN UNIQUE` · `expires_at NN` · `used_at`

**sessions** — `user_id FK→users CASCADE` · `refresh_token_hash text NN UNIQUE` · `token_chain_id uuid NN` · `user_agent` · `ip inet` · `expires_at NN` · `revoked_at` · `last_used_at NN`

**notification_preferences** — `user_id UNIQUE FK→users CASCADE` · `push_enabled bool NN true` · `email_enabled bool NN true` · `medication_due bool NN true` · `appointment_reminder bool NN true` · `exam_reminder bool NN true`

**push_subscriptions** — `user_id FK→users CASCADE` · `endpoint text NN UNIQUE` · `p256dh text NN` · `auth text NN` · `user_agent` · `last_success_at`

## 2. Família e pessoas

**families** — `name text NN` · `created_by uuid FK→users SET NULL`

**family_members**
`family_id FK→families CASCADE NN` · `user_id FK→users CASCADE` (nulo = sem conta) · `name text NN` · `birth_date date NN` · `role family_role` (nulo sem conta) · `is_dependent bool NN default false` · `blood_type blood_type` · `status member_status NN default 'ACTIVE'` · `blocked_at timestamptz` · `scheduled_deletion_at timestamptz`
UNIQUE `(family_id, id)` (alvo das FKs compostas) · UNIQUE `(family_id, user_id)` WHERE `user_id IS NOT NULL` · CHECK `role IS NULL OR user_id IS NOT NULL` · CHECK `status='BLOCKED' ⇒ user_id IS NULL`.
> Invariantes não expressáveis em CHECK (menor ⇒ dependente; admin adulto) são garantidas no serviço **e** por testes.

**guardianships**
`family_id NN` · `dependent_id NN` · `guardian_id NN` · `is_primary bool NN default false`
FK compostas `(family_id, dependent_id)` e `(family_id, guardian_id)` → `family_members(family_id,id)` CASCADE · UNIQUE `(dependent_id, guardian_id)` · CHECK `dependent_id <> guardian_id` · **UNIQUE parcial** `(dependent_id) WHERE is_primary` (um principal por dependente).

**invitations**
`family_id FK→families CASCADE NN` · `email citext NN` · `type invitation_type NN` · `member_id uuid` (FK composta opcional) · `token_hash text NN UNIQUE` · `status invitation_status NN default 'PENDING'` · `expires_at NN` · `invited_by FK→users SET NULL` · `accepted_by FK→users SET NULL` · `accepted_at`

**sharing_grants**
`family_id NN` · `owner_member_id NN` · `grantee_member_id` (nulo = toda a família) · `category data_category NN` (ALLERGIES, CONDITIONS, MEDICATION, APPOINTMENTS, EXAMS) · `granted_by FK→users SET NULL`
FK compostas para `family_members` CASCADE · UNIQUE `(owner_member_id, grantee_member_id, category)` com `NULLS NOT DISTINCT` · CHECK `grantee_member_id IS DISTINCT FROM owner_member_id`.

## 3. Portal da clínica (`ClinicAccount` — D17/D18, ADR-020)

> Espaço de identidade **separado** de `users`/`family_members` (ADR-020): sem FK entre as tabelas
> desta secção e as de `users`/família. Sessões próprias, tokens próprios.

**clinic_accounts**
`clinic_id FK→clinics CASCADE NN` · `email citext NN UNIQUE` · `password_hash text NN` · `role clinic_account_role NN` · `status clinic_account_status NN default 'ACTIVE'` · `created_by_platform_admin FK→users SET NULL` (preenchido só na conta `CLINIC_ADMIN` raiz) · `suspended_at timestamptz`
CHECK `clinic_id` tem de referenciar uma clínica `type='PARTNER'` (garantido no serviço; `clinics.type` não é imutável na BD). UNIQUE parcial `(clinic_id) WHERE role='CLINIC_ADMIN' AND status='ACTIVE'` (uma única conta Admin ativa por clínica, BR-CLN-05).

**clinic_sessions** — `clinic_account_id FK→clinic_accounts CASCADE NN` · `refresh_token_hash text NN UNIQUE` · `token_chain_id uuid NN` · `user_agent` · `ip inet` · `expires_at NN` · `revoked_at` · `last_used_at NN`
Equivalente a `sessions`, mas para `clinic_accounts`; cadeias de refresh independentes das de `User`.

**clinic_slots** — `clinic_id FK→clinics CASCADE NN` · `kind clinic_slot_kind NN default 'APPOINTMENT'` (D19; migração com default preserva horários existentes) · `specialty text NN` (em `EXAM`: tipo de exame) · `professional_name` · `starts_at timestamptz NN` · `duration_minutes int NN` · `capacity int NN default 1` (vagas, BR-APT-11; migração `0022`, o default preserva horários existentes)
CHECK `duration_minutes` em `(15, 20, 30, 45, 60)` (BR-CLN-04/UC-CLN-04) · CHECK `capacity BETWEEN 1 AND 50` · CHECK `kind = 'EXAM' OR capacity = 1` (consulta sempre 1 vaga). Ocupação **calculada em consulta**, sem coluna derivada: `APPOINTMENT` livre = sem `appointments.slot_id` com `status` em `(REQUESTED, SCHEDULED)` (BR-APT-06); `EXAM` com vaga = `count(examinations WHERE slot_id = slot AND status = 'SCHEDULED') < capacity` (BR-APT-11). **Concorrência:** reservar vaga (criar exame com `slotId`), alterar `capacity` e remover o horário correm numa transação que começa por `SELECT … FROM clinic_slots WHERE id = $1 FOR UPDATE` (bloqueio da linha do horário), depois contam e decidem; cancelar não precisa de bloqueio (só liberta). Detalhe no ADR-023. A compatibilidade `kind` ↔ recurso (consulta só em `APPOINTMENT`, exame só em `EXAM`) é garantida no serviço (não é expressável em CHECK entre tabelas).

## 3b. Portal da seguradora (`InsuranceAccount` — ADR-021, mirror exato de §3)

> Espaço de identidade **separado** de `users`/`family_members` e de `clinic_accounts` (ADR-021): sem FK
> entre as tabelas desta secção e as de `users`/família/clínica. Sessões próprias, tokens próprios.

**insurer_accounts** — `name text NN` · `tax_id text NN UNIQUE` · `status insurer_status NN default 'ACTIVE'` · `created_by FK→users SET NULL`
Mirror de `clinics` (type=PARTNER), mas entidade própria: não há seguradora privada.

**insurance_accounts**
`insurer_id FK→insurer_accounts CASCADE NN` · `email citext NN UNIQUE` · `password_hash text NN` · `role insurance_account_role NN` · `status insurance_account_status NN default 'ACTIVE'` · `created_by_platform_admin FK→users SET NULL` (preenchido só na conta `INSURANCE_ADMIN` raiz) · `suspended_at timestamptz`
UNIQUE parcial `(insurer_id) WHERE role='INSURANCE_ADMIN' AND status='ACTIVE'` (uma única conta Admin ativa por seguradora, BR-INS-06). Mirror de `clinic_accounts`.

**insurance_sessions** — `insurance_account_id FK→insurance_accounts CASCADE NN` · `refresh_token_hash text NN UNIQUE` · `token_chain_id uuid NN` · `user_agent` · `ip inet` · `expires_at NN` · `revoked_at` · `last_used_at NN`
Equivalente a `clinic_sessions`, mas para `insurance_accounts`; cadeias de refresh independentes das restantes.

## 4. Registos de saúde (todos: `family_id NN`, `member_id NN`, FK composta CASCADE)

**allergies** — `name text NN` · `notes text` · `since date`

**medical_conditions** — `name text NN` · `kind condition_kind NN` · `notes` · `since date` · `until date` · CHECK `until >= since`

**prescriptions** — `issued_on date NN` · `doctor_name` · `notes` · `status prescription_status NN default 'ACTIVE'` · `issued_by prescription_issuer NN default 'FAMILY'` · `issued_by_clinic_account_id FK→clinic_accounts SET NULL` · `appointment_id FK→appointments SET NULL` (consulta de origem, BR-RX-07)
CHECK `issued_on <= current_date` · CHECK `issued_by_clinic_account_id IS NULL OR issued_by = 'CLINIC'` (`0022` **corrige** `(issued_by='CLINIC') = (issued_by_clinic_account_id IS NOT NULL AND appointment_id IS NOT NULL)` de `0017`, que falhava em `SET NULL` de `issued_by_clinic_account_id`/`appointment_id`; a marca de origem é `issued_by`, que permanece `CLINIC`; que uma receita `CLINIC` nasce com conta e consulta é validado no serviço, BR-RX-07).

**medication_plans**
`prescription_id uuid FK→prescriptions CASCADE` (nulo = avulso) · `name text NN` · `dosage text NN` · `schedule_type schedule_type NN` · `times text[]` (HH:mm) · `days_of_week smallint[]` · `interval_hours int` · `start_at timestamptz NN` · `end_at timestamptz` · `continuous bool NN default false` · `notes` · `status plan_status NN default 'ACTIVE'` · `ended_at`
CHECK `(schedule_type='FIXED_TIMES' AND cardinality(times)>0 AND interval_hours IS NULL) OR (schedule_type='INTERVAL' AND interval_hours BETWEEN 1 AND 168 AND times IS NULL)` · CHECK `continuous <> (end_at IS NOT NULL)` · CHECK `end_at > start_at`.

**dose_occurrences**
`plan_id FK→medication_plans CASCADE NN` · `scheduled_at timestamptz NN` · `status dose_status NN default 'PENDING'` · `acted_at` · `acted_by_user_id FK→users SET NULL` · `note text` · `generation_version int NN default 1`
UNIQUE `(plan_id, scheduled_at)`. (`family_id`, `member_id` desnormalizados para filtro/FK composta.)

**appointments** — `scheduled_at timestamptz NN` · `status appointment_status NN default 'SCHEDULED'` · `professional_name` · `specialty text` · `clinic_id FK→clinics SET NULL` · `clinic_name text` · `reason` · `notes` · `outcome_requested_at` · `slot_id FK→clinic_slots SET NULL` (horário da clínica parceira que originou o pedido, D17) · `response_note text` (motivo da clínica ao recusar/cancelar, D17) · `clinic_outcome_note text` (resultado da consulta registado pela clínica, D18; nunca escrito pela família — distinto de `notes`) · `outcome_recorded_by_clinic_account_id FK→clinic_accounts SET NULL` · `outcome_recorded_at timestamptz`
CHECK `slot_id IS NULL OR clinic_id IS NOT NULL` · CHECK `status <> 'REQUESTED' OR slot_id IS NOT NULL` (BR-APT-01/04: um pedido só nasce de um horário; **corrige** a versão anterior `(status IN ('REQUESTED','REJECTED')) = (slot_id IS NOT NULL)`, que proibia `SCHEDULED`/`CANCELLED` com `slot_id` e quebrava a confirmação e o `SET NULL` de `REJECTED` — migração `0016` do código a corrigir na fase M7b, ADR-023) · CHECK `clinic_outcome_note IS NULL OR outcome_recorded_at IS NOT NULL` (BR-CLN-06: o resultado só existe com registo da clínica; **corrige** `clinic_outcome_note IS NULL OR outcome_recorded_by_clinic_account_id IS NOT NULL` da `0017`, que o `ON DELETE SET NULL` da conta violava e bloqueava a remoção da conta — migração `0022`, ponto 6; `outcome_recorded_at` nunca é anulado). · `walk_in boolean NN default false` (D20/ADR-024: marcada presencialmente pela clínica; permanente) · `booked_by_clinic_account_id FK→clinic_accounts SET NULL` (autor da marcação walk-in; CHECK `booked_by_clinic_account_id IS NULL OR walk_in`; migração própria, `walk_in` nunca é anulado)
UNIQUE parcial `(slot_id) WHERE status IN ('REQUESTED','SCHEDULED')` (BR-APT-06: um horário aceita uma marcação ativa).

**examinations** — `name text NN` · `exam_date date NN` · `scheduled_at timestamptz` (só com `slot_id`, D19) · `status exam_status NN default 'SCHEDULED'` · `clinic_id FK→clinics SET NULL` · `clinic_name` · `slot_id FK→clinic_slots SET NULL` · `response_note text` · `notes` · `issued_by exam_issuer NN default 'FAMILY'` · `issued_by_clinic_account_id FK→clinic_accounts SET NULL` · `results_issued_at timestamptz` · `clinic_result_note text`
CHECK `slot_id IS NULL OR clinic_id IS NOT NULL` · CHECK `status NOT IN ('REQUESTED','REJECTED')` (`examinations_no_request_flow_check`, `0022`: valores obsoletos mantidos no enum só por compatibilidade; substitui `examinations_requested_requires_slot_check`) · CHECK `issued_by_clinic_account_id IS NULL OR issued_by = 'CLINIC'` (BR-CLN-08; **corrige** `(issued_by='CLINIC') = (issued_by_clinic_account_id IS NOT NULL)` de `0021`, que impedia o `ON DELETE SET NULL` — `issued_by` fica `CLINIC` e o autor `NULL` quando a conta é removida) · CHECK `clinic_result_note IS NULL OR issued_by='CLINIC'`.
**Sem** índice único por `slot_id` (BR-APT-11: vários exames por horário até `capacity`): `0022` remove `examinations_slot_active_booking_idx` e cria o índice parcial **não único** `(slot_id) WHERE status = 'SCHEDULED'` (contagem) e o único parcial `(slot_id, member_id) WHERE status = 'SCHEDULED'` (o mesmo membro não ocupa duas vagas do mesmo horário; regra PROPOSTA). A garantia anti-overbooking é o bloqueio da linha do horário (ver `clinic_slots`), não um índice.

**exam_results** — `examination_id FK→examinations CASCADE NN` · `parameter text NN` · `value_numeric numeric` · `value_text text` · `unit text` · `reference_min numeric` · `reference_max numeric` · CHECK `value_numeric IS NOT NULL OR value_text IS NOT NULL` · CHECK `reference_min <= reference_max`

**documents**
`family_id NN` · `member_id NN` · `prescription_id FK→prescriptions CASCADE` · `examination_id FK→examinations CASCADE` · `insurance_policy_id FK→insurance_policies CASCADE` (foto do cartão, ADR-021) · `storage_key text NN UNIQUE` · `original_name text NN` · `mime_type text NN` · `size_bytes bigint NN` · `checksum_sha256 text NN` · `scan_status scan_status NN default 'PENDING'` · `uploaded_by FK→users SET NULL` · `uploaded_by_clinic boolean NN default false` (marca **permanente** de PDF emitido pela clínica; `0022`) · `uploaded_by_clinic_account_id FK→clinic_accounts SET NULL` (autor, rastreabilidade, BR-CLN-08)
CHECK `num_nonnulls(prescription_id, examination_id, insurance_policy_id) = 1` (ADR-021 estende a CHECK de v0.2) · CHECK `size_bytes BETWEEN 1 AND 10485760` · CHECK `uploaded_by IS NULL OR uploaded_by_clinic_account_id IS NULL` (nunca os dois) · CHECK `uploaded_by_clinic_account_id IS NULL OR uploaded_by_clinic` · CHECK `NOT uploaded_by_clinic OR (examination_id IS NOT NULL AND uploaded_by IS NULL)` (a clínica só carrega em exames; `0022` substitui `documents_clinic_upload_examination_only_check`). **Visibilidade:** documento com `uploaded_by_clinic = true` só é listável/descarregável pelo paciente se `examinations.status='COMPLETED'` (BR-CLN-08). **Porquê a coluna:** a regra assentava em `uploaded_by_clinic_account_id IS NOT NULL`, mas `ON DELETE SET NULL` (conta removida, BR-CLN-05) anulava-o e o PDF perdia a marca, ficando visível antes de `COMPLETED`. Alternativas rejeitadas: impedir apagar contas com documentos (quebra BR-CLN-05/ADR-011) e deduzir a origem por `uploaded_by IS NULL` (ambíguo com utilizador apagado). `0022` preenche `uploaded_by_clinic = true` onde `uploaded_by_clinic_account_id IS NOT NULL` ou (`uploaded_by IS NULL` e o exame tem `scheduled_at` ou `issued_by='CLINIC'`, i.e. PDFs já órfãos).

**clinics**
`type clinic_type NN` · `family_id FK→families CASCADE` · `name text NN` · `address` · `phone` · `email` · `status clinic_status NN default 'ACTIVE'` · `created_by FK→users SET NULL`
CHECK `(type='PRIVATE') = (family_id IS NOT NULL)`.

**insurance_policies** — categoria sem partilha (ADR-021)
`family_id NN` · `member_id NN` (FK composta CASCADE, como as restantes desta secção) · `insurer_id FK→insurer_accounts SET NULL` (seguradora parceira, BR-INS-09; opcional) · `insurer_name text NN` (livre; não exige `insurer_accounts`) · `policy_number text NN` · `holder_name text NN` · `valid_until date` · `created_by FK→users SET NULL`
Foto do cartão: `documents.insurance_policy_id` acima (sem coluna de ficheiro aqui).

**reimbursement_claims**
`policy_id FK→insurance_policies CASCADE NN` · `insurer_id FK→insurer_accounts RESTRICT NN` (= `insurance_policies.insurer_id`, desnormalizado para a FK composta do portal; nunca nulo ao criar o pedido, BR-INS-03) · `amount numeric NN` · `currency text NN default 'EUR'` · `status reimbursement_claim_status NN default 'SUBMITTED'` · `decision_note text` · `decided_by_insurance_account_id FK→insurance_accounts SET NULL` · `decided_at timestamptz` · `submitted_by FK→users SET NULL`
CHECK `amount > 0` · CHECK `status <> 'REJECTED' OR decision_note IS NOT NULL` (motivo obrigatório quando a seguradora rejeita, BR-INS-05; **corrige** a CHECK da v0.3, que falhava em toda a linha `SUBMITTED`) · `insurer_id` tem de coincidir com `insurance_policies.insurer_id` (garantido no serviço na criação).

**reimbursement_claim_documents** — associação simples (ADR-021, "sem entidade de anexo nova")
`claim_id FK→reimbursement_claims CASCADE NN` · `document_id FK→documents CASCADE NN`
UNIQUE `(claim_id, document_id)`. É a **única** superfície de documentos que a seguradora vê (BR-INS-04): a aplicação nunca junta `documents` por `member_id` nas rotas `/insurance-portal/*`, só por esta tabela.

**recommendations** (D19, ADR-023; `family_id NN`, `member_id NN`, FK composta CASCADE) — `clinic_id FK→clinics SET NULL` · `clinic_name text NN` · `clinic_account_id FK→clinic_accounts SET NULL` (autor) · `appointment_id FK→appointments CASCADE` · `examination_id FK→examinations CASCADE` · `text text NN`
CHECK `num_nonnulls(appointment_id, examination_id) = 1` · CHECK `char_length(text) BETWEEN 1 AND 2000`. Sem UPDATE/DELETE pela aplicação da clínica (imutável); apaga-se só em cascata.

## 5. Alertas

**alerts**
`recipient_user_id FK→users CASCADE NN` · `family_id FK→families CASCADE NN` · `member_id NN` (FK composta) · `type alert_type NN` · `source_type alert_source NN` · `source_id uuid NN` · `rule_key text NN` · `dedupe_key text NN UNIQUE` · `trigger_at timestamptz NN` · `read_at`

**notifications**
`alert_id FK→alerts CASCADE NN` · `recipient_user_id FK→users CASCADE NN` (desnormalizado de `alerts.recipient_user_id`; M8/`modules.md` §3 nota 15 — `notifications` nunca lê `alerts`, por isso precisa do destinatário na própria linha para decidir `SKIPPED` por conta suspensa/canal desativado no envio) · `channel channel NN` · `status notification_status NN default 'PENDING'` · `attempts int NN default 0` · `next_attempt_at timestamptz` · `last_error_code text` · `sent_at` · UNIQUE `(alert_id, channel)`

## 6. Transversal

**audit_logs** (append-only)
`id bigserial PK` · `occurred_at timestamptz NN default now()` · `actor_type actor_type NN` · `actor_user_id uuid` (**sem FK**, permite anonimizar) · `actor_clinic_account_id uuid` (**sem FK**; preenchido só quando `actor_type='CLINIC_ACCOUNT'`, D18) · `actor_insurance_account_id uuid` (**sem FK**; só quando `actor_type='INSURANCE_ACCOUNT'`, ADR-021) · `action text NN` · `resource_type text NN` · `resource_id uuid` · `family_id uuid` · `subject_member_id uuid` · `result audit_result NN` · `ip inet` · `user_agent text` · `request_id text NN` · `metadata jsonb`
Sem FKs (sobrevive à eliminação de dados). Papel da aplicação: só `INSERT`; anonimização e purga por papel de manutenção separado. Ações do portal da clínica nunca preenchem `family_id`/`subject_member_id` (ADR-020: sem contexto de família).

**data_exports** — `requested_by FK→users CASCADE NN` · `family_id uuid` · `subject_member_id uuid` (ambos só na exportação de um dependente) · `reason export_reason NN` · `status export_status NN default 'PENDING'` · `storage_key text` · `expires_at`

**file_deletions** — `storage_key text NN` · `attempts int NN default 0` · `deleted_at timestamptz`

## 7. Enums

`user_status`(PENDING_VERIFICATION, ACTIVE, SUSPENDED) · `platform_role`(NONE, PLATFORM_ADMIN) · `auth_token_type`(EMAIL_VERIFICATION, PASSWORD_RESET) · `family_role`(FAMILY_ADMIN, FAMILY_MEMBER) · `member_status`(ACTIVE, BLOCKED) · `blood_type`(A_POS, A_NEG, B_POS, B_NEG, AB_POS, AB_NEG, O_POS, O_NEG, UNKNOWN) · `invitation_type`(MEMBER, DEPENDENT_ACCOUNT) · `invitation_status`(PENDING, ACCEPTED, REVOKED, EXPIRED) · `data_category`(ALLERGIES, CONDITIONS, MEDICATION, APPOINTMENTS, EXAMS) · `condition_kind`(CONDITION, HISTORY) · `prescription_status`(ACTIVE, COMPLETED, CANCELLED) · `prescription_issuer`(FAMILY, CLINIC) · `schedule_type`(FIXED_TIMES, INTERVAL) · `plan_status`(ACTIVE, ENDED) · `dose_status`(PENDING, TAKEN, NOT_TAKEN, UNCONFIRMED) · `appointment_status`(REQUESTED, SCHEDULED, REJECTED, COMPLETED, NO_SHOW, CANCELLED) · `exam_status`(REQUESTED, SCHEDULED, REJECTED, COMPLETED, CANCELLED — `REQUESTED`/`REJECTED` **obsoletos**, ADR-023 revisto; proibidos por CHECK em `examinations`) · `exam_issuer`(FAMILY, CLINIC) · `clinic_slot_kind`(APPOINTMENT, EXAM) · `scan_status`(PENDING, CLEAN, INFECTED) · `clinic_type`(PARTNER, PRIVATE) · `clinic_status`(ACTIVE, ARCHIVED) · `clinic_account_role`(CLINIC_ADMIN, CLINIC_MANAGER) · `clinic_account_status`(ACTIVE, SUSPENDED) · `alert_type`(MEDICATION_DUE, APPOINTMENT_REMINDER, EXAM_REMINDER, APPOINTMENT_OUTCOME_REQUEST, APPOINTMENT_CONFIRMED, APPOINTMENT_REJECTED, APPOINTMENT_CANCELLED, EXAM_CONFIRMED, EXAM_REJECTED (obsoletos, ADR-023 revisto, nunca gerados), EXAM_CANCELLED, EXAM_RESULTS_AVAILABLE, RECOMMENDATION_ADDED) · `alert_source`(DOSE, APPOINTMENT, EXAMINATION, RECOMMENDATION) · `channel`(PUSH, EMAIL) · `notification_status`(PENDING, SENT, FAILED, SKIPPED) · `actor_type`(USER, SYSTEM, PLATFORM_ADMIN, CLINIC_ACCOUNT, INSURANCE_ACCOUNT) · `audit_result`(SUCCESS, DENIED, FAILURE) · `export_reason`(USER_REQUEST, LEAVE_FAMILY, REMOVED_BY_ADMIN) · `export_status`(PENDING, READY, EXPIRED, FAILED) · `insurer_status`(ACTIVE, SUSPENDED) · `insurance_account_role`(INSURANCE_ADMIN, INSURANCE_AGENT) · `insurance_account_status`(ACTIVE, SUSPENDED) · `reimbursement_claim_status`(SUBMITTED, APPROVED, REJECTED, PAID)

> `appointment_status` e `alert_type` já incluíam `REQUESTED`/`REJECTED` e os tipos de alerta de resposta da clínica em `04-domain/entities.md`/`state-machines.md` (D17); a v0.2 só os trouxe para o esquema de BD, que estava pendente. `actor_type = INSURANCE_ACCOUNT` acrescenta-se já aqui (ADR-021), mesmo critério usado para `CLINIC_ACCOUNT` em v0.2; falta ainda acrescentar o catálogo de ações do portal da seguradora a `08-security/audit.md` §3 (o mesmo catálogo nunca chegou a listar as ações do portal da clínica — pendência pré-existente de D17/D18, não fechada por esta revisão).

## 8. Eliminação em cascata (resumo)
`users` → apaga `family_members` com `user_id` (e, por cascata, os seus registos), `sessions`, `auth_tokens`, `alerts`, etc. **Antes** de apagar: o serviço enfileira `file_deletions` para os `storage_key` dos documentos afetados, na mesma transação. `families` → cascata total (inclui `insurance_policies`/`reimbursement_claims`/`reimbursement_claim_documents` do membro, ADR-021). `audit_logs` nunca em cascata. `clinics` → cascata para `clinic_accounts`, `clinic_slots` (ADR-020: independente da cascata de `users`/`families`); `clinic_accounts` → cascata para `clinic_sessions`. Eliminar uma clínica parceira segue BR-CLN-02 (consultas existentes mantêm `clinic_name` em texto; `appointments.clinic_id`/`slot_id` ficam `NULL` por `SET NULL`). `insurer_accounts` → cascata para `insurance_accounts` (ADR-021, mirror de `clinics`→`clinic_accounts`); `insurance_accounts` → cascata para `insurance_sessions`. Como não há "seguradora privada" nem BR-CLN-02 equivalente, não há eliminação de `insurer_accounts` prevista no MVP desta funcionalidade — só suspensão (`status=SUSPENDED`); `reimbursement_claims.insurer_id` é `RESTRICT` por isso.

**ADR-023:** `recommendations` e `examinations.slot_id`/`recommendations` seguem a origem (cascata); `clinic_accounts` → `SET NULL` em `examinations.issued_by_clinic_account_id`, `recommendations.clinic_account_id`, `documents.uploaded_by_clinic_account_id` (rastreabilidade preservada pelo `audit_logs`); `insurer_accounts` → `SET NULL` em `insurance_policies.insurer_id`.

## 9. Extensões necessárias
`citext` (e-mail), `pgcrypto` ou `gen_random_uuid()` nativo (PG ≥13).
