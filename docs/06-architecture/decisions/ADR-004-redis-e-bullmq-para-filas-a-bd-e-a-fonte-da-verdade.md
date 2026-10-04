# ADR-004 — Redis e BullMQ para filas; a BD é a fonte da verdade

**Estado:** Parcialmente substituída por ADR-012: mantém-se "a BD é a fonte da verdade"; fila em **river (PostgreSQL)**, **sem Redis**.

## Contexto
Há trabalho assíncrono (notificações, antivírus, exportações) e agendado (alertas, tomas). Perder um lembrete é um risco de saúde.

## Decisão
Usar **Redis + BullMQ** para filas e rate limit. Alertas e tomas existem como **linhas na BD**; o scanner (cada minuto) lê a BD; se o Redis perder dados, os jobs recriam-se a partir do estado persistente.

## Alternativas
Cron + tabela de jobs só em PostgreSQL; RabbitMQ/Kafka; serviços geridos (SQS).

## Justificação
BullMQ é simples e maduro; manter a verdade na BD evita depender da durabilidade do Redis. Idempotência por `dedupeKey` evita duplicados.

## Consequências
Dois mecanismos a monitorizar (filas e scanner). Redis fora do caminho crítico de dados.
