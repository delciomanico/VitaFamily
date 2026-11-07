# Vita Family — Entidades (Fase 9)

> Estado: **v0.5** — módulo operacional de seguradoras (ADR-025: secção própria; `InsurerAccount.currency`/`operationalModuleEnabled`; papéis alargados); v0.4 — `ClinicSlot.capacity` e exame marcado diretamente (`SCHEDULED`, sem pedido/recusa; ADR-023 revisto 2026-11-04); v0.3: `ClinicSlot.kind`, `Examination` emitido pela clínica, `Recommendation`, `InsurancePolicy.insurerId` (ADR-023, D19); v0.2 acrescenta o portal da seguradora parceira (ADR-021); corrige a secção do portal da clínica (`ClinicAccount`, D18) que ainda referia a suposição revista `ClinicStaff(userId,...)`. Fonte para `07-database/schema.md` e `05-api`. Tipos lógicos; os tipos físicos estão em `schema.md`.
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
`scheduledAt` (UTC) · `status` (REQUESTED | SCHEDULED | REJECTED | COMPLETED | NO_SHOW | CANCELLED) · `professionalName?` · `specialty?` · `clinicId?` · `clinicName?` (texto de reserva, BR-CLN-02) · `slotId?` (horário da clínica parceira, D17) · `responseNote?` (motivo da clínica ao recusar/cancelar, D17) · `reason?` · `notes?` · `outcomeRequestedAt?`

### Examination — categoria C6
`name` · `examDate` (date) · `scheduledAt?` (UTC; só em exame de horário da clínica, D19) · `status` (SCHEDULED | COMPLETED | CANCELLED; `REQUESTED`/`REJECTED` obsoletos, só no enum de BD, state-machines.md) · `clinicId?` · `clinicName?` · `slotId?` (horário `EXAM` de origem, D19) · `responseNote?` (motivo da clínica ao cancelar) · `notes?` · `issuedBy` (FAMILY | CLINIC, default FAMILY) · `issuedByClinicAccountId?` · `resultsIssuedAt?` · `clinicResultNote?` (nota livre da clínica ao completar)
**Regras:** BR-CLN-07/08, BR-EXM-05..08. `issuedBy=CLINIC` ⇔ `issuedByClinicAccountId` preenchido (espelho de BR-RX-07).

### ExamResult — categoria C6
`examinationId` · `parameter` · `valueNumeric?` · `valueText?` · `unit?` · `referenceMin?` · `referenceMax?` (informados pelo utilizador). Pelo menos um de `valueNumeric`/`valueText`.

### Recommendation — categoria da origem (APPOINTMENTS ou EXAMS) — D19, ADR-023
`familyId` · `memberId` · `clinicId?` · `clinicName` (texto de reserva) · `clinicAccountId?` (autor, rastreabilidade) · `appointmentId?` · `examinationId?` (exatamente um) · `text` (1–2000 caracteres; dado de saúde, BR-HLT-05) · `createdAt`
**Regras:** BR-CLN-09. Só a clínica da origem a cria (origem `SCHEDULED`/`COMPLETED`); imutável; cascata com a origem. Lida segundo a categoria da origem.

### Document — categoria do recurso associado
`familyId` · `memberId` · `resourceType` (PRESCRIPTION | EXAMINATION | INSURANCE_POLICY, ADR-021) · `resourceId` · `storageKey` · `originalName` · `mimeType` · `sizeBytes` · `checksumSha256` · `scanStatus` (PENDING | CLEAN | INFECTED) · `uploadedBy?` (User) · `uploadedByClinic` (bool, marca permanente de PDF emitido pela clínica, BR-CLN-08) · `uploadedByClinicAccountId?` (autor; nulo se a conta for removida; nunca em simultâneo com `uploadedBy`)
Máx. 5 por recurso e 100 MB por família (Q10). `INSURANCE_POLICY` reaproveita o upload existente para a foto do cartão (ADR-021) — sem porta/endpoint de upload novo.

### Clinic
`type` (PARTNER | PRIVATE) · `familyId?` (obrigatório se PRIVATE, nulo se PARTNER) · `name` · `address?` · `phone?` · `email?` · `status` (ACTIVE | ARCHIVED) · `createdBy`

