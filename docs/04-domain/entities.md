# Vita Family — Entidades (Fase 9)

> Estado: **v1.1 (R7 do arquivo do marco B, 2026-11-16, ADR-037): retiradas as entidades de seguradora (InsurancePolicy, ReimbursementClaim, InsurerAccount, InsuranceAccount, módulo operacional) e a cobertura do `Process`; texto verbatim em `_arquivo/marco-b/extratos/entities-seguradora.md`.**
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
**M14 Q (BR-CLN-25..30):** `confirmationStatus` (PENDING | CONFIRMED | DECLINED; omissão PENDING) · `confirmationSource?` (PATIENT | CLINIC) · `confirmedAt?` · `arrivedAt?` · `startedAt?` (fluxo do dia; **sem estados Vita novos**) · `followUpDueOn?` (date; `patientNotified` na API é derivado: consulta Vita e hoje ≥ `followUpDueOn` − 7 dias). Estados de dia derivados (`dayState`) em `state-machines.md`.
**Marco B fatia 1 (ADR-032):** `processId?` (uuid do `Process` aberto com a consulta; só leitura; BR-PRC-01).

### Examination — categoria C6
`name` · `examDate` (date) · `scheduledAt?` (UTC; só em exame de horário da clínica, D19) · `status` (SCHEDULED | COMPLETED | CANCELLED; `REQUESTED`/`REJECTED` obsoletos, só no enum de BD, state-machines.md) · `clinicId?` · `clinicName?` · `slotId?` (horário `EXAM` de origem, D19) · `responseNote?` (motivo da clínica ao cancelar) · `notes?` · `issuedBy` (FAMILY | CLINIC, default FAMILY) · `issuedByClinicAccountId?` · `resultsIssuedAt?` · `clinicResultNote?` (nota livre da clínica ao completar)
**Regras:** BR-CLN-07/08, BR-EXM-05..08. `issuedBy=CLINIC` ⇔ `issuedByClinicAccountId` preenchido (espelho de BR-RX-07). **Marco B fatia 1:** `processId?` (uuid do `Process` aberto com o exame; só leitura; BR-PRC-01).

### ExamResult — categoria C6
`examinationId` · `parameter` · `valueNumeric?` · `valueText?` · `unit?` · `referenceMin?` · `referenceMax?` (informados pelo utilizador). Pelo menos um de `valueNumeric`/`valueText`.

### Recommendation — categoria da origem (APPOINTMENTS ou EXAMS) — D19, ADR-023
`familyId` · `memberId` · `clinicId?` · `clinicName` (texto de reserva) · `clinicAccountId?` (autor, rastreabilidade) · `appointmentId?` · `examinationId?` (exatamente um) · `text` (1–2000 caracteres; dado de saúde, BR-HLT-05) · `createdAt`
**Regras:** BR-CLN-09. Só a clínica da origem a cria (origem `SCHEDULED`/`COMPLETED`); imutável; cascata com a origem. Lida segundo a categoria da origem.

### Document — categoria do recurso associado
`familyId` · `memberId` · `resourceType` (PRESCRIPTION | EXAMINATION) · `resourceId` · `storageKey` · `originalName` · `mimeType` · `sizeBytes` · `checksumSha256` · `scanStatus` (PENDING | CLEAN | INFECTED) · `uploadedBy?` (User) · `uploadedByClinic` (bool, marca permanente de PDF emitido pela clínica, BR-CLN-08) · `uploadedByClinicAccountId?` (autor; nulo se a conta for removida; nunca em simultâneo com `uploadedBy`)
Máx. 5 por recurso e 100 MB por família (Q10).

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
`clinicId` · `clinicPatientId` · `slotId?` · `scheduledAt` · `durationMinutes` · `status` (SCHEDULED | COMPLETED | CANCELLED | NO_SHOW — `NO_SHOW` desde M14 Q) · `notes?` · `outcomeNote?` · `cancelNote?` · `bookedByClinicAccountId?`
**Regras:** BR-CLN-18. Só da clínica (não está na app Vita, sem lembretes); ocupa o horário (BR-APT-06); estados e janela como a consulta (ST4); sem receita.
**M14 Q:** os mesmos campos de confirmação, chegada e retorno da consulta (`confirmationStatus` só PENDING | CONFIRMED, `confirmationSource` só CLINIC; `arrivedAt?` · `startedAt?` · `followUpDueOn?`); a visita não tem alertas, a clínica trata a confirmação por telefone e os retornos (BR-CLN-27/30).

