# Módulo `insurer-ops` (ADR-025, nome provisório)

Módulo operacional de seguradoras (multi-seguradora). **Marco S1 / Fase A** (`11-implementation/insurer-phase-a.md`): empresas, beneficiários (+ código de reclamação do cartão), importação CSV/XLSX, pedidos de ligação cartão↔paciente (decisão da seguradora) e apólices da seguradora, em `/insurance-portal/*`. **S2 mínimo**: lista de serviços por seguradora, planos com versões e coberturas (sim/não, % comparticipação, teto anual, carência, «exige autorização»; sem saldo/consumo, D-A2). **S3 parcial**: ligação de clínicas parceiras (`insurer_providers`, só `clinic_id`; `GET /insurance-portal/partner-clinics`) e, no portal da clínica, `GET /clinic-portal/insurers`, `POST …/eligibility` e `GET …/services`. **S6 parcial (app do paciente)**: `/families/{f}/members/{m}/insurance/{card-claims,cards}` (reclamar/desligar, cartão, QR, cobertura). Autorizações e despesas ainda **não** existem.

Dados **da seguradora**, nunca de saúde: a única fronteira é a FK composta `(family_id, family_member_id)` de `insurer_beneficiaries` (ligação consentida, BR-SEG-20); a API só devolve `linked: boolean`.

## Fronteiras (modules.md §2 nota 23)
- Depende só de `audit`. O estado da seguradora (`operational_module_enabled`, `currency`) entra por injeção (`createInsurerSettingsReader()` da raiz de `insurance`, ligado em `main/api.ts`); `insurance` consulta-nos por `InsurerOperationalDataPort` (`operationalData.hasData`, BR-SEG-19), também ligado em `main/api.ts` — nenhum importa o outro.
- Clínicas parceiras: `PartnerClinicDirectory` (porta em `application/ports.ts`) é implementada por `clinics.partnerClinicDirectory` e ligada em `main/api.ts` (nota 23b); só `PARTNER`+`ACTIVE`, só `id` e nome de apresentação.
- Ator: `InsuranceActorInfo` (token da seguradora). **Nunca** `AccessPolicy`. Papéis (§8.2b, Fase A): `INSURANCE_ADMIN` e `BENEFICIARY_MANAGER` escrevem empresas/beneficiários/apólices/importações/ligações; planos, coberturas, serviços, prestadores e `partner-clinics` são só do `INSURANCE_ADMIN` (acesso `admin`); `AUTHORIZATION_ANALYST`/`CLAIMS_MANAGER`/`FINANCE_MANAGER` só leem; `INSURANCE_AGENT` ⇒ `FORBIDDEN`. Módulo desativado ⇒ `NOT_FOUND` (antes do papel).
- Isolamento (BR-SEG-14, sem RLS): `insurerId` do token em **todas** as consultas; FKs compostas `(insurer_id, id)` na BD (`0033`). Recurso de outra seguradora ⇒ `NOT_FOUND`; `companyId`/`holderId`/`planId` de outra seguradora no corpo ⇒ `VALIDATION_ERROR`.

## Mapa de um pedido típico
```
POST /insurance-portal/imports/{id}/commit
  → interface/portal-router.ts          (ator da sessão; ficheiro/IDs do pedido)
    → application/imports.ts            (authorize: módulo ligado + papel; revalida o lote; uma transação)
      → domain/import-file.ts           (classifyImportRows: duplicados, titular, empresa; puro)
      → infrastructure/repo.ts          (insertMany: titulares primeiro; FKs compostas)
      → audit.record(INSURER_IMPORT_COMMIT)  (só contagens)
```
- **Importação** (`domain/import-file.ts`): CSV (`,`/`;`, UTF-8) e XLSX (1.ª folha, `fflate`); 1..5.000 linhas, ≤ 10 MB. A pré-visualização guarda as linhas válidas em `insurer_import_batches.rows` (jsonb) — **extensão** a `schema.md` §3c, limpa ao confirmar/cancelar. O `commit` revalida e grava como `PENDING` (nunca `ACTIVE`); duplicados/erros são contados, nunca atualizados.
- **Código de reclamação**: `POST …/claim-code` devolve o código em claro **uma só vez**; só o HMAC-SHA256 (segredo `CLINIC_LINK_CODE_SECRET`, com separação de domínio) fica em `claim_code_hash`. Validade 7 dias (pressuposto por ratificar).
- **Job** `insurer.expire-policies` (`infrastructure/jobs.ts`, diário 00:20 UTC): `ACTIVE` com `validTo < hoje` ⇒ `EXPIRED`; idempotente; auditoria `SYSTEM` por seguradora (só contagem).
- **Auditoria** `INSURER_*` (`audit.md` §3): `metadata.insurerId` sempre; nunca nomes, documentos, nº de cartão, códigos nem notas.

