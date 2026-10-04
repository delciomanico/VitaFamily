# Vita Family — API: visão geral (Fase 13)

> Estado: **v0.1**. A fonte de verdade do contrato é `openapi.yaml`; `endpoints.md` e `errors.md` são geradas a partir da mesma especificação.

## Convenções
| Tema | Regra |
|---|---|
| Estilo | REST sobre HTTPS, JSON (`application/json`); erros `application/problem+json`. |
| Base | `/api/v1`. Versão **maior** no caminho; mudanças compatíveis (campos opcionais novos) não mudam a versão; quebras ⇒ `/api/v2` em paralelo durante a transição. |
| Identificadores | UUID v4. |
| Datas | ISO-8601 UTC (`2026-10-04T10:32:00Z`); `date` = `YYYY-MM-DD`. A conversão para o fuso do utilizador é feita no cliente. |
| Contexto de família | Sempre explícito no caminho: `/families/{familyId}/...`. Sem "família atual" implícita. |
| Sujeito | Dados de saúde: `/families/{familyId}/members/{memberId}/...`. |
| Paginação | Listas potencialmente grandes: `?limit=` (1–100, por defeito 25) e `?cursor=`; resposta `{ items, nextCursor }`. Listas pequenas e limitadas (membros ≤20, clínicas, alergias) devolvem array. |
| Filtros | `status`, `from`, `to` onde aplicável. |
| Atualização parcial | `PATCH` com campos opcionais; `PUT` apenas para substituir um conjunto (partilha, preferências) ou definir estado. |
| Mudança de estado | `PUT .../status` com o estado alvo; transições inválidas ⇒ `INVALID_STATE_TRANSITION`. |
| Idempotência | Confirmar toma é idempotente; criações **não** são idempotentes por defeito; uploads e convites têm proteção por limites. Cabeçalho `Idempotency-Key` fica fora do MVP. |
| Respostas por visibilidade | Campos/secções sem permissão são **omitidos** (relatórios) ou o pedido é negado; nunca se devolvem campos "a nulo" que revelem existência. |
| Rate limiting | Por IP e por utilizador; limites em `authentication.md` e `security.md`; resposta `429` + `Retry-After`. |
| CORS | Lista branca da origem da PWA; credenciais permitidas só para essa origem. |
| Cabeçalhos de resposta | `X-Request-Id`; `Cache-Control: no-store` em respostas autenticadas; `X-Content-Type-Options: nosniff`; `Strict-Transport-Security`. |
| Tamanho de corpo | JSON ≤ 1 MB; upload ≤ 10 MB (multipart). |
| Idioma | Mensagens de erro em pt-PT; `code` estável em inglês. |
| Documentação interativa | Swagger UI/Redoc **apenas** em desenvolvimento e staging, servida a partir de `openapi.yaml`. |

## Grupos de endpoints
Auth · Users · Families · Members · Invitations · Sharing · Health records · Prescriptions · Medications · Appointments · Clinics · Examinations · Documents · Alerts · Reports · Admin · Operations (`/health`).

## Processo de alteração do contrato
1. Alterar primeiro `openapi.yaml` (e `endpoints.md`) por change control.
2. Gerar tipos/validação a partir do contrato (Fase 17): o controller não pode divergir do contrato; teste de conformidade em CI (o OpenAPI do código gerado = o do repositório).
3. Qualquer endpoint implementado tem testes e critérios de aceitação ligados (`09-testing`).
