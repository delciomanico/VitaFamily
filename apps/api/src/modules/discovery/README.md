# Módulo `discovery`

MK2 do mercado de profissionais (ADR-037; `modules.md` notas 34 e 36; `plan.md` «MK2»). Pesquisa, perfil público, comparação e ranking `v2` de profissionais `APPROVED`. **Sem tabelas, sem auditoria, sem registo de pesquisas** (BR-MKT-32/46): tudo se calcula no pedido sobre os factos da coorte.

## O que faz

- **Pesquisa** com filtros (especialidade, categoria, método, cidade, preço em Kz, disponibilidade, nome) combinados em AND sobre a **mesma oferta**; ordenações `RANKING`, `PRICE_ASC`, `PRICE_DESC`, `NEXT_AVAILABLE`; cursor opaco.
- **Perfil público** e **comparação** de 2–3 profissionais numa especialidade; não `APPROVED` ou inexistente ⇒ `404` idêntico.
- **Ranking `v2`** (`domain/ranking.ts`, `RANKING_V2`; BR-MKT-61, MK3 S4): função pura, 5 sinais (avaliações 40 %, completude 20 %, disponibilidade 20 %, preço relativo 10 %, antiguidade 10 %), explicável (`score`, `signals`, `reasons`, `label` NEW/RATED). **Sem pagamento, destaque nem ordem manual**: `RankingInput` é um tipo fechado (`professionalId`, `bioLength`, `offers`, `approvedAtMs`, `reviewCount`, `reviewSum`). As avaliações chegam pela porta `ReviewStats` (a ligar por `consultations` na S10; até lá `EMPTY_REVIEW_STATS`: sinal neutro 0,5, «Novo», `reviewSummary {0, null}`). `RANKING_V1` (`ranking-v1.ts`) fica só para testes de regressão.
- **Só User autenticado**, sem `AccessPolicy` (dados públicos; `PUBLIC_DATA_ROUTES`), 60 pedidos/min por utilizador. Respostas `no-store`; `q`, `city`, `specialtyId` e `ids` nunca vão para logs, métricas nem erros.

## Mapa de pastas

```
index.ts            raiz pública: createDiscoveryModule (router + casos de uso)
domain/             ranking (RANKING_V2; ranking-v1 só regressão), filters, compare, facts: funções puras, sem I/O, sem Date, sem platform
application/        discovery.ts (casos de uso), ports.ts, rules.ts (ranking-rules), views.ts (só campos públicos)
interface/          router.ts (Express), public-data-routes.ts
```

## Rotas (5 operações do contrato)

| Rota | Função |
|---|---|
| `GET /marketplace/professionals` | pesquisa, filtros, ordenação, paginação |
| `GET /marketplace/professionals/compare` | comparação de 2–3 (`ids`, `specialtyId`) |
| `GET /marketplace/professionals/{professionalId}` | perfil público |
| `GET /marketplace/filters` | especialidades, cidades e métodos disponíveis (com contagens) |
| `GET /marketplace/ranking-rules` | regras públicas do ranking (`«Como ordenamos»`), coerentes com `RANKING_V2` |

## Jobs

Nenhum.

## Portas e onde são implementadas

| Porta (`application/ports.ts`) | Implementação | Ligação |
|---|---|---|
| `ProfessionalCatalog` (`listApprovedFacts`, `getApprovedFacts`) | `ProfessionalDirectory` de `professionals` (extensão aditiva de MK2: só `APPROVED`, sem e-mail nem `paymentInstructions`, teto de 1000) | `main/api.ts` |
| `DiscoveryClock` | relógio da plataforma (injetado; sem `Date.now`) | `main/api.ts` |

## Fronteiras (testes `tests/discovery-architecture.test.ts`)

`discovery` só importa o próprio módulo e `platform/*`; nenhum módulo importa `discovery` (só `main/`); `domain/` só importa `domain/`; `PUBLIC_DATA_ROUTES` coincide com as operações `/marketplace/*` do `openapi.yaml`.
