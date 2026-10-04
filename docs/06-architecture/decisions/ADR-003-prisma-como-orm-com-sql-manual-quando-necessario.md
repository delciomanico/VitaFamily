# ADR-003 — Prisma como ORM, com SQL manual quando necessário

**Estado:** **Substituída por ADR-012** (sqlc + goose em vez de Prisma).

## Contexto
Precisamos de acesso tipado à BD e migrações versionadas, mas também de constraints que ORMs não modelam (índices parciais, FKs compostas, `CHECK`).

## Decisão
Usar **Prisma** para modelo, cliente e migrações; acrescentar **SQL manual nas migrações** para constraints avançadas. Repositórios encapsulam o Prisma (nenhuma outra camada o importa).

## Alternativas
TypeORM; Drizzle; Kysely; SQL puro.

## Justificação
Boa produtividade e tipos. O encapsulamento em repositórios limita o custo de substituir o ORM no futuro.

## Consequências
Dois sítios com verdade do esquema (schema.prisma + SQL manual): documentado em `07-database/migrations.md` e verificado por testes de integração.
