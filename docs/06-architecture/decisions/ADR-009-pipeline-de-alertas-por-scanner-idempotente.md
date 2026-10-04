# ADR-009 — Pipeline de alertas por scanner idempotente

**Estado:** Aceite (delegação do proprietário, 2026-10-04)

## Contexto
Prompt §18 exige Evento → Regra → Alerta → Notificação; NFR-AVL-02 exige não perder nem duplicar lembretes.

## Decisão
Doses, consultas e exames são linhas com instante; um **scanner por minuto** gera `alerts` com `dedupeKey` único e cria `notifications` por canal; regras são funções puras com valores fixos (R9, BR-APT-05).

## Alternativas
Agendar um job por evento no Redis; regras configuráveis em BD.

## Justificação
Agendar por evento perde-se se o Redis falhar e exige cancelar ao editar; o scanner sobre estado persistente é simples e recuperável. Regras em BD seriam overengineering com valores fixos.

## Consequências
Latência de até ~1 min (NFR-PERF-03 ≤ 1 min); custo de consulta controlado por índices em `(status, scheduled_at)`.