## Portal da clínica (`/clinic-portal/insurers*`, §8.4)
```
POST /clinic-portal/insurers/{insurerId}/eligibility
  → interface/clinic-router.ts          (ator `ClinicActorInfo` do token; a matriz papel×rota em `clinics` já recusou o Médico)
    → application/clinic-portal.ts      (papel; ligação `insurer_providers` ATIVA + módulo ativo + seguradora ativa, senão NOT_FOUND;
                                         rate limit em memória por conta e por IP; auditoria ELIGIBILITY_CHECK)
      → domain/coverage.ts              (evaluateEligibility/evaluateCoverage: ÚNICA decisão de cobertura, BR-SEG-41; pura)
      → domain/eligibility.ts           (pedido, resposta mínima e mapeador CoverageDecision → CoverageLimits; sem regras)
      → domain/card-qr.ts               (verifica o token do QR: HMAC, validade, `cardVersion`)
      → infrastructure/clinic-repo.ts   (candidato + coberturas não EXCLUDED de serviços ACTIVE; sem saldo «usado»)
```
- Resposta mínima (BR-SEG-18): `eligible:false` devolve **sempre** `{eligible, notice}` (inexistente, inelegível, QR inválido/expirado/revogado/de outra seguradora). Sem ids de família, sem dados de saúde, sem saldo.
- Rate limit (defaults conservadores, a ratificar; `security.md` não os fixa): 30 validações/10 min por conta de clínica e 60/10 min por IP; cada validação conta. Excedido ⇒ `429` + `Retry-After` e auditoria `DENIED` (`reason=RATE_LIMITED`).
- Auditoria `ELIGIBILITY_CHECK`: `metadata` só `insurerId`, `result` (`ELIGIBLE`|`NOT_ELIGIBLE`) e `serviceCode` (apenas se for um código real da lista); nunca cartão, QR, documento nem nome.
- QR: formato `base64url(JSON{v,i,b,c,e}).base64url(HMAC-SHA256)` (pressuposto de implementação, a documentação não o fixa), validade por omissão 120 s (`CARD_QR_TTL_SECONDS`); a emissão pertence a S6 e reutiliza `signCardQrToken`.

## App do paciente (S6 parcial, `/families/{f}/members/{m}/insurance/*`)
```
POST …/card-claims   → interface/patient-router.ts → application/patient-insurance.ts
   (porta PatientAccessPort ⇒ access.policy.can(MANAGE_INSURANCE): SELF adulto ou TUTOR_OF; qualquer recusa ⇒ NOT_FOUND)
   → rate limit (10/15 min por utilizador, 30/15 min por IP; cada tentativa conta)
   → infrastructure/patient-repo.ts findClaimCandidate (UMA consulta: beneficiário+apólice+HMAC+validade 7 d+não ligado ⇒ mesmo 404 em qualquer falha)
   → consumeClaimCode (uso único) + insertRequest(PENDING) + audit INSURER_LINK_REQUEST(step=CLAIM)
```
- Ator `User` (`getActor()`); a porta é ligada em `main/api.ts` sobre `access.policy` (sem importar `access`). Só seguradoras com módulo operacional ativo (reclamar exige também seguradora `ACTIVE`).
- Desligar: `CONFIRMED → REVOKED`, desfaz a ligação do beneficiário (mantém-no) e sobe `card_version` (os QR já emitidos deixam de valer); auditoria `INSURER_LINK_REVOKE`.
- QR: `signCardQrToken` (120 s), rate limit 20/10 min por cartão, auditoria `CARD_QR_ISSUE` (sem o token). Cobertura: só limites (D-A2), `COVERAGE_VIEW` quando lida por tutor. Cartão: dados da seguradora (nunca de saúde).
- Sem alerta ao paciente quando a seguradora decide: `AlertType` não prevê ligação de cartão (contrato).

## Marco B, fatia 2 (ADR-033): cobertura única, catálogo `service_kind` e política em dados
- **`domain/coverage.ts`** é a **única** decisão de cobertura (BR-SEG-41): `evaluateEligibility(beneficiary, date)` e `evaluateCoverage(plan, beneficiary, service, date, options?)` → `CoverageDecision` (razões ordenadas, comparticipação half-up, saldo). Pura (sem relógio, I/O nem texto de UI). A clínica e o cartão do paciente chamam-na por `eligibility.ts#coverageLimitsFor` (`coveredNow = reason !== WAITING_PERIOD`; a razão nunca sai, BR-SEG-18). **Proibido copiar a lógica** (comparar `waitingDays`/`validFrom`/`validTo`/estado de beneficiário ou apólice noutro ficheiro): `tests/coverage-source.test.ts` falha. Consumidores futuros (pré-cálculo, auto-aprovação, despesa) importam daqui.
- **Catálogo `service_kind`** (`domain/service-kind.ts`, `infrastructure/catalog-repo.ts`, 1 ficheiro = 1 ação em `application/`): `/insurance-portal/{catalog-types,service-kinds,services/classify}`; `guideType`/`expenseType` são códigos de tabelas globais (`guide_types`, `expense_types`): tipo novo = linha de dados (nenhum `switch` sobre os literais, `tests/coverage-source.test.ts`). Semeadura dos 9 tipos por seguradora: migração `0037` (existentes) e `ensure-service-kinds.ts` (novas, 1.ª utilização). `/services/classify` regista-se **antes** de `/services/{serviceId}`.
- **Política** (`domain/policy-setting.ts`): `resolvePolicySetting` (serviço > seguradora > omissão do Vita) e limites validados no domínio; leituras por qualquer papel do módulo, escrita só `INSURANCE_ADMIN`; auditada. Os consumidores (fatias 3, 4, 6) leem **sempre** por `resolvePolicySetting`: proibido repetir 48/72/15/7.
- Moeda: `insurance` define a moeda (`insurer_accounts.currency`, BR-SEG-42); este módulo só a lê por `InsurerSettingsPort`. Sem literal de moeda por omissão (`tests/currency-source.test.ts`).

### Fronteira `insurance` vs `insurer-ops` (marco B §7.7)
`insurance` = o que o **titular/família** faz com a seguradora (apólice própria, `ReimbursementClaim` a pedido da família, identidade e contas do portal, a moeda da seguradora). `insurer-ops` = a **operação** da seguradora (beneficiários, planos, serviços, cobertura, clínicas, política, e nas fatias seguintes autorizações e despesas). Nenhum importa o outro: ligam-se em `main/api.ts` por portas (`InsurerSettingsPort`, `InsurerOperationalDataPort`). Qualquer decisão de cobertura vive aqui (`coverage.ts`); qualquer decisão de moeda vive em `insurance`.