### ClinicAccount — conta do portal da clínica (D18, ADR-020)
**Correção (ADR-021):** esta secção referia-se antes a `ClinicStaff(userId, clinicId, role)`, suposição
revista por D18 — a conta do portal **não** é um `User`. Alinhado aqui com `schema.md` §3 (`clinic_accounts`).
`clinicId` (PARTNER) · `email` · `passwordHash` · `role` (CLINIC_ADMIN | CLINIC_MANAGER | CLINIC_DOCTOR — este desde M14 R) · `professionalId?` (só `CLINIC_DOCTOR`: o `ClinicProfessional` cuja agenda e pacientes a conta vê; um Médico por profissional, BR-CLN-39) · `status` (ACTIVE | SUSPENDED)
Sem FK para `users` nem `family_members`: não é membro de nenhuma família por esta via.


### ClinicReceipt — recibo interno não fiscal da clínica (M14 R)
`clinicId` · `number` (inteiro sequencial por clínica, sem falhas; apresentado `R-000123`) · `bookingKind` (APPOINTMENT | EXAM | VISIT) · `bookingId` (sem FK) · `status` (ISSUED | VOIDED) · `paymentMethod` (CASH | CARD | TRANSFER | INSURANCE; informativo) · `currency` · `totalMinor` (cêntimos, soma das linhas) · `patientName` (retrato) · `note?` · `issuer` (retrato do perfil da clínica) · `issuedAt` · `issuedByClinicAccountId?` · `voidedAt?` · `voidReason?` · `voidedByClinicAccountId?` · `lines`: [`ClinicReceiptLine`: `position` · `description` · `amountMinor` · `serviceTypeId?`]
Derivado: `notice` fixo "Documento não fiscal — não substitui fatura"; `availableToPatient` (existe `ClinicReceiptLink`).
**Regras:** BR-CLN-31..37. Imutável; único estado `ISSUED → VOIDED`; um `ISSUED` por marcação; registo **da clínica** (sem ids Vita, sobrevive ao apagamento do membro, BR-CLN-24).

### ClinicReceiptLink — ponte do recibo para o paciente Vita (M14 R)
`receiptId` (único) · `familyId` · `memberId`. Só existe para marcações Vita com consentimento na emissão (BR-CLN-35); nunca exposta pelo portal; apagada com o membro/família.

### ConsultationReport — relatório da consulta (M15 S, ADR-027) — registo **da clínica**
`clinicId` · `bookingKind` (APPOINTMENT | VISIT) · `bookingId` (**sem FK**; 1:1 com a marcação) · `clinicPatientId?` (se a marcação resolve para um `ClinicPatient`) · `status` (DRAFT | FINAL) · `reason?` (≤300) · `findings?` (≤1500) · `impression?` (≤500) · `plan?` (≤1500) — ≥1 preenchida · `sharedWithPatient` (omissão `true`; sempre `false` em VISIT; imutável em FINAL) · retrato: `patientName`, `patientBirthDate?`, `consultationAt`, `specialty?`, `authorName` (nome do `ClinicProfessional` da conta Médico, assinatura textual), `issuer?` (perfil da clínica, fixado em FINAL) · `authorAccountId?` · `finalizedAt?` · `addenda`: [`ConsultationReportAddendum`: `text` (1–1500) · `authorName` · `authorAccountId?` · `createdAt`]
Derivado: `Appointment.reportAvailable` (lado família: existe relatório FINAL partilhado **e** o actor é SELF/TUTOR_OF); `ClinicBooking.reportStatus` (DRAFT | FINAL | nulo).
**Regras:** BR-CLN-41..46, BR-CLN-50. `FINAL` e adendas imutáveis; sobrevive ao apagamento do membro (sem ids Vita); texto = dado de saúde (BR-HLT-05). Categoria de privacidade da leitura pelo paciente: `APPOINTMENTS`, restringida a SELF/TUTOR_OF (`authorization.md` §6.6).

