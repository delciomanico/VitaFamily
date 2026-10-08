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
