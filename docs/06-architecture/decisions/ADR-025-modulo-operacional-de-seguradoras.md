# ADR-025 — Módulo operacional de seguradoras (multi-seguradora): beneficiários, apólices, planos, elegibilidade, autorizações, despesas e rede de prestadores

**Estado:** Aceite — decisão **do proprietário** (2026-11-05, change control **D21**), tomada em conversa com aprovação explícita para avançar (respostas Q1–Q3 e Q5–Q13; **Q4 por decidir**, ver abaixo). Adenda a ADR-020/ADR-021; **emenda** a `BR-INS-08` e alarga `authorization.md` §8. Não substitui nenhum ADR.
> Numeração: a proposta (`docs/insurer-module/`) chamava a este ADR "ADR-024"; esse número já estava ocupado pela marcação presencial da clínica (D20), pelo que este é o **ADR-025**.

## Contexto
ADR-021 deu às seguradoras parceiras um papel **mínimo**: ver e decidir pedidos de reembolso do titular (`ReimbursementClaim`), sem pré-autorização, sem verificação de apólice e sem consulta de cobertura (`BR-INS-08`). O proprietário pede agora que **uma seguradora opere na VitaFamily** (multi-seguradora) com clínicas e pacientes a usarem os respetivos portais/app sobre o mesmo núcleo de dados e regras: beneficiários e apólices, planos e coberturas, validação de elegibilidade, autorizações médicas, despesas médicas, rede de prestadores e dashboard. Especificação funcional proposta e conflitos: `docs/insurer-module/01-functional-spec.md` e `02-conflicts-and-open-questions.md`.

## Decisão

| Tema | Escolha |
|---|---|
| Âmbito (MVP, 7 capacidades) | (1) beneficiários e apólices; (2) planos e coberturas; (3) elegibilidade; (4) autorizações; (5) despesas; (6) rede de prestadores; (7) dashboard. Entrega por marcos **S1–S6** (`plan.md`). |
| Tenant | `insurer_accounts` (ADR-021) é a raiz de tenant. Todas as tabelas novas têm `insurer_id NOT NULL` e **FKs compostas** `(insurer_id, id)` (UNIQUE `(insurer_id, id)` nas tabelas-alvo). **Sem RLS** (Q13): FK composta + testes de isolamento entre seguradoras obrigatórios (`vita-qa-security`). |
| Ativação | O módulo operacional só está disponível para seguradoras com `insurer_accounts.operational_module_enabled = true`, ligado pelo Platform Admin (a emenda a `BR-INS-08` aplica-se **só** a estas). Seguradoras sem módulo continuam apenas com o fluxo de reembolso (ADR-021). *(Detalhe de desenho derivado de C1; ratificar na implementação de S1.)* |
| Dados da seguradora vs. dados de saúde | Separação estrita (C2/C7): `Beneficiary`, `Policy`, `Plan`… são dados **da seguradora** (já detidos como contratante); `FamilyMember` e registos de saúde continuam em ADR-005. Nunca se cruzam, exceto pela **ligação com consentimento** do paciente (Q2) — nunca por FK obrigatória nem por correspondência automática de nome/documento. |
| Papéis da seguradora | `insurance_account_role` alargado: `INSURANCE_ADMIN`, `BENEFICIARY_MANAGER`, `AUTHORIZATION_ANALYST`, `CLAIMS_MANAGER`, `FINANCE_MANAGER`; `INSURANCE_AGENT` **mantém-se** só para o fluxo de reembolso (C4). Matriz em `authorization.md` §8.2b. Mesmo ator (`InsuranceActorInfo`, `insurance_sessions`, `/insurance-portal/*`) — sem terceiro/quarto contexto. |
| Clínica | **Sem novo papel de médico** (Q6): `CLINIC_ADMIN` e `CLINIC_MANAGER` fazem tudo (validar, registar atendimento, pedir autorização, submeter despesas). Só prestadores (`Provider`) ligados à seguradora, via `insurer_providers.clinic_id` (clínica `PARTNER`). |
| Resposta de elegibilidade | Mínima (C3, BR-CLN-03 estendida): nome, estado, plano, validade, serviços cobertos, limites e necessidade de autorização; **nunca** histórico clínico. Cada validação auditada (finalidade: atendimento) e com rate limit. |
| Ligação paciente ↔ beneficiário (Q2) | O paciente **reclama o cartão** com nº de apólice + código fornecido pela seguradora; a seguradora **confirma**. Sem ligação, só o cartão manual de ADR-021. A ligação (e o consentimento) é desfeita pelo paciente a qualquer momento. |
| Dois fluxos de dinheiro (Q3) | Coexistem faturação direta (clínica → seguradora, `ExpenseClaim`) e reembolso (paciente → seguradora, `ReimbursementClaim`). Despesa **aprovada** marca o atendimento `DIRECT_BILLED` e **bloqueia** reembolso desse ato (BR-SEG-21). |
| Diagnóstico (Q5) | **Sem diagnóstico**: o atendimento só tem código de serviço (`Encounter.diagnosis` fora do MVP). |
| Catálogo de serviços (Q7) | **Lista de serviços por seguradora** (`insurer_services`), sem catálogo comum nem comparação entre seguradoras; a clínica vê a lista da seguradora do cartão apresentado. |
| Limites (Q8) | Vigora o **menor saldo** entre individual, familiar e anual (BR-SEG-08). |
| Autorização automática (Q9) | Existe, com **teto por plano**; alto custo (acima do teto) é sempre humano (BR-SEG-03/16). |
| Pagamentos (Q10) | O MVP termina a despesa em **`APPROVED`** (valor a pagar); `PENDING_PAYMENT`/`PAID` e `FINANCE_MANAGER` operacional ficam para a fase 2. |
| Várias seguradoras (Q11) | Um paciente pode ter beneficiário em várias seguradoras; a seguradora **escolhe-se pelo cartão** apresentado. **Sem coordenação de benefícios.** |
| Importação (Q12) | CSV e XLSX, **até 5.000 linhas** por lote (BR-SEG-17). |
| Moeda e lei (Q1) | Mercado Angola, **Kz (AOA) por seguradora**: `insurer_accounts.currency` (ISO 4217, default `AOA`); o esquema deixa de assumir EUR (o `default 'EUR'` de `reimbursement_claims.currency` é removido: a moeda vem da seguradora no momento do pedido). A aplicabilidade da **Lei angolana de proteção de dados (Lei n.º 22/11)** além do RGPD, textos legais, AIPD e alojamento ficam como **pendência jurídica** (abaixo). |
| Módulo | Novo módulo `insurer-ops` (nome provisório; pode dividir-se por ADR-016), ver `modules.md` §2/§3 nota 23. |

