> **ARQUIVADO; ver tag `archive-marco-b-2026-11-16`** (ADR-037, R7). Extrato verbatim das secções/linhas de seguradora retiradas de documentos ativos; o ficheiro de origem indica-se em cada bloco.

## Origem: `08-security/authorization.md`

## 8. Portal da seguradora (`InsuranceAccount`, ADR-021)

Mirror exato de §6, com `CLINIC_ADMIN/CLINIC_MANAGER` → `INSURANCE_ADMIN/INSURANCE_AGENT` e `clinicId` →
`insurerId`.

### 8.1 Algoritmo (rotas `/insurance-portal/*`, independente de §1–6)
1. **Conta**: `InsuranceAccount.status ≠ ACTIVE` ⇒ DENY (`ACCOUNT_SUSPENDED`).
2. **Seguradora do caminho**: `insuranceAccount.insurerId` tem de coincidir com o `insurerId` do recurso (pedido de reembolso, agente); senão ⇒ `NOT_FOUND` (404, sem enumeração — mesma regra de `errors.md` §2).
3. **Papel**: decidir por ação segundo a matriz §8.2.
4. Registar auditoria (ações sensíveis e negações), com `actor_type = INSURANCE_ACCOUNT` (não `USER`/`SYSTEM`/`PLATFORM_ADMIN`/`CLINIC_ACCOUNT`).

### 8.2 Matriz de permissões `INSURANCE_ADMIN` vs `INSURANCE_AGENT`
| Ação | `INSURANCE_ADMIN` | `INSURANCE_AGENT` |
|---|---|---|
| Login/refresh/logout no portal da própria seguradora | sim | sim |
| Criar/listar/remover contas `INSURANCE_AGENT` da própria seguradora | sim | não |
| Listar pedidos de reembolso (`ReimbursementClaim`) da própria seguradora | sim | sim |
| Abrir um pedido e ver os documentos anexados (só os da lista do pedido) | sim | sim |
| Aprovar/rejeitar um pedido, com motivo | sim | sim |
| Ver/gerir pedidos ou agentes de **outra** seguradora | não (`NOT_FOUND`) | não (`NOT_FOUND`) |

Nunca há ação do portal que leia além dos documentos listados no pedido e dos dados da própria apólice
(seguradora, número, titular) — nunca condições, alergias, medicação, consultas, exames ou dados de
família/tutela do membro (ADR-021).

### 8.2b Papéis e matriz do módulo operacional (ADR-025)

Aplica-se **só** a seguradoras com `operational_module_enabled` (BR-INS-08, emenda). O `INSURANCE_AGENT` mantém exclusivamente o fluxo de reembolso (§8.2); os papéis novos **não** acedem a `ReimbursementClaim` (conservador; alargar por change control). Passo 3 do algoritmo §8.1 decide por esta matriz; `insurerId` do contexto filtra tudo (BR-SEG-14). `✓` = leitura + escrita · `R` = leitura · `—` = nenhum.

| Recurso | `INSURANCE_ADMIN` | `BENEFICIARY_MANAGER` | `AUTHORIZATION_ANALYST` | `CLAIMS_MANAGER` | `FINANCE_MANAGER` | `SUPERVISOR` (fatia 4, §8.2c) |
|---|---|---|---|---|---|---|
| Contas/papéis da seguradora | ✓ | — | — | — | — | — |
| Empresas, beneficiários, apólices, importações, ligações paciente↔beneficiário | ✓ | ✓ | R | R | R | R |
| Planos, coberturas e lista de serviços | ✓ | R | R | R | R | R |
| Tipos de serviço (`service_kind`) e classificação dos serviços (fatia 2, BR-SEG-39) | ✓ | R | R | R | R | R |
| Política da seguradora — prazos (`insurer_policy_settings`, fatia 2, BR-SEG-40) | ✓ | R | R | R | R | ✓ |
| Rede de prestadores | ✓ | R | R | R | R (✓ nos preços: fase 2) | R |
| Pedidos de autorização — fila, detalhe e métricas (fatia 4, BR-AUT-17..20) | R | — | ✓ (decide pedidos que não são recurso, §8.2d) | R | R | ✓ (só recursos, atribuir, reabrir, reverter; **não decide pedidos normais**, §8.2d) |
| Anexos dos pedidos de autorização (descarga, BR-AUT-13) | — (só metadados) | — | ✓ | — (só metadados) | — (só metadados) | ✓ |
| Regras de auto-aprovação (`AutoApprovalRule`, BR-AUT-23) | R | — | R | — | — | ✓ |
| Despesas (`ExpenseClaim`) | R | — | R | ✓ | R | R |
| Pagamentos (fase 2) | R | — | — | R | ✓ | — |
| Dashboard | ✓ (completo) | parcial: beneficiários/apólices | parcial: autorizações | parcial: despesas | ✓ (completo) | parcial: autorizações |
| Auditoria da seguradora (`GET .../audit`) | ✓ | — | — | — | — | — |
| Pedidos de reembolso (`ReimbursementClaim`) | ✓ (como §8.2) | — | — | — | — | — |

