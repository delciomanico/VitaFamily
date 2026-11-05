# Módulo de Seguradoras — Especificação funcional (PROPOSTA)

> Estado: **v0.2 (2026-11-05) — APROVADA e formalizada em `docs/06-architecture/decisions/ADR-025-modulo-operacional-de-seguradoras.md`** (D21; a proposta chamava-lhe "ADR-024", número entretanto ocupado). Este ficheiro é o **material de origem**; as regras, entidades, estados, papéis, esquema, casos de uso, auditoria, módulos e plano já foram propagados (`business-rules.md` §15, `entities.md`, `state-machines.md`, `authorization.md` §8.2b/8.4/8.5, `schema.md` §3c, `03-use-cases/insurer-operations.md`, `audit.md`, `modules.md` nota 23, `plan.md` S1–S6). Em caso de divergência prevalecem esses documentos e o ADR-025. Q4 continua por decidir. Origem: documento de produto "VitaFamily — Módulo de Seguradoras de Saúde" fornecido pelo proprietário. Convenções: `docs/11-implementation/conventions.md`; padrão de atores externos: ADR-020/ADR-021.

## 1. Objetivo e âmbito

Permitir que uma seguradora opere na VitaFamily (multi-seguradora) enquanto clínicas e pacientes usam os seus portais/app sobre o mesmo núcleo de dados e regras. Resolve: trabalho manual, validação de coberturas, demora de autorizações, falta de transparência e controlo de despesas.

**Capacidades do MVP (7):** (1) beneficiários e apólices; (2) planos e coberturas; (3) validação de elegibilidade; (4) autorizações médicas; (5) despesas médicas; (6) rede de prestadores; (7) dashboard operacional.

**Fora do MVP (fases 2–3 do roadmap do proprietário):** contratos/tabelas de preços negociadas, reconciliação, pagamentos a prestadores, relatórios financeiros avançados, importação/exportação avançada, alertas de despesas anormais, deteção de fraude, previsão de custos, doenças crónicas, telemedicina, assistência internacional, integrações externas, saúde corporativa. Qualquer IA fica sujeita a ADR-022 (AIPD + DPA).

**Princípios a preservar (do proprietário):** multi-tenancy rigorosa · regras configuráveis (nada de coberturas hard-coded) · auditoria · acesso por função e finalidade · um só núcleo de regras e dados · MVP focado · sem automatização cega (decisões sensíveis com regras explícitas e revisão humana).

## 2. Atores e papéis

| Ator | Contexto de autenticação | Papéis |
|---|---|---|
| Paciente/titular | `User` (existente) | `SELF`/`TUTOR_OF` (inalterado) |
| Clínica | `ClinicAccount` (ADR-020) | `CLINIC_ADMIN`, `CLINIC_MANAGER`; sem papel de médico (Q6): o `CLINIC_MANAGER` regista atendimentos |
| Seguradora | `InsuranceAccount` (ADR-021), papéis alargados | `INSURANCE_ADMIN`, `BENEFICIARY_MANAGER`, `AUTHORIZATION_ANALYST`, `CLAIMS_MANAGER`, `FINANCE_MANAGER` (`INSURANCE_AGENT` mantém-se para o fluxo de reembolso) |
| Plataforma | `PLATFORM_ADMIN` (existente) | cria seguradoras e o `INSURANCE_ADMIN` raiz; sem dados de saúde |

Matriz de permissões (✓ = leitura+escrita, R = leitura, — = nenhum), por seguradora (`insurerId` do contexto):

| Recurso | ADMIN | BENEF_MGR | AUTH_ANALYST | CLAIMS_MGR | FINANCE_MGR |
|---|---|---|---|---|---|
| Contas/papéis da seguradora | ✓ | — | — | — | — |
| Empresas, beneficiários, apólices | ✓ | ✓ | R | R | R |
| Planos e coberturas | ✓ | R | R | R | R |
| Rede de prestadores | ✓ | R | R | R | ✓ (preços, fase 2) |
| Pedidos de autorização | R | — | ✓ | R | R |
| Despesas (`ExpenseClaim`) | R | — | R | ✓ | R |
| Pagamentos | R | — | — | R | ✓ |
| Dashboard | ✓ | parcial | parcial | parcial | ✓ |
| Auditoria da seguradora | ✓ | — | — | — | — |

