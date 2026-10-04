# ADR-002 — Monólito modular com NestJS

**Estado:** Parcialmente substituída por ADR-012: mantém-se o **monólito modular**; a linguagem/framework passa a ser **Go** (onde diz NestJS ler Go).

## Contexto
Equipa pequena (uma pessoa a aprender arquitetura), 1 000 famílias alvo (N9), necessidade de separação de responsabilidades e testabilidade.

## Decisão
**Monólito modular** em NestJS/TypeScript; um código-base, dois processos (API e worker). Fronteiras por módulo com API pública; sem microserviços.

## Alternativas
Microserviços; monólito sem fronteiras; framework Express puro; Fastify+estrutura própria.

## Justificação
Simples de operar e testar; as fronteiras internas permitem extrair módulos mais tarde. NestJS dá DI, módulos e convenções que reduzem decisões arbitrárias.

## Consequências
Disciplina necessária para respeitar fronteiras (teste de arquitetura). Escalamento é do processo inteiro (aceitável para a escala alvo).
