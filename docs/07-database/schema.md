# Vita Family — Esquema da base de dados (Fase 12)

> **Pendente (D17, change control 2026-10-05):** acrescentar ClinicSlot, ClinicStaff, os estados REQUESTED/REJECTED de Appointment e as operações do portal da clínica. Até lá, este documento não cobre a marcação com clínica parceira (ver `00-product/discovery.md` → D17).

> Estado: **v0.1**. PostgreSQL 16. Nomes em `snake_case`, tabelas no plural. Derivado de `04-domain/entities.md`.
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

## 3. Registos de saúde (todos: `family_id NN`, `member_id NN`, FK composta CASCADE)

**allergies** — `name text NN` · `notes text` · `since date`

**medical_conditions** — `name text NN` · `kind condition_kind NN` · `notes` · `since date` · `until date` · CHECK `until >= since`

**prescriptions** — `issued_on date NN` · `doctor_name` · `notes` · `status prescription_status NN default 'ACTIVE'` · CHECK `issued_on <= current_date`

**medication_plans**
`prescription_id uuid FK→prescriptions CASCADE` (nulo = avulso) · `name text NN` · `dosage text NN` · `schedule_type schedule_type NN` · `times text[]` (HH:mm) · `days_of_week smallint[]` · `interval_hours int` · `start_at timestamptz NN` · `end_at timestamptz` · `continuous bool NN default false` · `notes` · `status plan_status NN default 'ACTIVE'` · `ended_at`
CHECK `(schedule_type='FIXED_TIMES' AND cardinality(times)>0 AND interval_hours IS NULL) OR (schedule_type='INTERVAL' AND interval_hours BETWEEN 1 AND 168 AND times IS NULL)` · CHECK `continuous <> (end_at IS NOT NULL)` · CHECK `end_at > start_at`.

**dose_occurrences**
`plan_id FK→medication_plans CASCADE NN` · `scheduled_at timestamptz NN` · `status dose_status NN default 'PENDING'` · `acted_at` · `acted_by_user_id FK→users SET NULL` · `note text` · `generation_version int NN default 1`
UNIQUE `(plan_id, scheduled_at)`. (`family_id`, `member_id` desnormalizados para filtro/FK composta.)

**appointments** — `scheduled_at timestamptz NN` · `status appointment_status NN default 'SCHEDULED'` · `professional_name` · `clinic_id FK→clinics SET NULL` · `clinic_name text` · `reason` · `notes` · `outcome_requested_at`

**examinations** — `name text NN` · `exam_date date NN` · `status exam_status NN default 'SCHEDULED'` · `clinic_id FK→clinics SET NULL` · `clinic_name` · `notes`

**exam_results** — `examination_id FK→examinations CASCADE NN` · `parameter text NN` · `value_numeric numeric` · `value_text text` · `unit text` · `reference_min numeric` · `reference_max numeric` · CHECK `value_numeric IS NOT NULL OR value_text IS NOT NULL` · CHECK `reference_min <= reference_max`

**documents**
`family_id NN` · `member_id NN` · `prescription_id FK→prescriptions CASCADE` · `examination_id FK→examinations CASCADE` · `storage_key text NN UNIQUE` · `original_name text NN` · `mime_type text NN` · `size_bytes bigint NN` · `checksum_sha256 text NN` · `scan_status scan_status NN default 'PENDING'` · `uploaded_by FK→users SET NULL`
CHECK `num_nonnulls(prescription_id, examination_id) = 1` · CHECK `size_bytes BETWEEN 1 AND 10485760`.

**clinics**
`type clinic_type NN` · `family_id FK→families CASCADE` · `name text NN` · `address` · `phone` · `email` · `status clinic_status NN default 'ACTIVE'` · `created_by FK→users SET NULL`
CHECK `(type='PRIVATE') = (family_id IS NOT NULL)`.

## 4. Alertas

**alerts**
`recipient_user_id FK→users CASCADE NN` · `family_id FK→families CASCADE NN` · `member_id NN` (FK composta) · `type alert_type NN` · `source_type alert_source NN` · `source_id uuid NN` · `rule_key text NN` · `dedupe_key text NN UNIQUE` · `trigger_at timestamptz NN` · `read_at`

