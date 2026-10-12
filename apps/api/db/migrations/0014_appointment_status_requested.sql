-- Portal da clínica parceira (D17, Fase D): novo estado `REQUESTED` de `appointment_status`
-- (state-machines.md "Appointment", schema.md §7). Postgres exige que `ALTER TYPE ... ADD VALUE`
-- fique na sua própria transação quando o valor é usado por outra migração a seguir (o runner
-- aplica cada ficheiro numa transação própria, `db/migrate-runner.ts`) — por isso esta migração
-- só acrescenta o valor; `REJECTED` fica na migração seguinte (0015) e as colunas/constraints que
-- os usam ficam em 0016, depois de ambos committados. SQL simples, sem marcadores +goose
-- (ADR-014/ADR-015).
ALTER TYPE appointment_status ADD VALUE 'REQUESTED';
