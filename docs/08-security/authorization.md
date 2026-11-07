# Vita Family — Autorização (Fase 14)

> Estado: **v0.5** — papéis e matriz do módulo operacional de seguradoras (ADR-025: §8.2b, §8.4, §8.5); v0.4 — exames, resultados e recomendações da clínica e administração de contas (ADR-023, D19: §3 nota, §4, §6.2–6.4, novo §7); v0.3 acrescenta o portal da clínica parceira (D17/D18, ADR-020) e o portal da seguradora parceira (ADR-021). Implementa `02-users/permissions.md` (v0.2). Racional: ADR-008 (ator de User/família), ADR-020 (segundo ator, `ClinicAccount`), ADR-021 (terceiro ator, `InsuranceAccount`).

## 1. Entradas e saída da decisão

```text
AccessPolicy.can( actor, action, target ) → ALLOW | DENY(reason)

actor  = { userId, platformRole, membership na família do pedido?, status da conta }
action = READ | CREATE | UPDATE | DELETE | CONFIRM_DOSE | MANAGE_SHARING | MANAGE_STRUCTURE | EXPORT ...
target = { família, categoria?, sujeito (memberId)?, recurso }
```

**Três tipos de ator (D18/ADR-020, ADR-021):** `AccessPolicy` (secções 2–6) decide **só** sobre o ator de
User/família (`ActorInfo`, ADR-008). As rotas `/clinic-portal/*` usam um **segundo ator**,
`ClinicActorInfo { clinicAccountId, clinicId, role, sessionId }` (ADR-020), autorizado por uma
verificação própria e mais simples (§6) — nunca pelo `AccessPolicy` de família. As rotas
`/insurance-portal/*` usam um **terceiro ator**, `InsuranceActorInfo { insuranceAccountId, insurerId,
role, sessionId }` (ADR-021), com a sua própria verificação (§8), mirror exata da do portal da clínica.
As três árvores de rotas nunca partilham contexto de pedido entre si. Um `ClinicAccount` ou uma
`InsuranceAccount` **nunca** aparecem como `actor` desta secção (não têm `userId`, não têm pertença de
família).

## 2. Algoritmo (por ordem; a primeira regra que decide termina)

1. **Conta**: `status ≠ ACTIVE` ⇒ DENY (`ACCOUNT_SUSPENDED`/`EMAIL_NOT_VERIFIED`); termos desatualizados ⇒ DENY exceto ações permitidas (B6).
2. **Platform Admin**: só ações `ADMIN_*`; qualquer ação sobre dados de saúde ⇒ DENY.
3. **Pertença**: o actor tem de ter FamilyMember **com conta ligada** na família do caminho; senão ⇒ `NOT_FOUND` (404).
4. **Ação estrutural** (convites, papéis, remoção, nome da família, clínicas privadas de outros): exige `FAMILY_ADMIN` (exceções na tabela abaixo).
5. **Ação sobre dados de saúde de um sujeito** (`memberId`): calcular a **relação** do actor com o sujeito:
   - `SELF`: o FamilyMember do actor é o sujeito.
   - `TUTOR_OF`: existe `Guardianship(dependent=sujeito, guardian=membro do actor)`.
   - `DEPENDENT_SELF`: SELF **e** o actor é dependente com conta (restringido por categoria).
   - `OTHER`: qualquer outra.
6. Decidir por **categoria** (ALLERGIES, CONDITIONS, MEDICATION, APPOINTMENTS, EXAMS) segundo a matriz abaixo.
7. Sujeito com `status = BLOCKED` ⇒ DENY para todos (`MEMBER_BLOCKED`) exceto Admin (ver avisos) para estrutura.
8. Registar auditoria da decisão relevante (ações sensíveis e negações).

## 3. Matriz de dados de saúde (resolve `permissions.md` §2–3)

| Relação do actor com o sujeito | Ler | Criar/Editar/Eliminar | Confirmar toma |
|---|---|---|---|
| **SELF (adulto)** | todas as categorias | todas | sim |
| **TUTOR_OF** | todas | todas | sim |
| **DEPENDENT_SELF** | MEDICATION, APPOINTMENTS e identificação | **nenhuma** | sim (MEDICATION) |
| **OTHER** | só categorias com `SharingGrant` ativo (do sujeito → actor ou → toda a família) | **nunca** | não |
| **Family Admin como OTHER** | idem OTHER (**sem privilégio**) | nunca | não |