### ClinicSlot — horário publicado por uma clínica parceira (D17)
`clinicId` (PARTNER) · `kind` (APPOINTMENT | EXAM, default APPOINTMENT; D19) · `specialty` (em `EXAM`: tipo de exame) · `professionalName?` · `startsAt` (UTC) · `durationMinutes` · `capacity` (1–50, default 1; só `EXAM` pode ser > 1; BR-APT-11)
**Regras:** BR-APT-06/10/11, BR-CLN-04. `APPOINTMENT`: livre = sem consulta PEDIDA/AGENDADA. `EXAM`: `bookedCount` = exames `SCHEDULED` com este `slotId`; `remaining = capacity − bookedCount`; cheio quando `remaining = 0`.

**M14 a1/a2 (ADR-026):** `ClinicSlot` ganha `professionalId?` (→ `ClinicProfessional`), `serviceTypeId?` (→ `ClinicServiceType`), `scheduleRuleId?` (→ `ClinicScheduleRule`; preenchido só nos horários gerados) e `endsAt` (= `startsAt + durationMinutes`, derivado, usado na deteção de sobreposição). Nulos nos horários manuais antigos (retrocompatível). **Regras:** BR-CLN-12/13/14.

### ClinicProfessional — profissional do catálogo da clínica (M14 a1)
`clinicId` (PARTNER) · `name` (1–120) · `specialty?` (≤80, informativa) · `active`
**Regras:** BR-CLN-11/15. Desativa-se, não se apaga. Sem ligação a `User`/`ClinicAccount` (a fase (f) acrescenta `ClinicAccount.professionalId`).

### ClinicServiceType — tipo de consulta ou de exame do catálogo (M14 a1)
`clinicId` · `name` (1–120) · `kind` (APPOINTMENT | EXAM; imutável) · `durationMinutes` (15, 20, 30, 45, 60) · `priceMinor?` (inteiro, cêntimos, ≥ 0; informativo) · `active` · `currency` (derivada de `Clinic.currency`, só leitura; omissão AOA)
**Regras:** BR-CLN-11/12.

### ClinicScheduleRule — regra semanal que gera horários (M14 a2)
`clinicId` · `professionalId` · `serviceTypeId` (imutáveis) · `weekdays` (ISO 1–7) · `startTime`/`endTime` (hora local, `[start, end)`) · `validFrom?`/`validUntil?` (dias locais) · `capacity` (1–50; > 1 só `EXAM`) · `active`
**Regras:** BR-CLN-12/13/15. Gera `ClinicSlot` numa janela de 8 semanas, de forma idempotente. Desativa-se, não se apaga.

### ClinicTimeOff — bloqueio/férias de um profissional (M14 a2)
`clinicId` · `professionalId` · `startsAt` · `endsAt` (> `startsAt`, ≤ 366 dias) · `reason?` (≤200, nota interna) · `createdByClinicAccountId?`
**Regras:** BR-CLN-14. Remove só horários livres; os marcados são sinalizados.

**`Clinic.currency`** (M14 a1): código ISO 4217 de 3 letras, omissão `AOA`; só leitura em a1/a2 (a fase (e) decide a configuração). **`Appointment.durationMinutes`** (M14 a2, interno): duração da marcação (copiada do horário; 30 se não houver); BR-CLN-16.

### ClinicPatient — paciente da clínica (M14 P)
`clinicId` (PARTNER) · `name` (1–120) · `phone?` · `email?` (contacto da clínica; nunca procura contas Vita) · `birthDate?` · `notes?` (≤2000, internas) · `origin` (MANUAL | VITA; imutável) · `createdByClinicAccountId?`
Derivado: `vitaLink?` = `{via (EMAIL | CODE), consentLevel?, consentValidUntil?}` (da `ClinicPatientLink` e do `ClinicConsent`; **sem ids Vita**).
**Regras:** BR-CLN-17/22/24. Registo da **clínica** (responsável pelo tratamento, ADR-026), separado de `FamilyMember`. Sem eliminação nesta fase (OP-32).

### ClinicPatientLink — ligação servidor paciente da clínica ↔ membro Vita (M14 P)
`clinicId` · `clinicPatientId` (único) · `familyId` · `memberId` (único por clínica) · `via` (EMAIL | CODE)
**Regras:** BR-CLN-18/19/20/24. **Única** ponte para ids Vita; nunca exposta pela API do portal; apagada com o membro/conta/família ou na revogação do consentimento.