Complemento Fase A (delegação do proprietário 2026-11-12, a rever): `GET /insurance-portal/me` (contexto da conta: `insurerId`, `name`, `currency`, `operationalModuleEnabled`, `role`) é acessível a **qualquer conta autenticada do portal** (incl. `INSURANCE_AGENT`) e **também com o módulo desativado** (exceção à regra de `NOT_FOUND` do módulo; não devolve dados pessoais). A pesquisa de titulares para os selects usa `GET /insurance-portal/beneficiaries?relationship=HOLDER` com as permissões de leitura já definidas (sem linha nova).

Notas: (a) o `INSURANCE_ADMIN` tem **R** (não ✓) nas autorizações e despesas: administra, não decide (separação de funções); (b) "parcial" no dashboard = só os indicadores do seu domínio (`dashboard.md`/spec §9), sem dados nominais de saúde; (c) uma conta tem exatamente um papel; (d) `INSURANCE_ADMIN` continua único e ativo por seguradora (BR-INS-06); (e) **Fase A (contrato 2026-11-11, `_arquivo/marco-b/insurer-phase-a.md`; atualizado na fatia 4, ADR-035):** tinham rotas só `INSURANCE_ADMIN` e `BENEFICIARY_MANAGER`; **a fatia 4 dá rotas e criação de contas a `AUTHORIZATION_ANALYST` e a `SUPERVISOR`** (`CLAIMS_MANAGER` e `FINANCE_MANAGER` continuam definidos, sem rotas nem criação de contas); a linha «Rede de prestadores» reduz-se à **ligação da clínica** (`/insurance-portal/providers`, ✓ só `INSURANCE_ADMIN`) e à listagem de clínicas parceiras que alimenta a escolha (`GET /insurance-portal/partner-clinics`: **só `INSURANCE_ADMIN`**, `BENEFICIARY_MANAGER` ⇒ `FORBIDDEN`; devolve apenas `id` e `name`, sem dados internos da clínica; módulo desativado ⇒ `NOT_FOUND`); `INSURANCE_AGENT` e qualquer papel em seguradora **sem** `operational_module_enabled` ⇒ `FORBIDDEN`/`NOT_FOUND` (módulo inexistente para o ator: `NOT_FOUND`); a emissão do código de reclamação do cartão e a confirmação/rejeição de ligações são ✓ `BENEFICIARY_MANAGER`/`INSURANCE_ADMIN` (linha «ligações paciente↔beneficiário»).