Regra transversal: a seguradora só vê dados com o seu `insurerId`; a clínica só vê o necessário ao atendimento (BR-CLN-03 estendida, §6); o paciente só vê os seus dados e os dependentes que gere. Todo o acesso fora destes limites é `DENIED` + auditado.

## 3. Modelo de domínio (proposto)

Todas as tabelas novas têm `insurer_id NOT NULL` (multi-tenancy) e FKs compostas `(insurer_id, id)` para impedir referências cruzadas entre seguradoras (mesmo padrão das FKs compostas de `schema.md`).

| Entidade | Campos essenciais | Notas |
|---|---|---|
| `Company` | nome, NIF, estado | Empresa cliente (apólice de grupo). |
| `Beneficiary` | `insurerId`, `companyId?`, nome, documento de identificação, data nascimento, `holderId?` (titular; null = é titular), `relationship`, estado `PENDING→ACTIVE⇄SUSPENDED→CANCELLED`, `familyMemberId?` | `holderId` modela agregado familiar e dependentes. **Não** é `FamilyMember`; ligação opcional só com consentimento do paciente (Q2). |
| `Plan` | nome, estado, versão | Imutável após ter apólices ativas: alterações criam nova versão (auditável). |
| `PlanCoverage` | `planId`, `serviceCode`/categoria, tipo `INCLUDED\|LIMITED\|EXCLUDED`, `copayPct`, limite por beneficiário/família/ano (`numeric`, moeda), `waitingDays`, `requiresAuthorization` | **Regras em dados**, nunca em código (princípio 2). |
| `Policy` | `planId`, `companyId?`, `holderId`, número, `validFrom`, `validTo`, estado `DRAFT→ACTIVE⇄SUSPENDED→EXPIRED\|CANCELLED` | Distinta de `InsurancePolicy` (ADR-021, cartão do paciente) — ver §7. |
| `Provider` / `ProviderUnit` | nome, NIF, tipo (clínica/hospital/laboratório/farmácia), unidades, especialidades, serviços, estado `ACTIVE⇄SUSPENDED` | Ligação opcional a `Clinic` (PARTNER) da VitaFamily. |
| `AuthorizationRequest` | `beneficiaryId`, `providerId`, `serviceCode`, justificação, documentos, estado, `authorizedAmount`, `code`, `validUntil`, `decidedBy`, `decisionNote` | Estados §4.1. |
| `ExpenseClaim` | `beneficiaryId`, `providerId`, `authorizationId?`, linhas (`serviceCode`, quantidade, valor), total, `insurerShare`, `patientShare`, estado, `duplicateKey` | Estados §4.2. Fluxo da **clínica**; coexiste com `ReimbursementClaim` do **paciente** (ADR-021). |
| `CoverageConsumption` | `beneficiaryId`, `coverageId`, período, `used`, `reserved` | `reserved` = autorizações aprovadas e despesas pendentes (§5.2). |
| `Encounter` (atendimento) | `beneficiaryId`, `providerId`, serviço, médico (texto), data, `authorizationId?`, diagnóstico? | Sem diagnóstico no MVP (Q5): só código de serviço. |
| Cartão digital | derivado de `Beneficiary`+`Policy`; QR com token assinado e rotativo, sem dados clínicos | Validade curta do token; revogável. |

## 4. Máquinas de estados

### 4.1 Autorização
`SUBMITTED → AUTO_APPROVED | IN_REVIEW → APPROVED | REJECTED | INFO_REQUESTED`; `INFO_REQUESTED → IN_REVIEW` (clínica responde); `APPROVED → USED | EXPIRED | CANCELLED`. Rejeição e pedido de informação exigem motivo. Decisão regista utilizador, data, motivo, estado (imutável; correções = novo evento).