### ClinicConsent — consentimento do paciente por clínica (M14 P)
`clinicId` · `familyId` · `memberId` · `level` (BOOKINGS | HISTORY) · `historyValidUntil?` (HISTORY: agora + 12 meses, renovável) · `grantedByUserId?`
Único por `(clinicId, memberId)`. Nível **efetivo**: `HISTORY` só enquanto `historyValidUntil > now`, senão `BOOKINGS`. Revogar = apagar.
**Regras:** BR-CLN-19/21. Concedido/revogado só por `SELF` adulto ou `TUTOR_OF`; direção paciente → clínica; categorias internas `MEDICATION` + `EXAMS` mapeadas ao nível `HISTORY`.

### ClinicLinkCode — código de ligação gerado pelo paciente (M14 P)
`familyId` · `memberId` · `codeHash` (HMAC-SHA256; nunca o código) · `expiresAt` (+10 min) · `usedAt?` · `createdByUserId?`
**Regras:** BR-CLN-20. Uso único; um ativo por membro; apagado diariamente depois de expirar/usar.

### ClinicVisit — visita presencial de um paciente da clínica sem ligação Vita (M14 P)
`clinicId` · `clinicPatientId` · `slotId?` · `scheduledAt` · `durationMinutes` · `status` (SCHEDULED | COMPLETED | CANCELLED) · `notes?` · `outcomeNote?` · `cancelNote?` · `bookedByClinicAccountId?`
**Regras:** BR-CLN-18. Só da clínica (não está na app Vita, sem lembretes); ocupa o horário (BR-APT-06); estados e janela como a consulta (ST4); sem receita.

### ClinicAccount — conta do portal da clínica (D18, ADR-020)
**Correção (ADR-021):** esta secção referia-se antes a `ClinicStaff(userId, clinicId, role)`, suposição
revista por D18 — a conta do portal **não** é um `User`. Alinhado aqui com `schema.md` §3 (`clinic_accounts`).
`clinicId` (PARTNER) · `email` · `passwordHash` · `role` (CLINIC_ADMIN | CLINIC_MANAGER) · `status` (ACTIVE | SUSPENDED)
Sem FK para `users` nem `family_members`: não é membro de nenhuma família por esta via.

## Seguros (ADR-021 — sem categoria de partilha; só SELF/TUTOR_OF)

### InsurancePolicy — sem categoria de partilha (ADR-021)
`familyId` · `memberId` · `insurerId?` (seguradora parceira `InsurerAccount`, BR-INS-09) · `insurerName` (texto livre, não exige seguradora parceira) · `policyNumber` · `holderName` · `validUntil?` (date) · `cardDocumentId?` (referência a `Document`, `resourceType=INSURANCE_POLICY`)
**Regras:** BR-INS-01/02. Criado/editado/visto só por `SELF` (adulto) ou `TUTOR_OF`; sem `SharingGrant`, sem acesso de `OTHER` nesta versão.

### ReimbursementClaim — só existe sobre uma apólice de seguradora parceira (ADR-021)
`policyId` · `insurerId` · `encounterId?` (atendimento do módulo operacional a que se refere, BR-SEG-21) · `amount` (decimal) · `currency` (copiada de `InsurerAccount.currency` à criação; sem default fixo, ADR-025/Q1) · `status` (SUBMITTED | APPROVED | REJECTED | PAID) · `decisionNote?` (motivo da seguradora) · `decidedByInsuranceAccountId?` · `decidedAt?` · `submittedBy` (userId)
**Regras:** BR-INS-03..05. Criado/submetido por `SELF`/`TUTOR_OF`. Associação `claim ↔ Document` por `reimbursement_claim_documents (claimId, documentId)` — sem entidade de anexo nova; a seguradora só vê os documentos desta lista.

### InsurerAccount — a seguradora parceira (ADR-021, mirror de `Clinic` PARTNER)
`name` · `taxId` (NIF) · `status` (ACTIVE | SUSPENDED) · `currency` (ISO 4217; default `AOA`, ADR-025/Q1) · `operationalModuleEnabled` (bool, default falso; ligado pelo Platform Admin, BR-INS-08 emendada) · `createdBy` (Platform Admin)

### InsuranceAccount — conta do portal da seguradora (ADR-021, mirror de `ClinicAccount`)
`insurerId` · `email` · `passwordHash` · `role` (INSURANCE_ADMIN | INSURANCE_AGENT | BENEFICIARY_MANAGER | AUTHORIZATION_ANALYST | CLAIMS_MANAGER | FINANCE_MANAGER; os quatro últimos só com módulo operacional, ADR-025) · `status` (ACTIVE | SUSPENDED)
Sem FK para `users` nem `family_members`.

## Módulo operacional de seguradoras (ADR-025) — dados **da seguradora**, nunca de `FamilyMember`