### 8.2c Papel `SUPERVISOR` — **ACEITE** (fatia 4, ADR-035; Q-S1b, 2026-11-14, instrução do proprietário de 2026-11-15)
Papel do módulo operacional (ADR-025) para a escalada de SLA, os recursos e as regras: **separação de funções — quem analisa (`AUTHORIZATION_ANALYST`) ≠ quem supervisiona (`SUPERVISOR`)**. **R** em tudo o que o analista e o gestor de despesas veem (e nas despesas, sem escrita); **✓** na política de prazos (§8.2b, BR-SEG-40) e nas regras de auto-aprovação; nos pedidos de autorização: atribuir/libertar, **decidir recursos**, reabrir recusas, reverter qualquer aprovação (incluindo a automática, **só ele**), descarregar anexos; **não decide pedidos que não são recurso** nem recursos de recusas que ele decidiu. Sem acesso a contas/papéis (`INSURANCE_ADMIN`) nem a `ReimbursementClaim`. Enum `insurance_account_role` + `SUPERVISOR` (`ADD VALUE`, `0040`); criado pelo `INSURANCE_ADMIN` (§8.3; **vários** por seguradora, ao contrário do Admin) só com módulo operacional ativo; criação, remoção e papel auditados (`INSURER_ACCOUNT_CREATE/REMOVE`). Alternativas rejeitadas: usar `INSURANCE_ADMIN` ou `CLAIMS_MANAGER` como gestor.

### 8.2d Decisão de autorizações — matriz fina (fatia 4, ADR-035; gera `TC-AZ-DEC-*`)
Algoritmo de §8.1 + passo 3 por esta tabela. Todas as rotas `/insurance-portal/authorizations*` e `/auto-approval-rules*` exigem módulo ativo (senão `NOT_FOUND`); `INSURANCE_AGENT` e `BENEFICIARY_MANAGER` ⇒ `FORBIDDEN`; pedido/regra/conta/anexo de outra seguradora ⇒ `NOT_FOUND` (BR-SEG-14). «Pedido normal» = sem `parentRequestId`; «recurso» = com.
| Ação (rota) | Analista | Supervisor | Admin / Claims / Finance |
|---|---|---|---|
| Fila, detalhe, métricas (`GET`) | ✓ | ✓ | ✓ (R) |
| `GET …/assignees` | — | ✓ | ✓ (só `INSURANCE_ADMIN`) |
| `assign` | só toma um pedido normal `IN_REVIEW` livre (para si) | ✓ pedido normal `IN_REVIEW`/`INFO_REQUESTED`; qualquer analista ativo ou libertar | — |
| `approve`, `reject`, `request-info` | ✓ **só pedido normal** `IN_REVIEW`, livre ou atribuído a si (atribuído a outro: `CONFLICT`) | ✓ **só recurso** `IN_REVIEW`; **não** se decidiu a recusa de origem (`FORBIDDEN`) | — |
| `cancel` (reverter aprovação) | ✓ só se `decidedBy=ANALYST` | ✓ qualquer (única via para `SYSTEM`) | — |
| `reopen` (recusa) | — | ✓ (não se foi quem a recusou, BR-AUT-22) | — |
| Descarregar anexo | ✓ | ✓ | — |
| Regras de auto-aprovação: `GET` | ✓ (R) | ✓ | ✓ (só `INSURANCE_ADMIN`) |
| Regras: `POST`/`PATCH`/`DELETE` | — | ✓ | — |
| Política de prazos `PUT`/`DELETE` | — | ✓ | ✓ (só `INSURANCE_ADMIN`) |
O analista **nunca** decide recursos; o supervisor **nunca** decide pedidos normais. A recusa de uma decisão por papel é `FORBIDDEN` (existe o recurso e o papel é da seguradora; sem enumeração entre seguradoras). Negações da fase A de seguradoras **não** se auditam (`audit.md`). A clínica e a família **não** ganham permissões novas: a clínica continua só em `/clinic-portal/authorizations*` (§8.4) e nunca vê o decisor nem se a aprovação foi automática; a família nunca lê pedidos.

### 8.3 Hierarquia de contas (ADR-021, mirror de §6.3) — quem administra quem
| Ação | Quem |
|---|---|
| Ver/editar/suspender a seguradora (inteira) | PLATFORM_ADMIN |
| Criar/repor a conta `INSURANCE_ADMIN` raiz de uma seguradora parceira | PLATFORM_ADMIN |
| Criar/listar/remover contas `INSURANCE_AGENT` da própria seguradora | `INSURANCE_ADMIN` da seguradora (self-service, nunca o Platform Admin diretamente) |
| Criar/listar/remover contas `BENEFICIARY_MANAGER`, `AUTHORIZATION_ANALYST`, `SUPERVISOR` (fatia 4, ADR-035) da própria seguradora; `CLAIMS_MANAGER` e `FINANCE_MANAGER` só quando tiverem rotas (S5) | `INSURANCE_ADMIN` (self-service; só com módulo operacional ativo) |
| Ativar/desativar o módulo operacional e definir a moeda (`currency`) de uma seguradora (ADR-025) | PLATFORM_ADMIN |

