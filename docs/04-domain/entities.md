# Vita Family — Entidades (Fase 9)

> Estado: **v0.1**. Fonte para `07-database/schema.md` e `05-api`. Tipos lógicos; os tipos físicos estão em `schema.md`.
> Convenções: `id` UUID; `createdAt`/`updatedAt` em UTC em todas, salvo indicação; `?` = opcional.
> **Categoria** indica a categoria de privacidade (C2–C6) dos registos de saúde.

## Identidade e acesso

### User
**Propósito:** conta de acesso. **Identificador:** `id`.
`email` (único, minúsculas) · `passwordHash` · `name` · `birthDate` · `timezone` (IANA) · `status` (PENDING_VERIFICATION | ACTIVE | SUSPENDED) · `platformRole` (NONE | PLATFORM_ADMIN) · `emailVerifiedAt?` · `termsAcceptedVersion` · `termsAcceptedAt` · `suspendedAt?` · `suspensionReason?`
**Regras:** BR-ACC-01..07. **Ciclo de vida:** ver `state-machines.md` (User).

### AuthToken
Tokens de uso único: verificação de e-mail e recuperação de palavra-passe.
`userId` · `type` (EMAIL_VERIFICATION | PASSWORD_RESET) · `tokenHash` · `expiresAt` · `usedAt?`

### Session
Sessão com refresh token rotativo.
`userId` · `refreshTokenHash` · `familyTokenId` (cadeia de rotação, para deteção de reutilização) · `userAgent?` · `ip?` · `expiresAt` · `revokedAt?` · `lastUsedAt`

### NotificationPreference
1:1 com User. `pushEnabled` · `emailEnabled` · `medicationDue` · `appointmentReminder` · `examReminder` (todos booleanos, por defeito verdadeiros).

### PushSubscription
`userId` · `endpoint` (único) · `p256dh` · `auth` · `userAgent?` · `lastSuccessAt?`

## Família e pessoas

### Family
`name` · `createdBy`. Fronteira de isolamento.

### FamilyMember
**Propósito:** pessoa numa família; sujeito dos dados de saúde.
`familyId` · `userId?` (único por família quando presente) · `name` · `birthDate` · `role?` (FAMILY_ADMIN | FAMILY_MEMBER; só com conta) · `isDependent` · `bloodType?` (A+, A-, B+, B-, AB+, AB-, O+, O-, UNKNOWN; categoria C2) · `status` (ACTIVE | BLOCKED) · `blockedAt?` · `scheduledDeletionAt?` (BR-MEM-11)
**Derivados (não guardados):** `isMinor` (idade <18), `hasAccount` (`userId` não nulo).

### Guardianship
Relação tutor↔dependente (N1). `familyId` · `dependentId` · `guardianId` · `isPrimary`
**Regras:** BR-MEM-03..08; um principal por dependente.

### Invitation
`familyId` · `email` · `type` (MEMBER | DEPENDENT_ACCOUNT) · `memberId?` (perfil a ligar) · `tokenHash` · `status` (PENDING | ACCEPTED | REVOKED | EXPIRED) · `expiresAt` (7 dias) · `invitedBy` · `acceptedBy?` · `acceptedAt?`
**Regras:** BR-MEM-12, BR-MEM-17; DEPENDENT_ACCOUNT exige `memberId` de dependente com ≥13 anos.

### SharingGrant
`familyId` · `ownerMemberId` · `granteeMemberId?` (nulo = toda a família, DM3) · `category` (ALLERGIES | CONDITIONS | MEDICATION | APPOINTMENTS | EXAMS) · `grantedBy`
**Regras:** BR-PRV-01..04, leitura apenas (BR-PRV-03).

## Registos de saúde (todos com `familyId` e `memberId`)

### Allergy — categoria C2
`name` · `notes?` · `since?` (date)

### MedicalCondition — categoria C3
`name` · `kind` (CONDITION | HISTORY) · `notes?` · `since?` · `until?`

### Prescription — categoria C4
`issuedOn` (date, obrigatória, não futura) · `doctorName?` · `notes?` · `status` (ACTIVE | COMPLETED | CANCELLED)
Tem 1+ MedicationPlan e 0..5 Documents.

### MedicationPlan — categoria C4
`prescriptionId?` · `name` (texto livre) · `dosage` (texto livre) · `scheduleType` (FIXED_TIMES | INTERVAL) · `times?` (lista HH:mm locais, FIXED_TIMES) · `daysOfWeek?` (1–7, vazio = todos) · `intervalHours?` (INTERVAL) · `startAt` (UTC) · `endAt?` (UTC) · `continuous` (bool) · `notes?` · `status` (ACTIVE | ENDED) · `endedAt?`
**Regras:** BR-MED-01/02, BR-RX-02/05. `endAt` ou `continuous` obrigatório (um exclui o outro).

