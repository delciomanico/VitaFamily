# ADR-010 — Datas em UTC, fuso por utilizador, relógio injetável

**Estado:** Aceite (delegação do proprietário, 2026-10-04)

## Contexto
Lembretes dependem de hora local do utilizador (M3) e do horário de verão (NFR-AVL-05).

## Decisão
Guardar tudo em **UTC** (`timestamptz`); o fuso efetivo (IANA) calcula ocorrências; `Clock` injetável em todos os serviços e jobs.

## Alternativas
Guardar hora local; fuso fixo Europe/Lisbon.

## Justificação
Evita ambiguidades e permite testar DST e passagem do tempo sem esperar.

## Consequências
Mudar fuso recalcula ocorrências futuras (job); testes de DST obrigatórios.
