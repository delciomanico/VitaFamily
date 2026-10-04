# Vita Family — Plano de implementação (Fase 16)

> **ATUALIZAÇÃO 2026-10-04 (ADR-012, decisão do proprietário):** a implementação é em **Go** (pgx+sqlc+goose, river, chi+oapi-codegen), **sem Redis**, em **VPS própria** com Caddy, domínio `vitafamily.cassfrei.com`. Onde este documento diz NestJS, Prisma, Redis, BullMQ ou Jest, ler o equivalente Go de ADR-012; a arquitetura lógica mantém-se.

> Estado: **v0.1 — a pasta `11-implementation/` é uma adição à estrutura do prompt** (o prompt previa a Fase 16 mas não um local para o plano). Sem datas: capacidade e prazos são **TBD** (proprietário).
> **A Fase 17 (código) só começa com a tua aprovação explícita.**

## 1. Regras de trabalho durante a implementação
1. Documentação = fonte da verdade (prompt §29). Divergência ⇒ **parar**, identificar, decidir, atualizar docs, corrigir código.
2. Alterações de comportamento só por **change control** (prompt §23).
3. Contrato primeiro: `openapi.yaml` manda; controllers/DTOs gerados ou verificados contra ele.
4. Cada milestone entrega **fatias verticais** (BD → domínio → API → testes → docs) e termina com a sua *Definition of Done*.
5. *Simple first*: nada fora do âmbito (`scope.md`); sem infraestrutura "para o futuro".
6. Explicar cada decisão técnica relevante (prompt §26): o que, porquê, alternativas, impacto.

## 2. Definition of Done (por milestone)
- Endpoints do milestone implementados conforme `endpoints.md`/`openapi.yaml`.
- Testes: unitários + integração + API dos critérios `AC-*` ligados; matriz de autorização atualizada.
- Auditoria das ações sensíveis implementada e testada.
- Migrações versionadas; sem *drift*; constraints críticas testadas.
- Gates de CI verdes (`strategy.md` §5); sem dependências com vulnerabilidades altas.
- Documentação atualizada onde a implementação revelou ajuste (via change control).
- Revisão e demonstração ao proprietário.

## 3. Estrutura do repositório
Monorepo `apps/api` (Go) · `apps/web` (futuro) · `deploy/` · `docs/` · `Makefile` — detalhe e camadas em `docs/06-architecture/decisions/ADR-013-monorepo-e-modulos-em-camadas.md` e `conventions.md` §1.

## 4. Milestones

| M | Nome | Conteúdo | Requisitos principais | Depende de |
|---|---|---|---|---|
| **M0** | **Fundações** | Repositório Go, Docker Compose (pg/minio/clamav/mailhog, sem Redis), CI com gates, `common` (config, Clock, erros problem+json, validação, paginação, logging com redação), health, teste de arquitetura, pipeline de contrato OpenAPI | NFR-OPS, NFR-QA, NFR-API | — |
| **M1** | **Auditoria + Identidade** | `audit`, `users`, `auth` (registo, verificação, login, refresh rotativo, recuperação, mudança de palavra-passe, termos B6, rate limiting, suspensão), e-mail (mailer) | FR-AUTH, BR-ACC, FR-AUD | M0 |
| **M2** | **Famílias e membros** | `families`: família, membros, dependentes, tutela, convites, limites; papéis | FR-FAM, FR-MEM, BR-FAM/MEM | M1 |
| **M3** | **Acesso e partilha** | `access`: `AccessPolicy` + matriz, partilha por categoria, testes gerados, "partilhado comigo"; guard de verificação; isolamento por FKs compostas | FR-PRIV, BR-PRV, NFR-SEC-04 | M2 |
| **M4** | **Registos de saúde** | `health-records` (alergias, condições, tipo sanguíneo) | FR-HP | M3 |
| **M5** | **Documentos** | `documents`: armazenamento, validação, quarentena, antivírus (worker), download mediado, quotas, outbox de ficheiros | FR-DOC, N4, Q10 | M3 |
| **M6** | **Medicação** | `prescriptions`, `medications`: planos, geração de ocorrências (DST), ações sobre tomas, adesão; `UNCONFIRMED` | FR-RX, FR-MED | M4, M5 |
| **M7** | **Consultas, clínicas e exames** | `appointments`, `clinics` (+ admin de parceiras), `examinations` | FR-APT, FR-EXM, FR-CLN | M5 |
| **M8** | **Alertas e notificações** | `alerts` (scanner, regras, destinatários), `notifications` (push + e-mail, preferências, subscrições, retry), idempotência | FR-ALR, BR-ALR | M6, M7 |
| **M9** | **Relatórios e ciclo de vida** | `reports`, `lifecycle`: exportação, sair/remover com pacote, maioridade (avisos), bloqueio/apagamento 90 dias, eliminação de conta/família, `admin` (contas) | FR-RPT, FR-PRIV-05, R4, P4, Q7 | M6–M8 |
| **M10** | **Endurecimento e lançamento** | Carga (N9), segurança (suite completa, revisão), restauro de backup, monitorização/alertas, runbooks, AIPD e textos legais, checklist de release | NFR-*, privacidade | M0–M9 |

