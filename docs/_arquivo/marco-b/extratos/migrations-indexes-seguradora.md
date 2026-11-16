> **ARQUIVADO; ver tag `archive-marco-b-2026-11-16`** (ADR-037, R7). Extrato verbatim das secções/linhas de seguradora retiradas de documentos ativos; o ficheiro de origem indica-se em cada bloco.

## Origem: `07-database/migrations.md`

## `0037_insurer_catalog_policy.sql` — Catálogo `service_kind`, política da seguradora (marco B fatia 2, ADR-033; PROPOSTA, contrato 2026-11-14)
Número seguinte a `0036_processes.sql`. Uma migração transacional, só aditiva (princípio «expandir»); **não toca em `reimbursement_claims`** nem apaga nada. Por ordem:
1. `CREATE TABLE guide_types`, `expense_types`, `policy_setting_definitions` (`schema.md` §3c) + **sementes** (3 tipos de guia, 9 tipos de despesa com `legacy_code`/`default_guide_type`/`default_name`, 5 chaves de política).
2. `CREATE TABLE insurer_service_kinds` (UNIQUE `(insurer_id, code)` e `(insurer_id, id)`) e `insurer_policy_settings` (UNIQUEs parciais).
3. **Semeadura por seguradora:** `INSERT INTO insurer_service_kinds (insurer_id, code, name, guide_type, expense_type) SELECT i.id, e.code, e.default_name, e.default_guide_type, e.code FROM insurer_accounts i CROSS JOIN expense_types e WHERE e.active ON CONFLICT DO NOTHING` (idempotente; seguradoras novas: semeadas na primeira utilização do módulo, mesma instrução na `application`).
4. `ALTER TABLE insurer_services ADD COLUMN service_kind_id uuid` + FK composta `(insurer_id, service_kind_id)`.
5. **Mapeamento a partir da `category` livre (por seguradora, conservador):** tabela temporária `(padrão, expense_type)` com expressões regulares sobre `category` normalizada (minúsculas, sem acentos): `consult`→CONSULTATION; `internament|internac`→INPATIENT; `parto|matern`→CHILDBIRTH; `exame|diagn|laborat|imagem|radiolog|analise`→DIAGNOSTICS; `tratament|fisio|terap`→TREATMENT; `estomat|dent`→DENTAL; `protese|ortese`→PROSTHETICS; `medicament|farmac`→MEDICATION; `subsidio`→DAILY_ALLOWANCE. `UPDATE insurer_services s SET service_kind_id = k.id … WHERE s.service_kind_id IS NULL AND` **exatamente um** padrão corresponde (ambíguos e sem correspondência ficam `NULL`, «por classificar»). Idempotente.
6. Índices de `indexes.md` («Catálogo e política»).
- **Reversão:** `DROP COLUMN insurer_services.service_kind_id`, `DROP TABLE insurer_policy_settings, insurer_service_kinds, policy_setting_definitions, expense_types, guide_types` (só enquanto nada da fatia 3 dependa).
- **Verificação obrigatória após correr (cópia de dados reais primeiro):** por seguradora, `total de serviços`, `classificados`, `por classificar` e a lista `(category, nº serviços, tipo atribuído)` entregue ao proprietário; nenhum serviço pode ter mudado de `code`/`name`/`status`; contagem de `insurer_services` igual antes/depois.
- Teste de integração (TC-CAT-*, TC-POL-*): sementes presentes, UNIQUEs, FK composta (tipo de outra seguradora rejeitado), semeadura idempotente, mapeamento ambíguo fica `NULL`, `ON DELETE CASCADE` da seguradora.

