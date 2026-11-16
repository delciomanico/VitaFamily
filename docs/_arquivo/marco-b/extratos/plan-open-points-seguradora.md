> **ARQUIVADO; ver tag `archive-marco-b-2026-11-16`** (ADR-037, R7). Extrato verbatim das secções/linhas de seguradora retiradas de documentos ativos; o ficheiro de origem indica-se em cada bloco.

## Origem: `11-implementation/plan.md`

### Propostos pós-M15 (2026-11-14) — **PROPOSTOS, não aprovados; ARQUIVADOS pelo pivô de 2026-11-16** (ADR-029/030/031; `_arquivo/marco-b/business-model.md`)
> Direção de produto indicada pelo proprietário; formalização por aprovar. **Sem datas** (capacidade TBD). Cada milestone só arranca depois de aprovação do ADR respetivo e de contrato (`openapi.yaml`) validado. Nenhum altera o âmbito existente até aprovação.

| Marco | Conteúdo proposto | Depende de | Bloqueios / conflitos |
|---|---|---|---|
| **A — Consolidar Fase A** | Fechar S1–S3/S6 parciais da Fase A (`_arquivo/marco-b/insurer-phase-a.md`): pendências, QA/segurança, piloto; escrever em `privacy.md` o princípio de §3.4 antes do piloto. | S1–S6 parciais | — |
| **B — S4 Autorizações** | Pedido/decisão de autorização, auto-aprovação configurável, reservas (BR-SEG-03/05/07/16; **a reserva de saldo foi adiada para a 2b**, ADR-035 §7); convenção mínima (ADR-030). **Decididos 2026-11-14:** urgência (48 h, revisão manual), SLA de análise 48 h por omissão (configurável por seguradora/serviço) com escalada ao novo papel Supervisor (sem aprovação tácita; `falta informação` caduca em 7 dias), vários recursos (salvaguardas propostas), auto-aprovação por regras simples, falta sem cancelar a autorização e entidade `Process` (migração Proposta, `_arquivo/marco-b/process-flows.md` §13; entra como pré-requisito de B). **Decididos também (2026-11-14):** módulo próprio `processes`; todo o ato tem `Process` (com ou sem seguradora); limites do prazo de decisão 24–120 h (48 h por omissão); recurso até 15 dias após a recusa, respondido em 72 h. Desenho e migração em **ADR-032 (Proposto, D28)**. Fluxo, estados propostos, recurso e BR-AUT-* provisórias em `_arquivo/marco-b/process-flows.md` e `state-machines.md` (secção proposta). **Revisão v0.2 (2026-11-14, proposta):** 3 tipos de guia (consulta, serviços/exames, internação), catálogo de despesa I/P/C/EAD/T/E/PO/M/SD, fallbacks telefone/WhatsApp; **Q-V2** (prazo com consequência para urgentes) por decidir; D29 (diagnóstico vs BR-SEG-23). Pesquisa em `_arquivo/marco-b/real-flow-research.md`; critérios do proprietário pendentes. **Construção autorizada em 2026-11-14 (plano em `_arquivo/marco-b/marco-b-construcao.md`): fatias 0, 1 (`Process`), 2 (catálogo/política/moeda), 3 (pedido de autorização pelo prestador, ADR-034) e **4 (fila/decisão pela seguradora, auto-aprovação por regras simples, SLA medido e papel `SUPERVISOR`, ADR-035, contrato fechado 2026-11-15; migração `0040`)** com contrato fechado; 5–6 por contratar. A Despesa unificada (S5 núcleo) e a migração do `ReimbursementClaim` passaram do marco C para este marco (fatia 2b).** | A, ADR-030, `Process` | C2 (mínimo do ato autorizado); papel `SUPERVISOR` (**aceite** na fatia 4, `authorization.md` §8.2c, ADR-035); aprovação do ADR-032 e registos de clínica sem ids Vita (BR-CLN-24); restantes salvaguardas de recurso por aprovar **Fatia 5 contratada em 2026-11-15 (ADR-036; `_arquivo/marco-b/marco-b-construcao.md` §4):** vista da família (`Process.coverage`, aprovação revertida/expirada), 5 alertas `AUTHORIZATION_*` pelo `alerts`/`notifications` existentes, migração `0041` (só enums e um índice); saldo/copagamento estimado, urgência (6) e despesa (2b) ficam fora. |
| **C — S5 Despesas** | **Nota (2026-11-14): a Despesa unificada (origem `PROVIDER`/`FAMILY`, núcleo `SUBMITTED → IN_REVIEW → APPROVED \| REJECTED \| RETURNED → PAID`) e a migração do `ReimbursementClaim` (expand/backfill/fachada) foram antecipadas para o marco B, fatia 2b; ficam no marco C o S5 para além do núcleo, a medição/faturação (C9) e a fase «contrair» só após verificação em dados reais.** Despesas, devolução, duplicados, dashboard (BR-SEG-10..13/21); medição de transações (ADR-029). Fluxo, reembolso fora da rede, `contestada`/`paga` e BR-DSP-* provisórias em `_arquivo/marco-b/process-flows.md`; copagamento pago no balcão, Vita só calcula e mostra (Q-C1 decidida 2026-11-14). Decididos 2026-11-14: Q-F1 (seguradora regista pagamento, prestador confirma receção; altera BR-INS-05, proposta pendente), Q-T1, Q-A1, Q-S3, **Q-F2: Despesa unificada (origem `PROVIDER`/`FAMILY`, fila única) que obriga a migrar o `ReimbursementClaim` de ADR-021 (plano em ADR-032, Proposto)**. | B | C9 (medição/faturação); aprovação do ADR-032 |
| **Empresa fase 2** | Portal da empresa: `EmployerAccount`, adesão/saída, dependentes, indicadores agregados e anónimos (k mínimo), vínculo revogável (ADR-031). | A (Beneficiários→empresas), C para custo | C1, C10, k e entidade por decidir |
| **D — Segurança medicamentosa** | Alertas de interações/duplicações/doses. | M6 | **C3** (BR-HLT-03): ADR + validação clínica; possível dispositivo médico |
| **E — Assistente de sintomas** | Orientação de sintomas. | M12 (ADR-022) | **C4**: ADR que reverta `scope.md`/BR-RPT-03; AIPD; parecer |
| **F — Wearables + incentivos** | Integração (`wearables/06`) e incentivos. | `wearables/` fase 1 aprovada | **C1, C7**: princípio de dados do app vs incentivos |