Notas:
- Dependente **sem conta** não é actor; os tutores atuam por ele.
- Um tutor que também é Admin usa a relação `TUTOR_OF` (não a de Admin).
- Um adulto com conta que é dependente (N3) é tratado como qualquer dependente com conta: os tutores têm `TUTOR_OF` e o próprio tem `DEPENDENT_SELF` (acesso limitado, N2). Como se marcou dependente por vontade própria (Q7), pode deixar de o ser a qualquer momento (`PUT .../dependent` com `isDependent=false`), recuperando `SELF` completo.
- `DEPENDENT_SELF` aplica-se a **qualquer idade**: o que o define é ser dependente, não ser menor.
- `Recommendation` (ADR-023) **não** é categoria nova: herda a da origem — consulta ⇒ `APPOINTMENTS`, exame ⇒ `EXAMS`. Leitura: SELF/TUTOR_OF; `DEPENDENT_SELF` só as de consulta (N2); `OTHER` só com `SharingGrant` da categoria da origem. Nunca escrita por utilizadores de família (só a clínica cria). Listas filtram, não anulam (§5.3). Documentos emitidos pela clínica seguem `EXAMS` (BR-DOC-04/BR-CLN-08).
- `InsurancePolicy`/`ReimbursementClaim` (ADR-021) **não** são uma categoria desta matriz: não têm
  `SharingGrant`, logo não há acesso de `OTHER` nesta versão. Só `SELF`/`TUTOR_OF` leem/criam/editam
  (mesma regra de leitura/escrita que as restantes categorias para estas duas relações); `OTHER` e
  `DEPENDENT_SELF` nunca veem nem criam. Se o proprietário pedir partilha com `OTHER`, é uma categoria
  nova por change control (ver ADR-021, "porquê opt-in por documento").

## 4. Ações estruturais

| Ação | Quem |
|---|---|
| Criar família | Qualquer User ativo. |
| Ver família/membros | FAM_MEMBER (dependente com conta só vê nomes, P5). |
| Alterar nome, convidar, criar perfil sem conta, definir papéis, remover membro, eliminar família | FAMILY_ADMIN (eliminar: só se único membro). |
| Atribuir/remover tutor, tutor principal, marcar dependente | FAMILY_ADMIN para menores e adultos sem conta; **o próprio** para adulto com conta. |
| Criar convite de conta de dependente | Tutor do dependente. |
| Revogar convite | FAMILY_ADMIN; tutor se for convite do seu dependente. |
| Definir partilha | SELF (adulto) ou tutor (dependente). |
| Sair da família | Adulto com conta; menor/dependente com conta ⇒ via tutor/Admin. |
| Exportar dados | SELF; tutor pelo dependente. |
| Pedir "Resumo com IA" (tendências) | SELF; tutor pelo dependente — mesma relação de "Exportar dados"; exige consentimento explícito próprio (BR-RPT-05, ADR-022), além da autorização. |
| Clínicas privadas | Criar: adulto da família; editar/arquivar/eliminar: criador ou FAMILY_ADMIN. |
| Criar clínica parceira, ver/suspender a clínica | PLATFORM_ADMIN. |
| Contas do portal da clínica (`CLINIC_ADMIN`/`CLINIC_MANAGER`) | Fora de `AccessPolicy` — ver §6 (ADR-020). |
| Marcar exame num horário de clínica parceira (nasce `SCHEDULED` se houver vaga) | WRITE(EXAMS): SELF ou TUTOR_OF (UC-EXM-08, BR-APT-11). |
| Ler recomendações | READ da categoria da origem (APPOINTMENTS/EXAMS), ver §3. |
| Pesquisar/ver utilizador, repor acesso, listar/suspender contas de clínica, gerir seguradoras | PLATFORM_ADMIN — ver §7 (nunca dados de saúde). |
| Criar/ver apólice (`InsurancePolicy`), criar/submeter pedido de reembolso (`ReimbursementClaim`) | SELF (adulto) ou TUTOR_OF (dependente); ADR-021. |
| Criar seguradora parceira, ver/suspender a seguradora | PLATFORM_ADMIN. |
| Contas do portal da seguradora (`INSURANCE_ADMIN`/`INSURANCE_AGENT`) | Fora de `AccessPolicy` — ver §8 (ADR-021). |

