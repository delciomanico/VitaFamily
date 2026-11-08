# clinic-patients (M14 P, ADR-026)

Registo de pacientes da clínica (`ClinicPatient`), ligação a membros Vita, consentimento por clínica, código/QR de ligação (HMAC) e visitas presenciais manuais. BR-CLN-17..24, UC-CLN-14..19.

- Rotas do portal (`interface/portal-router.ts`): `/clinic-portal/patients*`, `/search`, `/calendar` (ator `ClinicAccount`).
- Rotas da família (`interface/family-router.ts`): `clinic-consents*`, `clinic-link-codes` (`AccessPolicy` `MANAGE_CLINIC_CONSENT`).
- Não importa módulos de saúde: usa as portas de `application/ports.ts` (`SharedHistoryReader`, `CalendarSource`, `SlotReservation`, `RecommendationsSource`, `MemberDirectory`, `ClinicDirectory`), ligadas em `main/api.ts`.
- `appointments` usa a porta `ClinicPatientDirectory` (walk-in, agenda, cancelar/completar visitas), implementada por `index.ts#directory`.
- Job `clinic-patients.purge-link-codes` (`infrastructure/jobs.ts`).
- Fluxo típico: `interface/portal-router.ts` -> `application/patients.ts` -> `infrastructure/repo.ts`.

## Fluxo do dia, retornos e indicadores (M14 Q, BR-CLN-25..30)
- Visitas manuais: `application/visit-day-flow.ts` (confirmar por telefone, Chegou/Iniciar/Faltou, retorno), regras puras em `domain/day-flow.ts`; `NO_SHOW` é reversível pela chegada tardia e não reabre o horário passado. Chamadas por `appointments` (despacho por id) através da porta `ClinicPatientDirectory`.
- `GET /clinic-portal/reports/summary` e `GET /clinic-portal/follow-ups`: `application/reports.ts` + `domain/report.ts`, sobre a porta `ReportSource` (consultas/exames/retornos Vita, ligada em `main/api.ts`) e `SlotReservation` (horários/capacidade). Só contagens e taxas, 30 pedidos/min por conta, sem auditoria nem PII.
- Calendário/ficha: `confirmationStatus`, `dayState`, `arrivedAt`, `waitingMinutes`; consultas `CANCELLED`+`DECLINED` e visitas `NO_SHOW` aparecem no calendário.