### 4.2 Despesa
`SUBMITTED → IN_REVIEW → APPROVED | REJECTED | RETURNED`; `RETURNED → SUBMITTED` (clínica corrige); `APPROVED → PENDING_PAYMENT → PAID` (`PAID` e pagamentos: fase 2; no MVP termina em `APPROVED` com valor a pagar). Duplicados detetados à submissão ficam `IN_REVIEW` com flag, nunca rejeitados automaticamente.

### 4.3 Beneficiário / Apólice
Beneficiário: `PENDING → ACTIVE ⇄ SUSPENDED → CANCELLED`. Apólice: ver §3. Elegível ⇔ beneficiário `ACTIVE` **e** apólice `ACTIVE` **e** data dentro de `validFrom..validTo`.

## 5. Regras de negócio (prefixo proposto `BR-SEG-`)

### 5.1 Elegibilidade e autorização
- BR-SEG-01 Validação = elegibilidade + plano + validade + serviços cobertos + limites disponíveis + necessidade de autorização, filtrados por permissão (§6).
- BR-SEG-02 `requiresAuthorization` é por cobertura; serviços sem esta marca validam-se automaticamente (consulta geral não exige).
- BR-SEG-03 Autorização automática (`AUTO_APPROVED`) só quando todas as condições configuradas pela seguradora forem verdadeiras (coberto, dentro do limite, fora de carência, valor abaixo do teto de auto-aprovação do plano). Caso contrário `IN_REVIEW`. Alto custo (acima do teto) nunca é automático.
- BR-SEG-04 Carência: serviço dentro de `waitingDays` desde `Policy.validFrom` → não coberto (a decisão manual pode sobrepor-se, com motivo).
- BR-SEG-05 Código de autorização único, não adivinhável, com validade; uma autorização só cobre o serviço/prestador/beneficiário para que foi emitida.

### 5.2 Limites e comparticipação
- BR-SEG-06 Comparticipação = `valor × copayPct`, limitada ao saldo; o excedente é do paciente. Exemplo do proprietário: 20.000 × 80 % → 16.000 seguradora / 4.000 paciente.
- BR-SEG-07 Saldo disponível = limite − `used` − `reserved`. Aprovar autorização reserva o `authorizedAmount`; despesa aprovada converte reserva em `used`; expirar/cancelar liberta.
- BR-SEG-08 Limites por beneficiário, por família (soma do agregado) e anual; vence o mais restritivo. Cálculo em dinheiro com `numeric`, arredondamento definido e testado (Q8).
- BR-SEG-09 Exclusões prevalecem sobre inclusões.

### 5.3 Despesas
- BR-SEG-10 Despesa deve associar beneficiário, apólice vigente na data do atendimento e, se exigida, autorização válida para esse serviço.
- BR-SEG-11 Duplicado = mesmo beneficiário + prestador + serviço + data (+ valor); sinalizado para revisão humana.
- BR-SEG-12 Devolver (`RETURNED`) exige motivo; a clínica só edita despesas devolvidas.
- BR-SEG-13 Valor faturado > valor autorizado (+ tolerância configurável) → `IN_REVIEW` obrigatória.

### 5.4 Dados e auditoria
- BR-SEG-14 Multi-tenancy por `insurer_id` em todas as consultas (e FKs compostas); testes de isolamento obrigatórios (`vita-qa-security`).
- BR-SEG-15 Auditar: alterações de apólice/plano/cobertura, decisões, despesas, permissões e validações de elegibilidade (`actor_type` já existe: `INSURANCE_ACCOUNT`, `CLINIC_ACCOUNT`).
- BR-SEG-16 Sem decisão financeira/clínica sensível apenas automática: auto-aprovação é configurável, auditada e reversível por revisão humana.
- BR-SEG-17 Importação CSV/Excel: pré-visualização + relatório de erros por linha, transação por lote, deteção de duplicados por documento de identificação; nunca ativa beneficiários sem validação.

## 6. Integração com portais

**App do paciente** (consumo por `User` ligado a `Beneficiary`): cartão digital+QR; plano/coberturas/limites e **saldo** (limite − usado − reservado; ex.: 500.000 − 120.000 = 380.000 Kz); rede médica; estado do seguro e renovação; histórico de autorizações/despesas com valores comparticipados; dependentes; notificações (via `alerts`/`notifications`).

