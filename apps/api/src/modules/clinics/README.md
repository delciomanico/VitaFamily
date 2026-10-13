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
- `domain/clinic.ts` — `assertValidClinicName`, `MAX_PRIVATE_CLINICS_PER_FAMILY` (B4). `domain/clinic-staff-hierarchy.ts` — `assertCanManageStaff`/`assertRemovableStaffTarget` (Fase C, BR-CLN-05). `domain/clinic-slot.ts`/`domain/clinic-slot-time.ts` — `ClinicSlot`, validações (BR-CLN-04) e conversão de hora local para UTC (Fase C).
- `application/` — `support.ts` (`requireMembership`/`requireAdultMember`/`requireCreatorOrFamilyAdmin`/`requirePrivateClinicOfFamily`/`requirePartnerClinic` — autorização ESTRUTURAL, `authorization.md` §4, nunca `AccessPolicy`); um ficheiro por caso de uso de família (`list-clinics`, `create-private-clinic`, `update-private-clinic`, `set-private-clinic-status`, `delete-private-clinic`); `admin-clinics.ts` (as operações de `/admin/clinics`, `requirePlatformAdmin` local, incluindo `adminCreateOrResetClinicRootAccount`); `get-bookable-clinic.ts` (API pública para `appointments`/`examinations`); `manage-clinic-staff.ts`/`clinic-slots.ts` (Fase C, ver secção própria abaixo).
- `infrastructure/` — `KyselyClinicsRepository` (tabela `clinics`), `KyselyClinicAccountRepository`/`KyselyClinicSessionRepository` (tabelas `clinic_accounts`/`clinic_sessions`, D18), `KyselyClinicSlotsRepository` (tabela `clinic_slots`, Fase C).
- `interface/router.ts` + `interface/admin-router.ts` — ver "Duas raízes HTTP"; `interface/clinic-portal-router.ts` — ver "Portal da clínica" abaixo (inclui `/clinic-portal/staff/*` e `/clinic-portal/slots/*`, Fase C).

## Migração
`db/migrations/0008_clinics_appointments_examinations.sql`: `clinics` (+ `appointments`/`examinations`/`exam_results`, ver READMEs desses módulos). `db/migrations/0012_clinic_accounts.sql`: `clinic_accounts`/`clinic_sessions` + `actor_type` ganha `CLINIC_ACCOUNT` + `audit_logs.actor_clinic_account_id` (D18). `db/migrations/0013_clinic_slots.sql`: `clinic_slots` (Fase C).

## Portal da clínica (`ClinicAccount`, D17/D18, ADR-020, change control desta fase)

Identidade **totalmente separada** de `User`: `clinic_accounts`/`clinic_sessions` sem nenhuma FK para `users`/`family_members` (ADR-020). Decisão de onde este código vive (ADR-020 deixava "módulo `clinic-portal` novo, ou secção própria dentro de `clinics` — detalhe de implementação"): ficou dentro de `clinics`, porque já depende só de `access`/`audit` e já expõe `/admin/clinics...`; acrescentar o portal não introduz nenhuma aresta nova no grafo de módulos (`modules.md` §2/§3 inalterados) — um módulo novo exigiria repetir as mesmas duas dependências sem ganho de isolamento (o isolamento real já vem de `ClinicAccount` não ter FK/import de `users`/`auth`, não de estar numa pasta `modules/` diferente).

Tudo o que seria "igual" a `auth` (hashing argon2id, refresh token opaco rotativo, rate limiter em memória, cache de estado ≤60 s, cookie HttpOnly) está **duplicado** em `domain/clinic-*.ts` (CLAUDE.md: a separação de identidade é deliberada — `clinics` nunca importa `modules/auth`).

- **JWT do portal**: claims `cid` (clinicAccountId) + `csid` (sessionId do portal) — nunca `sub`/`sid`/`userId`/`familyId` de `User` (authorization.md §1, ADR-020). `clinicId`/`role` NÃO vão no token: são resolvidos por pedido a partir de `clinic_accounts`, com cache ≤60 s (`resolve-clinic-actor-state.ts`), para que uma suspensão (`authorization.md` §6.1 passo 1) tenha efeito quase imediato, não só no próximo login — mesmo critério de `auth/application/resolve-actor-state.ts`.
- **Ator do pedido**: `platform/actor` ganhou um SEGUNDO `AsyncLocalStorage` (`ClinicActorInfo`/`runWithClinicActor`/`getClinicActor`) — nunca o mesmo de `ActorInfo` de `User` (ADR-020); só as rotas `/clinic-portal/*` o preenchem.
- **Segurança HTTP**: `createClinicBearerAuthSecurityHandler` (esquema `clinicBearerAuth` do contrato) + `createClinicActorContextMiddleware`; `main/api.ts` compõe este middleware a seguir ao de `auth` (cada pedido só preenche um dos dois `req.authSubject`/`req.clinicAuthSubject`, nunca os dois).
- **Admin**: `POST /admin/clinics/{clinicId}/root-account` (ator de **User**/Platform Admin normal, não o do portal) cria/repõe a conta `CLINIC_ADMIN` raiz — idempotente (UNIQUE parcial `clinic_accounts_single_active_admin_idx`, BR-CLN-05); a password é sempre gerada pelo servidor e só sai por e-mail (`ClinicMailer`, best effort via `send-clinic-mail.ts`).

