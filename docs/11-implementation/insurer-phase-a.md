# Seguradoras — Fase A ("porta de entrada"): recorte do ADR-025

> Estado: **recorte executado — ver §8 (estado real, 2026-11-12)**; proposta original de 2026-11-11 (não é change control; não altera contratos nem BR). Seguradora-alvo do piloto: **Baluarte Seguros** (`baluarteseguros.ao`). O site não esteve acessível durante a análise (ligação recusada), pelo que **nada neste documento assume produtos, rede ou sistemas da Baluarte** — ver §6.
> Origem: `docs/insurer-module/`, ADR-025 (D21), marcos S1–S6 em `plan.md`. Este documento **não cria funcionalidades novas**: seleciona, dentro de S1–S6, o subconjunto que entrega valor mensurável à seguradora sem substituir o seu sistema central.

## 1. Objetivo e tese de valor

A Baluarte mantém o seu sistema de apólices e sinistros. O Vita fica **à frente**, no ponto de contacto com clínica e paciente:

| Resultado para a seguradora | Como o Fase A o entrega | Métrica do piloto (com baseline antes) |
|---|---|---|
| Menos chamadas "tenho cobertura?" ao contact center | Cartão digital + estado e serviços cobertos no app | Chamadas/semana de verificação de cobertura |
| Verificação imediata na clínica | Validação por QR/nº de cartão em segundos | Tempo médio de verificação; % de atendimentos com verificação eletrónica |
| Controlo de quem tem direito | Importação periódica de beneficiários; estado sempre da seguradora | Nº de atendimentos a beneficiários inelegíveis detetados antes do ato |
| Rasto auditável | Cada validação auditada (BR-SEG-15/18) | 100 % das validações com registo |

## 2. Âmbito da Fase A (mapeado nos marcos existentes)

| Capacidade | Marco / UC / BR | Inclui na Fase A | Fica fora |
|---|---|---|---|
| Base da seguradora, papéis, moeda | S1 · BR-SEG-14/15/19 | `currency`, `operational_module_enabled`, papéis `INSURANCE_ADMIN` e `BENEFICIARY_MANAGER` | Papéis `AUTHORIZATION_ANALYST`, `CLAIMS_MANAGER`, `FINANCE_MANAGER` (ficam definidos, sem rotas) |
| Empresas, beneficiários, apólices | S1 · UC-SEG-01/02 | `Company`, `Beneficiary`, `Policy`, estados, job `insurer.expire-policies` | — |
| Importação | S1 · BR-SEG-17 | CSV/XLSX ≤ 5.000 linhas, pré-visualização, erros por linha, entram `PENDING` | Sincronização por API (fase 3) |
| Cartão digital e reclamar cartão | S1 + S6 · BR-SEG-20 · UC-SEG-03/15 | Cartão com QR, reclamar com nº de apólice + código, confirmação pela seguradora | Histórico de autorizações/despesas no app |
| Planos e serviços (mínimo) | S2 (parcial) · BR-SEG-01/02/22 | `InsurerService` (lista por seguradora), `Plan` com versões, `PlanCoverage` com: cobertura sim/não, % comparticipação, teto anual, carência, «exige autorização» | Cálculo de saldo com consumo real (ver §4), exclusões complexas |
| Validação na clínica | S3 (parcial) · UC-SEG-05 · BR-SEG-18/23 | `GET /clinic-portal/insurers`, `POST …/eligibility`, `GET …/services`, rate limit, auditoria `ELIGIBILITY_CHECK` | `Provider`/`ProviderUnit` completos (basta a ligação `clinic_id`), `Encounter` |
| Saldo no app | S6 (parcial) · UC-SEG-14 | Plano, validade, serviços, limites | Saldo «usado/pendente» (ver §4) |

**Fora da Fase A (explícito):** autorizações (S4), despesas e dashboard (S5), pagamentos, contratos/preços, qualquer IA, dados de saúde na seguradora.

## 3. Princípios de privacidade (invioláveis)

