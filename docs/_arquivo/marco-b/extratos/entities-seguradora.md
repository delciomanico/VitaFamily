> **ARQUIVADO; ver tag `archive-marco-b-2026-11-16`** (ADR-037, R7). Extrato verbatim das secções/linhas de seguradora retiradas de documentos ativos; o ficheiro de origem indica-se em cada bloco.

## Origem: `04-domain/entities.md`

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
`insurerId` · `email` · `passwordHash` · `role` (INSURANCE_ADMIN | INSURANCE_AGENT | BENEFICIARY_MANAGER | AUTHORIZATION_ANALYST | CLAIMS_MANAGER | FINANCE_MANAGER | SUPERVISOR; os cinco últimos só com módulo operacional, ADR-025/035; vários `SUPERVISOR` por seguradora) · `status` (ACTIVE | SUSPENDED)
Sem FK para `users` nem `family_members`.

## Origem: `04-domain/entities.md`

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
- **InsurerService** (lista de serviços **por seguradora**, BR-SEG-22): `insurerId` · `code` (único por seguradora) · `name` · `category` (rótulo livre) · `serviceKindId?` (BR-SEG-39; nulo = por classificar) · `status` (ACTIVE | INACTIVE).
- **ServiceKind** (`service_kind`, marco B fatia 2, BR-SEG-39): `insurerId` · `code` (único por seguradora) · `name` · `guideType` (CONSULTATION | SERVICES | ADMISSION; catálogo global `guide_types`) · `expenseType` (INPATIENT | CHILDBIRTH | CONSULTATION | DIAGNOSTICS | TREATMENT | DENTAL | PROSTHETICS | MEDICATION | DAILY_ALLOWANCE; catálogo global `expense_types` com `legacyCode` I, P, C, EAD, T, E, PO, M, SD) · `status`. O tipo de guia do pedido **deduz-se do serviço** (`InsurerService.serviceKindId → ServiceKind.guideType`).
- **PolicySetting** (marco B fatia 2, BR-SEG-40): `insurerId` · `key` · `serviceId?` · `value` (inteiro, horas ou dias conforme a chave); limites e omissão em `PolicySettingDefinition` (`key`, `unit`, `min`, `max`, `default`, `allowsServiceScope`; definidos pelo Vita). Valor efetivo = serviço > seguradora > omissão.
- **CoverageDecision** (valor de domínio, sem persistência, BR-SEG-41): saída de `evaluateCoverage` — `covered`, `reason`, `copayPct`, `requiresAuthorization`, `waitingDays`, `waitingEndsOn`, `limitPerYearMinor`, `remainingMinor`, `insurerShareMinor?`, `patientShareMinor?`.
- **EligibilityLight** (valor de domínio, sem persistência, BR-SEG-43; fatia 3): `GREEN | YELLOW | RED`, função pura `toEligibilityLight(decision)` **de** `CoverageDecision` (não recalcula cobertura); acompanha `patientSharePct` (copagamento). A razão nunca sai da `insurer-ops`.
- **Plan:** `insurerId` · `name` · `version` (int) · `status` (DRAFT | ACTIVE | ARCHIVED) · `autoApprovalCeiling?` (teto de auto-aprovação, BR-SEG-03) · `amountTolerancePct?` (tolerância fatura > autorizado, BR-SEG-13). **Imutável depois de ter apólices ativas**: alterações criam nova versão (auditável).
- **PlanCoverage:** `planId` · `serviceId` · `type` (INCLUDED | LIMITED | EXCLUDED) · `copayPct` (0–100) · `limitPerBeneficiary?` · `limitPerFamily?` · `limitPerYear?` · `waitingDays` · `requiresAuthorization`. **Regras em dados**, nunca em código; exclusões prevalecem (BR-SEG-09).

### Policy (apólice da seguradora)
`insurerId` · `planId` · `companyId?` · `holderId` (beneficiário titular) · `number` (único por seguradora) · `validFrom` · `validTo` · `status` (DRAFT | ACTIVE | SUSPENDED | EXPIRED | CANCELLED). **Distinta** de `InsurancePolicy` (cartão do paciente, ADR-021): são dois conceitos; a ligação é só por BR-SEG-20.