**Portal da clínica** (`/clinic-portal/*`, só prestadores ligados à seguradora):
1. Validar beneficiário (nº cartão, QR ou identificação) → resposta mínima: nome, estado, plano, validade, serviços cobertos, limites, necessidade de autorização (nunca histórico clínico).
2. Registar atendimento (serviço, médico, data, autorização).
3. Pedir autorização (+ responder a `INFO_REQUESTED`).
4. Submeter/corrigir despesas e anexos; acompanhar estados e valores pendentes/pagos.
Cada validação é auditada (finalidade: atendimento) e sujeita a rate limit (anti-enumeração).

**Portal da seguradora** (`/insurance-portal/*`): módulos §3.1–3.5 do proprietário + dashboard.

## 7. Relação com o que já existe (ADR-021/023)

- `InsurancePolicy` (cartão do paciente, texto livre) e `ReimbursementClaim` (paciente → seguradora, reembolso a posteriori) **mantêm-se**. `ExpenseClaim` é o fluxo **clínica → seguradora** (faturação direta). Um mesmo ato não pode gerar os dois: `ExpenseClaim` aprovado marca o atendimento como `DIRECT_BILLED` e bloqueia reembolso (regra a fechar, Q3).
- Ligação paciente↔beneficiário: o paciente "reclama" o seu cartão (nº apólice + código fornecido pela seguradora); a seguradora confirma. Sem ligação, o paciente continua apenas com o cartão manual do ADR-021.
- `insurer_accounts` (ADR-021/023) torna-se a raiz de tenant; reutilizam-se `insurance_sessions`, `getInsuranceActor()` e o algoritmo de autorização de `authorization.md` §8, alargado a papéis.

## 8. Casos de uso (índice; detalhe a escrever em `03-use-cases/` se aprovado)

`UC-SEG-01` gerir empresas · `02` registar/importar beneficiários e dependentes · `03` criar/gerir apólices · `04` criar plano e coberturas · `05` validar elegibilidade (clínica/paciente) · `06` pedir autorização · `07` analisar e decidir autorização · `08` responder a pedido de informação · `09` gerir rede de prestadores · `10` registar atendimento · `11` submeter despesa · `12` analisar despesa (aprovar/rejeitar/devolver) · `13` corrigir despesa devolvida · `14` consultar saldo de cobertura · `15` ver cartão digital · `16` dashboard · `17` consultar histórico/auditoria.

## 9. Dashboard (MVP)

Beneficiários ativos; apólices ativas/expiradas; beneficiários por empresa; autorizações pendentes e tempo médio de decisão; total de despesas; despesas por prestador/plano; autorizado vs. faturado; despesas rejeitadas; taxa de utilização dos planos. Agregações calculadas no servidor, filtradas por `insurerId` e papel (§2); sem dados nominais de saúde no dashboard.

## 10. API (esboço; contrato final em `openapi.yaml` se aprovado)

Prefixos: `/insurance-portal/{companies,beneficiaries,policies,plans,providers,authorizations,expenses,dashboard,imports,audit}`; `/clinic-portal/insurers/{id}/{eligibility,authorizations,encounters,expenses}`; `/families/{f}/members/{m}/insurance/{card,coverage-balance,authorizations,expenses}`. Erros, paginação e idempotência (`Idempotency-Key` nas submissões) como `errors.md`/`api-overview.md`.

## 11. Plano por fases (proposta; só após aprovação)

| Marco | Conteúdo | Depende de |
|---|---|---|
| S1 | Papéis alargados, `Company`, `Beneficiary`, `Policy`, importação, cartão digital | M11 |
| S2 | `Plan`/`PlanCoverage`, motor de elegibilidade e saldos | S1 |
| S3 | Rede de prestadores + validação no portal da clínica | S1, S2, M7 |
| S4 | Autorizações (manual + auto configurável) | S2, S3 |
| S5 | Despesas e comparticipação, dashboard | S4 |
| S6 | App do paciente: cartão, saldo, histórico | S1, S2 |
Cada marco: `pnpm gen && lint && test && build`, conformidade OpenAPI, teste de arquitetura, testes de isolamento entre seguradoras.