### Porque esta ordem (para aprender)
- **Auditoria e autorização cedo:** são transversais; acrescentá-las no fim obriga a refazer tudo. M1 e M3 criam a base sobre a qual todo o resto se escreve.
- **Documentos antes da medicação:** receitas e exames dependem de anexos; o antivírus e o apagamento por outbox são riscos técnicos que convém resolver cedo.
- **Alertas só depois de existirem os eventos** (tomas, consultas, exames): o scanner trabalha sobre dados reais; M8 valida o requisito mais crítico (lembretes fiáveis).
- **Ciclo de vida (M9) no fim:** depende de todos os dados existirem para exportar e apagar corretamente; mas os *esqueletos* de eliminação em cascata devem ser testados desde M2 (testes de integração de FKs).

## 5. Rastreabilidade (requisitos → milestone)
| Área de requisitos | M |
|---|---|
| FR-AUTH, BR-ACC, FR-AUD | M1 |
| FR-FAM, FR-MEM, BR-FAM, BR-MEM (exceto ciclo de vida) | M2 |
| FR-PRIV (partilha), BR-PRV, autorização | M3 |
| FR-HP | M4 |
| FR-DOC | M5 |
| FR-RX, FR-MED | M6 |
| FR-APT, FR-EXM, FR-CLN, FR-ADM-01 (clínicas) | M7 |
| FR-ALR, BR-ALR | M8 |
| FR-RPT, FR-PRIV-05, saída/remoção, maioridade, bloqueio, eliminações, FR-ADM-01 (contas) | M9 |
| NFR-PERF/AVL/OPS/SEC (verificação final) | M10 |

## 6. Riscos de implementação e mitigação
| Risco | Mitigação |
|---|---|
| Falha de isolamento entre famílias | Cenário de dois tenants em todos os testes de integração; teste automático por endpoint; FKs compostas. |
| Lembretes perdidos ou duplicados | Scanner idempotente + `dedupeKey`; testes com relógio; métrica de atraso e alerta crítico. |
| Erros de DST/fuso | Biblioteca de tempo robusta (IANA), casos fixos de teste, relógio injetável. |
| Prisma vs. constraints avançadas | SQL manual versionado + teste de *drift* (ADR-003). |
| Antivírus e ficheiros | Quarentena + outbox + testes EICAR; limites de quota. |
| Complexidade de ciclo de vida (maioridade, 90 dias, saída com pacote) | Fatias pequenas em M9; testes de relógio; fluxos documentados em `member.md`. |
| **Sem validação com utilizadores (D16)** | Aceite pelo proprietário; manter o MVP mínimo; instrumentar métricas de uso desde M10 sem dados de saúde. |
| Conformidade legal | AIPD, textos legais e eventual DPO **antes** do lançamento (M10). |

## 7. O que preciso de ti para arrancar a Fase 17
1. **Aprovação** para iniciar a implementação (M0).
2. **Decisões operacionais** (não alteram a especificação): fornecedor de alojamento UE; fornecedor SMTP UE; nome/domínio da API; entidade legal responsável pelo tratamento.
3. Confirmar o **nome do repositório/projeto** e o gestor de pacotes (propostos: Node LTS + pnpm).
