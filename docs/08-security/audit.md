# Vita Family — Auditoria (Fase 14)

> Estado: **v0.1**. Requisitos: FR-AUD-01..03, BR-AUD-01..04, prompt §20.

## 1. Registo
`audit_logs` (ver `07-database/schema.md`): `occurredAt`, `actorType`, `actorUserId`, `action`, `resourceType`, `resourceId`, `familyId`, `subjectMemberId`, `result` (SUCCESS | DENIED | FAILURE), `ip`, `userAgent`, `requestId`, `metadata`.

Exemplo: `User 123 · VIEW · Examination · 456 · 2026-10-04 10:32 · SUCCESS`.

## 2. Regras
1. **Append-only** para a aplicação (papel de BD só com `INSERT`).
2. `metadata` **nunca** contém dados de saúde nem segredos; só identificadores, contagens, estados anteriores/novos de tipo enum.
3. A auditoria é escrita **na mesma transação** da ação (se a ação é confirmada, o registo existe). Negações (`DENIED`) escrevem-se numa transação própria.
4. **Leitura:** sem endpoint no MVP (P7); acesso só por operações com papel de BD de leitura, ele próprio auditado fora da aplicação.
5. **Anonimização (D15):** ao eliminar um User, `actorUserId`, `ip`, `userAgent` ficam a `NULL` (job de manutenção com papel próprio). Os `resourceId` de dados apagados permanecem (já não resolvem a nada).
6. **Retenção:** 24 meses; purga diária pelo mesmo papel de manutenção.

## 3. Catálogo mínimo de ações (`action`)

| Domínio | Ações |
|---|---|
| Autenticação | `AUTH_LOGIN`, `AUTH_LOGIN_FAILED`, `AUTH_LOGOUT`, `AUTH_REFRESH_REUSE_DETECTED`, `AUTH_PASSWORD_RESET`, `AUTH_PASSWORD_CHANGE`, `AUTH_EMAIL_VERIFIED` |
| Conta | `USER_UPDATE`, `USER_TERMS_ACCEPTED`, `USER_DELETE`, `USER_EXPORT_REQUEST`, `USER_EXPORT_DOWNLOAD` |
| Família | `FAMILY_CREATE`, `FAMILY_UPDATE`, `FAMILY_DELETE`, `MEMBER_CREATE`, `MEMBER_UPDATE`, `MEMBER_REMOVE`, `MEMBER_LEAVE`, `MEMBER_ROLE_CHANGE`, `MEMBER_BLOCKED`, `MEMBER_PURGED` |
| Tutela e convites | `GUARDIAN_ADD`, `GUARDIAN_REMOVE`, `GUARDIAN_PRIMARY_CHANGE`, `GUARDIANSHIP_ENDED_AT_18`, `DEPENDENT_SET`, `INVITATION_CREATE`, `INVITATION_REVOKE`, `INVITATION_ACCEPT` |
| Partilha | `SHARING_UPDATE` |
| Dados de saúde (leitura de **outro titular** e todas as escritas) | `HEALTH_VIEW`, `ALLERGY_*`, `CONDITION_*`, `BLOODTYPE_UPDATE`, `PRESCRIPTION_*`, `PLAN_*`, `DOSE_TAKEN`, `DOSE_NOT_TAKEN`, `DOSE_CORRECTED`, `APPOINTMENT_*`, `EXAM_*`, `EXAM_RESULT_*` (`*` = CREATE/UPDATE/DELETE/STATUS) |
| Documentos | `DOCUMENT_UPLOAD`, `DOCUMENT_SCAN_CLEAN`, `DOCUMENT_SCAN_INFECTED`, `DOCUMENT_DOWNLOAD`, `DOCUMENT_DELETE` |
| Relatórios | `REPORT_VIEW` (quando inclui outro titular) |
| Plataforma | `ADMIN_USER_SUSPEND`, `ADMIN_USER_REACTIVATE`, `ADMIN_CLINIC_CREATE/UPDATE/STATUS` |
| Acesso negado | `ACCESS_DENIED` (com ação tentada em `metadata.action`) |

**Não** se audita a leitura do titular sobre os seus próprios dados (volume e ruído), mas **sim** qualquer leitura por quem não é o titular, e **todo** download de documento.

## 4. Uso
Investigação de incidentes, resposta a pedidos de titulares (internos), deteção de padrões (muitas negações, `AUTH_REFRESH_REUSE_DETECTED`). Alertas operacionais sobre eventos de segurança em `10-operations/monitoring.md`.
