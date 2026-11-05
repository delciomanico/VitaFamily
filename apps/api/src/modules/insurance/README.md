# Módulo `insurance`

M11 (`plan.md`, ADR-021/ADR-023). **Fase 4a:** seguradoras parceiras (`/admin/insurers*`) e identidade do portal da seguradora (`/insurance-portal/auth|agents`). **Fase 4b:** apólices (`InsurancePolicy`), pedidos de reembolso (`ReimbursementClaim`), `GET /families/{f}/insurers`, `/families/.../insurance-policies*` (titular) e `/insurance-portal/claims*` (seguradora).

Depende de `access`, `documents` e `audit` (`tests/architecture-rules.ts`, modules.md §2). O portal vive dentro do módulo (mesma decisão do ADR-020 para `clinics`): não importa `auth`/`access`/`families`/`clinics`; tudo da identidade (hash, JWT, rate limiter, cache, cookie) é duplicado de propósito em `domain/`.

## Identidade separada (ADR-021)
- Tabelas `insurer_accounts`, `insurance_accounts`, `insurance_sessions` (`db/migrations/0024_insurers.sql`), sem FK para `users`/`clinic_*` (salvo `created_by*` SET NULL). `audit_logs.actor_insurance_account_id` e `actor_type=INSURANCE_ACCOUNT`.
- JWT com claims `iid`/`isid` (User: `sub`/`sid`; clínica: `cid`/`csid`) e esquema `insuranceBearerAuth`; terceiro `AsyncLocalStorage` (`platform/actor`: `getInsuranceActor`). `insurerId`/`role` resolvem-se por pedido (cache ≤60 s; limpa ao suspender/reativar a seguradora).
- Cookie `insurance_refresh_token` (HttpOnly, SameSite=Strict, Path `/api/v1/insurance-portal/auth`).

## Mapa de um pedido típico
```
POST /insurance-portal/agents
  → interface/insurance-portal-router.ts  (ator da sessão: insurerId/role nunca vêm do corpo)
    → application/manage-insurance-agents.ts → domain/insurance-staff-hierarchy.ts (só INSURANCE_ADMIN)
      → infrastructure/repo.ts (insert) → audit.record (INSURANCE_AGENT_CREATE) → e-mail com palavra-passe (best effort)
```
`POST /admin/insurers/{id}/root-account` → `application/admin-insurers.ts` (idempotente por UNIQUE parcial; repor revoga sessões da conta). Suspender a seguradora revoga as sessões de todas as contas (BR-INS-10).

## Fase 4b: apólices e pedidos
- Migração `0025_insurance_policies_and_claims.sql`: `insurance_policies`, `reimbursement_claims`, `reimbursement_claim_documents` e `documents.insurance_policy_id` (FK composta `(family_id, member_id, id)`: a foto é sempre do mesmo membro da apólice).
- **Autorização do titular:** só `AccessPolicy.can({ action: "MANAGE_INSURANCE" })` (SELF adulto ou TUTOR_OF, leitura e escrita; nunca OTHER nem dependente com conta; BR-INS-02). A ação foi acrescentada a `access` porque as apólices não são categoria nem têm `SharingGrant`.
- **Foto do cartão:** `POST /documents` com `resourceType=INSURANCE_POLICY` (módulo `documents`, quarentena/ClamAV, download mediado). `cardDocumentId` é derivado (documento mais recente da apólice; sem coluna, schema.md); o valor recebido no corpo só é validado (tem de ser documento da apólice).
- **Anexos do pedido (BR-INS-04):** `documents.listAttachable` devolve só documentos do membro, `CLEAN` e visíveis ao paciente; o pedido guarda-os em `reimbursement_claim_documents` — a única superfície de documentos do portal.
- **Portal:** `application/portal-claims.ts` usa só `InsurancePortalClaimsDeps` (sem `access`/`documents`); o repositório filtra SEMPRE por `insurerId` da sessão (outra seguradora ⇒ `NOT_FOUND`) e junta apenas `insurance_policies` (titular e nº da apólice). `decide` bloqueia a linha (`FOR UPDATE`) ⇒ decisões concorrentes dão `CONFLICT`.
- Auditoria: `INSURANCE_POLICY_CREATE|UPDATE|DELETE`, `CLAIM_SUBMIT`, `CLAIM_PAID` (USER) e `CLAIM_DECIDE` (`INSURANCE_ACCOUNT`); leitura por tutor ⇒ `HEALTH_VIEW`.

Fluxo típico: `POST .../insurance-policies/{id}/reimbursement-claims` → `interface/insurance-router.ts` → `application/reimbursement-claims.ts` (autoriza, bloqueia a apólice, valida seguradora ACTIVE e documentos) → `infrastructure/repo.ts` → `audit.record(CLAIM_SUBMIT)`.