### Provider / ProviderUnit
- **Provider:** `insurerId` · `name` · `taxId` · `type` (CLINIC | HOSPITAL | LABORATORY | PHARMACY) · `clinicId?` (clínica `PARTNER` da VitaFamily; único por seguradora; dá acesso do portal da clínica, `authorization.md` §8.4) · `status` (ACTIVE | SUSPENDED) · serviços cobertos (associação a `InsurerService`).
- **ProviderUnit:** `providerId` · `name` · `address?` · `specialties` (texto).

### AuthorizationRequest (marco B fatia 3, ADR-034; tabela `insurer_authorizations`)
`insurerId` · `beneficiaryId` · `providerId` · `serviceId` · `guideType` (deduzido do serviço, `service_kind`; override só para um tipo ativo de `guide_types`; guardado como facto do pedido) · `processId?` (`Process` do ato ou aberto por este pedido) · `parentRequestId?` (recurso: pedido recusado a que responde) · `status` (**SUBMITTED | IN_REVIEW | INFO_REQUESTED | APPROVED | REJECTED | CANCELLED**; S4 simplificado) · `closedReason?` (só `CANCELLED`: `INFO_TIMEOUT` | `CLINIC_CANCELLED`) · `justification` (administrativa, 1–500, **sem dados clínicos**, C2) · `requestedAmount` · `expectedOn` (data prevista do serviço) · `authorizedAmount?` · `code?` (único, não adivinhável, BR-SEG-05) · `validUntil?` · `decisionNote?` (motivo da recusa/pedido de informação) · `decidedByInsuranceAccountId?` · `decidedAt?` · `decisionDueAt` (prazo informativo, BR-AUT-06) · `infoExpiresAt?` (só `INFO_REQUESTED`) · `submittedByClinicAccountId`. **Derivados (não são estados):** `partial` (= `APPROVED` com `authorizedAmount < requestedAmount`, BR-AUT-04), `allowedActions`, `appealOpenUntil`. `AUTO_APPROVED` (= `APPROVED` com `decidedBy=SYSTEM`), `USED` e `EXPIRED` não existem como estado: entram nas fatias 4/2b como derivados/`closedReason`. Cada transição gera um evento imutável (`AuthorizationEvent`: `fromStatus`, `toStatus`, ator, `channel` = `PORTAL|PHONE|WHATSAPP|PHOTO|API`, `note?`, data). Anexos **administrativos** em `Attachment` (até 5). **Fatia 4 (ADR-035):** `closedReason` ganha `ANALYST_CANCELLED` (reversão pela seguradora) · `decidedBy` (`ANALYST|SUPERVISOR|SYSTEM`, a decisão atual; `SYSTEM` = auto-aprovação) · `assignedTo?` (marca de atribuição, nula em recursos) · `escalatedAt?` (marca de SLA, BR-AUT-20; limpa ao recalcular o prazo) · `autoApproval?` (rasto `{ok, ruleId?, ruleName?, checks[]}`, só para a seguradora). `AuthorizationEvent` ganha `actorRole` (`ANALYST|SUPERVISOR`) e `internalNote?` (só seguradora). **Derivados:** `expired` (`APPROVED` com `validUntil` passada), `slaStatus` (`ON_TIME|OVERDUE|MET|MISSED`), `isAppeal` (= `parentRequestId`). **Regras:** BR-AUT-01..23, BR-SEG-03/05/16 (emendadas).

### AutoApprovalRule (marco B fatia 4, ADR-035; tabela `insurer_auto_approval_rules`)
`insurerId` · `name` (1–80) · alvo **exatamente um** de `serviceKindId` | `serviceId` · `maxAmount` (> 0, moeda da seguradora) · `active`. **Uma regra ativa por alvo**; o serviço precede o tipo de serviço; sem regra aplicável o pedido vai a análise humana; carência e limite esgotado nunca se auto-aprovam. Geridas só pelo `SUPERVISOR` (BR-AUT-23). Dados da seguradora, nunca de saúde.

### Encounter (atendimento)
`insurerId` · `beneficiaryId` · `providerId` · `serviceId` · `doctorName` (texto) · `occurredOn` · `authorizationId?` · `directBilled` (bool; `true` quando a despesa é aprovada, BR-SEG-21) · `registeredByClinicAccountId`. **Sem diagnóstico** (Q5).