1. A seguradora só vê **dados seus** (`Beneficiary`, `Policy`) e o que a clínica submete; **nunca** o perfil de saúde (ADR-005, C2).
2. Ligação paciente ↔ beneficiário **só por consentimento** (BR-SEG-20), revogável.
3. Resposta de elegibilidade **mínima** (BR-SEG-18); respostas de "não encontrado" indistinguíveis (anti-enumeração).
4. Os dados do app (adesão, consultas) **não** alimentam subscrição, preço de prémio nem decisão de cobertura. Convém escrevê-lo em `privacy.md` antes do piloto.

## 4. Decisões necessárias antes de contratar (S1)

> **2026-11-11 — decididas pelo proprietário (aceitou as recomendações):** **D-A1** Q4 fechada = seguradora do cartão apresentado; **D-A2** a Fase A mostra só cobertura e limites, **sem «usado»/saldo consumido** (o saldo real chega com S4/S5). Restantes (D-A3..D-A6) mantêm-se como abaixo.
>
> **2026-11-11 — ratificadas pelo proprietário (questionário sobre o contrato):** (1) código de reclamação emitido por `POST /insurance-portal/beneficiaries/{id}/claim-code`, só o hash guardado no beneficiário; (2) `0033` remove o `default 'EUR'` de `reimbursement_claims.currency` (moeda da seguradora); (3) `commit` da importação grava as linhas válidas e conta inválidas/duplicadas; (4) a seguradora liga clínicas **escolhendo numa lista de clínicas parceiras** (`PARTNER`) — **requer acrescentar ao contrato uma listagem de clínicas parceiras, ainda inexistente** (o contrato atual só recebe `{clinicId}`); (5) `CLINIC_DOCTOR` continua `FORBIDDEN` em `/clinic-portal/insurers/*`.

| # | Decisão | Recomendação |
|---|---|---|
| D-A1 | **Q4** — que seguradora valida | Manter «a do cartão apresentado» (já assumida) e fechá-la formalmente |
| D-A2 | **Origem do «usado» do saldo** sem S4/S5: não há autorizações nem despesas que consumam limite | Mostrar na Fase A só **limites e cobertura** (sem «usado»); o saldo real chega com S4/S5. Alternativa (mais valor, mais risco): a seguradora importa o consumo acumulado por CSV, marcado como «posição à data X» |
| D-A3 | Arredondamento (BR-SEG-08) | Ratificar a proposta do ADR-025 (half-up, sobre o total) — só necessário quando houver cálculo (S4/S5), mas convém fechar já |
| D-A4 | Anexos (`documents` vs `insurer_attachments`) | Não bloqueia a Fase A (sem autorizações); adiar para S4 |
| D-A5 | Auditoria da seguradora vs P7 | Só necessária para S5; adiar |
| D-A6 | Pendência jurídica (Lei 22/11, AIPD, DPA, alojamento) | **Bloqueia o piloto com dados reais**, não o desenvolvimento. Dados de beneficiários da Baluarte são dados de terceiros |

## 5. Plano de execução (documentação primeiro, conforme CLAUDE.md)

1. **Contrato** (`vita-architect` + `vita-identity`): redigir em `openapi.yaml` e `endpoints.md` só as operações da Fase A (44 operações no contrato final: admin da seguradora, empresas, beneficiários, apólices, importação, cartão, planos/serviços/coberturas, `clinic-portal/insurers*`, reclamar cartão), validar com `pnpm gen`.
2. Migração `0033`-seguinte (tabelas `insurer_*` da Fase A, FKs compostas `(insurer_id, id)`), sem RLS (Q13).
3. Backend por camadas (`apps/api/src/modules/insurance` já existe para ADR-021; o ADR-025 prevê `insurer-ops`): S1 → S2 mínimo → validação S3.
4. Testes de isolamento entre seguradoras e matriz `TC-AZ-SEG` (`vita-qa-security`); conformidade OpenAPI.
5. Web: portal da seguradora (importação, beneficiários, planos), validação no portal da clínica, cartão no app.
6. Piloto: 1 seguradora (Baluarte), 3–5 clínicas da rede, 1 grupo corporativo, 60–90 dias, com baseline das métricas de §1.

