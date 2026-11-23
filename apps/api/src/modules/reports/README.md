# Módulo `reports`

M9 (`plan.md` §4): vistas calculadas (FR-RPT) — relatório individual (UC-RPT-01) e visão familiar (UC-RPT-02). M17: **Resumo de saúde** do membro e da família (UC-RPT-05/05b, BR-RPT-11..18). Sem tabelas próprias.

## Como respeita a partilha (FR-RPT-03, BR-RPT-01)
`reports` **não decide permissões**. Lê pelas leituras públicas (`reads`) dos módulos dono (`families`, `health-records`, `prescriptions`, `medications`, `appointments`, `examinations`; contratos em `platform/reads`), que passam pela mesma `AccessPolicy` e auditoria dos endpoints GET. `Forbidden`/`NotFound` de uma leitura = secção **omitida** (não "vazia"). Sem nenhuma secção legível → `NOT_FOUND` (não revela o membro). O Family Admin não vê mais por ser Admin (D13).

As portas (`application/ports.ts`) são ligadas em `main/api.ts`; por isso `reports` não importa os outros módulos (a lista de `architecture-rules.ts` é só o máximo permitido).

## Mapa de um pedido típico
```
GET /families/{familyId}/members/{memberId}/report?from&to
  → interface/router.ts
    → application/member-report.ts
      → domain/period.ts (Q11: 12 meses por defeito, máx. 5 anos)
      → sources.* (reads dos módulos dono, em paralelo; Forbidden/NotFound → secção omitida)
```

## Notas
- Itens pendentes (UC-RPT-02, proposta): tomas UNCONFIRMED dos últimos 7 dias, consultas AGENDADAS já passadas (Q4) e exames AGENDADOS já passados — só na visão familiar.
- O endpoint de adesão (`medication-adherence`, UC-RPT-03) é de `medications`; o relatório individual limita-o ao período.
- Listas lidas até 5 páginas de 100 por secção.

## Resumo de saúde (M17)
```
GET /families/{f}/members/{m}/health-summary?from&to   |   GET /families/{f}/health-summary?from&to
  → interface/router.ts (Cache-Control: private, no-store; nunca há PDF nem ligação, BR-RPT-18)
    → application/health-summary.ts (limite 30/min, período, auditoria REPORT_VIEW só ao ver outro titular)
      → application/health-summary-core.ts (leituras `sources.*` por categoria → secções; Forbidden/NotFound = omitida)
        → domain/health-summary.ts (aritmética pura: adesão, séries por parâmetro+unidade, contagens, completude)
```
- Portas extra (`HealthSummarySources`, ligadas em `main/api.ts`): `alerts` (contagens do próprio pedinte, módulo `alerts`), `canWrite` (`AccessPolicy`, só para `sourceIds`), `timezone` (fuso efetivo do membro), `auditView`.
- Sem IA e sem juízo: nunca «fora da referência»; `variationPct` só aritmético; «o que falta» só de completude (BR-RPT-17).
- Datas do contrato de leitura (`issuedOn`, `scheduledAt`, `examDate`) substituem `createdAt/updatedAt` na «atividade» (BR-RPT-16) e no fecho de receitas (BR-RPT-15): decisão a validar.