### ExamOrder — pedido de exame (M15 U, ADR-028) — registo **da clínica**
`clinicId` · `bookingKind` (APPOINTMENT | VISIT) · `bookingId` (**sem FK**) · `clinicPatientId?` · `name` (1–80; copiado do serviço EXAM do catálogo se `serviceTypeId`) · `serviceTypeId?` · `note?` (≤200) · `urgent` (omissão `false`) · `status` (ORDERED | SCHEDULED | FULFILLED | CANCELLED) · `bookedHere` (o exame ligado é da própria clínica; mascara SCHEDULED/FULFILLED na API do portal) · retrato: `patientName`, `patientBirthDate?`, `consultationAt`, `authorName` · `authorAccountId?` · `cancelledAt?`/`cancelledByAccountId?`. Imutável salvo estado/`bookedHere`/cancelamento. Máx. 5 ativos por marcação.
**Regras:** BR-CLN-51..54, BR-CLN-56. Sobrevive ao apagamento do membro (sem ids Vita). Texto = dado de saúde (BR-HLT-05).

### ExamOrderLink — ponte do pedido para o paciente Vita (M15 U)
`orderId` (único) · `familyId` · `memberId` · `appointmentId` · `examinationId?` (exame ligado; nulo ⇒ pedido `ORDERED`). Só existe para consultas Vita; nunca exposta pelo portal; apagada com o membro/família/consulta. Derivados: `Appointment.examOrderCount`; `FamilyExamOrder` (leitura SELF/TUTOR_OF, `authorization.md` §6.7).

### Declaração de presença (M15 V, ADR-028)
Documento **gerado, sem entidade nem tabela**: derivado de uma marcação `COMPLETED` ou `SCHEDULED` com `arrivedAt` (BR-CLN-55). Só auditoria (`ATTENDANCE_STATEMENT_ISSUED`).
### ExamResultsDraft — rascunho de resultados de exame (M15 T, ADR-027)
`examinationId` (único) · `clinicId` · `results` (0–50 × `ExamResultInput`) · `resultNote?` (≤2000) · `updatedByClinicAccountId?`. Existe só com o exame `SCHEDULED`; **não** é visível ao paciente nem cria `ExamResult`; apaga-se ao concluir, cancelar ou apagar o exame. **Regras:** BR-CLN-47.

**`Document` (M15 T):** novo `generatedBySystem` (bool, omissão false): laudo PDF gerado pelo servidor (BR-CLN-49); implica `uploadedByClinic`, recurso EXAMINATION, `scanStatus=CLEAN`; um por exame. **`Appointment` (M15 S):** `reportAvailable` (derivado, só leitura). **`ClinicBooking`/`ClinicExamBooking`:** `reportStatus` · `hasResultsDraft`, `reportAvailable` (derivados).

**`Clinic` (M14 R):** campos de perfil `displayName?` · `description?` · `openingHours?` (BR-CLN-38) e `address?`/`phone?`/`email?` editáveis pela própria clínica parceira. **`ReimbursementClaim` (M14 R):** associação opcional a recibos (`receiptIds`, BR-CLN-36), sem `Encounter` nem despesa novos.

## Processos (ADR-032, marco B fatia 1) — categoria da **origem** (APPOINTMENTS ou EXAMS); sem categoria de partilha própria