Ordem sugerida: A → B → C → Empresa fase 2 → D → E → F. Rastreabilidade: BR-SEG-03/05/07/16 → B; BR-SEG-10..13/21 → C; novas BR (Empresa, convenção, publicação) a criar após aprovação.

## Origem: `11-implementation/plan.md`

| **M11** | **Seguradoras e portal da seguradora** | `insurance` (`InsurancePolicy`, `ReimbursementClaim`, reaproveita `documents`), **`insurance-portal`** (ADR-021: `InsuranceAccount`/`insurance_sessions` separados de `users`/`ClinicAccount`; hierarquia `INSURANCE_ADMIN`/`INSURANCE_AGENT`; listar/decidir pedidos) | BR-INS (ADR-021) | M3, M5 |
| **S1** | **Seguradoras: base operacional** (ADR-025, D21) | **Primeiro: contrato** (`openapi.yaml` + `endpoints.md`, validado). Papéis alargados (`insurance_account_role`), `insurer_accounts.currency`/`operational_module_enabled` (+ `PATCH /admin/insurers`), `Company`, `Beneficiary`, `Policy`, importação CSV/XLSX (≤ 5.000), cartão digital/QR, reclamar cartão + confirmação (BR-SEG-20); job `insurer.expire-policies`; migração própria; auditoria `INSURER_*`. **[Fase A: todo o S1; contrato redigido 2026-11-11; migração proposta `0033_insurer_phase_a`]** | BR-SEG-14/15/17/18/19/20; UC-SEG-01/02/03/15 | M11 |
| **S2** | **Planos, coberturas e elegibilidade** | `InsurerService`, `Plan` (versões), `PlanCoverage`, motor de elegibilidade e de saldos (`CoverageConsumption`), cálculo de comparticipação com testes de propriedade (casos do proprietário: 20.000×80 %; 500.000−120.000); ratificar arredondamento. **[Fase A só: `InsurerService`, `Plan` com versões e `PlanCoverage` (cobertura sim/não, % comparticipação, teto anual, carência, exige autorização); o resto — motor de saldos, `CoverageConsumption`, arredondamento, limites por beneficiário/família — fica para depois da Fase A]** | BR-SEG-01/02/04/06..09/22; UC-SEG-04/14 | S1 |
| **S3** | **Rede de prestadores e validação na clínica** | `Provider`/`ProviderUnit`, ligação `clinic_id`, `GET /clinic-portal/insurers`, `eligibility`, `services`, rate limit e auditoria `ELIGIBILITY_CHECK`; `Encounter`; matriz `TC-AZ-SEG` da clínica (§8.4). **[Fase A só: ligação `clinic_id` (`insurer_providers`), `GET /clinic-portal/insurers`, `eligibility`, `services`, rate limit, auditoria; sem `ProviderUnit`/serviços por prestador nem `Encounter`]** | BR-SEG-18/22/23; UC-SEG-05/09/10 | S1, S2, M7 |
| **S4** | **Autorizações** | `AuthorizationRequest` (manual + auto-aprovação com teto por plano), eventos imutáveis, reserva de saldo, código; resposta a `INFO_REQUESTED`; anexos (`insurer_attachments`, decisão de desenho); job `insurer.expire-authorizations` | BR-SEG-03/05/07/16; UC-SEG-06/07/08 | S2, S3 |
| **S5** | **Despesas, comparticipação e dashboard** | `ExpenseClaim`/linhas, duplicados, tolerância, aprovação (reserva→usado, `DIRECT_BILLED`), bloqueio de reembolso (`reimbursement_claims.encounter_id`, BR-SEG-21), dashboard por papel, auditoria `GET .../audit` (**só se P7 for emendado**); termina em `APPROVED` (Q10) | BR-SEG-10..13/21; UC-SEG-11/12/13/16/17 | S4 |
| **S6** | **App do paciente** | Cartão digital, saldo, histórico de autorizações/despesas, várias seguradoras, notificações (`alerts`); `/families/{f}/members/{m}/insurance/*`. **[Fase A só: reclamar/desligar cartão, cartão digital/QR, plano/validade/serviços/limites **sem «usado»** (D-A2); sem histórico, sem várias-seguradoras além de um cartão por seguradora, sem notificações]** **Proposto (2026-11-14, `_arquivo/marco-b/digital-card.md`): segredo próprio do QR renovável, várias seguradoras (último usado), cartão de empresa, pré-verificação; carteira Apple/Google (decisão do proprietário: no âmbito, fase posterior ao cartão na app, requisitos por verificar).** | BR-SEG-20/23; UC-SEG-14/15 | S1, S2 |

