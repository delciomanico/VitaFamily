# Módulo `clinics`

M7 (`plan.md` §4): `Clinic` PARTNER/PRIVATE, incluindo a gestão de parceiras (FR-CLN, FR-ADM-01). Depende só de `access` (modules.md §2).

## Decisão de change control: `access.getMembershipFacts` em vez de `clinics` → `families`

`modules.md` §2 e `tests/architecture-rules.ts` já declaravam `clinics: ["access"]` antes desta implementação (nenhuma aresta nova a `families`). Mas `authorization.md` §4 ("Clínicas privadas: criar — adulto da família; editar/arquivar/eliminar — criador ou FAMILY_ADMIN") exige dois factos que não são decisão de `AccessPolicy.can()` (não há categoria de dados de saúde envolvida, `clinics` nem está em `HEALTH_MODULES`): **pertença** à família e **papel/idade** do actor. Resolução, mesmo critério de `getEffectiveTimezone`/`getBloodType` (modules.md §3 notas 9/10): `access` (que já depende de `families`) expõe `getMembershipFacts(trx, familyId, userId) → { memberId, role?, isAdult, status } | null` (`access/index.ts`) — computação direta na raiz (`isAdultAt`, `access/domain/age.ts`, duplicado do cálculo de idade de `families/domain/member.ts` porque `access` não pode importar o `domain` de `families`, só a sua raiz). `clinics/application/support.ts` usa isto para decidir estrutura, nunca `policy.can()`.

## Duas raízes HTTP

`createClinicsModule` devolve **dois** routers (`router`: `/families/{familyId}/clinics...`; `adminRouter`: `/admin/clinics...`) — não existe módulo `admin` ainda (M9, `plan.md` §4: "FR-ADM-01 (contas)" só nesse milestone); `modules.md` já previa que `clinics` "inclui a gestão de parceiras, exposta pelo admin através da API de `clinics`". `main/api.ts` monta os dois diretamente; quando `admin` existir, deverá montar/delegar `clinics.adminRouter` em vez de o duplicar.

## Mapa de um pedido típico
```
POST /families/{familyId}/clinics
  → interface/router.ts
    → application/create-private-clinic.ts
      → access/index.js (getMembershipFacts)   # pertença + isAdult
        → support.ts (requireAdultMember)
          → infrastructure/repo.ts (insert + countPrivateByFamily, B4: máx. 10)
            → audit.record(trx, …)             # CLINIC_CREATE
```
```
(M7+) appointments|examinations/application/support.ts (resolveClinicSnapshot)
  → modules/clinics/index.js (getBookableClinic)   # pela raiz (modules.md §2)
    → application/get-bookable-clinic.ts            # null se ARCHIVED/inexistente/outra família
```

## Camadas presentes
- `domain/clinic.ts` — `assertValidClinicName`, `MAX_PRIVATE_CLINICS_PER_FAMILY` (B4).
- `application/` — `support.ts` (`requireMembership`/`requireAdultMember`/`requireCreatorOrFamilyAdmin`/`requirePrivateClinicOfFamily`/`requirePartnerClinic` — autorização ESTRUTURAL, `authorization.md` §4, nunca `AccessPolicy`); um ficheiro por caso de uso de família (`list-clinics`, `create-private-clinic`, `update-private-clinic`, `set-private-clinic-status`, `delete-private-clinic`); `admin-clinics.ts` (as 4 operações de `/admin/clinics`, `requirePlatformAdmin` local); `get-bookable-clinic.ts` (API pública para `appointments`/`examinations`).
- `infrastructure/` — `KyselyClinicsRepository` (única tabela `clinics`).
- `interface/router.ts` + `interface/admin-router.ts` — ver "Duas raízes HTTP".

## Migração
`db/migrations/0008_clinics_appointments_examinations.sql`: `clinics` (+ `appointments`/`examinations`/`exam_results`, ver READMEs desses módulos).