## 6. O que não sabemos sobre a Baluarte (a perguntar antes de desenhar importação e planos)

- Que sistema usa hoje para apólices e quem o administra (formato e periodicidade de exportação de beneficiários).
- Se já tem rede própria de clínicas, cartão físico/QR e como valida hoje (telefone, e-mail, portal).
- Planos de saúde que comercializa e se vende a empresas, particulares ou ambos.
- Se existe um interlocutor que aprove o piloto e a cedência de dados (e o enquadramento regulatório com o regulador).

## 7. Riscos

- **Dependência de dados da seguradora:** sem importação regular e limpa, o estado «elegível» fica desatualizado e a validação perde credibilidade. Definir responsável e periodicidade.
- **Falso positivo de elegibilidade** (clínica trata e a seguradora recusa): a resposta deve dizer que é verificação de cobertura, não garantia de pagamento, até existir S4.
- **Adoção pelas clínicas:** um plano B sem internet (ex.: código de verificação por SMS) não está no ADR-025; avaliar por change control se o piloto o exigir.
- **Escopo:** manter a Fase A fechada; qualquer pedido de autorizações/despesas passa a S4/S5.

## 8. Estado real (2026-11-12) e pendências

> **2026-11-12 — delegação do proprietário:** o proprietário autorizou concluir a Fase A com as recomendações do assistente; ficam ratificadas como **DECIDIDAS «pelo proprietário (delegação 2026-11-12, a rever)»**: `GET /insurance-portal/me`; filtro `relationship=HOLDER` (+ `q`, `companyId` já existentes) em `GET /insurance-portal/beneficiaries` para os selects de titular (sem endpoint novo); máximos `waitingDays` ≤ 36 500 e `limitPerYear` ≤ 999 999 999 999,99, e `covered=false` ⇒ restantes campos ignorados (`EXCLUDED`, `limitPerYear=null`); pressupostos do paciente BR-SEG-32..37; `OTHER` ⇒ 404 nas rotas do paciente; porta `PatientAccessPort` em vez da aresta `insurer-ops` → `access` (modules.md).

| Marco | Estado | Notas |
|---|---|---|
| **S1** base, papéis, empresas, beneficiários, apólices, importação, job de expiração | **Implementado** (backend + portal web) | migração `0033`; BR-SEG-14..28 |
| **S2 mínimo** serviços, planos (versões), coberturas | **Implementado** (backend + portal web) | migração `0034`; sem cálculo de saldo (D-A2); `INSURER_PLAN_UPDATE` sem rota |
| **S3 parcial** ligação da clínica, `GET /clinic-portal/insurers`, `eligibility`, `services`, rate limit, `ELIGIBILITY_CHECK`, `partner-clinics` | **Implementado** (backend + web da clínica) | BR-SEG-29..31; sem `ProviderUnit`/`Encounter` |
| **S6 parcial** reclamar/desligar cartão, cartões, QR, cobertura | **Backend e web implementados** (serviço/tipos/mocks do cartão em `apps/web/src`; `qrcode-generator` para o QR) | BR-SEG-32..37; auditoria `INSURER_LINK_REVOKE`, `CARD_QR_ISSUE`, `COVERAGE_VIEW` |
| **Contrato novo** `GET /insurance-portal/me`, filtro `relationship` | **Implementado** (router/dto do `insurer-ops`; 45 operações) | TC-SEG-12/13/14 |
| **Web dos portais** (seguradora, clínica, paciente) | **Implementado** | — |
| **Revisão de segurança** | **Feita** (2026-11-12): migração `0035`, expurgo de pré-visualizações (BR-SEG-17), BR-SEG-38, auditoria de recusas limitada, redação do `err` do logger, `TRUST_PROXY` | `audit.md`, `security.md` |

**Falta para fechar o piloto:** (1) pendência jurídica D-A6 (Lei 22/11, AIPD, DPA, alojamento) **antes** de dados reais da Baluarte; (2) baseline das métricas de §1; (3) respostas às 4 perguntas de §6; (4) critérios `AC-SEG-01..12` (`acceptance-criteria.md`) executados.

