# Vita Family — Documentação (fonte única da verdade)

> Estado em 2026-10-08: **Fases 1–16 concluídas (rascunho aprovado por delegação)**. **Fase 17 (implementação) em curso por decisão do proprietário (ADR-014/ADR-015: Node.js/TypeScript, Clean Architecture; ADR-012 substituída na linguagem/dados/filas).**
> Regra: se o código e a documentação divergirem ⇒ parar, decidir, atualizar a documentação, corrigir o código. Alterações por change control.

> **Stack e alojamento (ADR-014/ADR-015, decisão do proprietário):** Node.js 24 LTS + TypeScript (Clean Architecture por módulo), sem Redis (pg-boss sobre PostgreSQL), VPS própria, `https://vitafamily.cassfrei.com` (PWA na raiz, API em `/api/v1`), responsável pelo tratamento: **Cassfrei**. Convenções de código em `11-implementation/conventions.md`; agentes em `.claude/agents/`.

## Índice
| Pasta | Conteúdo |
|---|---|
| `00-product/` | `discovery.md` (Fase 1 + decisões D1–D19), `vision.md`, `scope.md` (MVP, M1–M6, N1–N3), `glossary.md`, `roadmap.md` |
| `01-requirements/` | `functional-requirements.md` (R1–R10), `non-functional-requirements.md` (N4–N11), `business-rules.md` (B1–B6 + regras derivadas) |
| `02-users/` | `actors.md`, `roles.md`, `permissions.md` (P1–P8) |
| `03-use-cases/` | Casos de uso por área (inclui `insurance.md` e `insurer-operations.md`, UC-SEG); decisões Q1–Q11 em `alerts.md` |
| `04-domain/` | `domain-model.md` (DM1–DM8), `entities.md`, `relationships.md`, `state-machines.md` (ST1–ST6) |
| `05-api/` | `api-overview.md`, `authentication.md`, `endpoints.md`, `errors.md`, `openapi.yaml` (170 operações, validado) |
| `06-architecture/` | `architecture.md`, `modules.md`, `infrastructure.md`, `decisions/` (ADR-001..026) |
| `07-database/` | `schema.md`, `indexes.md`, `migrations.md` |
| `08-security/` | `security.md`, `authorization.md`, `privacy.md`, `audit.md` |
| `09-testing/` | `strategy.md`, `test-cases.md`, `acceptance-criteria.md` |
| `10-operations/` | `environment.md`, `deployment.md`, `monitoring.md` |
| `insurer-module/` | Material de origem do módulo de seguradoras (formalizado em ADR-025): especificação funcional e conflitos/decisões |
| `11-implementation/` | `plan.md` (adição à estrutura do prompt: plano da Fase 16); `open-points.md` (pendências conhecidas de clínica/exames/recomendações); `clinic-portal-v2.md` (roadmap M14 e frontend do portal da clínica, ADR-026) |

## Como foram tomadas as decisões
- Fases 1–5: decididas **pelo proprietário** (D1–D16, M1–M6, N1–N3, R1–R10, N4–N11) — duas escolhas diferentes da recomendação (R2, R8) e uma de D16 (sem validação com utilizadores).
- Fases 5 (P1–P8) a 16: **delegadas ao assistente** ("adota a recomendação", "faz todas as fases restantes com a sua recomendação"). Estão marcadas como tal em cada documento e podem ser revistas por change control.
- **ADR-021 (2026-10-16): decidida pelo proprietário**, aprovação explícita ("sim") a uma proposta detalhada em conversa (acesso de seguradoras parceiras: cartão de apólice, pedidos de reembolso, portal `/insurance-portal/*`). Documentação atualizada por change control (`vita-architect`); detalhe fino de implementação (módulo `insurance`/`insurance-portal`, `modules.md` §3, catálogo de `audit.md`) fica pendente para o milestone M11.
- **ADR-022 (2026-10-17): decidida pelo proprietário**, avisado explicitamente de que reverte uma regra fundacional (`BR-RPT-03`) e a exclusão de IA do MVP (`scope.md` §1/§3), e confirmou querer avançar com os limites mais estritos discutidos ("Resumo com IA": só contextualiza tendências nos dados já existentes, sem ação clínica/diagnóstico, via fornecedor externo de IA, opt-in, filtro de saída obrigatório). **Esta funcionalidade fica explicitamente amarrada à AIPD da pendência abaixo** — não entra em produção para utilizadores reais sem a AIPD a cobrir este tratamento **e** um DPA assinado com o fornecedor escolhido (gate de lançamento, ADR-022). Detalhe fino de implementação (contrato `openapi.yaml`, schema de consentimento, módulo) fica pendente para o milestone que a implementar (`plan.md`).
- **ADR-023 / D19 (2026-11-04): decidida pelo proprietário** — portal da clínica passa a gerir exames (**revisto no mesmo dia: horários com vagas e marcação direta `SCHEDULED`, sem pedido/recusa; migração `0022`**), emitir resultados (estruturados/PDF) e recomendações; admin ganha detalhe/pesquisa/reposição de acesso, gestão de contas de clínica e CRUD de seguradoras; fecha lacunas de M11 (ADR-021). Plano: M7b e M13 em `11-implementation/plan.md`.
- **ADR-024 / D20 (2026-11-05): decidida pelo proprietário** — a clínica pesquisa um utilizador por e-mail exato (devolve só nome de apresentação ou 404 genérico) e marca-lhe uma consulta `SCHEDULED` num horário livre da própria clínica; BR-CLN-03 emendada, BR-CLN-10 nova; plano M7d.
- **ADR-025 / D21 (2026-11-05): decidida pelo proprietário**, aprovação explícita em conversa — módulo operacional de seguradoras (multi-seguradora; beneficiários, apólices, planos, elegibilidade, autorizações, despesas, rede de prestadores, dashboard; moeda Kz por seguradora; emenda a BR-INS-08; BR-SEG-01..23, UC-SEG-01..17). **Q4 (que seguradora valida) por decidir**: assumida a do cartão apresentado. Contrato `openapi.yaml` ainda **não** alterado (esboço em `endpoints.md`); marcos S1–S6 em `plan.md`. Material de origem em `insurer-module/`.
- **ADR-026 / D22 (2026-11-07): decidida pelo proprietário** (critério "máximo valor para a clínica, mínima complexidade para o utilizador"; OP-24..30 resolvidos) — portal da clínica como ferramenta independente (registo próprio de pacientes, clínica responsável pelo tratamento, consentimento por clínica/categoria/prazo); emendas estreitas a BR-CLN-03/BR-CLN-10; roadmap M14 e frontend em `11-implementation/clinic-portal-v2.md`; DPA/AIPD são gate de lançamento.

## Pendências conhecidas (não bloqueiam M0)
Textos legais (termos, privacidade) · aplicabilidade da Lei angolana 22/11 e alojamento para o mercado de Angola (ADR-025, Q1) · dados legais da Cassfrei · confirmar que a VPS e os backups estão na UE · AIPD antes do lançamento (**bloqueia especificamente o "Resumo com IA" de ADR-022**, além de ser pendência geral do MVP; precisa de cobrir explicitamente o novo subcontratante de dados de saúde e um DPA assinado com o fornecedor escolhido) · DPO (avaliação jurídica) · responsável por incidentes · MFA (evolução recomendada) · tamanho/escala real (sem dados de utilizadores).

Resolvidas: fornecedor SMTP UE → **Brevo** (`infrastructure.md` §4, `deploy/.env.production.example`).
