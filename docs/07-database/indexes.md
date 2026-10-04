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
| `examinations` | `(member_id, exam_date DESC)` · `(status, exam_date) WHERE status='SCHEDULED'` | Listar; scanner. |
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
