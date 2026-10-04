# ADR-011 — Hard delete com outbox de ficheiros e anonimização da auditoria

**Estado:** Aceite (delegação do proprietário, 2026-10-04)

## Contexto
RGPD: direito ao apagamento (D15, N6) sem perder a integridade nem a capacidade de auditar.

## Decisão
Eliminação **física** em transação; ficheiros apagados através de `file_deletion`; logs de auditoria **anonimizados** (sem `actorUserId`, IP e user-agent); backups expiram em ≤30 dias.

## Alternativas
Soft delete; arquivo de longo prazo.

## Justificação
Soft delete não cumpre o pedido de apagamento. A outbox garante que um erro no armazenamento não deixa ficheiros órfãos silenciosamente.

## Consequências
Sem recuperação depois do apagamento (a UI exige confirmação forte). Complexidade moderada nos jobs de ciclo de vida.