## Origem: `11-implementation/plan.md`

| BR-INS (ADR-021/ADR-023: apólice, pedidos de reembolso, portal da seguradora) | M11 |
| BR-SEG-14/15/17..20 (base, importação, cartão; ADR-025) | S1 |
| BR-SEG-01/02/04/06..09/22 (planos, elegibilidade, saldos) | S2 |
| BR-SEG-18/22/23 (rede, validação na clínica) | S3 |
| BR-SEG-03/05/07/16 (autorizações) | S4 |
| BR-SEG-10..13/21 (despesas, dashboard) | S5 |
| BR-SEG-20/23 (app do paciente) | S6 |

## Origem: `11-implementation/plan.md`

| Mistura entre os três atores (User/família, `ClinicAccount`, `InsuranceAccount`) (ADR-021) | Terceiro `ActorInfo`/`AsyncLocalStorage` próprio, claims de JWT distintas, rotas `/insurance-portal/*` nunca partilham contexto com as restantes; teste de arquitetura verifica que `insurance-portal` não importa `auth`/`access`/`families`/`clinic-portal`. |
| Fuga entre seguradoras / enumeração de beneficiários pela clínica (ADR-025) | FK compostas `(insurer_id, id)` em todas as tabelas `insurer_*` (sem RLS, Q13), dois tenants em todos os testes de integração, teste automático por endpoint, resposta de elegibilidade mínima + rate limit + auditoria, QR rotativo/revogável. |
| Erros monetários em limites/comparticipação (ADR-025) | `numeric`, arredondamento ratificado, testes de propriedade e casos do proprietário; atualização de `CoverageConsumption` sob bloqueio de linha. |

