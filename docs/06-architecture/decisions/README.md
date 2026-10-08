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
- ADR-012 — Stack em Go, alojamento em VPS própria e domínio (substituída por ADR-014 na linguagem/dados/filas; alojamento/domínio/storage mantêm-se)
- ADR-013 — Monorepo e módulos em camadas (substituída por ADR-015)
- ADR-014 — Stack em Node.js/TypeScript com Clean Architecture (decisão do proprietário; substitui ADR-012 e ADR-003; restaura o monólito modular de ADR-002 sem NestJS)
- ADR-015 — Monorepo e módulos em Clean Architecture por módulo (substitui ADR-013)
- ADR-016 — Limites práticos da Clean Architecture por módulo: quando criar porta, quando não (esclarece ADR-014/ADR-015, não as substitui)

Alterar uma decisão exige um novo ADR que a substitua (change control, prompt §23).