### Verificação da moeda (BR-SEG-42) — sem alteração de dados na `0037`
A fonte única é `insurer_accounts.currency`; o DEFAULT da BD já foi retirado em `0033`. O defeito era **aplicacional** (`parseClaimInput` com `EUR`). Depois de corrigir o código, **antes da fatia 2b**, correr em cópia de dados reais (só leitura):
```sql
SELECT i.id AS insurer_id, i.currency AS insurer_currency, c.currency AS claim_currency,
       c.status, count(*) AS claims, sum(c.amount) AS total
FROM reimbursement_claims c JOIN insurer_accounts i ON i.id = c.insurer_id
GROUP BY 1, 2, 3, 4 ORDER BY 1, 3, 4;
```
- **Zero divergências** (`claim_currency = insurer_currency` em todas as linhas): nada a corrigir; a 2b pode arrancar.
- **Com divergências:** o relatório (por seguradora/estado) vai ao proprietário, que decide por seguradora. **Nunca se convertem valores** (`amount` intocável). Correção = migração corretiva **`0038_claims_currency_reconcile.sql`** (reservada; só se a verificação o exigir e o proprietário autorizar): copia `(claim_id, old_currency)` para uma tabela de salvaguarda `reimbursement_claims_currency_backup`, faz `UPDATE … SET currency = i.currency` **só** nas linhas divergentes aprovadas e termina com a verificação acima (0 divergências, `sum(amount)` e contagens idênticos antes/depois, por seguradora e estado). Opcional no mesmo passo: `UNIQUE (id, currency)` em `insurer_accounts` + FK composta `(insurer_id, currency) → insurer_accounts (id, currency)` em `reimbursement_claims`, para que a divergência passe a ser impossível na BD (e a mudança de moeda da seguradora com pedidos existentes falhe). **Divergência encontrada:** `operationalData.hasData` (`insurer-ops/index.ts:176`) só conta beneficiários e apólices, pelo que hoje a moeda de uma seguradora pode mudar com reembolsos já gravados; **emenda a BR-SEG-19 (parte da fatia 2): `hasData` também conta `reimbursement_claims` da seguradora** (⇒ `CONFLICT`), com teste (TC-MOE-05).
- **Código (fatia 2):** `reimbursement-claim.ts` sem `DEFAULT_CURRENCY`; `createReimbursementClaim` usa `insurer.currency`; recibos comparados com a moeda da seguradora; `apps/web` (`insurance.service.ts`, `mocks/handlers/insurance.ts` e respetivos testes, `MemberInsurancePage.tsx`) deixam de enviar/assumir `EUR` e passam a usar a moeda da seguradora (`PartnerInsurer.currency`, acrescentado ao contrato em `GET /families/{f}/insurers`; no mock, AOA).

## Origem: `07-database/migrations.md`

## `0039_insurer_authorizations.sql` — Pedido de autorização pelo prestador (marco B fatia 3, ADR-034; IMPLEMENTADA, contrato 2026-11-14)
**Numeração:** `0038_claims_currency_reconcile.sql` continua **reservada e condicional** (fatia 2, verificação da moeda); esta migração usa **`0039`** para não depender de a `0038` existir (o runner aplica por ordem de nome e aceita lacunas; uma `0038` tardia aplica-se depois sem conflito, porque não toca nestas tabelas). A fatia 4 usa a `0040` e a fatia 2b o número seguinte livre (`0041` ou posterior). Uma migração transacional, **só aditiva**: não altera nem apaga dados existentes (as tabelas de S4 nunca foram criadas). Por ordem:
1. `ALTER TYPE process_kind ADD VALUE 'AUTHORIZED'` e `ALTER TYPE process_origin_type ADD VALUE 'AUTHORIZATION'` (**sem usar os valores na própria migração**: padrão verificado em `0029`–`0032`; se o runner/PG alvo o não permitir, dividir em `0039_enum_values` + `0040_insurer_authorizations` e renumerar a 2b).
2. `CREATE TYPE authorization_status` (6 valores), `authorization_closed_reason`, `authorization_channel`, `authorization_attachment_kind` (`schema.md` §3c).
3. `CREATE TABLE insurer_authorizations` (FKs compostas `(insurer_id, …)`, `guide_type → guide_types`, `process_id → processes` `SET NULL`, `parent_request_id` composta; CHECKs; UNIQUEs parciais de duplicado em curso e de recurso único), `insurer_authorization_events` e `insurer_attachments` (`schema.md` §3c). Sem triggers nem lógica em defaults (`decision_due_at` e `channel` definidos pela aplicação).
4. Índices de `indexes.md` («Autorizações do prestador»).
5. **Sem backfill** (tabelas novas) e **sem alterar** `processes` existentes.
- **Reversão (documentada; o runner não executa `down`):** `DROP TABLE insurer_attachments, insurer_authorization_events, insurer_authorizations`, `DROP TYPE` dos 4 enums novos. Os dois `ADD VALUE` **não se revertem** (limitação do PostgreSQL): inofensivos, o código tolera valores desconhecidos. Só enquanto nenhuma fatia posterior dependa.
- **Job `insurer.expire-info-requests`** (código, não migração): diário **00:50 UTC**, `INFO_REQUESTED` com `info_expires_at <= agora` → `CANCELLED` + `closed_reason=INFO_TIMEOUT` (idempotente; evento `SYSTEM`; auditoria `AUTHORIZATION_INFO_TIMEOUT`).
- Teste de integração (TC-AUT-*): CHECKs e UNIQUEs (duplicado em curso concorrente; segundo recurso), FK composta (serviço/beneficiário/prestador de outra seguradora rejeitados), `SET NULL` ao apagar o `Process`, cascata ao apagar a seguradora, ausência de colunas clínicas (`information_schema`), `ADD VALUE` aplicado.