## Origem: `11-implementation/plan.md (parágrafos M11 e S1–S6)`

**M11 (ADR-021, acrescentado 2026-10-16; completado por ADR-023, 2026-11-04):** inclui agora `InsurancePolicy.insurerId`, `GET /families/{f}/insurers`, `PATCH /admin/insurers/{id}`, BR-INS-09/10 e `_arquivo/marco-b/insurance.md` (fase 4 do plano de ADR-023). funcionalidade aprovada depois do plano original (M0–M10) estar
fechado; por isso aparece depois de M10 nesta tabela, mas as suas dependências reais são só M3 (`access`) e
M5 (`documents`) — pode ser agendado antes de M10 se a capacidade o permitir. Se for implementado antes de
M10, os gates de M10 (segurança, carga) devem cobrir também `insurance`/`insurance-portal`.


**S1–S6 (ADR-025, acrescentado 2026-11-05):** módulo operacional de seguradoras; aprovado depois de M11/M13. Cada marco fecha com `pnpm gen && lint && test && build`, **conformidade OpenAPI**, teste de arquitetura (`modules.md` §3 nota 23), **testes de isolamento entre seguradoras** (BR-SEG-14, `vita-qa-security`) e revisão ao proprietário. **Fase A (2026-11-11):** recorte `_arquivo/marco-b/insurer-phase-a.md` dentro de S1 + S2 (mínimo) + S3 (validação) + S6 (parcial); **contrato da Fase A redigido e validado em `openapi.yaml`/`endpoints.md` (45 operações, incl. `/insurance-portal/me`, 2026-11-12)**; migração proposta `0033_insurer_phase_a.sql`; critérios de aceitação/testes `TC-AZ-SEG-*` e `TC-SEG-*` em `09-testing`. **Gates e pendências antes de S1:** (1) ~~redigir e validar o contrato `openapi.yaml`~~ **feito para a Fase A (2026-11-11)**; S4–S5 continuam sem contrato; (2) ~~decisão do proprietário sobre **Q4**~~ **decidida 2026-11-11: seguradora do cartão apresentado**; D-A2: Fase A sem saldo «usado»; (3) ratificar arredondamento (BR-SEG-08); (4) desenho de anexos (`documents` vs. `insurer_attachments`); (5) confirmar com o proprietário a vista de auditoria da seguradora face a P7 (`audit.md` §2); (6) pendência jurídica (Lei 22/11, AIPD, alojamento — Q1) antes do lançamento, juntamente com os gates de M10, que devem cobrir também o módulo operacional (dados de terceiros).

## Origem: `11-implementation/open-points.md`

