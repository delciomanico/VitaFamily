# Vita Family — Migrações (Fase 12)

> **ATUALIZAÇÃO 2026-10-08 (ADR-014/ADR-015, decisão do proprietário):** a implementação é em **Node.js/TypeScript** (Clean Architecture), com Kysely+`pg` e um **runner de migrações próprio** (SQL simples e numerado, tabela de controlo + transação — sem Prisma), pg-boss, **sem Redis**, em **VPS própria** com Caddy, domínio `vitafamily.cassfrei.com`. Onde este documento diz Prisma, `prisma migrate deploy`, Redis, BullMQ ou Jest, ler o equivalente de ADR-014/ADR-015: o runner próprio aplica as migrações SQL antes de arrancar a nova versão.

> Estado: **v0.1**.

## Princípios
1. **Migrações versionadas e imutáveis** depois de aplicadas num ambiente partilhado; correções = nova migração.
2. Geradas pelo Prisma; **constraints avançadas** (índices parciais, FKs compostas, `CHECK`, `NULLS NOT DISTINCT`, tipos `citext`) em migrações SQL manuais, na mesma sequência (ADR-003).
3. Cada migração é pequena e com um único propósito; nomeadas `YYYYMMDDHHmm_descricao`.
4. **Expand → migrate → contract** para alterações com dados: (1) acrescentar nova estrutura compatível, (2) migrar dados, (3) remover a antiga numa migração posterior; nunca remover e acrescentar na mesma release.
5. Migrações **reversíveis em desenvolvimento** (script de *down* guardado junto, NFR-DATA-04); em produção avança-se com correção-para-a-frente e restauro de backup como último recurso.
6. Aplicação em produção: `prisma migrate deploy` como passo **antes** de arrancar a nova versão (ver `deployment.md`).
7. Dados de teste/seed só em desenvolvimento e staging; produção nunca recebe seeds, exceto o **bootstrap** do primeiro Platform Admin (comando CLI explícito, auditado).
8. Antes de uma migração destrutiva em produção: backup verificado + janela comunicada.

## Verificações automáticas em CI
- A BD criada pelas migrações coincide com `schema.prisma` + SQL manual (teste de *drift*).
- Teste de integração valida cada constraint crítica: tutor principal único, isolamento por FK composta, `CHECK` de documentos, `dedupe_key` único.
- Linter de SQL para operações bloqueantes em tabelas grandes (ex.: `CREATE INDEX` sem `CONCURRENTLY` em tabelas de volume).

## Ordem inicial das migrações (M0–M9)
`0001 extensões e enums` → `0002 users/auth` → `0003 families/members/guardianships/invitations/sharing` → `0004 health records` → `0005 clinics` → `0006 prescriptions/plans/doses` → `0007 appointments/examinations/results` → `0008 documents/file_deletions` → `0009 alerts/notifications/push/preferences` → `0010 audit_logs` → `0011 data_exports` → `0012 índices de desempenho`. (Cada milestone acrescenta as suas.)

**Nota 2026-10 (decisão do proprietário, change control, mesmo padrão da nota 9 de `06-architecture/modules.md`):** a ordem real de implementação (`11-implementation/plan.md` §4) coloca `documents` em **M5**, antes de `prescriptions`/`examinations` (M6/M7) — o inverso da ordem conceptual acima, que listava `documents` como `0008`, depois dessas duas tabelas. Na implementação Node.js/TypeScript (ADR-014/ADR-015), a migração real é `apps/api/db/migrations/0006_documents.sql` (antes de `prescriptions`/`examinations`, que ainda não existem). Resolução: esquema em 2 fases.
- **Fase 1 (M5, `0006_documents.sql`):** `documents` nasce com as colunas `prescription_id uuid`/`examination_id uuid` **sem** `REFERENCES` (as tabelas-alvo não existem ainda), mas já com o `CHECK num_nonnulls(prescription_id, examination_id) = 1` — não depende de FK, só dos valores das colunas.
- **Fase 2 (a fazer nas migrações de M6/M7):** depois de criar `prescriptions` (M6), `ALTER TABLE documents ADD CONSTRAINT documents_prescription_fk FOREIGN KEY (prescription_id) REFERENCES prescriptions (id) ON DELETE CASCADE;`; depois de criar `examinations` (M7), o equivalente para `examination_id` → `examinations`. Até essas migrações existirem, a API pública `documents.deleteAllForResource` (`apps/api/src/modules/documents/index.ts`) é a forma correta de apagar os documentos de uma receita/exame ao apagar o recurso — não depender só da cascata de FK. Ver `apps/api/src/modules/documents/README.md` e o comentário SQL no topo de `0006_documents.sql`.
  - **M6 concluído:** o FK `documents_prescription_fk` já foi acrescentado em `apps/api/db/migrations/0007_prescriptions_and_medications.sql` (mesma migração que cria `prescriptions`/`medication_plans`/`dose_occurrences`). `documents.deleteAllForResource` continua a ser o caminho usado por `prescriptions/application/delete-prescription.ts` (enfileira o outbox de ficheiros antes de apagar as linhas); o FK é só a rede de segurança ao nível da BD. Falta ainda o equivalente para `examination_id` → `examinations` (M7).
