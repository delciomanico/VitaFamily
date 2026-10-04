# Decisões de arquitetura (ADR)

- ADR-001 — Escolha do PostgreSQL
- ADR-002 — Monólito modular com NestJS
- ADR-003 — Prisma como ORM, com SQL manual quando necessário
- ADR-004 — Redis e BullMQ para filas; a BD é a fonte da verdade
- ADR-005 — Dados de saúde pertencem ao FamilyMember (por família)
- ADR-006 — Armazenamento de objetos, quarentena, antivírus e download mediado
- ADR-007 — Autenticação: access token curto + refresh rotativo em cookie
- ADR-008 — Autorização centralizada (`AccessPolicy`) sem RLS no MVP
- ADR-009 — Pipeline de alertas por scanner idempotente
- ADR-010 — Datas em UTC, fuso por utilizador, relógio injetável
- ADR-011 — Hard delete com outbox de ficheiros e anonimização da auditoria
- ADR-012 — Stack em Go, alojamento em VPS própria e domínio (decisão do proprietário; substitui ADR-003 e parte de ADR-002/004)

Alterar uma decisão exige um novo ADR que a substitua (change control, prompt §23).
- ADR-013 — Monorepo e módulos em camadas (pedido do proprietário)