## Origem: `07-database/migrations.md`

## `0040_insurer_decisions.sql` — Decisão pela seguradora, auto-aprovação, SLA e papel `SUPERVISOR` (marco B fatia 4, ADR-035; contrato 2026-11-15; **por implementar**)
**Numeração:** `0040` (a `0038` continua reservada e condicional; o runner aceita lacunas); a 2b usa o número seguinte livre (**`0042`** ou posterior, depois de a fatia 5 reservar a `0041`). Uma migração transacional, **só aditiva**: não apaga nem reescreve dados; os pedidos anteriores ficam com `assigned_*`/`escalated_at`/`auto_approval_trace` nulos e o único preenchimento é o de `decided_by_kind` (ponto 4). Por ordem:
1. `ALTER TYPE authorization_closed_reason ADD VALUE 'ANALYST_CANCELLED'` e `ALTER TYPE insurance_account_role ADD VALUE 'SUPERVISOR'` (**sem usar os valores na própria migração**; mesmo padrão e mesma salvaguarda da `0039`: se o runner/PG alvo o não permitir, dividir em `0040_enum_values` + `0041_insurer_decisions` e renumerar a 2b).
2. `CREATE TYPE authorization_decider AS ENUM ('ANALYST','SUPERVISOR','SYSTEM')`.
3. `ALTER TABLE insurer_authorizations ADD COLUMN` `decided_by_kind`, `assigned_to_insurance_account_id` (FK `SET NULL`), `assigned_at`, `escalated_at`, `auto_approval_trace jsonb` (`schema.md` §3c). **Sem defaults e sem triggers.**
4. **Pedidos já `APPROVED` ou `REJECTED`** (só existem se a fatia 3 correu com dados): `UPDATE insurer_authorizations SET decided_by_kind = 'ANALYST' WHERE status IN ('APPROVED','REJECTED') AND decided_by_kind IS NULL` (única forma de decisão que existia, por fixture/repositório); **depois** `ADD CONSTRAINT … CHECK (status NOT IN ('APPROVED','REJECTED') OR decided_by_kind IS NOT NULL)`. Idempotente; em ambiente sem dados não faz nada.
5. `ALTER TABLE insurer_authorization_events ADD COLUMN actor_role text CHECK (actor_role IN ('ANALYST','SUPERVISOR'))` e `ADD COLUMN internal_note text`.
6. `CREATE TABLE insurer_auto_approval_rules` com as FKs compostas, CHECKs e UNIQUEs parciais (`schema.md` §3c).
7. `INSERT INTO policy_setting_definitions (key, unit, min_value, max_value, default_value, allows_service_scope) VALUES ('AUTHORIZATION_VALIDITY_DAYS','DAYS',1,365,30,false) ON CONFLICT DO NOTHING` (idempotente; limites **propostos**).
8. **Recriar o UNIQUE parcial de duplicado** `insurer_authorizations_open_duplicate_idx` com `APPROVED` incluído no predicado (`DROP INDEX` + `CREATE UNIQUE INDEX`, mesma transação; falha se já houver duas aprovações iguais — impossível enquanto só a fatia 3 existe; num ambiente com dados, verificar antes: `SELECT … GROUP BY (beneficiary, provider, service, expected_on) HAVING count(*) > 1 WHERE status IN (…,'APPROVED')`).
9. Índices de `indexes.md` («Decisão pela seguradora»).
- **Reversão (documentada; o runner não executa `down`):** `DROP TABLE insurer_auto_approval_rules`; `ALTER TABLE … DROP COLUMN` das colunas novas de `insurer_authorizations` e `insurer_authorization_events` (e do CHECK); `DELETE FROM policy_setting_definitions WHERE key = 'AUTHORIZATION_VALIDITY_DAYS'`; `DROP TYPE authorization_decider`. Os dois `ADD VALUE` **não se revertem** (limitação do PostgreSQL): inofensivos (o código tolera valores desconhecidos). Só enquanto não existirem decisões reais.
- **Job `insurer.flag-sla-breaches`** (código, não migração): a cada **15 min**, `IN_REVIEW` com `decision_due_at <= agora` e `escalated_at IS NULL` → `escalated_at = agora` (idempotente; auditoria `AUTHORIZATION_SLA_BREACH`, `SYSTEM`). **Não** há job `insurer.expire-authorizations` (a expiração é derivada).
- Teste de integração (TC-DEC-*): CHECK de `decided_by_kind`, UNIQUEs parciais de regra por alvo, FK composta (tipo/serviço de outra seguradora rejeitado), `SET NULL` ao remover a conta atribuída, ausência de colunas clínicas em `insurer_auto_approval_rules`/`auto_approval_trace` (TC-AUT-17 alargado), `ADD VALUE` aplicado, semente idempotente.