> Todas as entidades desta secção têm `insurerId` (tenant, obrigatório) e referências entre si por `(insurerId, id)` (FK composta, BR-SEG-14). Não pertencem a nenhuma família (ADR-005 não se aplica) e **nunca** guardam dados de saúde: o atendimento só tem código de serviço (Q5). Valores monetários: `numeric`, na `currency` da seguradora (BR-SEG-19). Nomes de tabela com prefixo `insurer_` em `schema.md` (para não colidir com `InsurancePolicy` do paciente).

### Company
`insurerId` · `name` · `taxId` (NIF) · `status` (ACTIVE | INACTIVE). Empresa cliente (apólice de grupo). UC-SEG-01.

### Beneficiary
`insurerId` · `companyId?` · `name` · `identityDocument` (tipo + número; único por seguradora) · `birthDate` · `holderId?` (titular do agregado; nulo = é titular) · `relationship` (HOLDER | SPOUSE | CHILD | OTHER) · `cardNumber` (único por seguradora) · `cardVersion` (int; incrementado para revogar QR) · `status` (PENDING | ACTIVE | SUSPENDED | CANCELLED) · `familyId?` · `familyMemberId?` (ligação **consentida** ao perfil do paciente, BR-SEG-20; FK composta `SET NULL`).
**Regras:** BR-SEG-01/14/17/20/23. Não é `FamilyMember`. Ciclo: `state-machines.md` (Beneficiary).

### BeneficiaryLinkRequest
`insurerId` · `beneficiaryId` · `requestedByUserId` · `familyId` · `familyMemberId` · `status` (PENDING | CONFIRMED | REJECTED | REVOKED) · `decidedByInsuranceAccountId?` · `decidedAt?`. Pedido do paciente para reclamar o cartão (nº de apólice + código da seguradora; o código é guardado só em hash, uso único, validade curta). BR-SEG-20.

### Plan / PlanCoverage / InsurerService
- **InsurerService** (lista de serviços **por seguradora**, BR-SEG-22): `insurerId` · `code` (único por seguradora) · `name` · `category` · `status` (ACTIVE | INACTIVE).
- **Plan:** `insurerId` · `name` · `version` (int) · `status` (DRAFT | ACTIVE | ARCHIVED) · `autoApprovalCeiling?` (teto de auto-aprovação, BR-SEG-03) · `amountTolerancePct?` (tolerância fatura > autorizado, BR-SEG-13). **Imutável depois de ter apólices ativas**: alterações criam nova versão (auditável).
- **PlanCoverage:** `planId` · `serviceId` · `type` (INCLUDED | LIMITED | EXCLUDED) · `copayPct` (0–100) · `limitPerBeneficiary?` · `limitPerFamily?` · `limitPerYear?` · `waitingDays` · `requiresAuthorization`. **Regras em dados**, nunca em código; exclusões prevalecem (BR-SEG-09).

### Policy (apólice da seguradora)
`insurerId` · `planId` · `companyId?` · `holderId` (beneficiário titular) · `number` (único por seguradora) · `validFrom` · `validTo` · `status` (DRAFT | ACTIVE | SUSPENDED | EXPIRED | CANCELLED). **Distinta** de `InsurancePolicy` (cartão do paciente, ADR-021): são dois conceitos; a ligação é só por BR-SEG-20.

### Provider / ProviderUnit
- **Provider:** `insurerId` · `name` · `taxId` · `type` (CLINIC | HOSPITAL | LABORATORY | PHARMACY) · `clinicId?` (clínica `PARTNER` da VitaFamily; único por seguradora; dá acesso do portal da clínica, `authorization.md` §8.4) · `status` (ACTIVE | SUSPENDED) · serviços cobertos (associação a `InsurerService`).
- **ProviderUnit:** `providerId` · `name` · `address?` · `specialties` (texto).

### AuthorizationRequest
`insurerId` · `beneficiaryId` · `providerId` · `serviceId` · `justification` · `status` (SUBMITTED | AUTO_APPROVED | IN_REVIEW | INFO_REQUESTED | APPROVED | REJECTED | USED | EXPIRED | CANCELLED) · `requestedAmount` · `authorizedAmount?` · `code?` (único, não adivinhável, BR-SEG-05) · `validUntil?` · `decidedByInsuranceAccountId?` (nulo em `AUTO_APPROVED`) · `decisionNote?` · `submittedByClinicAccountId`. Anexos em `Attachment`. Cada decisão gera um evento imutável (utilizador, data, motivo, estado; correções = novo evento).

