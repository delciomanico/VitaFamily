// Portas do módulo audit (conventions.md §3.2): definidas aqui, implementadas em infrastructure.
import type { AuditEvent } from "../domain/event.js";

/**
 * Persiste eventos de auditoria. `record` recebe o "handle" de transação genérico (`Trx`) do
 * chamador — audit.md regra 3: a escrita de auditoria acontece na MESMA transação da ação; quem
 * chama (outro módulo) passa a sua própria transação Kysely, cujo tipo concreto só a
 * infrastructure de cada módulo conhece. Por isso a porta é genérica em `Trx`.
 */
export interface AuditRepository<Trx> {
  record(trx: Trx, event: AuditEvent): Promise<void>;
}

/** Porta de manutenção (audit.md regras 5/6): fora do caminho transacional de negócio. */
export interface AuditMaintenanceRepository {
  /** Remove entradas com `occurredAt` anterior a `cutoff` (retenção de 24 meses). */
  purgeOlderThan(cutoff: Date): Promise<number>;
  /** Anonimiza `actorUserId`, `ip`, `userAgent` de todas as entradas de `userId` (D15/ADR-011). */
  anonymizeUser(userId: string): Promise<number>;
}