## Origem: `07-database/migrations.md`

## `0041_authorization_alerts.sql` — Alertas do pedido de autorização à família (marco B fatia 5, ADR-036; contrato 2026-11-15; **por implementar**)
**Numeração:** `0041` (última implementada: `0040`; a `0038` continua reservada e condicional); a 2b usa **`0042`** ou posterior. Uma migração transacional, **só aditiva** (sem dados a preservar, sem tabelas nem colunas novas). Por ordem:
1. `ALTER TYPE alert_type ADD VALUE 'AUTHORIZATION_APPROVED'`, `'AUTHORIZATION_NOT_APPROVED'`, `'AUTHORIZATION_INFO_REQUESTED'`, `'AUTHORIZATION_EXPIRING'`, `'AUTHORIZATION_WITHDRAWN'` e `ALTER TYPE alert_source ADD VALUE 'PROCESS'` (**sem usar os valores na própria migração**: mesmo padrão e salvaguarda de `0023`/`0029`/`0032`/`0039`/`0040`; se o runner/PG alvo o não permitir, dividir em `0041_enum_values` + `0042_authorization_alerts_index` e renumerar a 2b).
2. `CREATE INDEX insurer_authorizations_expiring_idx ON insurer_authorizations (valid_until) WHERE status = 'APPROVED' AND process_id IS NOT NULL` (candidatas do scanner `alerts.scan`, `indexes.md`).
- **Sem** backfill (alertas históricos não se geram), **sem** CHECK/trigger, **sem** alterar `notification_preferences`.
- **Reversão (documentada; o runner não executa `down`):** `DROP INDEX insurer_authorizations_expiring_idx`; os seis `ADD VALUE` **não se revertem** (limitação do PostgreSQL), inofensivos (o código tolera valores desconhecidos). Só enquanto não existirem alertas reais.
- **Teste de integração (TC-ALR-14):** `ADD VALUE` aplicado (inserir alerta de cada tipo e `sourceType=PROCESS` depois da migração); índice presente; idempotência do runner.

## Origem: `07-database/indexes.md`

## Catálogo e política da seguradora (marco B fatia 2; `schema.md` §3c, migração `0037`)
| Índice | Para quê |
|---|---|
| UNIQUE `insurer_service_kinds (insurer_id, code)` e `(insurer_id, id)` | código único por seguradora; alvo da FK composta (BR-SEG-39) |
| `insurer_services (insurer_id, service_kind_id)` | contagem por tipo, `classify`, inativação de tipo com serviços ativos |
| UNIQUE parcial `insurer_policy_settings (insurer_id, setting_key) WHERE service_id IS NULL` · `(insurer_id, setting_key, service_id) WHERE service_id IS NOT NULL` | upsert idempotente; resolução serviço > seguradora (BR-SEG-40) |