### 8.4 Clínica a operar sobre uma seguradora (ADR-025)
Rotas `/clinic-portal/insurers/{insurerId}/*` continuam no algoritmo de §6 (ator `ClinicAccount`, fora de `AccessPolicy`) com um passo extra: **(a)** conta ativa; **(b)** existe `insurer_providers` ativo com `clinic_id` = `clinicId` do token e `insurer_id` = `insurerId` do caminho, e a seguradora tem módulo operacional ativo; senão `NOT_FOUND` (sem enumeração); **(c)** `CLINIC_ADMIN` e `CLINIC_MANAGER` têm as mesmas permissões (Q6).
| Ação | `CLINIC_ADMIN` | `CLINIC_MANAGER` |
|---|---|---|
| Listar seguradoras a que a clínica está ligada | sim | sim |
| Validar elegibilidade (nº de cartão, QR ou identificação; resposta mínima, BR-SEG-18) | sim | sim |
| Registar atendimento (serviço da lista da seguradora; sem diagnóstico) | sim | sim |
| Pedir autorização (com serviço do catálogo e justificação administrativa); ver/listar os seus pedidos; responder a `INFO_REQUESTED`; anexar documentos administrativos; cancelar o próprio pedido pendente; recorrer de uma recusa (**marco B fatia 3**: rotas `/clinic-portal/authorizations*`, ver abaixo) | sim | sim |
| Submeter despesa; corrigir despesa `RETURNED`; ver estados e valores | sim | sim |
| Ver dados de outra seguradora, de beneficiários fora da validação feita, ou histórico clínico | não (`NOT_FOUND`/`FORBIDDEN`) | não |

Fase A (contrato 2026-11-11): `CLINIC_DOCTOR` (M14 R, §6.2b) **não** acede a `/clinic-portal/insurers/*` (`FORBIDDEN`) — a matriz acima cobre só `CLINIC_ADMIN`/`CLINIC_MANAGER` (Q6, anterior ao papel `CLINIC_DOCTOR`); abrir ao Médico é change control (mantido `FORBIDDEN` por decisão do proprietário, 2026-11-11). **Fatia 3 (ADR-034): `/clinic-portal/authorizations*`.** Mesmo algoritmo de §6.1 + passo (b) **só nas escritas** (criar, responder, cancelar, recorrer, anexar/remover): ligação `ACTIVE` da clínica à seguradora e módulo ativo, senão `NOT_FOUND`; as **leituras** (`GET` lista e detalhe) só exigem que o prestador do pedido (`insurer_providers.clinic_id`) seja a clínica do token e mantêm-se com a ligação suspensa/módulo desativado (BR-INS-10). Pedido, anexo ou `processId` de outra clínica ⇒ `404`/`VALIDATION_ERROR` sem enumeração (`processId` inválido devolve sempre a mesma mensagem). A criação **revalida** o beneficiário com a mesma identificação da elegibilidade, **o mesmo rate limit** e o mesmo `404` único (BR-SEG-18). O prestador nunca lê saldo, usado, reservado, notas internas nem a identidade do analista; a **família nunca lê** pedidos nem anexos (só o estado derivado do `Process`, §6.8); o analista e o supervisor descarregam anexos (§8.2d, fatia 4: `AUTHORIZATION_ANALYST`/`SUPERVISOR`); a clínica nunca vê o decisor nem se a aprovação foi automática; o motivo escrito pela seguradora (`decisionNote`) é visível, as notas internas (`internalNote`) nunca. Testes: `TC-AZ-AUT-01..06`.
A seguradora que valida é a do **cartão apresentado** (Q4, decidida 2026-11-11): o `insurerId` do caminho vem da lista `GET /clinic-portal/insurers`; não há pesquisa transversal.

