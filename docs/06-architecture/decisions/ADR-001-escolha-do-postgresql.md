# ADR-001 — Escolha do PostgreSQL

**Estado:** Aceite (delegação do proprietário, 2026-10-04)

## Contexto
Precisamos de uma base de dados para dados relacionais com forte integridade (famílias, membros, tutela, registos de saúde), transações e consultas por tempo (tomas, alertas).

## Decisão
Usar **PostgreSQL 16** como única fonte da verdade.

## Alternativas
MySQL/MariaDB; MongoDB; SQLite.

## Justificação
Relacional e transacional; `timestamptz`, `jsonb`, índices parciais (tutor principal único, dedupe), constraints compostas para isolamento entre famílias. MongoDB perde integridade referencial que o domínio exige; SQLite não serve concorrência de produção.

## Consequências
Operação de uma BD gerida/própria com backups e WAL. Algumas constraints exigem SQL manual nas migrações (ADR-003).