### ExpenseClaim / ExpenseLine
- **ExpenseClaim:** `insurerId` · `beneficiaryId` · `providerId` · `authorizationId?` · `encounterId` · `status` (SUBMITTED | IN_REVIEW | APPROVED | REJECTED | RETURNED; `PENDING_PAYMENT`/`PAID`: fase 2) · `total` · `insurerShare` · `patientShare` · `duplicateKey` · `duplicateFlag` · `decisionNote?`. Fluxo da **clínica**; coexiste com `ReimbursementClaim` do paciente.
- **ExpenseLine:** `claimId` · `serviceId` · `quantity` · `unitAmount`.

### CoverageConsumption
`insurerId` · `beneficiaryId` · `coverageId` · `periodYear` · `used` · `reserved` (autorizações aprovadas e despesas pendentes, BR-SEG-07). Saldo = limite − `used` − `reserved`; vence o menor entre individual, familiar e anual (BR-SEG-08).

### Attachment (`insurer_attachments`, fatia 3)
`insurerId` · `authorizationId` (a 2b acrescenta `expenseClaimId`) · `kind` (QUOTE | INSURER_FORM | ID_COPY | OTHER_ADMIN — **só administrativos**) · `originalName` · `mimeType` (PDF/JPG/PNG) · `sizeBytes` (≤ 10 MB) · `checksumSha256` · `uploadedByClinicAccountId`. Antivírus **síncrono antes de gravar** (sem estado `PENDING`); ficheiros no `Storage` da plataforma; fora da quota da família. A família nunca os vê; o prestador só vê metadados (a seguradora descarrega na fatia 4).

### ImportBatch
`insurerId` · `format` (CSV | XLSX) · `rowCount` (≤ 5.000) · `status` (PREVIEW | COMMITTED | FAILED | CANCELLED) · `errorReport?` · `createdByInsuranceAccountId`. BR-SEG-17.

### Cartão digital (derivado)
Calculado a partir de `Beneficiary` + `Policy`; QR com token assinado, de validade curta e revogável por `cardVersion` (BR-SEG-18). Sem dados clínicos. Não é tabela.

## Origem: `04-domain/entities.md (fragmentos retirados/reescritos)`

- > Estado: **v1.0** — marco B fatia 5 (ADR-036): `Process.coverage` (derivado, nunca persistido), `CoverageFact` com `EXPIRED`/`WITHDRAWN`/`appeal`/`partial`/`validUntil?`, 5 `alert_type` `AUTHORIZATION_*` e `alert_source` `PROCESS`; v0.9 — marco B fatia 4 (ADR-035): `AuthorizationRequest` com decisor, atribuição, escalada e rasto de auto-aprovação; nova `AutoApprovalRule`; papel `SUPERVISOR` em `InsuranceAccount`; v0.8 — M15 U/V: `ExamOrder`, `ExamOrderLink`, `alert_type` `EXAM_ORDER_ADDED`, `ExaminationInput.examOrderId` (ADR-028); v0.7 — M15 S/T: `ConsultationReport`, `ConsultationReportAddendum`, `ExamResultsDraft`, `Document.generatedBySystem` (ADR-027); v0.6 — M14 R: `ClinicReceipt`, `ClinicReceiptLink`, `ClinicAccount.professionalId`/`CLINIC_DOCTOR`, perfil da `Clinic` (ADR-026); v0.5 — módulo operacional de seguradoras (ADR-025: secção própria; `InsurerAccount.currency`/`operationalModuleEnabled`; papéis alargados); v0.4 — `ClinicSlot.capacity` e exame marcado diretamente (`SCHEDULED`, sem pedido/recusa; ADR-023 revisto 2026-11-04); v0.3: `ClinicSlot.kind`, `Examination` emitido pela clínica, `Recommendation`, `InsurancePolicy.insurerId` (ADR-023, D19); v0.2 acrescenta o portal da seguradora parceira (ADR-021); corrige a secção do portal da clínica (`ClinicAccount`, D18) que ainda referia a suposição revista `ClinicStaff(userId,...)`. Fonte para `07-database/schema.md` e `05-api`. Tipos lógicos; os tipos físicos estão em `schema.md`.

- PRESCRIPTION | EXAMINATION | INSURANCE_POLICY, ADR-021)