### DoseOccurrence — categoria C4
`planId` · `scheduledAt` (UTC) · `status` (PENDING | TAKEN | NOT_TAKEN | UNCONFIRMED) · `actedAt?` · `actedByUserId?` · `note?` · `generationVersion` (para recalcular sem perder histórico)
Único (`planId`, `scheduledAt`).

### Appointment — categoria C5
`scheduledAt` (UTC) · `status` (REQUESTED | SCHEDULED | REJECTED | COMPLETED | NO_SHOW | CANCELLED) · `professionalName?` · `clinicId?` · `clinicName?` (texto de reserva, BR-CLN-02) · `slotId?` (horário da clínica parceira, D17) · `responseNote?` (motivo da clínica ao recusar/cancelar, D17) · `reason?` · `notes?` · `outcomeRequestedAt?`

### Examination — categoria C6
`name` · `examDate` (date) · `status` (SCHEDULED | COMPLETED | CANCELLED) · `clinicId?` · `clinicName?` · `notes?`

### ExamResult — categoria C6
`examinationId` · `parameter` · `valueNumeric?` · `valueText?` · `unit?` · `referenceMin?` · `referenceMax?` (informados pelo utilizador). Pelo menos um de `valueNumeric`/`valueText`.

### Document — categoria do recurso associado
`familyId` · `memberId` · `resourceType` (PRESCRIPTION | EXAMINATION) · `resourceId` · `storageKey` · `originalName` · `mimeType` · `sizeBytes` · `checksumSha256` · `scanStatus` (PENDING | CLEAN | INFECTED) · `uploadedBy`
Máx. 5 por recurso e 100 MB por família (Q10).

### Clinic
`type` (PARTNER | PRIVATE) · `familyId?` (obrigatório se PRIVATE, nulo se PARTNER) · `name` · `address?` · `phone?` · `email?` · `status` (ACTIVE | ARCHIVED) · `createdBy`

### ClinicSlot — horário publicado por uma clínica parceira (D17)
`clinicId` (PARTNER) · `specialty` · `professionalName?` · `startsAt` (UTC) · `durationMinutes`
**Regras:** BR-APT-06, BR-CLN-04. Livre = sem consulta PEDIDA ou AGENDADA associada.

### ClinicStaff — Gestor da clínica (D17)
`clinicId` (PARTNER) · `userId` · `role` (CLINIC_MANAGER) · `createdBy` (Platform Admin)
Sem relação com Family: o Gestor não é membro de nenhuma família por esta via.

## Alertas

### Alert
`recipientUserId` · `familyId` · `memberId` (sujeito) · `type` (MEDICATION_DUE | APPOINTMENT_REMINDER | EXAM_REMINDER | APPOINTMENT_OUTCOME_REQUEST | APPOINTMENT_CONFIRMED | APPOINTMENT_REJECTED | APPOINTMENT_CANCELLED) · `sourceType` (DOSE | APPOINTMENT | EXAMINATION) · `sourceId` · `ruleKey` (ex.: `dose.due`, `dose.repeat`, `appointment.24h`, `appointment.2h`, `exam.24h`, `appointment.outcome`, `appointment.confirmed`, `appointment.rejected`, `appointment.cancelled` — respostas da clínica parceira, D17/FR-APT-07) · `dedupeKey` (único) · `triggerAt` · `readAt?`

### Notification
Entrega de um Alert num canal. `alertId` · `channel` (PUSH | EMAIL) · `status` (PENDING | SENT | FAILED | SKIPPED) · `attempts` · `nextAttemptAt?` · `lastErrorCode?` · `sentAt?`

## Transversal

### AuditLog
`occurredAt` · `actorType` (USER | SYSTEM | PLATFORM_ADMIN) · `actorUserId?` · `action` · `resourceType` · `resourceId?` · `familyId?` · `subjectMemberId?` · `result` (SUCCESS | DENIED | FAILURE) · `ip?` · `userAgent?` · `requestId` · `metadata?` (sem dados de saúde)

### DataExport
`requestedByUserId` · `subjectMemberId?` (dependente) · `reason` (USER_REQUEST | LEAVE_FAMILY | REMOVED_BY_ADMIN) · `status` (PENDING | READY | EXPIRED | FAILED) · `storageKey?` · `expiresAt?`

### FileDeletion (outbox)
Fila de ficheiros a apagar do armazenamento depois de a linha de BD ser removida (garante apagamento definitivo, NFR-DATA-05). `storageKey` · `attempts` · `deletedAt?`
