# clinic-patients (M14 P, ADR-026)

Registo de pacientes da clínica (`ClinicPatient`), ligação a membros Vita, consentimento por clínica, código/QR de ligação (HMAC) e visitas presenciais manuais. BR-CLN-17..24, UC-CLN-14..19.

- Rotas do portal (`interface/portal-router.ts`): `/clinic-portal/patients*`, `/search`, `/calendar` (ator `ClinicAccount`).
- Rotas da família (`interface/family-router.ts`): `clinic-consents*`, `clinic-link-codes` (`AccessPolicy` `MANAGE_CLINIC_CONSENT`).
- Não importa módulos de saúde: usa as portas de `application/ports.ts` (`SharedHistoryReader`, `CalendarSource`, `SlotReservation`, `RecommendationsSource`, `MemberDirectory`, `ClinicDirectory`), ligadas em `main/api.ts`.
- `appointments` usa a porta `ClinicPatientDirectory` (walk-in, agenda, cancelar/completar visitas), implementada por `index.ts#directory`.
- Job `clinic-patients.purge-link-codes` (`infrastructure/jobs.ts`).
- Fluxo típico: `interface/portal-router.ts` -> `application/patients.ts` -> `infrastructure/repo.ts`.
