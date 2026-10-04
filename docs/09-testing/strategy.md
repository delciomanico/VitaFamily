# Vita Family — Estratégia de testes (Fase 15)

> **ATUALIZAÇÃO 2026-10-04 (ADR-012, decisão do proprietário):** a implementação é em **Go** (pgx+sqlc+goose, river, chi+oapi-codegen), **sem Redis**, em **VPS própria** com Caddy, domínio `vitafamily.cassfrei.com`. Onde este documento diz NestJS, Prisma, Redis, BullMQ ou Jest, ler o equivalente Go de ADR-012; a arquitetura lógica mantém-se.

> Estado: **v0.1 — adotada com a recomendação do assistente.** Requisitos: NFR-QA-01..04.

## 1. Princípios
1. **Risco primeiro:** o que mais pode magoar (fuga entre famílias, permissões, lembretes perdidos/duplicados, apagamento, datas) tem mais testes.
2. **Cada requisito importante tem critérios de aceitação** (`acceptance-criteria.md`) ligados a casos de teste (`test-cases.md`).
3. Testes são **código de primeira classe**: deterministas, rápidos, independentes.
4. **Sem mocks do que é o risco:** autorização e isolamento testam-se contra PostgreSQL real.

## 2. Pirâmide

| Nível | Âmbito | Ferramentas propostas | Execução |
|---|---|---|---|
| **Unitários** | Regras de domínio puras: idade/maioridade, janela de tomas, geração de ocorrências (DST), transições de estado, regras de alerta, política de palavra-passe, validadores, `AccessPolicy` (sem BD) | Jest | cada commit (segundos) |
| **Integração** | Módulo + PostgreSQL + Redis + MinIO reais: repositórios, constraints (FKs compostas, índices parciais), transações, filas, scanner, outbox de ficheiros, auditoria | Jest + Testcontainers | cada PR |
| **API/contrato (E2E de API)** | Pedidos HTTP reais contra a aplicação completa (Supertest): fluxos, erros `problem+json`, conformidade com `openapi.yaml` | Jest + Supertest + validador OpenAPI | cada PR |
| **E2E de cenário** | Jornadas completas multi-ator (família com tutor e dependente, ciclo de lembrete) com relógio controlado | Jest/Supertest com `Clock` injetável | cada PR (subconjunto) / noturno (completo) |
| **Segurança** | IDOR/isolamento, matriz de permissões, enumeração, rate limit, upload malicioso, tokens, logs sem dados de saúde | Suites dedicadas + SAST/SCA | cada PR (críticos) / noturno |
| **Carga** | Escala N9 (1 000 famílias / 5 000 users), scanner de alertas, picos de lembretes às horas redondas | k6 | antes da release (M10) |
| **Recuperação** | Restauro de backup, apagamento definitivo | scripts + checklist | trimestral / pré-release |

## 3. Técnicas específicas deste projeto

| Tema | Técnica |
|---|---|
| **Tempo** | `Clock` injetável em todo o código; testes avançam o tempo (lembretes, `UNCONFIRMED`, 18 anos, 90 dias, expiração de convites/tokens) sem esperar. |
| **DST e fusos** | Casos fixos: mudança de hora (março/outubro em Europe/Lisbon), hora inexistente/repetida, utilizador a mudar de fuso, tutor principal em fuso diferente. |
| **Idempotência** | Executar o scanner N vezes sobre o mesmo estado ⇒ mesmos alertas; repetir confirmação de toma ⇒ mesmo resultado. |
| **Autorização gerada** | A matriz de `authorization.md` é dados (tabela); gera-se um teste por (relação × categoria × ação). Falha de CI se a tabela e a policy divergirem. |
| **Isolamento** | Para **cada** endpoint com `familyId`: pedido por utilizador de outra família ⇒ 404; por utilizador sem a relação ⇒ 403/404 conforme a regra. Teste automático percorre o `openapi.yaml`. |
| **Contrato** | CI compara o OpenAPI gerado do código com `docs/05-api/openapi.yaml`; diferença ⇒ falha. |
| **Dados sensíveis em logs** | Teste executa fluxos com dados "canário" (ex.: nome de medicamento único) e verifica que não aparecem em logs, notificações externas nem mensagens de erro. |
| **Constraints** | Testes tentam violar cada constraint crítica (segundo tutor principal, documento sem recurso, grant a si próprio). |
| **Ficheiros** | EICAR (antivírus), ficheiro com extensão falsa, >10 MB, 6.º ficheiro, quota de 100 MB. |
| **Apagamento** | Após hard delete: nada na BD, nada no storage, auditoria anonimizada, exportação consistente. |

## 4. Dados de teste
Fábricas (*builders*) de cenários: `familia com Admin`, `familia com tutor+menor sem conta`, `familia com menor com conta`, `dois adultos com partilha parcial`, `duas famílias isoladas`. Sempre dados **sintéticos**; sem dados reais fora de produção.

## 5. Qualidade e critérios de saída (gates de CI)
| Gate | Critério |
|---|---|
| Tipos, lint, formatação | verdes |
| Unitários + integração + API | 100 % verdes |
| Cobertura | domínio (regras puras) ≥ 90 %; serviços de aplicação ≥ 80 %; `AccessPolicy` **100 %** das combinações da matriz |
| Contrato | OpenAPI do código = repositório |
| Segurança | SCA sem vulnerabilidades altas/críticas conhecidas e sem *secrets* |
| Arquitetura | testes de dependência entre módulos (`modules.md` §3) |
| Migrações | BD das migrações = `schema.prisma` + SQL manual (sem *drift*) |
| Release | + E2E de cenário completo + suite de segurança + checklist `10-operations` |

## 6. Responsabilidades
Quem escreve a funcionalidade escreve os testes; cada PR liga-se aos IDs de requisito (`FR-*`, `BR-*`) e de critérios (`AC-*`). Funcionalidade sem critérios de aceitação **não entra** (regra de change control, prompt §23).