### Process
`id` (= `processId`) · `familyId` · `memberId` · `kind` (ROUTINE; `AUTHORIZED` inerte na BD, ADR-037) · `originType` (APPOINTMENT | EXAMINATION; `AUTHORIZATION` inerte na BD) · `originId` (ato âncora) · `clinicId?` (clínica do ato à abertura) · `openedAt`
**Derivados em leitura (nunca persistidos, BR-PRC-02/03):** `familyStatus` (SCHEDULED | IN_PROGRESS | DONE | CANCELLED) e `nextStep { code, actor }` por `deriveFamilyStatus(facts)` (`facts` = o facto do ato; sem cobertura). `scheduledAt?` e `phase` vêm do facto do ato (`ActFact { source, phase, scheduledAt?, changedAt }`, publicado pelo módulo dono, `state-machines.md` Process).
**Agregador, não dono:** não tem máquina de estados, não duplica estados dos atos, não guarda dados clínicos. Relações: 1 `Process` : 1 ato (`appointments.process_id`/`examinations.process_id`). Registos da clínica sem ids Vita (BR-CLN-24) não têm `Process`. Regras: BR-PRC-01..11.

## Mercado de profissionais — MK1 (ADR-037; contrato 2026-11-16, **nada implementado**)

> Espaço de identidade **próprio** (BR-MKT-13): nenhuma destas entidades tem FK para `users`, `family_members` nem `clinic_accounts` (exceção: `ValidationCase.decidedBy` → `users`, só para o admin). **Sem dados de saúde nem ids de famílias** (BR-MKT-27). Dados em `schema.md` §11.

### ProfessionalAccount — conta do portal do profissional
`email` (único entre contas de profissional) · `passwordHash` · `status` (PENDING_VERIFICATION | ACTIVE) · `emailVerifiedAt?` · `termsAcceptedVersion` · `termsAcceptedAt` · `lastLoginAt?`. Tem `ProfessionalSession` (refresh rotativo com cadeia) e tokens de verificação/recuperação (`auth_token_type` reutilizado). 1:1 com `Professional`.

### Professional — perfil e estado de validação
`accountId` · `displayName?` · `bio?` · `city?` · `paymentInstructions?` (nunca público, BR-MKT-26) · `validationStatus` (DRAFT | PENDING_REVIEW | NEEDS_INFO | APPROVED | REJECTED | SUSPENDED; `state-machines.md`) · `statusReason?` · `statusChangedAt` · `submittedAt?` · `approvedAt?` (primeira aprovação). **Não tem `category`**: deriva-se das especialidades (BR-MKT-16). Só `APPROVED` é visível (BR-MKT-19).

### Specialty — catálogo gerido pelo admin
`name` (2–80, único sem distinção de maiúsculas) · `category` (HEALTH | WELLNESS; **dado**, BR-MKT-02; imutável com profissionais ligados) · `active`. Liga-se ao profissional por `ProfessionalSpecialty` (1–5 por profissional).

### ProfessionalCredential — credencial carregada pelo profissional
`professionalId` · `kind` (IDENTITY | PROFESSIONAL_LICENSE | CERTIFICATION) · `number?` · `issuingBody?` · `validUntil?` (data) · ficheiro (`storageKey`, `contentType` PDF/JPG/PNG, `sizeBytes` ≤ 10 MB) · `scanStatus` (PENDING | CLEAN | INFECTED). Só o próprio e o admin descarregam (BR-MKT-17). Requisitos por categoria: BR-MKT-16.

### ValidationCase — histórico imutável das decisões
`professionalId` · `action` (SUBMITTED | APPROVED | REJECTED | NEEDS_INFO | SUSPENDED | REACTIVATED | EXPIRED) · `fromStatus` · `toStatus` · `actor` (PROFESSIONAL | PLATFORM_ADMIN | SYSTEM) · `decidedBy?` (id do admin; sem FK de domínio) · `reason?` (≤ 500; obrigatório em REJECTED, NEEDS_INFO, SUSPENDED, EXPIRED) · `createdAt`. Nunca se edita (trigger); apaga-se só com o profissional (cascata).

