# Vita Family — Monitorização (Fase 16)

> **ATUALIZAÇÃO 2026-10-04 (ADR-012, decisão do proprietário):** a implementação é em **Go** (pgx+sqlc+goose, river, chi+oapi-codegen), **sem Redis**, em **VPS própria** com Caddy, domínio `vitafamily.cassfrei.com`. Onde este documento diz NestJS, Prisma, Redis, BullMQ ou Jest, ler o equivalente Go de ADR-012; a arquitetura lógica mantém-se.

> Estado: **v0.1**. Requisitos: NFR-OPS-01..03, NFR-AVL-01 (99,5 %).

## 1. Logs
- **pino** em JSON com `requestId`, `userId` (UUID, nunca e-mail), `familyId`, rota, estado, duração.
- **Nunca** registar: palavras-passe, tokens, cookies, corpos de pedidos/respostas, texto livre de saúde, nomes de medicamentos, e-mails em claro, conteúdo de ficheiros. Redação automática + teste canário (TC-LOG-01).
- Retenção de logs técnicos: **30 dias** `[PROPOSTO]`.

## 2. Métricas (Prometheus + dashboards)
| Grupo | Métricas |
|---|---|
| API | pedidos por rota/estado, latência p50/p95/p99, erros 5xx, 401/403/404/429 |
| Autenticação | logins falhados, `AUTH_REFRESH_REUSE_DETECTED`, rate limits ativados |
| Filas e jobs | profundidade e idade da fila de notificações, jobs falhados, duração do `alerts.scan`, execuções falhadas dos jobs agendados |
| **Lembretes (negócio)** | **atraso entre `trigger_at` e envio** (p95 ≤ 60 s), notificações `FAILED`/`SKIPPED`, taxa de entrega por canal |
| Tomas | ocorrências geradas vs. esperadas por dia (deteção de job de geração parado) |
| Documentos | uploads, `INFECTED`, tempo de verificação, fila de antivírus, `file_deletions` pendentes |
| Infraestrutura | CPU, memória, disco, conexões PG, memória Redis, espaço de objetos, expiração de certificados |
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
| `file_deletions` pendentes > 1 h | Média | Garantir apagamento (RGPD) |

## 4. Disponibilidade e SLO
- **SLO:** 99,5 % mensal de disponibilidade da API (≈ 3 h 39 min de indisponibilidade/mês permitida) e **lembretes ≤ 1 min de atraso (p95)**.
- *Uptime check* externo em `/health/ready` a cada minuto (de fora da infraestrutura).
- Relatório mensal: SLO, incidentes, atraso de lembretes.

## 5. Rastreio de erros
Ferramenta de captura de exceções (autohospedada ou na UE) **com redação de dados** e sem corpos de pedido; desativada se não garantir a ausência de dados de saúde.

## 6. Procedimentos
- **Runbooks** curtos: fila parada, ClamAV em baixo, Redis perdido (reconstruir filas a partir da BD), falha de SMTP/Push, restauro de backup, rotação de segredos, violação de dados (`security.md` §4).
- **Pós-incidente:** análise sem culpa, registo e, se alterar decisões, novo ADR.