### 8.5 Paciente/titular (app) (ADR-025)
Rotas `/families/{f}/members/{m}/insurance/*` (cartão digital, saldo, autorizações, despesas, reclamar cartão): **SELF** (adulto) ou **TUTOR_OF**, mesma regra de `BR-INS-02` — **sem** categoria de partilha nova e sem acesso de `OTHER`. Só com ligação confirmada ao `Beneficiary` (BR-SEG-20; reclamar/desligar o cartão e listar os seus pedidos não exigem ligação prévia, mas exigem o mesmo ator); **Fase A:** o paciente vê só plano, validade, serviços cobertos e limites — **sem «usado»/«reservado»/saldo** (D-A2, 2026-11-11); o paciente vê apenas os valores comparticipados e o saldo, nunca dados internos de análise (notas do analista além do motivo da decisão). **Fase A, implementado (delegação 2026-11-12, a rever):** a ação é `MANAGE_INSURANCE` e qualquer recusa (`OTHER`, dependente, não-membro, Platform Admin) devolve **`404 NOT_FOUND`**, nunca `403` (sem enumeração); `MEMBER_BLOCKED` (423) mantém-se como nas restantes rotas do membro. Reclamar exige seguradora `ACTIVE` e módulo ativo; cartões, QR e cobertura exigem módulo ativo; listar pedidos próprios e desligar **não dependem** do módulo nem do estado da seguradora (privacidade: revogar o consentimento é sempre possível) e expõem apenas `insurerName` (BR-SEG-37, P-SEG-1 resolvida). Pressupostos em BR-SEG-32..37. O módulo `insurer-ops` consulta `AccessPolicy.can()` para este ator; as rotas `/insurance-portal/*` e `/clinic-portal/*` nunca a usam.

## Origem: `08-security/authorization.md (fragmentos retirados)`

- (cabeçalho antigo de estado)

-  As rotas
`/insurance-portal/*` usam um **terceiro ator**, `InsuranceActorInfo { insuranceAccountId, insurerId,
role, sessionId }` (ADR-021), com a sua própria verificação (§8), mirror exata da do portal da clínica.
As três árvores de rotas nunca partilham contexto de pedido entre si. Um `ClinicAccount` ou uma
`InsuranceAccount` **nunca** aparecem

- - `InsurancePolicy`/`ReimbursementClaim` (ADR-021) **não** são uma categoria desta matriz: não têm
  `SharingGrant`, logo não há acesso de `OTHER` nesta versão. Só `SELF`/`TUTOR_OF` leem/criam/editam
  (mesma regra de leitura/escrita que as restantes categorias para estas duas relações); `OTHER` e
  `DEPENDENT_SELF` nunca veem nem criam. Se o proprietário pedir partilha com `OTHER`, é uma categoria
  nova por change control (ver ADR-021, "porquê opt-in por documento").


- , gerir seguradoras |

- | Criar/ver apólice (`InsurancePolicy`), criar/submeter pedido de reembolso (`ReimbursementClaim`) | SELF (adulto) ou TUTOR_OF (dependente); ADR-021. |
| Criar seguradora parceira, ver/suspender a seguradora | PLATFORM_ADMIN. |
| Contas do portal da seguradora (`INSURANCE_ADMIN`/`INSURANCE_AGENT`) | Fora de `AccessPolicy` — ver §8 (ADR-021). |


- | `authorizations` (`POST`, `GET` lista, `GET /{id}`, `POST /{id}/respond`, `/cancel`, `/appeals`, `POST /{id}/attachments`, `DELETE /{id}/attachments/{attachmentId}`; marco B fatia 3, BR-AUT-01..16) | sim | sim | **não** (`FORBIDDEN`) |


- (3) o Médico não tem permissões no módulo operacional de seguradoras (ADR-025/Q6; inclui `/clinic-portal/authorizations*`, marco B fatia 3); (4)

- (como `InsurancePolicy`, §3): só

- ; anexar em `…/reimbursement-claims`)

- | Anexar recibo a um pedido de reembolso (`receiptIds`, BR-CLN-36) | sim | sim | não | não |