| OP-13 | `audit.md` §3 não lista as ações de auditoria do portal da seguradora (`INSURANCE_ACCOUNT_LOGIN/LOGIN_FAILED/LOGOUT/REFRESH_REUSE_DETECTED`, `INSURANCE_AGENT_CREATE/REMOVE`, `ADMIN_INSURER_CREATE/UPDATE/STATUS`). | Fase 4a | Documentação incompleta | Ratificar os nomes e documentá-los. **Fechado por ADR-025 (2026-11-05): `audit.md` §3.** |
| OP-14 | Dois `POST/PATCH /admin/insurers` concorrentes com o mesmo NIF: a BD deixa passar um, mas o outro receberia 500 em vez de 422 (não testado). | Fase 4a | Erro feio num caso raro | Traduzir a violação UNIQUE em 422. |
| OP-15 | O contrato do portal da seguradora não tem suspender/reativar agentes (só criar/remover). | Fase 4a | Gestão de staff mais pobre que a da clínica | Decidir se se acrescenta a rota (a coluna `suspended_at` já existe). |
| OP-16 | O portal da seguradora só recebe `documentIds` dos pedidos: não há rota para descarregar os anexos. | Fase 4b | A seguradora não abre os documentos | Definir rota (p. ex. `GET /insurance-portal/claims/{id}/documents/{docId}`) e as regras de minimização. |
| OP-17 | Sem alertas/notificações de pedidos de reembolso (tipos de alerta não estão no contrato): o titular não é avisado da decisão. | Fase 4b | UX | Acrescentar ao contrato e implementar. |
| OP-18 | Divergências doc: openapi dá 404 para apólice sem seguradora parceira (AC-INS-01 diz 422, seguiu-se o AC); 409 de seguradora suspensa não declarado; `audit.md` sem as novas ações; `authorization.md` sem `MANAGE_INSURANCE`. | Fase 4b | Docs desalinhadas | Atualizar docs. |
| OP-20 | Exportação de dados não inclui apólices, pedidos nem cartões. | Fase 4b | RGPD: portabilidade | Incluir no `lifecycle`. |
| OP-21 | Upload `INSURANCE_POLICY` para apólice inexistente deixa objeto órfão na quarentena (comportamento pré-existente de `documents`). | Fase 4b | Lixo em storage | Validar antes de gravar. |

## Origem: `11-implementation/clinic-portal-v2.md (excertos de reembolso/seguradora)`

- emendas a BR-CLN-05/24, BR-INS-04, BR-ADM-03

- , `createReimbursementClaim` (`receiptIds`), `ReimbursementClaim`/`InsuranceClaimView` (`receipts`)

- (6) **anexo ao reembolso** por `receiptIds` (associação, sem `Document`/`Encounter`/despesa novos; BR-SEG-21 intacto; a seguradora vê um resumo mínimo); (7)

- , **Seguro → Recibos das clínicas** e "Anexar recibo da clínica" no pedido de reembolso

- Preços, recibos e comprovativo para reembolso

- ; **comprovativo para reembolso** (PDF) que o paciente anexa a um pedido (M11, `ReimbursementClaim`); integra com `Encounter` do módulo de seguradoras (S3) quando houver validação de seguro.

- ; serve de comprovativo de reembolso;

- ; comprovativo contém só o mínimo; papel Médico não vê financeiro; coordenar com S3/S5 para não duplicar despesas.

## Origem: `00-product/roadmap.md`

Detalhe em `11-implementation/plan.md` §4 e `_arquivo/marco-b/business-model.md`: **A** consolidar Fase A · **B** autorizações (S4) · **C** despesas (S5) · **Empresa fase 2** (portal leve, ADR-031) · **D** segurança medicamentosa · **E** assistente de sintomas · **F** wearables + incentivos. D, E e F estão **bloqueados** por conflitos com BR-HLT-03/BR-RPT-03/ADR-022 e com o princípio "dados do app não alimentam prémio/cobertura" (_arquivo/marco-b/business-model.md §7). Não aprovados; só entram no âmbito por change control.

