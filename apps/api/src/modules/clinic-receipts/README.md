# Módulo `clinic-receipts`

M14 R (ADR-026, BR-CLN-31..37): recibos internos **não fiscais** da clínica (`ClinicReceipt`, linhas, ligação ao paciente, contador sequencial por clínica). Sem PDF no servidor (o navegador imprime a vista HTML a partir do JSON). Depende só de `access` e `audit`; tudo o resto entra por **portas** ligadas em `main/api.ts`.

## Fluxo de um pedido típico (emitir)
```
POST /clinic-portal/receipts
  → clinics/interface/clinic-portal-middleware.ts    # matriz papel × rota (Médico => 403)
  → interface/portal-router.ts
    → application/issue-receipt.ts
      → ports.BookingSource      (appointments | examinations | clinic-patients; marcação COMPLETED da clínica)
      → ports.ServiceCatalogReader / ClinicProfileReader (clinics)
      → infrastructure/repo.ts  nextNumber (UPSERT … RETURNING) + insert, na mesma transação
      → ports.ConsentLookup     (clinic-patients) → clinic_receipt_links só se há consentimento NA emissão
      → audit.record            # CLINIC_RECEIPT_ISSUE sem PII
```
Lado família: `GET /families/{f}/members/{m}/clinic-receipts[/{id}]` → `application/family-receipts.ts` → `AccessPolicy.can(VIEW_CLINIC_RECEIPTS)` (só `SELF`/`TUTOR_OF`).
`insurance` consome `interface/claim-lookup.ts` (porta `ClinicReceiptLookup`) para anexar recibos a pedidos de reembolso; `clinic-receipts` nunca importa `insurance`.

## Camadas
- `domain/` — estados, linhas, total, numeração `R-000123`, validação do corpo (puro, testado).
- `application/` — emitir, anular, listar/total (Financeiro), ver, lado família, leituras para reembolso; portas em `ports.ts`.
- `infrastructure/` — Kysely: contador, recibos imutáveis (só `status`/`voided_*` mudam), ligações.
- `interface/` — routers do portal e da família, adaptador `ClinicReceiptLookup`.