- (como o seguro, §3): documento

-  A clínica nunca vê nem altera estas ligações nem os pedidos de reembolso; a seguradora só vê o resumo mínimo dos recibos que o titular anexou (BR-CLN-36).

- **Fatia 3 (ADR-034):** processo de `originType=AUTHORIZATION` (aberto por um pedido de autorização sem marcação) **não tem categoria de dados de saúde**: segue §8.5 — a decisão é `AccessPolicy.can(MANAGE_INSURANCE)` (ação **já existente**; **SELF adulto** e **TUTOR_OF** leem; `DEPENDENT_SELF`, `OTHER` mesmo com `SharingGrant` e `PLATFORM_ADMIN` ⇒ omitido na lista e `404` no detalhe; `MEMBER_BLOCKED` propaga), calculada **uma vez por pedido**; `PROCESS_VIEW` só para o tutor (como acima). Um processo de consulta/exame com pedido de autorização ligado continua a seguir a categoria do **ato** (`APPOINTMENTS`/`EXAMS`) e mostra o estado de cobertura a quem o lê: **não** revela justificação, valor, serviço nem anexos (só `familyStatus` e `nextStep`). Testes: `TC-AZ-AUT-05/06`.


- **Fatia 5 (ADR-036) — cobertura (`Process.coverage`) e `nextStep`:** a decisão `MANAGE_INSURANCE` passa a ser **também** calculada para processos **com ato** (consulta/exame), **uma vez por pedido** (não por processo), e decide a **cobertura**: com `MANAGE_INSURANCE` (SELF adulto, TUTOR_OF) o processo traz `coverage` e o `nextStep`/`familyStatus` consideram o facto de cobertura; **sem** ela (`DEPENDENT_SELF`, `OTHER` com `SharingGrant`) `coverage = null` e a derivação usa **só o ato** (apertado face à fatia 3, que mostrava o `nextStep` de cobertura a quem lia o ato; aplica a decisão «só o titular/`MANAGE_INSURANCE` vê o pedido»). Isto **não é uma recusa**: nunca devolve `403`/`404` por falta de `MANAGE_INSURANCE` num processo de ato legível. Processo `AUTHORIZATION`: regra da fatia 3 inalterada (omitido/`404`). A resposta **nunca** contém motivo, valor, serviço, justificação, anexos, decisor, nota interna, `overrideReason`, rasto nem automático/manual (BR-PRC-12). Sem ação nova em `AccessPolicy`, sem rotas novas. **Alertas `AUTHORIZATION_*` (BR-ALR-10/11):** destinatários = quem tem `MANAGE_INSURANCE` e conta (titular adulto; tutores do dependente; **nunca** `DEPENDENT_SELF`); a leitura segue a regra de `GET /alerts` (só o próprio destinatário); o alerta guarda `familyId`/`memberId`/`processId`, e abrir o `Process` volta a decidir o acesso (um alerta não dá acesso). Testes: `TC-AZ-PRC-07..09`, `TC-ALR-09..14`.


-  Token de User ou de seguradora nunca é aceite aqui,

- | Seguradoras: listar, criar, editar, suspender/reativar; conta raiz | PLATFORM_ADMIN | BR-ADM-05/06; sem eliminação. |


- Um token de `ClinicAccount`/`InsuranceAccount` nunca autoriza

-  As matrizes §6.2 (clínica), §8.2/§8.2b (seguradora) e §8.4 (clínica sobre seguradora) seguem a mesma regra: geradas a partir da tabela, com casos próprios `TC-AZ-CLN-*`/`TC-AZ-INS-*` (e `TC-AZ-SEG-*` para §8.2b/§8.4/§8.5, incluindo isolamento entre seguradoras); §6.8 gera `TC-AZ-PRC-*` (**fatia 5: `TC-AZ-PRC-07..09`**); §8.4 (rotas `/clinic-portal/authorizations*`) gera `TC-AZ-AUT-*`; **§8.2b/§8.2d (decisão, regras e supervisão, fatia 4) geram `TC-AZ-DEC-*`**.