**Pendências abertas (não decididas):**
- **P-SEG-1 (privacidade, BR-SEG-37) — RESOLVIDA (delegação 2026-11-12, a rever):** listar pedidos próprios (`GET …/card-claims`) e desligar (`DELETE …/card-claims/{id}`) deixaram de depender de `operationalModuleEnabled` e do estado da seguradora; o único dado da seguradora exposto é `insurerName`. Reclamar exige módulo ativo e seguradora `ACTIVE`; cartões, QR e cobertura exigem módulo ativo. Implementado no backend.
- **P-SEG-4 (cancelar pedido `PENDING`):** hoje só se desliga uma ligação `CONFIRMED`; o paciente não pode cancelar um pedido `PENDING` (o código já foi consumido, BR-SEG-32). **Proposta (não introduzida no contrato):** `DELETE …/card-claims/{id}` aceitar `PENDING`→`REVOKED`, sem devolver o código; estado final (`REVOKED` vs. novo estado) a decidir pelo proprietário.
- **P-SEG-2 (alertas):** alertas ao paciente de ligação confirmada/rejeitada. `AlertType` (`04-domain`/`alerts`) não tem tipo para estes eventos; **não se inventa**. Decisão futura: novo `AlertType` (ADR/change control em `alerts.md`) ou notificação só na lista de pedidos (`GET …/card-claims`), que já mostra o estado.
- **P-SEG-3 (interpretação):** `GET /insurance-portal/me` foi aberto a **qualquer conta do portal** (incl. `INSURANCE_AGENT`), não só aos papéis do módulo, porque com o módulo desativado só existem `INSURANCE_ADMIN`/`INSURANCE_AGENT` e o portal precisa de saber a flag. A rever.
- **Decisões «a rever» (delegação 2026-11-12):** `GET /insurance-portal/me`, filtro `relationship`, máximos de `waitingDays`/`limitPerYear`, BR-SEG-32..38, `OTHER` ⇒ 404, `PatientAccessPort`, expurgo de `PREVIEW` > 24 h (BR-SEG-17) e `409` ao confirmar beneficiário `CANCELLED`.
- **P-SEG-2 / P-SEG-3 / P-SEG-4:** ver acima (alertas ao paciente; `/me` aberto a qualquer conta do portal; cancelar pedido `PENDING`), todas por decidir.
- **Limitador em memória:** os rate limits (BR-SEG-18/33) são por processo; com várias instâncias da API o limite efetivo multiplica-se. Antes de escalar, mover para BD/Redis (change control).
- **Segredo dedicado ao QR:** o token do QR (`security.md`) deve ter segredo próprio, separado do dos códigos de reclamação, com rotação (`kid`); hoje não há variável de configuração dedicada documentada em `environment.md`. Por decidir/implementar.
- **Zeros à esquerda no XLSX:** células numéricas de documento/cartão perdem zeros à esquerda (o Excel guarda-as como número); definir regra (exigir texto, ou repor por formato) antes de importar ficheiros reais.
- **Corrida «ativar apólice» vs «arquivar plano»:** sem bloqueio entre as duas transações, uma apólice pode ficar `ACTIVE` sobre um plano arquivado; decidir regra (lock/validação na transação) e testar.
- **`apps/web/package-lock.json`:** regenerar (acrescentou-se `qrcode-generator`); o `npm ci` do Dockerfile do web falha com o lock desatualizado.
- **`TRUST_PROXY=2` na VPS:** definir e verificar (`deployment.md` §4); sem isso os rate limits e o IP auditado podem ser contornados ou colapsar no IP do proxy.
- **D-A6 jurídica:** Lei 22/11, AIPD e DPA por concluir; bloqueia o piloto com dados reais.
- **Perguntas à Baluarte (§6), por fazer:** (1) sistema de apólices atual e formato/periodicidade da exportação; (2) rede de clínicas, cartão físico/QR e validação atual; (3) planos comercializados e segmento (empresas/particulares); (4) interlocutor que aprova o piloto, a cedência de dados e o enquadramento regulatório.