## 5. Regras de implementação
1. **Toda** a rota de negócio chama `AccessPolicy` no application service; um guard global *verifica* (em testes e em runtime de desenvolvimento) que a policy foi invocada — uma rota sem decisão registada falha.
2. Repositórios recebem `familyId` obrigatório; não existe método "buscar por id" sem família.
3. As respostas de relatório e listas **filtram** por permissão (omitir, não anular).
4. A decisão de visibilidade ao listar (ex.: família) é calculada **uma vez** por pedido e reutilizada (evita N+1 e inconsistências).
5. Mensagens de negação não revelam o motivo detalhado.

## 6. Portal da clínica (`ClinicAccount`, D17/D18, ADR-020)

### 6.1 Algoritmo (rotas `/clinic-portal/*`, independente de §1–5)
1. **Conta**: `ClinicAccount.status ≠ ACTIVE` ⇒ DENY (`ACCOUNT_SUSPENDED`).
2. **Clínica do caminho**: `clinicAccount.clinicId` tem de coincidir com o `clinicId` do recurso (horário, pedido, consulta); senão ⇒ `NOT_FOUND` (404, sem enumeração — mesma regra de `errors.md` §2 para User).
3. **Papel**: decidir por ação segundo a matriz §6.2.
4. Registar auditoria (ações sensíveis e negações), com `actor_type` próprio do portal da clínica (não `USER`/`SYSTEM`/`PLATFORM_ADMIN`).

