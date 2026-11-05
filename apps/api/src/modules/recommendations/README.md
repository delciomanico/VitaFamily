# Módulo `recommendations`

ADR-023 (D19), plan.md M7c, BR-CLN-09, UC-REC-01..03, FR-REC-01. `Recommendation` é uma **nota de texto** (1–2000 caracteres) que a conta da clínica parceira emite sobre **uma** consulta **ou** **um** exame da **própria clínica** (estado `SCHEDULED`/`COMPLETED`). O sistema nunca interpreta o texto nem gera alertas por conteúdo (D11). Depende de `access`, `appointments`, `examinations` e `audit` (modules.md §2); o alerta entra por uma porta ligada em `main/api.ts` (`alerts.raiseRecommendationEvent`).

## Regras que o código impõe
- **Origem única:** exatamente um de `appointmentId`/`examinationId` (`domain/recommendation.ts#parseRecommendationDraft`, CHECK `recommendations_single_origin_check`). Texto com trim, 1–2000 (CHECK `recommendations_text_length_check`).
- **Só a própria clínica:** a origem é resolvida por `appointments.findClinicOrigin` / `examinations.findClinicOrigin` (`WHERE clinic_id = <clínica do token>`); de outra clínica ou inexistente ⇒ `NOT_FOUND` (indistinto); estado fora de `SCHEDULED`/`COMPLETED` ⇒ `CONFLICT`. O portal **não** usa `AccessPolicy` (ADR-020, authorization.md §6.1).
- **Imutável:** repositório sem update/delete e sem rotas PUT/PATCH/DELETE; eliminação só por cascata de BD (consulta/exame/membro, D15).
- **Rastreabilidade sem dependência do autor:** `clinic_account_id` e `clinic_id` são `ON DELETE SET NULL`; `clinic_name` é congelado; **nenhuma CHECK** exige a conta autora não-nula (mesmo critério da 0022 ponto 6 / `issued_by`). A visibilidade nunca depende do autor.
- **Leitura da família:** a recomendação herda a categoria da origem (consulta ⇒ `READ(APPOINTMENTS)`, exame ⇒ `READ(EXAMS)`; dependente com conta só as de consulta, N2). `list-recommendations.ts` chama `policy.can` por categoria e **omite** as negadas (só falha `FORBIDDEN` se nenhuma for permitida). Leitura por quem não é o titular ⇒ `RECOMMENDATION_VIEW`.
- **Sem texto fora da BD:** auditoria `RECOMMENDATION_CREATE` (`actor_type=CLINIC_ACCOUNT`, sem `family_id`, `metadata` só `originType`/`originId`); alerta `RECOMMENDATION_ADDED` genérico (`sourceType=RECOMMENDATION`, `ruleKey=recommendation.added`), na mesma transação (BR-HLT-05/BR-ALR-07).

## Mapa de um pedido típico
```
POST /clinic-portal/recommendations { appointmentId | examinationId, text }
  → interface/clinic-portal-router.ts  (ator de clínica, ADR-020)
    → application/clinic-recommendations.ts (createClinicRecommendation), UMA transação:
      parseRecommendationDraft → origins.find…OfClinic (clínica do token) → assertOriginAcceptsRecommendation
      → infrastructure/repo.ts insert → audit.record(RECOMMENDATION_CREATE) → alerts.raiseRecommendationAdded
GET /families/{f}/members/{m}/recommendations
  → interface/router.ts → application/list-recommendations.ts
    → policy.can(READ, APPOINTMENTS|EXAMS) por categoria → repo.listByMember (categorias permitidas, keyset desc)
    → audit RECOMMENDATION_VIEW se relação ≠ SELF
```

## Camadas presentes
`domain/` (entidade, validação, categoria da origem) · `application/` (casos de uso, portas, `fixtures.ts` com fakes) · `infrastructure/` (`schema.ts`, `repo.ts` Kysely) · `interface/` (2 routers + `dto.ts`).

## Migração
`db/migrations/0023_recommendations.sql`: `ALTER TYPE alert_type ADD VALUE 'RECOMMENDATION_ADDED'`, `ALTER TYPE alert_source ADD VALUE 'RECOMMENDATION'` (não usados na própria migração) e a tabela `recommendations` com índices de `indexes.md`.

## Testes
`domain/*.test.ts`, `application/recommendations.test.ts` (fakes), `tests/http/recommendations.http.test.ts` (OpenAPI, tokens, isolamento), `tests/integration/recommendations.integration.test.ts` (PostgreSQL real: CHECKs, isolamento, SET NULL, cascata).
