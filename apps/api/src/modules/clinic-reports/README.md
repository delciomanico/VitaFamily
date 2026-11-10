# Módulo `clinic-reports`

> M15 U/V (ADR-028, BR-CLN-51..56): acrescenta o **pedido de exame** (`ExamOrder`, ponte `clinic_exam_order_links`, PDF "Pedido de exame", rotas `/clinic-portal/agenda/{id}/exam-orders*` e `/families/{f}/members/{m}/exam-orders`) e a **declaração de presença** (PDF a pedido, sem tabela). Ver a secção "Pedido de exame e declaração de presença" no fim.

M15 S/T (ADR-027, BR-CLN-41..50): relatório da consulta da clínica (`ConsultationReport`, 1:1 com a marcação, `DRAFT → FINAL` imutável + adendas), PDF gerado a pedido e layout do laudo de exame (realce aritmético "Fora da referência" só dentro do PDF). Registo **da clínica**: sem FK para `appointments`/`clinic_visits`. Só `clinics` (via portas) e `audit`; tudo o resto entra por **portas** ligadas em `main/api.ts` (`BookingSource`, `FamilyAppointmentLookup`, `ClinicProfileReader`, `ProfessionalReader`, `PatientAccess`, `PdfRenderer`).

## Fluxo de um pedido típico (guardar rascunho)
```
PUT /clinic-portal/agenda/{id}/report
  → clinics/interface/clinic-portal-middleware.ts    # matriz papel × rota (Admin/Gestor => 403)
  → interface/portal-router.ts
    → application/clinic-reports.ts (saveReport)
      → domain/consultation-report.ts   parseReportInput (limites, ≥1 secção, sem controlo)
      → ports.BookingSource             (appointments | clinic-patients) + ProfessionalReader (âmbito do Médico)
      → infrastructure/repo.ts          upsert (ON CONFLICT … WHERE status='DRAFT')
      → audit.record                    # CONSULT_REPORT_SAVED sem texto
```
- `PUT …/complete` com `report`: `appointments` chama `finalizeWithComplete` (porta `ConsultationReportFinalizer`) na transação da conclusão.
- PDF: `domain/report-pdf.ts` monta `PdfDocument`; `infrastructure/pdfkit-renderer.ts` (pdfkit, JS puro) desenha. Laudo do exame: `application/exam-report.ts` implementa a porta `ExamReportGenerator` de `examinations`; `domain/exam-report-pdf.ts` tem `isOutOfReference` (`valor < min || valor > max`, estrito).
- Lado família: `GET /families/{f}/members/{m}/appointments/{id}/report[/pdf]` → `application/family-reports.ts` → `PatientAccess` (`AccessPolicy.can(VIEW_CONSULTATION_REPORT)`: só `SELF`/`TUTOR_OF`).

## Camadas
- `domain/` — relatório, validação, estado, layouts do PDF e do laudo (puro, testado).
- `application/` — casos de uso e portas (`ports.ts`).
- `infrastructure/` — Kysely (relatório + adendas; trigger de BD garante a imutabilidade) e adaptador pdfkit.
- `interface/` — routers do portal e da família.

## Pedido de exame e declaração de presença (M15 U/V, ADR-028)
```
POST /clinic-portal/agenda/{id}/exam-orders                  (só o Médico; Admin/Gestor => 403 no middleware)
  → interface/portal-router.ts
    → application/exam-orders.ts (createExamOrders → createOrders)
      → domain/exam-order.ts        parseExamOrdersBody (1–5 itens, nome ou serviço, nota, urgent)
      → ports.BookingSource         (arrivedAt?, vitaMember? só no servidor) + assertInScope (Médico só as suas)
      → ordersRepo.lockBooking      pg_advisory_xact_lock(booking) + countActive ≤ 5
      → infrastructure/exam-orders-repo.ts  insert + insertLink (só consulta Vita)
      → ports.ExamOrderAlerts       alerts.raiseExamOrderEvent (1 alerta genérico por pedido, só SELF/TUTOR_OF)
      → audit.record                EXAM_ORDER_CREATED (contagens, nunca texto)
```
- `examOrders` em `PUT …/complete`: `appointments` chama `createWithComplete` (porta `ConsultationReportsPort.createExamOrdersWithComplete`) na transação da conclusão.
- Estado do pedido: movido pela porta `ExamOrderLinker` (`application/family-exam-orders.ts#createExamOrderLinker`, definida em `examinations`): `link` (valida `VIEW_EXAM_ORDERS` e `ORDERED`, calcula `booked_here`), `release` (exame cancelado/apagado) e `fulfil` (exame concluído), todas na transação do exame. A API do portal **mascara** `SCHEDULED`/`FULFILLED` como `ORDERED` se `booked_here=false` (`domain/exam-order.ts#clinicVisibleStatus`).
- PDF: `domain/exam-order-pdf.ts` (pedido e declaração) → mesmo `PdfRenderer`; a declaração (`application/attendance-statement.ts`) exige `COMPLETED` ou `SCHEDULED` com `arrivedAt` e nunca inclui especialidade/diagnóstico; só auditoria `ATTENDANCE_STATEMENT_ISSUED`.
- Rate limits: criar/cancelar pedidos 30/min por conta (bolsa `order-write`); os PDF (relatório, pedido, declaração) partilham a bolsa `pdf` de 30/min.
- Família: `GET …/exam-orders` (`application/family-exam-orders.ts`, `PatientAccess.assertCanViewExamOrders` = `AccessPolicy.can(VIEW_EXAM_ORDERS)`).
