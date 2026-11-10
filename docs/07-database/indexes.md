# Vita Family — Índices (Fase 12)

> Estado: **v0.1**. Cada índice tem justificação de consulta. Não criar índices sem uma consulta concreta (simple first); rever com `EXPLAIN` no M10.

## Unicidade e integridade (já em `schema.md`)
`users(email)` · `auth_tokens(token_hash)` · `sessions(refresh_token_hash)` · `push_subscriptions(endpoint)` · `family_members(family_id,id)` · `family_members(family_id,user_id) WHERE user_id IS NOT NULL` · `guardianships(dependent_id,guardian_id)` · `guardianships(dependent_id) WHERE is_primary` · `sharing_grants(owner_member_id,grantee_member_id,category)` · `dose_occurrences(plan_id,scheduled_at)` · `alerts(dedupe_key)` · `notifications(alert_id,channel)` · `documents(storage_key)` · `invitations(token_hash)`

## Índices de desempenho

| Tabela | Índice | Consulta que serve |
|---|---|---|
| `family_members` | `(user_id)` | "As minhas famílias" (FR-FAM-02) e resolução do membro por User. |
| `family_members` | `(family_id)` | Listar membros. |
| `family_members` | `(scheduled_deletion_at) WHERE status='BLOCKED'` | Job de apagamento a 90 dias. |
| `family_members` | `(birth_date)` | Job de maioridade (avisos 30/7/0 dias); parcial por `is_dependent` se preciso. |
| `guardianships` | `(guardian_id)` | "Quem são os meus dependentes" (autorização e alertas). |
| `invitations` | `(family_id, status)` · `(email) WHERE status='PENDING'` · `(expires_at) WHERE status='PENDING'` | Listar pendentes; aceitar; job de expiração. |
| `sharing_grants` | `(grantee_member_id, category)` · `(owner_member_id)` | Resolver partilha por categoria e "partilhado comigo". |
| `allergies`, `medical_conditions` | `(member_id)` | Listagens por membro. |
| `prescriptions` | `(member_id, status, issued_on DESC)` | Lista por membro/estado. |
| `medication_plans` | `(member_id, status)` · `(prescription_id)` | Medicamentos ativos; planos de uma receita. |
| `medication_plans` | `(status, end_at) WHERE status='ACTIVE' AND end_at IS NOT NULL` | Terminar planos por duração. |
| `dose_occurrences` | `(status, scheduled_at) WHERE status IN ('PENDING','UNCONFIRMED')` | **Scanner de alertas** e marcação UNCONFIRMED. |
| `dose_occurrences` | `(plan_id, scheduled_at)` (único) | Geração e histórico por plano. |
| `dose_occurrences` | `(member_id, scheduled_at DESC)` | Agenda do dia e histórico/adesão. |
| `appointments` | `(member_id, scheduled_at)` · `(status, scheduled_at) WHERE status='SCHEDULED'` | Listar; scanner de lembretes/desfecho. |
| `appointments` (M14 Q) | `(clinic_id, scheduled_at) WHERE clinic_id IS NOT NULL` · `(clinic_id, followup_due_on) WHERE followup_due_on IS NOT NULL` · `(scheduled_at) WHERE status='SCHEDULED' AND confirmation_status='PENDING' AND slot_id IS NOT NULL` | Agenda/Hoje/relatórios da clínica por período; lista de retornos; scanner do pedido de confirmação de 48 h. |
| `examinations` | `(member_id, exam_date DESC)` · `(status, exam_date) WHERE status='SCHEDULED'` | Listar; scanner. |
| `examinations` | `(slot_id) WHERE status = 'SCHEDULED'` (**não único**, `0022`) · `(slot_id, member_id) WHERE status = 'SCHEDULED'` (único, `0022`) · `(clinic_id, status, scheduled_at)` | Contagem de vagas ocupadas por horário (BR-APT-11; o limite é imposto pelo bloqueio da linha do horário, não por índice); um membro não ocupa 2 vagas do mesmo horário; agenda da clínica (D19). Substitui o único `(slot_id) WHERE status IN ('REQUESTED','SCHEDULED')` de `0021`. |
| `clinic_slots` | `(clinic_id, kind, starts_at)` | Horários livres por tipo (D19). |
| `clinic_slots` | `(professional_id, starts_at) WHERE professional_id IS NOT NULL` (+ a `EXCLUDE` gist e o UNIQUE parcial `(schedule_rule_id, starts_at)` de `schema.md` §3a) | Calendário por profissional, deteção de sobreposição, bloqueios e geração idempotente (M14 a2). |
| `clinic_professionals` · `clinic_service_types` | `(clinic_id, active)` | Listar o catálogo da clínica (M14 a1). |
| `clinic_schedule_rules` | `(clinic_id, active)` · `(professional_id) WHERE active` | Job de geração e regras do profissional (M14 a2). |
| `clinic_time_off` | `(professional_id, ends_at)` | Bloqueios futuros do profissional na geração/listagem (M14 a2). |
| `clinic_patients` | `(clinic_id, name_norm, id)` · `(clinic_id, phone_digits) WHERE phone_digits IS NOT NULL` · `(clinic_id, email) WHERE email IS NOT NULL` | Listagem paginada por nome (cursor) e pesquisa; a pesquisa "contém" faz varrimento **dentro da clínica** (volume esperado de milhares; `pg_trgm` só se medir necessário) (M14 P). |
| `clinic_patient_links` | UNIQUE `(clinic_patient_id)` · UNIQUE `(clinic_id, member_id)` · `(member_id)` | Resolver paciente↔membro; apagar/listar por membro (M14 P). |
| `clinic_consents` | UNIQUE `(clinic_id, member_id)` · `(member_id)` | Consentimento efetivo; "quem vê o quê" (M14 P). |
| `clinic_link_codes` | UNIQUE `(code_hash)` · `(member_id) WHERE used_at IS NULL` · `(expires_at)` | Consumo do código, invalidar anteriores, job de limpeza (M14 P). |
| `clinic_visits` | `(clinic_id, scheduled_at)` · `(clinic_patient_id, scheduled_at DESC)` · UNIQUE parcial `(slot_id) WHERE status='SCHEDULED' AND slot_id IS NOT NULL` | Calendário, ficha e ocupação do horário (M14 P). |
| `clinic_visits` (M14 Q) | `(clinic_id, followup_due_on) WHERE followup_due_on IS NOT NULL` | Lista de retornos por tratar (as visitas já têm `(clinic_id, scheduled_at)` para Hoje e relatórios). |
| `clinic_receipts` (M14 R) | UNIQUE `(clinic_id, number)` · UNIQUE parcial `(clinic_id, booking_kind, booking_id) WHERE status='ISSUED'` · `(clinic_id, issued_at DESC, id DESC)` | Numeração sem repetições, um recibo ativo por marcação (BR-CLN-31/32); Financeiro por período com cursor (BR-CLN-37); o total do período usa o mesmo índice. |
| `clinic_receipt_lines` / `clinic_receipt_links` / `reimbursement_claim_receipts` (M14 R) | UNIQUE `(receipt_id, position)` · `clinic_receipt_links (member_id, created_at DESC)` · `reimbursement_claim_receipts (receipt_id)` | Linhas por recibo; lista de recibos do membro na app; verificar anexos ativos de um recibo. |
| `clinic_accounts` (M14 R) | UNIQUE parcial `(professional_id) WHERE professional_id IS NOT NULL` | Uma conta Médico por profissional (BR-CLN-39). |
| `audit_logs` (M14 R) | `(actor_clinic_id, occurred_at DESC, id DESC) WHERE actor_clinic_id IS NOT NULL` | `GET /clinic-portal/audit` (BR-CLN-40); sem custo para as restantes entradas (índice parcial). |
| `clinic_slots` / `appointments` / `clinic_visits` (M14 R, filtro do Médico) | reutiliza `clinic_slots (professional_id, starts_at)` (a2) e o UNIQUE parcial `clinic_visits (slot_id)`; acrescenta `appointments (slot_id) WHERE slot_id IS NOT NULL` (`CREATE INDEX IF NOT EXISTS`) | Filtrar marcações e pacientes por `slot.professional_id` (BR-CLN-39) sem varrimento. |
| `clinic_consultation_reports` (M15 S) | UNIQUE `(clinic_id, booking_kind, booking_id)` · `(clinic_id, clinic_patient_id) WHERE clinic_patient_id IS NOT NULL` · `(clinic_id, id)` (alvo da FK composta) | Relatório por marcação (portal e leitura do paciente, BR-CLN-41/45); relatórios na ficha do paciente. |
| `clinic_consultation_report_addenda` (M15 S) | `(clinic_id, report_id, created_at)` | Adendas por relatório (≤20). |
| `documents` (M15 T) | UNIQUE parcial `(examination_id) WHERE generated_by_system` | Um laudo gerado por exame (BR-CLN-49). |
| `clinic_exam_orders` (M15 U) | `(clinic_id, booking_id) WHERE status <> 'CANCELLED'` · `(clinic_id, clinic_patient_id) WHERE clinic_patient_id IS NOT NULL` · `(clinic_id, id)` (alvo de FK composta) | Pedidos ativos por marcação (portal, PDF, limite de 5, BR-CLN-51/54); pedidos na ficha do paciente. |
| `clinic_exam_order_links` (M15 U) | PK `(order_id)` · `(family_id, member_id, created_at DESC)` · `(appointment_id)` · UNIQUE parcial `(examination_id) WHERE examination_id IS NOT NULL` | Lista do membro e cartão da consulta (BR-CLN-53); `release`/`fulfil` por exame (BR-CLN-52). |
| `recommendations` | `(member_id, created_at DESC)` · `(appointment_id)` · `(examination_id)` · `(clinic_id, created_at DESC)` | Leitura pelo paciente; listagem da clínica (D19). |
| `documents` | `(uploaded_by_clinic_account_id) WHERE uploaded_by_clinic_account_id IS NOT NULL` | Documentos emitidos pela clínica (D19). |
| `exam_results` | `(examination_id)` · `(parameter)` por membro via join | Histórico de um parâmetro. |
| `documents` | `(prescription_id)` · `(examination_id)` · `(family_id)` · `(scan_status) WHERE scan_status='PENDING'` | Documentos do recurso; quota por família (soma de `size_bytes`); fila de antivírus. |
| `clinics` | `(type, status)` · `(family_id)` | Listar parceiras e privadas. |
| `alerts` | `(recipient_user_id, read_at, trigger_at DESC)` | Lista de alertas por utilizador, não lidos primeiro. |
| `alerts` | `(source_type, source_id)` | Cancelar/recalcular alertas ao editar recurso. |
| `notifications` | `(status, next_attempt_at) WHERE status IN ('PENDING','FAILED')` | Fila de envio/retry. |
| `sessions` | `(user_id)` · `(expires_at)` | Revogar sessões; limpeza. |
| `auth_tokens` | `(user_id, type)` · `(expires_at)` | Invalidar anteriores; limpeza. |
| `audit_logs` | `(occurred_at)` · `(actor_user_id, occurred_at)` · `(family_id, occurred_at)` | Purga a 24 meses; investigações. Particionamento mensal avaliado se o volume o justificar. |
| `file_deletions` | `(deleted_at) WHERE deleted_at IS NULL` | Worker de apagamento. |

## Regras
1. Índices parciais exigem SQL manual nas migrações (ADR-003).
2. Antes de M10, validar os 5 caminhos quentes: scanner, agenda do dia, lista de alertas, resolução de membership, relatório individual.