### ProfessionalOffer — serviço com preço em Kz
`professionalId` · `specialtyId` (do próprio profissional) · `method` (IN_PERSON | VIDEO | CHAT | PHONE) · `durationMinutes` (15|20|30|45|60) · `priceKz` (inteiro 0–100 000 000) · `note?` (≤ 200) · `active`. Imutáveis: especialidade, método, duração (BR-MKT-24).

### ProfessionalScheduleRule / ProfessionalTimeOff / ProfessionalSlot — horários
`ProfessionalScheduleRule`: `professionalId` · `offerId` · `weekdays` (ISO 1–7) · `startTime`/`endTime` (hora local de `Africa/Luanda`) · `validFrom?`/`validUntil?` · `active`. `ProfessionalTimeOff`: `professionalId` · `startsAt` · `endsAt` · `reason?` (nota interna). `ProfessionalSlot`: `professionalId` · `offerId` · `ruleId` · `startsAt` · `endsAt` (instantes UTC; gerados idempotentemente numa janela de 8 semanas, sem sobreposição por profissional; só para `APPROVED`; BR-MKT-25). Ocupação (marcações): MK3.

## Mercado de profissionais — MK2: conversas (ADR-037; contrato 2026-11-17, **nada implementado**)

> Módulo `messaging` (`modules.md` nota 36). **Primeira ponte entre o espaço da família e o do profissional:** as tabelas ligam `family_members` (cascata) e `professionals` (cascata) por FK, mas **nenhum dos dois lados vê identificadores do outro** (BR-MKT-10/38). Dados em `schema.md` §12. A **descoberta e o ranking não têm entidades** (leem `ProfessionalDirectory`; o ranking é função pura calculada no pedido, BR-MKT-36).

### Conversation — conversa família ↔ profissional
`familyId` · `memberId` (membro-sujeito: o titular ou o dependente, **só no servidor**) · `professionalId` · `participantLabel` (1–40; como a família quer ser tratada; é tudo o que o profissional vê) · `status` (OPEN | CLOSED) · `closedBy?` (FAMILY | PROFESSIONAL | SYSTEM; presente sse CLOSED) · `closedAt?` · `lastSeq` · `lastMessageAt` · `familyReadSeq` · `professionalReadSeq` (marcadores de leitura por lado) · `professionalNotifiedAt?` (aviso por e-mail limitado, BR-MKT-41). Única por (`familyId`, `memberId`, `professionalId`). **Derivado, não guardado:** `canSend` (OPEN **e** profissional `APPROVED`, BR-MKT-47) e `unreadCount` por lado.

### Message — mensagem de texto
`conversationId` · `seq` (1, 2, 3…; por conversa) · `side` (FAMILY | PROFESSIONAL) · `senderUserId?` (só `FAMILY`; **só no servidor**; anulado se o utilizador for eliminado) · `body` (1–1000, texto simples; **dado de saúde potencial**, BR-MKT-46) · `clientMessageId?` (idempotência) · `hiddenAt?` (moderação; o texto deixa de ser devolvido) · `createdAt`. Imutável (só `hiddenAt` passa de nulo a data). Sem anexos (ADR-037 §7).

### MessageReport — denúncia de uma mensagem
`messageId` · `reporterSide` (FAMILY | PROFESSIONAL) · `reason` (ABUSE | SPAM | SCAM_OR_OFF_PLATFORM_PAYMENT | SENSITIVE_DATA | OTHER) · `note?` (≤ 300) · `status` (OPEN | DECIDED) · `decision?` (DISMISS | HIDE_MESSAGE | HIDE_AND_CLOSE; presente sse DECIDED) · `decidedBy?` (id do admin; `SET NULL`) · `decidedAt?` · `createdAt`. Única por (`messageId`, `reporterSide`). O admin só acede ao detalhe por esta entidade (BR-MKT-44).

