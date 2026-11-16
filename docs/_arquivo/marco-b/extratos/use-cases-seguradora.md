> **ARQUIVADO; ver tag `archive-marco-b-2026-11-16`** (ADR-037, R7). Extrato verbatim das secções/linhas de seguradora retiradas de documentos ativos; o ficheiro de origem indica-se em cada bloco.

## Origem: `03-use-cases/alerts.md`

### UC-ALR-07 Avisar a família do pedido de autorização (marco B fatia 5, ADR-036)
- **Ator:** sistema (`insurer-ops` por porta `FamilyNotifier` na transição; `alerts.scan` para «a expirar») · **Regras:** BR-ALR-10/11/12, BR-PRC-12. Sem rota nova: o utilizador usa `GET /alerts`, `POST /alerts/{id}/read` e as preferências existentes.
- **Fluxo (transição):** `insurer-ops` aprova/recusa/pede informação/reverte (UC-SEG-07/20, UC-SEG-06 na auto-aprovação) → na **mesma transação** chama `FamilyNotifier.notify` (ligada em `main/api.ts` a `alerts.raiseAuthorizationEvent`) → `alerts` resolve dono e destinatários do `processId` (titular adulto; tutores se dependente) → por destinatário: `insertIfNew` (dedupe) → `notifications.enqueueForAlert` (um por canal ativo) → texto externo genérico, in-app fixo por tipo.
- **Fluxo (a expirar):** `alerts.scan` lê `insurer-ops.listExpiringApprovals` (aprovações `APPROVED` com `validUntil − 3 dias ≤ agora < validUntil`, decisão anterior a esse instante, `process_id` não nulo) → pergunta ao `processes` se o processo está aberto (`SCHEDULED`/`IN_PROGRESS`) → emite como acima.
- **Alternativos:** pedido sem processo ou sem destinatário com conta ⇒ nada; sem canal ativo ⇒ alerta só na app (UC-ALR-02 alternativo); falhar o alerta numa transição ⇒ a transição reverte; repetir ⇒ idempotente. **Não gera:** «expirada», reabertura, `INFO_TIMEOUT`, cancelamento da clínica, escalada, aviso ao prestador.
- **Resultado:** o alerta abre o `Process` (`sourceType=PROCESS`, `sourceId`); a família vê o estado simples (`_arquivo/marco-b/process-flows.md` §14).

## Origem: `03-use-cases/processes.md`

> Estado: **v0.1** (contrato 2026-11-14) — convenções comuns em `family.md`. Regras: BR-PRC-01..14. O `Process` é um **agregador de leitura**: id único por ato e estado simples para a família. Sem seguradora, autorização, despesa, urgência nem notificações na fatia 1 (as seguintes acrescentam: fatia 3 autorização, fatia 4 decisão, fatia 5 vista da família e avisos, ADR-036). Não há caso de uso de criação pelo utilizador: o processo nasce como efeito da criação do ato.

- **Fatia 3 (ADR-034, BR-AUT-01):** também abre o processo o **pedido de autorização** (`insurer-ops`, `UC-SEG-06`) quando o beneficiário está ligado a um membro e o pedido não traz o `processId` de um ato: `ProcessLinker.open({originType: AUTHORIZATION, originId: id do 1.º pedido, clinicId, by: conta de clínica})`, `kind=AUTHORIZED`; a porta é definida em `insurer-ops/application` e implementada por `processes`. Leitura pela família: UC-PRC-03/04 com a categoria estrutural de seguro (`MANAGE_INSURANCE`, `authorization.md` §6.8).

- **Fatia 5 (ADR-036, BR-PRC-12..14):** a resposta de UC-PRC-03/04 ganha `coverage` (estado simples do pedido à seguradora: «a analisar», «a completar», «aprovado (em parte) até …», «não aprovado», «expirou», «cancelado pela seguradora», com «nova análise» em `appeal`), **só** para quem tem `MANAGE_INSURANCE` (titular adulto, tutor) e, em processo com ato, enquanto o ato não está `DONE`/`CANCELLED`; sem motivo, valor, serviço nem rasto; sem rota de detalhe do pedido; aprovação cancelada ou expirada chega agora à família (`nextStep` `COVERAGE_WITHDRAWN`/`COVERAGE_EXPIRED` em processo sem ato). Passos novos: **0**. Textos: `_arquivo/marco-b/process-flows.md` §14.

## Origem: `03-use-cases/appointments.md`

### UC-CLN-28 Ver o recibo na app e anexá-lo a um reembolso (M14 R)
- **Atores:** titular/tutor · **FR:** CLN-16 · **BR:** CLN-35, CLN-36, BR-INS-03/04
- **Fluxo:** na ficha do membro (**Seguro → Recibos das clínicas**, ou no detalhe da consulta/exame) vê a lista de recibos recebidos → abre um → **Imprimir / Guardar PDF**. Ao criar um **pedido de reembolso** (UC-INS-03), escolhe também os recibos a anexar ("Anexar recibo da clínica"): a app sugere o total como `amount`.
- **Alternativos:** recibo anulado, de outra moeda ou já em outro pedido ativo ⇒ `CONFLICT`/`VALIDATION_ERROR` (a UI esconde-os); dependente com conta ou `OTHER` ⇒ `FORBIDDEN`; sem consentimento na emissão ou visita manual ⇒ o recibo não aparece (a clínica entrega impresso).
- **Pós-condição:** `reimbursement_claim_receipts` criado; a seguradora vê o resumo mínimo do recibo (BR-CLN-36); sem `Document`/`Encounter` novos.

### UC-ADM-07 Gerir seguradoras parceiras (ADR-021/ADR-023)
- **Ator:** Platform Admin · **FR:** ADM-04 · **BR:** BR-ADM-05/06, BR-INS-06/10
- **Fluxo:** lista, cria (nome, NIF único), edita, suspende/reativa; cria/repõe a conta `INSURANCE_ADMIN` raiz. Sem eliminação.

## Origem: `03-use-cases/alerts.md`

| **Pedido de autorização** (marco B fatia 5, BR-ALR-10, `AUTHORIZATION_*`): aprovado, não aprovado, a seguradora pediu informação, aprovação cancelada pela seguradora (por transição, mesma transação); aprovação a expirar (scanner) | no momento da transição; **3 dias antes** de `validUntil` | só **titular adulto e tutores** (`MANAGE_INSURANCE`; nunca o dependente com conta) |