## Conflitos C1–C7 e sua resolução

| # | Conflito | Resolução |
|---|---|---|
| C1 | ADR-021 / `BR-INS-08` excluía pré-autorização, verificação automática da apólice e consulta de cobertura. | `BR-INS-08` **emendada**: a exclusão mantém-se para o fluxo de reembolso e para seguradoras sem módulo operacional; para as que o têm ativo, o módulo faz as três (BR-SEG-01..05). |
| C2 | Mínimo necessário (BR-CLN-03/ADR-021) vs. seguradora a guardar dados próprios de beneficiários. | Dados da seguradora separados dos dados de saúde (ADR-005); só se ligam por consentimento do paciente (Q2, BR-SEG-20). A seguradora nunca lê o perfil de saúde do paciente. |
| C3 | A clínica passa a ver dados de seguro de terceiros e vice-versa. | Resposta de elegibilidade mínima, relação explícita `Provider` ↔ `Clinic`, auditoria e rate limit por validação (BR-SEG-18); a seguradora só vê o que a clínica submete (atendimento, autorização, despesa). |
| C4 | `authorization.md` §8 só tinha `ADMIN`/`AGENT`. | §8 alargado com a matriz de cinco papéis (`authorization.md` §8.2b); `INSURANCE_AGENT` mantém-se para reembolsos. |
| C5 | Fase 3 do roadmap inclui IA/deteção de fraude/previsão. | **Fora do MVP**; qualquer IA fica sujeita ao gate de ADR-022 (AIPD + DPA). |
| C6 | `currency default 'EUR'` e alojamento UE vs. mercado angolano. | Moeda por seguradora (Q1); `infrastructure.md` (UE) inalterado até a pendência jurídica ser decidida. |
| C7 | `entities.md`: tudo pertence a `FamilyMember`. | `Beneficiary` é entidade da seguradora (nova secção de `entities.md`); ligação opcional e consentida a `FamilyMember`. |

