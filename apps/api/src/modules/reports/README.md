# Módulo `reports`

M9 (`plan.md` §4): vistas calculadas (FR-RPT) — relatório individual (UC-RPT-01) e visão familiar (UC-RPT-02). Sem tabelas próprias.

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