### Encounter (atendimento)
`insurerId` · `beneficiaryId` · `providerId` · `serviceId` · `doctorName` (texto) · `occurredOn` · `authorizationId?` · `directBilled` (bool; `true` quando a despesa é aprovada, BR-SEG-21) · `registeredByClinicAccountId`. **Sem diagnóstico** (Q5).

### ExpenseClaim / ExpenseLine
- **ExpenseClaim:** `insurerId` · `beneficiaryId` · `providerId` · `authorizationId?` · `encounterId` · `status` (SUBMITTED | IN_REVIEW | APPROVED | REJECTED | RETURNED; `PENDING_PAYMENT`/`PAID`: fase 2) · `total` · `insurerShare` · `patientShare` · `duplicateKey` · `duplicateFlag` · `decisionNote?`. Fluxo da **clínica**; coexiste com `ReimbursementClaim` do paciente.
- **ExpenseLine:** `claimId` · `serviceId` · `quantity` · `unitAmount`.

### CoverageConsumption
`insurerId` · `beneficiaryId` · `coverageId` · `periodYear` · `used` · `reserved` (autorizações aprovadas e despesas pendentes, BR-SEG-07). Saldo = limite − `used` − `reserved`; vence o menor entre individual, familiar e anual (BR-SEG-08).

### Attachment
`insurerId` · `ownerType` (AUTHORIZATION | EXPENSE) · `ownerId` · metadados do ficheiro (como `Document`) · `scanStatus`. Armazenamento/antivírus reutilizados de `documents` (pendência do ADR-025).

### ImportBatch
`insurerId` · `format` (CSV | XLSX) · `rowCount` (≤ 5.000) · `status` (PREVIEW | COMMITTED | FAILED | CANCELLED) · `errorReport?` · `createdByInsuranceAccountId`. BR-SEG-17.

### Cartão digital (derivado)
Calculado a partir de `Beneficiary` + `Policy`; QR com token assinado, de validade curta e revogável por `cardVersion` (BR-SEG-18). Sem dados clínicos. Não é tabela.

## Alertas

### Alert
`recipientUserId` · `familyId` · `memberId` (sujeito) · `type` (MEDICATION_DUE | APPOINTMENT_REMINDER | EXAM_REMINDER | APPOINTMENT_OUTCOME_REQUEST | APPOINTMENT_CONFIRMED | APPOINTMENT_REJECTED | APPOINTMENT_CANCELLED | EXAM_CANCELLED | EXAM_RESULTS_AVAILABLE | RECOMMENDATION_ADDED) · `sourceType` (DOSE | APPOINTMENT | EXAMINATION | RECOMMENDATION) · `sourceId` · `ruleKey` (ex.: `dose.due`, `dose.repeat`, `appointment.24h`, `appointment.2h`, `exam.24h`, `appointment.outcome`, `appointment.confirmed`, `appointment.rejected`, `appointment.cancelled` — respostas da clínica parceira, D17/FR-APT-07; `exam.cancelled`, `exam.results`, `recommendation.added`, D19/FR-EXM-09) · `dedupeKey` (único) · `triggerAt` · `readAt?`

### Notification
Entrega de um Alert num canal. `alertId` · `channel` (PUSH | EMAIL) · `status` (PENDING | SENT | FAILED | SKIPPED) · `attempts` · `nextAttemptAt?` · `lastErrorCode?` · `sentAt?`

## Transversal

### AuditLog
`occurredAt` · `actorType` (USER | SYSTEM | PLATFORM_ADMIN | CLINIC_ACCOUNT | INSURANCE_ACCOUNT) · `actorClinicAccountId?` · `actorInsuranceAccountId?` · `actorUserId?` · `action` · `resourceType` · `resourceId?` · `familyId?` · `subjectMemberId?` · `result` (SUCCESS | DENIED | FAILURE) · `ip?` · `userAgent?` · `requestId` · `metadata?` (sem dados de saúde)

### DataExport
`requestedByUserId` · `subjectMemberId?` (dependente) · `reason` (USER_REQUEST | LEAVE_FAMILY | REMOVED_BY_ADMIN) · `status` (PENDING | READY | EXPIRED | FAILED) · `storageKey?` · `expiresAt?`

### FileDeletion (outbox)
Fila de ficheiros a apagar do armazenamento depois de a linha de BD ser removida (garante apagamento definitivo, NFR-DATA-05). `storageKey` · `attempts` · `deletedAt?`
