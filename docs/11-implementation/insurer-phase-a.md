# Seguradoras — Fase A ("porta de entrada"): recorte do ADR-025

> Estado: **proposta de recorte, 2026-11-11** (não é change control; não altera contratos nem BR). Seguradora-alvo do piloto: **Baluarte Seguros** (`baluarteseguros.ao`). O site não esteve acessível durante a análise (ligação recusada), pelo que **nada neste documento assume produtos, rede ou sistemas da Baluarte** — ver §6.
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