**notifications**
`alert_id FK→alerts CASCADE NN` · `channel channel NN` · `status notification_status NN default 'PENDING'` · `attempts int NN default 0` · `next_attempt_at timestamptz` · `last_error_code text` · `sent_at` · UNIQUE `(alert_id, channel)`

## 5. Transversal

**audit_logs** (append-only)
`id bigserial PK` · `occurred_at timestamptz NN default now()` · `actor_type actor_type NN` · `actor_user_id uuid` (**sem FK**, permite anonimizar) · `action text NN` · `resource_type text NN` · `resource_id uuid` · `family_id uuid` · `subject_member_id uuid` · `result audit_result NN` · `ip inet` · `user_agent text` · `request_id text NN` · `metadata jsonb`
Sem FKs (sobrevive à eliminação de dados). Papel da aplicação: só `INSERT`; anonimização e purga por papel de manutenção separado.

**data_exports** — `requested_by FK→users CASCADE NN` · `subject_member_id uuid` · `reason export_reason NN` · `status export_status NN default 'PENDING'` · `storage_key text` · `expires_at`

**file_deletions** — `storage_key text NN` · `attempts int NN default 0` · `deleted_at timestamptz`

## 6. Enums

`user_status`(PENDING_VERIFICATION, ACTIVE, SUSPENDED) · `platform_role`(NONE, PLATFORM_ADMIN) · `auth_token_type`(EMAIL_VERIFICATION, PASSWORD_RESET) · `family_role`(FAMILY_ADMIN, FAMILY_MEMBER) · `member_status`(ACTIVE, BLOCKED) · `blood_type`(A_POS, A_NEG, B_POS, B_NEG, AB_POS, AB_NEG, O_POS, O_NEG, UNKNOWN) · `invitation_type`(MEMBER, DEPENDENT_ACCOUNT) · `invitation_status`(PENDING, ACCEPTED, REVOKED, EXPIRED) · `data_category`(ALLERGIES, CONDITIONS, MEDICATION, APPOINTMENTS, EXAMS) · `condition_kind`(CONDITION, HISTORY) · `prescription_status`(ACTIVE, COMPLETED, CANCELLED) · `schedule_type`(FIXED_TIMES, INTERVAL) · `plan_status`(ACTIVE, ENDED) · `dose_status`(PENDING, TAKEN, NOT_TAKEN, UNCONFIRMED) · `appointment_status`(SCHEDULED, COMPLETED, NO_SHOW, CANCELLED) · `exam_status`(SCHEDULED, COMPLETED, CANCELLED) · `scan_status`(PENDING, CLEAN, INFECTED) · `clinic_type`(PARTNER, PRIVATE) · `clinic_status`(ACTIVE, ARCHIVED) · `alert_type`(MEDICATION_DUE, APPOINTMENT_REMINDER, EXAM_REMINDER, APPOINTMENT_OUTCOME_REQUEST) · `alert_source`(DOSE, APPOINTMENT, EXAMINATION) · `channel`(PUSH, EMAIL) · `notification_status`(PENDING, SENT, FAILED, SKIPPED) · `actor_type`(USER, SYSTEM, PLATFORM_ADMIN) · `audit_result`(SUCCESS, DENIED, FAILURE) · `export_reason`(USER_REQUEST, LEAVE_FAMILY, REMOVED_BY_ADMIN) · `export_status`(PENDING, READY, EXPIRED, FAILED)

## 7. Eliminação em cascata (resumo)
`users` → apaga `family_members` com `user_id` (e, por cascata, os seus registos), `sessions`, `auth_tokens`, `alerts`, etc. **Antes** de apagar: o serviço enfileira `file_deletions` para os `storage_key` dos documentos afetados, na mesma transação. `families` → cascata total. `audit_logs` nunca em cascata.

## 8. Extensões necessárias
`citext` (e-mail), `pgcrypto` ou `gen_random_uuid()` nativo (PG ≥13).