## Pendências assumidas e não resolvidas
- **Q4 — Que seguradora valida? Por decidir.** **Pendência assumida:** a seguradora é determinada **pelo cartão apresentado** (o QR/nº de cartão identifica o `insurerId`; a clínica escolhe nos portais a seguradora indicada no cartão, `GET /clinic-portal/insurers`). Sem regra de desempate nem pesquisa transversal entre seguradoras. Rever por change control se o proprietário decidir outro critério.
- **Arredondamento (Q8, parte não respondida):** o proprietário decidiu só "o menor saldo". Proposta **a ratificar** (BR-SEG-08): `numeric(14,2)`, arredondamento *half-up* à unidade menor da moeda, calculado **sobre o total da despesa** (não por linha), `patientShare = total − insurerShare`; ordem: comparticipação → limite → excedente do paciente.
- **Anexos de autorizações/despesas:** `documents` está ligado a `family_id`/`member_id`; anexos da clínica à seguradora precisam de tabela própria (`insurer_attachments`) reutilizando o armazenamento/antivírus de `documents` pela sua raiz. Desenho fino a decidir no marco S4.
- **Bloqueio de reembolso (Q3) sem referência ao ato:** `ReimbursementClaim` não tem hoje ligação a um atendimento. Proposto `reimbursement_claims.encounter_id?` opcional (BR-SEG-21); pedidos sem referência não podem ser verificados automaticamente (revisão humana do `INSURANCE_AGENT`).
- **Lei 22/11, AIPD, textos legais e alojamento (Q1):** confirmação jurídica pendente (não bloqueia a documentação; bloqueia o lançamento, junto da AIPD já pendente).
- **Contrato `openapi.yaml`:** **não alterado** por este ADR; as rotas estão só esboçadas em `endpoints.md`. Nenhuma implementação de rotas antes de o contrato ser redigido e validado (marco S1).

## Consequências
- Novos: `BR-SEG-01..23`, UC-SEG-01..17 (`03-use-cases/insurer-ops.md`), máquinas de estado (`state-machines.md`), entidades, tabelas `insurer_*` (`schema.md`; **sem migração SQL**), papéis/matriz (`roles.md`, `authorization.md` §8.2b/§8.4), catálogo de auditoria (`audit.md`), módulo `insurer-ops` (`modules.md`), marcos S1–S6 (`plan.md`).
- Risco de escopo (7 capacidades ≈ várias vezes ADR-021): entrega faseada e revisão por marco.
- Risco monetário: testes de propriedade e casos do proprietário (20.000 × 80 % → 16.000/4.000; 500.000 − 120.000 = 380.000 Kz).
- Risco de privacidade: enumeração de beneficiários pela clínica (rate limit, resposta mínima, auditoria, QR rotativo); fuga entre seguradoras (testes de isolamento); dados de saúde de terceiros → AIPD a cobrir este tratamento antes do lançamento.
- `insurer_accounts` ganha `currency` e `operational_module_enabled`; `reimbursement_claims` perde o default `EUR`.

## Fora do âmbito (fases 2–3 do roadmap do proprietário)
Contratos/tabelas de preços negociadas, reconciliação, pagamentos a prestadores (`PAID`), relatórios financeiros avançados, importação/exportação avançadas além de CSV/XLSX, alertas de despesas anormais, deteção de fraude, previsão de custos, doenças crónicas, telemedicina, assistência internacional, integrações externas, saúde corporativa, coordenação de benefícios, diagnóstico no atendimento, papel de médico na clínica, catálogo comum de serviços, RLS.

## Notas datadas (não reescrevem o histórico acima)
- **2026-11-11 — Q4 fechada pelo proprietário.** A seguradora que valida é a **do cartão apresentado** (a pendência assumida acima passa a decisão): nº de cartão/QR identifica o `insurerId`, a clínica escolhe-a em `GET /clinic-portal/insurers`; sem desempate nem pesquisa transversal. **Fase A (recorte `11-implementation/insurer-phase-a.md`):** o app do paciente mostra **só cobertura e limites**, **sem «usado»/saldo consumido** (sem `CoverageConsumption`, sem reservas — chegam com S4/S5). O contrato da Fase A (44 operações) foi redigido em `openapi.yaml`/`endpoints.md`, o que **cumpre** o gate «contrato `openapi.yaml` não alterado» desta ADR **para a Fase A apenas** (S4–S5 continuam só esboçados); migração proposta `0033_insurer_phase_a.sql` (`schema.md` §3c). Regra de privacidade acrescentada a `privacy.md` §3: os dados do app nunca alimentam subscrição, preço de prémio nem decisão de cobertura.