### 6.2 Matriz de permissões `CLINIC_ADMIN` vs `CLINIC_MANAGER`
| Ação | `CLINIC_ADMIN` | `CLINIC_MANAGER` |
|---|---|---|
| Login/refresh/logout no portal da própria clínica | sim | sim |
| Criar/listar/remover contas `CLINIC_MANAGER` da própria clínica (BR-CLN-05) | sim | não |
| Publicar/remover horários (`ClinicSlot`, BR-CLN-04) | sim | sim |
| Ver pedidos/agenda da própria clínica (mínimo necessário, BR-CLN-03) | sim | sim |
| Confirmar/recusar pedido (`REQUESTED → SCHEDULED\|REJECTED`) | sim | sim |
| Cancelar consulta confirmada, com motivo | sim | sim |
| Completar consulta: registar resultado e emitir receita (BR-CLN-06, BR-RX-07) | sim | sim |
| Publicar/remover horários `kind=EXAM` e alterar a `capacity` (BR-CLN-07, BR-APT-10/11) | sim | sim |
| Ver agenda e ocupação por horário de **exames** da própria clínica (mínimo, BR-CLN-03); não há pedidos de exame por confirmar (ADR-023 revisto) | sim | sim |
| Cancelar marcação de exame `SCHEDULED` futura, com motivo (liberta a vaga) | sim | sim |
| Completar exame: carregar PDF (só metadados de volta, nunca download) e registar resultados (BR-CLN-08) | sim | sim |
| Pesquisar utilizador por e-mail exato (só `displayName`) e marcar consulta presencial `SCHEDULED` num horário `APPOINTMENT` livre da própria clínica (BR-CLN-10, ADR-024); sujeito ao rate limit de BR-CLN-10 | sim | sim |
| Criar e listar recomendações sobre consulta/exame da própria clínica (BR-CLN-09); **nunca** editar/eliminar | sim | sim |
| Ler profissionais, tipos de serviço, regras de horário e bloqueios da própria clínica (M14 a1/a2, BR-CLN-11..14) | sim | sim |
| Criar/editar/**desativar** profissionais e tipos de serviço (sem DELETE, BR-CLN-11/12) | sim | sim |
| Criar/editar/desativar/regenerar regras de horário (geram `ClinicSlot`) e criar/remover bloqueios/férias (BR-CLN-12..15) | sim | sim |
| Publicar horário manual com `professionalId`/`serviceTypeId` do catálogo (BR-CLN-13/14); remover horário gerado por regra individualmente | sim / **não** (`CONFLICT`) | sim / **não** (`CONFLICT`) |
| Criar/editar/listar/pesquisar **pacientes da clínica** e ver a ficha (consultas, exames, recomendações da própria clínica; M14 P, BR-CLN-17/22) | sim | sim |
| Pesquisa global do portal e calendário por profissional da própria clínica (BR-CLN-22/23); sujeitos a rate limit | sim | sim |
| Marcar presencial com `clinicPatientId` (paciente da clínica, ligado ou manual) e cancelar/completar a **visita manual** (BR-CLN-18) | sim | sim |
| Ligar um paciente Vita com o código/QR do paciente (`POST /patients/link`, BR-CLN-20); rate limit partilhado com BR-CLN-10 | sim | sim |
| Ler o **histórico partilhado** (medicação e exames) de um paciente ligado, só com consentimento `HISTORY` válido; leitura auditada (BR-CLN-21) | sim | sim |
| Ver/gerir horários, pedidos, agenda, exames, documentos, recomendações, profissionais, serviços, regras, bloqueios, pacientes, ficha, calendário ou histórico partilhado de **outra** clínica | não (`NOT_FOUND`) | não (`NOT_FOUND`) |

> **M14 (P):** pacientes, pesquisa, calendário, ligação e histórico partilhado têm as mesmas permissões para `CLINIC_ADMIN` e `CLINIC_MANAGER` (a diferenciação de receção vs. médico, "receção não vê notas clínicas", é a fase (f), ADR-026). O portal **nunca** recebe `userId`/`familyId`/`memberId`; `clinic_patient_links` é resolvida só no servidor. O histórico partilhado é a **única** leitura de dados de saúde Vita pelo portal para além de BR-CLN-06/08/09, só com consentimento válido, e é lido por **portas** dos módulos de saúde (não por `AccessPolicy`: o consentimento `ClinicConsent` é o critério, avaliado a cada pedido).

> **M14 (a1/a2):** nestas fases `CLINIC_ADMIN` e `CLINIC_MANAGER` têm as mesmas permissões sobre catálogo, regras e bloqueios (decisão do proprietário); a diferenciação por papel (`CLINIC_DOCTOR`, só o seu calendário) é a fase (f). O catálogo e as regras são dados da clínica e não contêm dados Vita/saúde. O job `clinics.generate-schedule` corre como `SYSTEM`, sem conta de clínica, e só escreve `clinic_slots` por regras ativas.

Não há ação do portal que leia dados fora do mínimo de BR-CLN-03 (**exceto** o histórico partilhado por consentimento, BR-CLN-21) (nome do paciente, especialidade,
profissional, data/hora, observações do pedido); nunca condições, alergias, medicação prévia,
histórico de outras consultas, nem dados de família/tutela. A exceção de BR-CLN-06 (registar
resultado/receita) só se aplica à consulta `SCHEDULED` que a própria clínica está a atender; a de BR-CLN-08 (resultados/PDF) só ao exame `SCHEDULED` da própria clínica; a de BR-CLN-09 (recomendação) só a consulta/exame da própria clínica em `SCHEDULED`/`COMPLETED`. Exceção D20 (BR-CLN-10): a pesquisa por e-mail devolve só `displayName`; a marcação re-resolve o e-mail no servidor e o portal nunca recebe `userId`/`familyId`/`memberId`. O portal **nunca** lê resultados, documentos ou recomendações do paciente além do que a própria clínica escreveu.

### 6.3 Hierarquia de contas (BR-CLN-05) — quem administra quem
| Ação | Quem |
|---|---|
| Ver/suspender a clínica (inteira) | PLATFORM_ADMIN |
| Criar/repor a conta `CLINIC_ADMIN` raiz de uma clínica parceira | PLATFORM_ADMIN (`POST /admin/clinics/{id}/root-account`) |
| Criar/listar/remover contas `CLINIC_MANAGER` da própria clínica | `CLINIC_ADMIN` da clínica (self-service, nunca o Platform Admin diretamente) |
| **Listar** as contas do portal de uma clínica; **suspender/reativar** cada uma (revoga `clinic_sessions`) — ADR-023, BR-ADM-03/04 | PLATFORM_ADMIN (`GET /admin/clinics/{id}/accounts`, `POST .../accounts/{accountId}/suspend\|reactivate`); não cria nem remove |

### 6.4 Consentimento e ligação a clínicas — lado família (M14 P, ADR-026)
| Ação (rotas `/families/{f}/members/{m}/clinic-consents*` e `clinic-link-codes`) | `SELF` (adulto) | `TUTOR_OF` | `DEPENDENT_SELF` | `OTHER` / Family Admin como OTHER |
|---|---|---|---|---|
| Listar "quem vê o quê" | sim (do próprio) | sim (do dependente) | não (`FORBIDDEN`) | não (`FORBIDDEN`) |
| Conceder/alterar/renovar nível (`PUT`) | sim | sim | não | não |
| Revogar (`DELETE`) | sim | sim | não | não |
| Gerar código/QR de ligação (`POST`) | sim | sim | não | não |

Sem categoria de partilha nova nem `SharingGrant` (como `InsurancePolicy`, §3): só `SELF`/`TUTOR_OF` (N2: o dependente com conta não consente sozinho). Utilizador sem acesso ao membro ou família: `NOT_FOUND`. Um tutor que também é Admin usa `TUTOR_OF`. Mantém-se a regra de ADR-026: o consentimento é por clínica **parceira ativa**; revogar é sempre possível, mesmo com a clínica suspensa ou arquivada.

## 7. Administração da plataforma (`PLATFORM_ADMIN`, ADR-023)

Segue §2.2: só ações `ADMIN_*`; **nunca** dados de saúde (BR-PRV-07, BR-ADM-01); `admin` não importa módulos de saúde.
| Ação | Quem | Notas |
|---|---|---|
| Listar/pesquisar utilizadores (`q`, `status`) e ver detalhe operacional | PLATFORM_ADMIN | Sem famílias/membros/saúde (BR-ADM-01). |
| Suspender/reativar utilizador | PLATFORM_ADMIN | BR-ACC-05. |
| Repor acesso de utilizador (`reset-access`) | PLATFORM_ADMIN | Revoga sessões + e-mail de recuperação; nunca vê palavra-passe/token; não a si próprio (BR-ADM-02). |
| Listar contas de clínica; suspender/reativar | PLATFORM_ADMIN | BR-ADM-03/04; `CLINIC_ADMIN` só reativável se não houver outro ativo. |
| Seguradoras: listar, criar, editar, suspender/reativar; conta raiz | PLATFORM_ADMIN | BR-ADM-05/06; sem eliminação. |
Um token de `ClinicAccount`/`InsuranceAccount` nunca autoriza rotas `/admin/*`.

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

| Recurso | `INSURANCE_ADMIN` | `BENEFICIARY_MANAGER` | `AUTHORIZATION_ANALYST` | `CLAIMS_MANAGER` | `FINANCE_MANAGER` |
|---|---|---|---|---|---|
| Contas/papéis da seguradora | ✓ | — | — | — | — |
| Empresas, beneficiários, apólices, importações, ligações paciente↔beneficiário | ✓ | ✓ | R | R | R |
| Planos, coberturas e lista de serviços | ✓ | R | R | R | R |
| Rede de prestadores | ✓ | R | R | R | R (✓ nos preços: fase 2) |
| Pedidos de autorização | R | — | ✓ | R | R |
| Despesas (`ExpenseClaim`) | R | — | R | ✓ | R |
| Pagamentos (fase 2) | R | — | — | R | ✓ |
| Dashboard | ✓ (completo) | parcial: beneficiários/apólices | parcial: autorizações | parcial: despesas | ✓ (completo) |
| Auditoria da seguradora (`GET .../audit`) | ✓ | — | — | — | — |
| Pedidos de reembolso (`ReimbursementClaim`) | ✓ (como §8.2) | — | — | — | — |

Notas: (a) o `INSURANCE_ADMIN` tem **R** (não ✓) nas autorizações e despesas: administra, não decide (separação de funções); (b) "parcial" no dashboard = só os indicadores do seu domínio (`dashboard.md`/spec §9), sem dados nominais de saúde; (c) uma conta tem exatamente um papel; (d) `INSURANCE_ADMIN` continua único e ativo por seguradora (BR-INS-06).

### 8.3 Hierarquia de contas (ADR-021, mirror de §6.3) — quem administra quem
| Ação | Quem |
|---|---|
| Ver/editar/suspender a seguradora (inteira) | PLATFORM_ADMIN |
| Criar/repor a conta `INSURANCE_ADMIN` raiz de uma seguradora parceira | PLATFORM_ADMIN |
| Criar/listar/remover contas `INSURANCE_AGENT` da própria seguradora | `INSURANCE_ADMIN` da seguradora (self-service, nunca o Platform Admin diretamente) |
| Criar/listar/remover contas `BENEFICIARY_MANAGER`, `AUTHORIZATION_ANALYST`, `CLAIMS_MANAGER`, `FINANCE_MANAGER` da própria seguradora (ADR-025) | `INSURANCE_ADMIN` (self-service; só com módulo operacional ativo) |
| Ativar/desativar o módulo operacional e definir a moeda (`currency`) de uma seguradora (ADR-025) | PLATFORM_ADMIN |

### 8.4 Clínica a operar sobre uma seguradora (ADR-025)
Rotas `/clinic-portal/insurers/{insurerId}/*` continuam no algoritmo de §6 (ator `ClinicAccount`, fora de `AccessPolicy`) com um passo extra: **(a)** conta ativa; **(b)** existe `insurer_providers` ativo com `clinic_id` = `clinicId` do token e `insurer_id` = `insurerId` do caminho, e a seguradora tem módulo operacional ativo; senão `NOT_FOUND` (sem enumeração); **(c)** `CLINIC_ADMIN` e `CLINIC_MANAGER` têm as mesmas permissões (Q6).
| Ação | `CLINIC_ADMIN` | `CLINIC_MANAGER` |
|---|---|---|
| Listar seguradoras a que a clínica está ligada | sim | sim |
| Validar elegibilidade (nº de cartão, QR ou identificação; resposta mínima, BR-SEG-18) | sim | sim |
| Registar atendimento (serviço da lista da seguradora; sem diagnóstico) | sim | sim |
| Pedir autorização; responder a `INFO_REQUESTED`; cancelar a própria autorização pendente | sim | sim |
| Submeter despesa; corrigir despesa `RETURNED`; ver estados e valores | sim | sim |
| Ver dados de outra seguradora, de beneficiários fora da validação feita, ou histórico clínico | não (`NOT_FOUND`/`FORBIDDEN`) | não |

### 8.5 Paciente/titular (app) (ADR-025)
Rotas `/families/{f}/members/{m}/insurance/*` (cartão digital, saldo, autorizações, despesas, reclamar cartão): **SELF** (adulto) ou **TUTOR_OF**, mesma regra de `BR-INS-02` — **sem** categoria de partilha nova e sem acesso de `OTHER`. Só com ligação confirmada ao `Beneficiary` (BR-SEG-20); o paciente vê apenas os valores comparticipados e o saldo, nunca dados internos de análise (notas do analista além do motivo da decisão). O módulo `insurer-ops` consulta `AccessPolicy.can()` para este ator; as rotas `/insurance-portal/*` e `/clinic-portal/*` nunca a usam.

## 9. Testes
Os testes de autorização são **gerados a partir da matriz** acima (incl. §7: `TC-AZ-ADM-*`): para cada (relação × categoria × ação) um caso positivo ou negativo (Fase 15, `TC-AZ-*`). Adicionar uma categoria ou ação sem atualizar a matriz faz falhar a CI. As matrizes §6.2 (clínica), §8.2/§8.2b (seguradora) e §8.4 (clínica sobre seguradora) seguem a mesma regra: geradas a partir da tabela, com casos próprios `TC-AZ-CLN-*`/`TC-AZ-INS-*` (e `TC-AZ-SEG-*` para §8.2b/§8.4/§8.5, incluindo isolamento entre seguradoras).
