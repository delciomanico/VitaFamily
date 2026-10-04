# ADR-008 — Autorização centralizada (`AccessPolicy`) sem RLS no MVP

**Estado:** Aceite (delegação do proprietário, 2026-10-04)

## Contexto
A matriz de permissões é rica (papel × relação × partilha × categoria). Espalhá-la em guards causa lacunas.

## Decisão
Um **`AccessPolicy`** único, invocado nos application services; **repositórios exigem `familyId`**; FKs compostas (`family_id`, `member_id`) garantem coerência no esquema. **Sem Row-Level Security** do Postgres no MVP.

## Alternativas
RLS no PostgreSQL; ACL por recurso; biblioteca CASL em guards.

## Justificação
A política precisa de dados contextuais (tutela, partilha) difíceis de expressar em RLS com Prisma e pooling; testes gerados da matriz dão cobertura forte. As FKs compostas dão uma rede de segurança na BD.

## Consequências
A segurança depende do código passar pela policy: mitigado por testes de arquitetura e testes de isolamento obrigatórios (NFR-QA-03). RLS pode ser acrescentado como defesa em profundidade.