## Origem: `07-database/indexes.md`

## Autorizações do prestador (marco B fatia 3; `schema.md` §3c, migração `0039`)
| Índice | Para quê |
|---|---|
| UNIQUE `insurer_authorizations (insurer_id, id)` | alvo das FKs compostas (eventos, anexos, recurso) |
| UNIQUE parcial `(insurer_id, code) WHERE code IS NOT NULL` | código de autorização único (BR-SEG-05) |
| UNIQUE parcial `(insurer_id, beneficiary_id, provider_id, service_id, expected_on) WHERE status IN ('SUBMITTED','IN_REVIEW','INFO_REQUESTED')` | duplicado em curso, também sob concorrência (BR-AUT-09) |
| UNIQUE parcial `(parent_request_id) WHERE parent_request_id IS NOT NULL AND status <> 'CANCELLED'` | um recurso não cancelado por recusa (BR-AUT-08) |
| `insurer_authorizations (provider_id, created_at DESC, id DESC)` | lista da clínica, cursor por (`created_at`, `id`) |
| `insurer_authorizations (process_id) WHERE process_id IS NOT NULL` | factos de cobertura do `Process` (porta `ProcessFacts`) e `SET NULL` da FK |
| `insurer_authorizations (info_expires_at) WHERE status = 'INFO_REQUESTED'` | job `insurer.expire-info-requests` |
| `insurer_authorization_events (authorization_id, id)` | `timeline` do pedido |
| `insurer_attachments (authorization_id)` · UNIQUE `(storage_key)` | anexos do pedido (máx. 5) |

## Origem: `07-database/indexes.md`

## Decisão pela seguradora (marco B fatia 4; `schema.md` §3c, migração `0040`)
| Índice | Para quê |
|---|---|
| `insurer_authorizations (insurer_id, status, decision_due_at, id)` | fila por prazo, cursor por (`decision_due_at`, `id`) (BR-AUT-19) |
| `insurer_authorizations (insurer_id, updated_at DESC, id DESC)` | histórico (`sort=RECENT`) |
| `insurer_authorizations (assigned_to_insurance_account_id) WHERE assigned_to_insurance_account_id IS NOT NULL` | filtro «meus» e `SET NULL` ao remover a conta |
| `insurer_authorizations (decision_due_at) WHERE status = 'IN_REVIEW' AND escalated_at IS NULL` | job `insurer.flag-sla-breaches` (BR-AUT-20) |
| UNIQUE parcial `insurer_authorizations (insurer_id, beneficiary_id, provider_id, service_id, expected_on) WHERE status IN ('SUBMITTED','IN_REVIEW','INFO_REQUESTED','APPROVED')` (**recria o da `0039`**) | duplicado em curso **ou já aprovado**, também sob concorrência (BR-AUT-09) |
| UNIQUE parcial `insurer_auto_approval_rules (insurer_id, service_kind_id) WHERE active AND service_kind_id IS NOT NULL` · `(insurer_id, service_id) WHERE active AND service_id IS NOT NULL` · UNIQUE `(insurer_id, id)` | uma regra ativa por alvo; alvo das FKs (BR-AUT-23) |
| `insurer_auto_approval_rules (insurer_id, active)` | carregar as regras ativas na criação do pedido |

## Origem: `07-database/indexes.md`

## Alertas do pedido de autorização (marco B fatia 5; migração `0041`, ADR-036)
| Índice | Consulta |
|---|---|
| `insurer_authorizations (valid_until) WHERE status = 'APPROVED' AND process_id IS NOT NULL` (`0041`, ADR-036) | candidatas de `AUTHORIZATION_EXPIRING` no `alerts.scan` (BR-ALR-10) |

## Origem: `07-database/indexes.md`

| `clinic_receipt_lines` / `clinic_receipt_links` / `reimbursement_claim_receipts` (M14 R) | UNIQUE `(receipt_id, position)` · `clinic_receipt_links (member_id, created_at DESC)` · `reimbursement_claim_receipts (receipt_id)` | Linhas por recibo; lista de recibos do membro na app; verificar anexos ativos de um recibo. |

