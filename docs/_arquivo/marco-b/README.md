# Arquivo do marco B (seguradoras, autorizações, reembolsos) — índice

> **ARQUIVADO; ver tag `archive-marco-b-2026-11-16`** (commit `b6ff812`; ramo `archive/marco-b-seguradoras`). Decisão do proprietário de 2026-11-16 (ADR-037 §12); plano e estado da remoção em `11-implementation/arquivo-marco-b.md` (R1–R7 feitos; R8 e R9 pendentes). **Nada aqui é fonte de verdade ativa**: serve de histórico e de ponto de partida para uma eventual retoma (change control + ADR novo). Os ADR-021, 023 (parte seguradora), 025 e 029–036 ficam em `06-architecture/decisions/` com estado «ARQUIVADO».

## Documentos movidos (texto original; só os caminhos entre documentos arquivados foram atualizados)
| Ficheiro | Origem |
|---|---|
| `insurance.md` | `03-use-cases/insurance.md` (UC-INS) |
| `insurer-operations.md` | `03-use-cases/insurer-operations.md` (UC-SEG) |
| `insurer-module/` | `insurer-module/` (especificação funcional e conflitos do módulo operacional) |
| `insurer-phase-a.md` | `11-implementation/insurer-phase-a.md` |
| `marco-b-construcao.md` | `11-implementation/marco-b-construcao.md` |
| `business-model.md` | `00-product/business-model.md` |
| `real-flow-research.md` | `00-product/real-flow-research.md` |
| `digital-card.md` | `00-product/digital-card.md` |
| `process-flows.md` | `00-product/process-flows.md` |

## Extratos (secções/linhas de seguradora retiradas de documentos que continuam ativos; cada bloco indica o ficheiro de origem)
| Extrato | Conteúdo |
|---|---|
| `extratos/business-rules-seguradora.md` | BR-INS (§13), BR-SEG (§15), BR-AUT (§17), BR-ALR-10..12, BR-ADM-05/06, BR-CLN-36, BR-PRC-12..14 e linhas reescritas |
| `extratos/schema-seguradora.md` | `schema.md` §3b/§3c, tabelas de apólice/reembolso, enums de seguradora |
| `extratos/authorization-seguradora.md` | `authorization.md` §8 (portal da seguradora, matrizes, `SUPERVISOR`, `MANAGE_INSURANCE`) e fragmentos |
| `extratos/audit-privacy-seguradora.md` | `audit.md`, `privacy.md`, `security.md` (ações `INSURANCE_*`/`AUTHORIZATION_*`, rate limit/QR, finalidade vedada) |
| `extratos/entities-seguradora.md` | `entities.md` (Seguros e módulo operacional) e `relationships.md` |
| `extratos/state-machines-seguradora.md` | `state-machines.md` (ReimbursementClaim, Beneficiary, Policy, Plan, S4, S5, Propostas, cobertura do `Process`) |
| `extratos/modules-alerts-seguradora.md` | `modules.md` (módulos `insurance`/`insurer-ops`, notas 23/30–33, jobs `insurer.*`) |
| `extratos/use-cases-seguradora.md` | UC-ALR-07, UC-PRC fatias 3/5, UC-CLN-28 (anexo a reembolso), UC-ADM-07 |
| `extratos/tests-seguradora.md` | `test-cases.md` (§8b/8d–8g) e `acceptance-criteria.md` (AC-INS/SEG/AUT/PRC-08/09) |
| `extratos/roles-actors-glossary-seguradora.md` | `roles.md`, `actors.md`, `glossary.md`, FR-ADM-04 |
| `extratos/migrations-indexes-seguradora.md` | `migrations.md` (0037/0039/0040/0041) e `indexes.md` |
| `extratos/plan-open-points-seguradora.md` | `plan.md` (M11, S1–S6, marcos A–C/Empresa, rastreabilidade, riscos), `open-points.md` (OP-13..21) e excertos de `clinic-portal-v2.md`/`roadmap.md` |
| `extratos/readme-seguradora.md` | entradas do registo de decisões de `docs/README.md` |

## Contrato (R6)
As operações e schemas de seguradora removidos de `05-api/openapi.yaml`, `endpoints.md` e `errors.md` **não** têm extrato: recuperam-se da tag (`git show archive-marco-b-2026-11-16:docs/05-api/openapi.yaml`).

## Nota sobre referências
Documentos ativos e ADR que citam secções entretanto arquivadas (por exemplo «`schema.md` §3c», «`business-rules.md` §15», «`authorization.md` §8», «`modules.md` nota 31») leem-se agora no extrato correspondente acima.
