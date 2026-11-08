# Módulo `clinic-reports`

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
