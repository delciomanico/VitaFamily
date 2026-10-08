# Módulo `audit`

Regista eventos de auditoria na mesma transação da ação que os origina (`audit.md`, ADR-011). Não tem endpoint HTTP próprio no MVP — por isso não há pasta `interface/`.

## Mapa de um pedido típico
Não há "pedido" de fora — este módulo é chamado por outros módulos a meio da própria transação deles:

```
outro módulo (ex. auth/application/refresh.ts)
  → audit.record(trx, event)              # index.ts (API pública)
    → infrastructure/repo.ts               # KyselyAuditRepository.record — INSERT na mesma trx do chamador
```

As duas outras operações (`purgeOlderThan`, `anonymizeUser`) são chamadas por jobs (M9), não por pedidos HTTP:
```
job (M9, ainda não implementado)
  → audit.purgeOlderThan(cutoff) / audit.anonymizeUser(userId)   # index.ts
    → infrastructure/repo.ts                                      # KyselyAuditMaintenanceRepository
```

## Camadas presentes
- `domain/event.ts` — forma do evento (`AuditEvent`, tipos de ação/resultado); regras puras, sem I/O.
- `application/ports.ts` — portas `AuditRepository`/`AuditMaintenanceRepository` (critério ADR-016: implementação real é BD, e os testes usam um fake).
- `infrastructure/repo.ts` — implementação Kysely das portas acima.
- Sem `interface/`: nenhum endpoint usa este módulo diretamente (ver `audit.md` regra 4).

## Porquê cada porta existe
- `AuditRepository`/`AuditMaintenanceRepository`: ferramenta externa real (Postgres via Kysely) + precisa de ser substituível em testes por um fake em memória — critério 1 e 3 do ADR-016.