-  `INSURANCE_POLICY` reaproveita o upload existente para a foto do cartão (ADR-021) — sem porta/endpoint de upload novo.

- (ROUTINE; **AUTHORIZED** na fatia 3 = processo aberto por um pedido de autorização; URGENT | OUT_OF_NETWORK | PHARMACY nas seguintes)

- `originType` (APPOINTMENT | EXAMINATION | **AUTHORIZATION** — fatia 3: sem marcação prévia; `originId` = primeiro pedido da cadeia)

- e `nextStep { code, actor, dueAt? }` por `deriveFamilyStatus(facts)` (fatia 3: `facts` = `{ act?, coverage? }`, `CoverageFact { phase: PENDING_DECISION | NEEDS_INFO | APPROVED | NOT_APPROVED | **EXPIRED | WITHDRAWN** (fatia 5) | CLOSED, dueAt?, changedAt, **appeal, partial, validUntil?** (fatia 5) }` publicado por `insurer-ops` pela porta `ProcessFacts`, `state-machines.md`); **Fatia 5 (ADR-036):** `coverage?` = `{ state: PENDING | NEEDS_INFO | APPROVED | NOT_APPROVED | EXPIRED | WITHDRAWN, appeal, partial, dueAt?, validUntil? }` por `deriveCoverageView` (só quem tem `MANAGE_INSURANCE`; nunca motivo, valor, serviço, decisor, nota nem rasto, BR-PRC-12). `scheduledAt?`

-  ou 1 pedido de autorização inicial (`originType=AUTHORIZATION`); **1 : N pedidos** de autorização por `insurer_authorizations.process_id` (fatia 3); a 2b acrescenta despesas pelo mesmo mecanismo.

- Regras: BR-PRC-01..14.

-  não guarda dados clínicos nem de seguradora.

-  | **AUTHORIZATION_APPROVED | AUTHORIZATION_NOT_APPROVED | AUTHORIZATION_INFO_REQUESTED | AUTHORIZATION_EXPIRING | AUTHORIZATION_WITHDRAWN** — marco B fatia 5, ADR-036)

- | RECOMMENDATION | **PROCESS**)

- ; **`authorization.approved`, `authorization.not_approved`, `authorization.info_requested`, `authorization.withdrawn`, `authorization.expiring`, fatia 5/BR-ALR-10, `sourceType=PROCESS`, `sourceId` = `processId`**)

- CLINIC_ACCOUNT | INSURANCE_ACCOUNT) · `actorClinicAccountId?` · `actorInsuranceAccountId?`

## Origem: `04-domain/relationships.md (fragmentos retirados/reescritos)`

- (→ Prescription | Examination | InsurancePolicy)

-   │                        └── 0..N InsurancePolicy ── 0..N ReimbursementClaim (ADR-021)


-  InsurerAccount (global, parceira) 1 ── 0..N InsuranceAccount ;  1 ── 0..N ReimbursementClaim (via InsurancePolicy)   (ADR-021)
 ReimbursementClaim 1 ── 0..N Document (reimbursement_claim_documents, associação simples)   (ADR-021)


- | InsurancePolicy → InsurerAccount | N : 0..1 | Ligação opcional a seguradora parceira (BR-INS-09). | `ON DELETE SET NULL`. |


- | FamilyMember → InsurancePolicy | 1 : N | Cartão da apólice pertence à pessoa (ADR-021), como qualquer dado de saúde. | Cascata + `FileDeletion` para a foto do cartão. |


- | InsurancePolicy → ReimbursementClaim | 1 : N | Só existe pedido sobre apólice de seguradora **parceira** (ADR-021). | Cascata. |


- | InsurerAccount → InsuranceAccount | 1 : N | Contas do portal da seguradora (ADR-021, mirror de `Clinic(PARTNER) → ClinicAccount`). | Cascata (mirror de `clinics` → `clinic_accounts`). |


- | InsuranceAccount → ReimbursementClaim (decisão) | 0..1 : N | Quem decidiu o pedido (`decidedByInsuranceAccountId`), para auditoria. | `ON DELETE SET NULL`. |


- - InsurerAccount: global, parceira (mirror Clinic PARTNER); InsuranceAccount: 1 `INSURANCE_ADMIN` ativa por seguradora (ADR-021, mirror BR-CLN-05).

