# Vita Family — Monitorização (Fase 16)

> **ATUALIZAÇÃO 2026-10-08 (ADR-014/ADR-015, decisão do proprietário):** a implementação é em **Node.js/TypeScript** (Clean Architecture), Kysely+`pg`, pg-boss (fila sobre PostgreSQL), **sem Redis para filas** (Redis só nos limitadores de taxa, ADR-038), em **VPS própria** com Caddy, domínio `vitafamily.cassfrei.com`. Onde este documento diz NestJS, Prisma, Redis, BullMQ ou Jest, ler o equivalente de ADR-014/ADR-015.

> Estado: **v0.1**. Requisitos: NFR-OPS-01..03, NFR-AVL-01 (99,5 %).

## 1. Logs
- **pino** em JSON com `requestId`, `userId` (UUID, nunca e-mail), `familyId`, rota, estado, duração.
- **Nunca** registar: palavras-passe, tokens, cookies, corpos de pedidos/respostas, texto livre de saúde, nomes de medicamentos, e-mails em claro, conteúdo de ficheiros. Redação automática + teste canário (TC-LOG-01).
- Retenção de logs técnicos: **30 dias** `[PROPOSTO]`.

## 2. Métricas (Prometheus + dashboards)
`GET /metrics` no contentor `api` (porta 8080, `platform/metrics`), formato de exposição do
Prometheus: métricas padrão do processo Node + `http_request_duration_seconds` (por `method`,
`route`, `status`). Só acessível na rede interna (ADR-019) — nem o nginx do `web` nem o Dokploy
encaminham para lá; o scraper do Prometheus corre na própria VPS. Os restantes grupos da tabela
(filas, lembretes, documentos, infraestrutura, backups) ainda não têm métricas instrumentadas —
pendente de implementação por módulo.

| Grupo | Métricas |
|---|---|
| API | pedidos por rota/estado, latência p50/p95/p99, erros 5xx, 401/403/404/429 |
| Autenticação | logins falhados, `AUTH_REFRESH_REUSE_DETECTED`, rate limits ativados |
| Filas e jobs | profundidade e idade da fila de notificações, jobs falhados, duração do `alerts.scan`, execuções falhadas dos jobs agendados |
| **Lembretes (negócio)** | **atraso entre `trigger_at` e envio** (p95 ≤ 60 s), notificações `FAILED`/`SKIPPED`, taxa de entrega por canal |
| Tomas | ocorrências geradas vs. esperadas por dia (deteção de job de geração parado) |
| Documentos | uploads, `INFECTED`, tempo de verificação, fila de antivírus, `file_deletions` pendentes |
| Infraestrutura | CPU, memória, disco, conexões PG, espaço de objetos, expiração de certificados |
| Backups | idade do último backup bem-sucedido; último restauro ensaiado |

## 3. Alertas operacionais
| Condição | Gravidade | Ação |
|---|---|---|
| API indisponível (readiness falha > 2 min) | Crítica | Intervenção imediata |
| Atraso de lembretes p95 > 5 min ou `alerts.scan` sem executar > 3 min | **Crítica** (risco de saúde) | Intervenção imediata |
| Fila de notificações a crescer 15 min | Alta | Investigar canal |
| Taxa 5xx > 2 % em 5 min | Alta | |
| `AUTH_REFRESH_REUSE_DETECTED` em pico, ou muitas `ACCESS_DENIED` de um utilizador | Média | Revisão de segurança |
| Backup sem sucesso > 26 h | Alta | |
| Espaço em disco/objetos > 80 % | Média | |
| Certificado a expirar < 14 dias | Média | |
| Documento `INFECTED` | Informativa (auditado) | |
| Redis indisponível (`/health/ready` 503, `RATE_LIMIT_BACKEND_UNAVAILABLE`/`_DEGRADED`, disjuntor aberto) > 1 min; memória do Redis > 80 % de 64 MB; picos de `503` por limitador | Alta (escritas e rotas sensíveis falham fechadas, ADR-038) | Reiniciar `redis`; os contadores repõem-se a zero (sem restauro) |
| `file_deletions` pendentes > 1 h | Média | Garantir apagamento (RGPD) |

## 4. Disponibilidade e SLO
- **SLO:** 99,5 % mensal de disponibilidade da API (≈ 3 h 39 min de indisponibilidade/mês permitida) e **lembretes ≤ 1 min de atraso (p95)**.
- `/health/ready` inclui o `PING` ao Redis (ADR-038); `/health` (liveness) não depende dele.
- *Uptime check* externo em `/health/ready` a cada minuto (de fora da infraestrutura).
- Relatório mensal: SLO, incidentes, atraso de lembretes.

## 5. Rastreio de erros
Ferramenta de captura de exceções (autohospedada ou na UE) **com redação de dados** e sem corpos de pedido; desativada se não garantir a ausência de dados de saúde.

## 6. Procedimentos
- **Runbooks** curtos: Redis em baixo (reiniciar o serviço; sem restauro; escritas sensíveis ficam `503` até voltar), fila parada (reiniciar `worker`/pg-boss; jobs idempotentes repõem-se a partir da BD), ClamAV em baixo, falha de SMTP/Push, restauro de backup, rotação de segredos, violação de dados (`security.md` §4).
- **Runbook Redis (ADR-038; RL2).** Sintomas: `/health/ready` 503, `503` + `Retry-After: 5` em escritas/rotas sensíveis, logs `RATE_LIMIT_BACKEND_UNAVAILABLE` (falha fechada) ou `RATE_LIMIT_BACKEND_DEGRADED` (leituras sob o limite geral e `discovery` em limitador local por processo). Passos: (1) `docker ps`/Dokploy: o serviço `redis` está `healthy`? (2) se não, reiniciar só `redis` (Dokploy) e ver `docker logs`; (3) teste de dentro da rede: `docker exec <redis> sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping'` (esperado `PONG`; `CONFIG`/`KEYS`/`FLUSHALL` estão desativados de propósito); (4) memória cheia (`noeviction`, 64 MB): reiniciar repõe o serviço; se recorrente, investigar chaves sem TTL ou ataque, não aumentar às cegas; (5) a API recupera sozinha quando o disjuntor fecha (≤ 5 s após o Redis voltar) sem reinício. **Reiniciar o Redis zera todos os contadores** (uma janela de abuso por reinício; risco aceite no ADR) e não há restauro; não é fonte de verdade. Rotação de `REDIS_PASSWORD`: alterar o segredo no Dokploy **e** `REDIS_URL`, redeploy de `redis`, `api` e `worker` na mesma operação. Rotação de `RATE_LIMIT_KEY_SECRET`: só zera os contadores (as chaves passam a outros HMAC), sem outro impacto.
- **Pós-incidente:** análise sem culpa, registo e, se alterar decisões, novo ADR.