### Mapa de um pedido típico (login do portal)
```
POST /clinic-portal/auth/login
  → interface/clinic-portal-router.ts
    → application/clinic-login.ts
      → domain/clinic-account-password.ts (verifyClinicPassword)
        → infrastructure/clinic-account-repo.ts (findByEmail)
          → infrastructure/clinic-account-repo.ts (ClinicSessionRepository.insert)
            → audit.record(trx, …)   # CLINIC_ACCOUNT_LOGIN(_FAILED)
              → domain/clinic-jwt.ts (signClinicAccessToken)
```

## Hierarquia de staff e `ClinicSlot` (Fase C, BR-CLN-04/05)

**Staff = `ClinicAccount` com papel `CLINIC_MANAGER`** — decisão desta fase (não uma tabela nova):
`clinic_accounts` já modela os dois papéis do portal (`clinic_account_role`, schema.md §1, Fase A);
um `CLINIC_MANAGER` criado pelo `CLINIC_ADMIN` da sua clínica é só mais uma linha dessa tabela, com
`created_by_platform_admin = NULL` (esse campo só é preenchido na conta `CLINIC_ADMIN` raiz, Fase
B). `ClinicAccountRepository` ganhou `listByClinic`/`delete` (só usados por `manage-clinic-staff.ts`
— as restantes operações do portal continuam a usar `insert`/`findByEmail`/etc.). A regra "só o
`CLINIC_ADMIN` da própria clínica gere os seus `CLINIC_MANAGER`" (BR-CLN-05, authorization.md §6.3)
é pura em `domain/clinic-staff-hierarchy.ts` (`assertCanManageStaff`/`assertRemovableStaffTarget`),
usada por `application/manage-clinic-staff.ts` — nunca o Platform Admin (esse só cria/repõe a conta
raiz, Fase B), nunca outra clínica (`NOT_FOUND`, sem enumerar o motivo).

**`ClinicSlot`** (`domain/clinic-slot.ts`, `application/clinic-slots.ts`, BR-CLN-04/UC-CLN-04):
publicar/listar/remover os horários da própria clínica. `domain/clinic-slot-time.ts` converte
`date`+`times` locais (fuso fixo `CLINIC_TIMEZONE = "Europe/Lisbon"` — a Vita Family só opera em
Portugal, CLAUDE.md; sem o conceito de "fuso efetivo" de `families`/`medications`, que `clinics` não
importa) para o instante UTC, com o mesmo algoritmo de ponto fixo sobre `Intl.DateTimeFormat` de
`medications/domain/schedule.ts` (duplicado deliberadamente, não há aresta `clinics` → `medications`
em `modules.md`). `publishClinicSlots` ignora, em silêncio, horas passadas e duplicadas (mesma hora,
especialidade, profissional — BR-CLN-04) em vez de falhar o lote.

**Decisão desta fase sobre "livre"**: `clinic_slots` (schema.md §3) não guarda estado próprio — é
`appointments.slot_id` que marca um horário como ocupado (`REQUESTED`/`SCHEDULED`, ligado na Fase D,
D17). `clinics/index.ts` expõe pela raiz `listFreeClinicSlots(clinicId, specialty?)` e
`findClinicSlot(clinicId, slotId)` — desde a Fase D consumidas por `appointments`
(`application/ports.ts#ClinicsPort`/`support.ts#resolveSlotBooking`) para resolver/validar pedidos
num horário (UC-APT-07) e para `GET /families/{familyId}/clinics/{clinicId}/slots`
(`appointments/application/list-available-slots.ts`). **Limitação que permanece** (fora do âmbito
da Fase D, só toca `appointments`+`clinics` pela raiz): `listOwnClinicSlots`
(`GET /clinic-portal/slots`, a vista da própria clínica) continua a devolver sempre
`state: "FREE"` e `removeClinicSlot` continua a remover sem verificar ocupação — `clinics` não
pode importar `appointments` (modules.md §2) para calcular o estado real aqui; resolver isto
exigiria uma porta nova (ex.: callback injetado pelo composition root) fora do âmbito desta fase.

### Migração
`db/migrations/0013_clinic_slots.sql`: tabela `clinic_slots` (schema.md §3 v0.2), sem FK de
`appointments` (essa liga-se só na Fase D).

### Mapa de um pedido típico (publicar horários)
```
POST /clinic-portal/slots
  → interface/clinic-portal-router.ts (ClinicPortalActor: clinicId/role da sessão)
    → application/clinic-slots.ts (publishClinicSlots)
      → domain/clinic-slot.ts (assertValidSpecialty/assertValidDurationMinutes)
        → domain/clinic-slot-time.ts (zonedTimeToUtc, CLINIC_TIMEZONE)
          → infrastructure/clinic-slots-repo.ts (existsDuplicate + insert)
            → audit.record(trx, …)   # CLINIC_SLOT_PUBLISH
```

## Pendente (Fase G — reportado pela Fase F, frontend)
`ClinicTokenResponse` (login/refresh, `clinicLogin`/`clinicRefreshToken`) só devolve
`clinicId`/`role`, nunca o nome da clínica — a UI do portal (`apps/web`) mostra o e-mail da conta em
vez do nome. Não é falha de segurança (o `clinicId` já identifica a clínica correta, só a
apresentação fica pior) nem de autorização — fica como melhoria de UX pendente, fora do âmbito
desta fase: exigiria alterar `ClinicTokenResponse` (ou acrescentar `GET /clinic-portal/me`) por
change control (decisão do proprietário), já que o contrato é fonte da verdade.