### Estruturas só de contrato (sem tabela) — descoberta
`MarketplaceProfessionalItem` (cartão da pesquisa) · `MarketplaceProfessionalProfile` (perfil público) · `ProfessionalComparison` (lado a lado) · `RankingExplanation` (`version`, `score` 0–100, `signals` {`profileCompleteness`, `availability`, `price`, `seniority`} em [0,1], `reasons[]`, `label` `NEW`) · `RankingRules` (versão, sinais, pesos, exclusões) · `MarketplaceFilters` (especialidades com nº de profissionais, cidades, métodos). Ver `openapi.yaml`.

## Alertas

### Alert
`recipientUserId` · `familyId` · `memberId` (sujeito) · `type` (MEDICATION_DUE | APPOINTMENT_REMINDER | EXAM_REMINDER | APPOINTMENT_OUTCOME_REQUEST | APPOINTMENT_CONFIRMED | APPOINTMENT_REJECTED | APPOINTMENT_CANCELLED | EXAM_CANCELLED | EXAM_RESULTS_AVAILABLE | RECOMMENDATION_ADDED | APPOINTMENT_CONFIRM_REQUEST | FOLLOWUP_REMINDER | EXAM_ORDER_ADDED | **MESSAGE_RECEIVED** (MK2, BR-MKT-41) | `AUTHORIZATION_*` ×5, **legado inerte**: já não são gerados, ADR-037) · `sourceType` (DOSE | APPOINTMENT | EXAMINATION | RECOMMENDATION | **CONVERSATION** (MK2) | PROCESS inerte) · `sourceId` · `ruleKey` (ex.: `dose.due`, `dose.repeat`, `appointment.24h`, `appointment.2h`, `exam.24h`, `appointment.outcome`, `appointment.confirmed`, `appointment.rejected`, `appointment.cancelled` — respostas da clínica parceira, D17/FR-APT-07; `exam.cancelled`, `exam.results`, `recommendation.added`, D19/FR-EXM-09; `appointment.confirm48h` e `followup.due`, M14 Q/BR-ALR-09, `sourceType=APPOINTMENT`; `exam_order.added`, M15 U/BR-CLN-53, `sourceType=APPOINTMENT`, `sourceId` = consulta); `message.received`, MK2/BR-MKT-41, `sourceType=CONVERSATION`, `sourceId` = conversa, um alerta por conversa até a família a ler) · `dedupeKey` (único) · `triggerAt` · `readAt?`

### Notification
Entrega de um Alert num canal. `alertId` · `channel` (PUSH | EMAIL) · `status` (PENDING | SENT | FAILED | SKIPPED) · `attempts` · `nextAttemptAt?` · `lastErrorCode?` · `sentAt?`

## Transversal

### AuditLog
`occurredAt` · `actorType` (USER | SYSTEM | PLATFORM_ADMIN | CLINIC_ACCOUNT; `INSURANCE_ACCOUNT` inerte) · `actorClinicAccountId?` · `actorUserId?` · `action` · `resourceType` · `resourceId?` · `familyId?` · `subjectMemberId?` · `result` (SUCCESS | DENIED | FAILURE) · `ip?` · `userAgent?` · `requestId` · `metadata?` (sem dados de saúde)

### DataExport
`requestedByUserId` · `subjectMemberId?` (dependente) · `reason` (USER_REQUEST | LEAVE_FAMILY | REMOVED_BY_ADMIN) · `status` (PENDING | READY | EXPIRED | FAILED) · `storageKey?` · `expiresAt?`

### FileDeletion (outbox)
Fila de ficheiros a apagar do armazenamento depois de a linha de BD ser removida (garante apagamento definitivo, NFR-DATA-05). `storageKey` · `attempts` · `deletedAt?`
