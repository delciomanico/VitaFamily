# Vita Family — Autorização (Fase 14)

> Estado: **v1.0 (R7 do arquivo do marco B, 2026-11-16, ADR-037: retirados os atores/ações/matrizes de seguradora — §8 e referências —, `MANAGE_INSURANCE`, `SUPERVISOR` e a vista de cobertura; versões ≤ v0.11 em `_arquivo/marco-b/extratos/authorization-seguradora.md` e no git)**.

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
verificação própria e mais simples (§6) — nunca pelo `AccessPolicy` de família. 
As duas árvores de rotas nunca partilham contexto de pedido entre si. Um `ClinicAccount` **nunca** aparece como `actor` desta secção (não têm `userId`, não têm pertença de
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
- `Process` (ADR-032, marco B fatia 1) **não** é categoria nova: herda a da origem — consulta ⇒ `APPOINTMENTS`, exame ⇒ `EXAMS` — como `Recommendation`. Só leitura (não há escrita de utilizadores). Detalhe em §6.8.

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
| Ler processos de um membro (lista/detalhe, marco B fatia 1) | READ da categoria da origem de cada processo (APPOINTMENTS/EXAMS), ver §6.8. Sem ações de escrita. |
| Responder ao pedido de confirmação de uma consulta ("Vou" / "Não posso", `PUT …/appointments/{id}/confirmation`; M14 Q, BR-CLN-26) | WRITE(APPOINTMENTS): a mesma permissão de `setAppointmentStatus` (SELF, TUTOR_OF; `DEPENDENT_SELF` com conta, FR-ALR-08); `OTHER` ⇒ `FORBIDDEN`. Sem categoria nova. Ler `confirmationStatus`/`followUpDueOn`: READ(APPOINTMENTS). |
| Abrir/continuar, ler, enviar, marcar como lida, fechar/reabrir e denunciar numa conversa com um profissional (`/families/{f}/members/{m}/conversations*`; MK2, BR-MKT-38) | Ação nova `MESSAGE_PROFESSIONALS`: `SELF` (adulto) ou `TUTOR_OF` do membro-sujeito; `DEPENDENT_SELF`/`OTHER` ⇒ `FORBIDDEN` — ver §11.2. Sem categoria de dados nem `SharingGrant`. |
| Marcar, ver, cancelar marcações, carregar/descarregar/disputar comprovativos, avaliar (`/families/{f}/members/{m}/bookings*`; MK3, BR-MKT-50) | Ação nova `BOOK_PROFESSIONALS`: `SELF` (adulto) ou `TUTOR_OF` do membro-sujeito; `DEPENDENT_SELF`/`OTHER` ⇒ `FORBIDDEN` — ver §12.1. Sem categoria de dados nem `SharingGrant`. A consulta gerada e o `Process` `BOOKING` leem-se pelas regras existentes (APPOINTMENTS, §3). |
| Ver opções, criar, listar, ver, ver as vistas e revogar partilhas de registos com um profissional (`/families/{f}/members/{m}/record-shares*`; MK4, BR-MKT-67) | Ação nova `SHARE_WITH_PROFESSIONALS`: `SELF` (adulto) ou `TUTOR_OF` do membro-sujeito; `DEPENDENT_SELF`/`OTHER` ⇒ `FORBIDDEN` — ver §13.1. Sem categoria de dados nem `SharingGrant` (a partilha **não** é um `SharingGrant`: o destinatário é um profissional, fora da família). |
| Horários livres e avaliações públicas de um profissional (`/marketplace/professionals/{id}/slots`, `…/reviews`; MK3) | Qualquer User autenticado (`AUTH`), sem família nem `AccessPolicy` — ver §12.4. |
| Pesquisar, ver perfil, comparar profissionais (`/marketplace/*`; MK2) | Qualquer User autenticado (`AUTH`), sem família nem `AccessPolicy` — ver §11.1. |
| Pesquisar/ver utilizador, repor acesso, listar/suspender contas de clínica | PLATFORM_ADMIN — ver §7 (nunca dados de saúde). |

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

### 6.2 Matriz de permissões `CLINIC_ADMIN` vs `CLINIC_MANAGER` (o `CLINIC_DOCTOR` e a matriz endpoint a endpoint estão em §6.2b)
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
| Marcar "confirmado por telefone", "Chegou", "Iniciar" e "Faltou" numa consulta ou visita da própria clínica (`PUT /agenda/{id}/confirm\|arrive\|start\|no-show`; M14 Q, BR-CLN-27/28) | sim | sim |
| Propor/limpar retorno numa marcação concluída e listar retornos por tratar (`PUT\|DELETE /agenda/{id}/follow-up`, `GET /follow-ups`; BR-CLN-30) | sim | sim |
| Ver indicadores da própria clínica (`GET /reports/summary`; só contagens, BR-CLN-29); rate limit 30/min por conta | sim | sim |
| Ver/gerir horários, pedidos, agenda, exames, documentos, recomendações, profissionais, serviços, regras, bloqueios, pacientes, ficha, calendário, histórico partilhado, retornos ou indicadores de **outra** clínica | não (`NOT_FOUND`) | não (`NOT_FOUND`) |

> **M14 (Q):** confirmação por telefone, fluxo do dia, retorno e indicadores têm as mesmas permissões para `CLINIC_ADMIN` e `CLINIC_MANAGER` (a limitação de Relatórios/Financeiro e a de "Médico só os seus" ficou definida em M14 R, §6.2b). O portal só lê **contagens** nos indicadores e o **nome/telefone do registo da clínica** nos retornos; nunca ids Vita. A resposta "Vou / Não posso" é a **única** escrita do paciente sobre uma consulta de clínica parceira que altera o estado da consulta além de `setAppointmentStatus`; a clínica nunca escreve `DECLINED`.

> **M14 (P):** pacientes, pesquisa, calendário, ligação e histórico partilhado têm as mesmas permissões para `CLINIC_ADMIN` e `CLINIC_MANAGER` (a diferenciação receção vs. médico é a de §6.2b; "receção não vê notas clínicas" ficou sem efeito, BR-CLN-39/OP-40). O portal **nunca** recebe `userId`/`familyId`/`memberId`; `clinic_patient_links` é resolvida só no servidor. O histórico partilhado é a **única** leitura de dados de saúde Vita pelo portal para além de BR-CLN-06/08/09, só com consentimento válido, e é lido por **portas** dos módulos de saúde (não por `AccessPolicy`: o consentimento `ClinicConsent` é o critério, avaliado a cada pedido).

> **M14 (a1/a2):** nestas fases `CLINIC_ADMIN` e `CLINIC_MANAGER` têm as mesmas permissões sobre catálogo, regras e bloqueios (decisão do proprietário); a diferenciação por papel (`CLINIC_DOCTOR`, só o seu calendário) é a fase (f). O catálogo e as regras são dados da clínica e não contêm dados Vita/saúde. O job `clinics.generate-schedule` corre como `SYSTEM`, sem conta de clínica, e só escreve `clinic_slots` por regras ativas.

Não há ação do portal que leia dados fora do mínimo de BR-CLN-03 (**exceto** o histórico partilhado por consentimento, BR-CLN-21) (nome do paciente, especialidade,
profissional, data/hora, observações do pedido); nunca condições, alergias, medicação prévia,
histórico de outras consultas, nem dados de família/tutela. A exceção de BR-CLN-06 (registar
resultado/receita) só se aplica à consulta `SCHEDULED` que a própria clínica está a atender; a de BR-CLN-08 (resultados/PDF) só ao exame `SCHEDULED` da própria clínica; a de BR-CLN-09 (recomendação) só a consulta/exame da própria clínica em `SCHEDULED`/`COMPLETED`. Exceção D20 (BR-CLN-10): a pesquisa por e-mail devolve só `displayName`; a marcação re-resolve o e-mail no servidor e o portal nunca recebe `userId`/`familyId`/`memberId`. O portal **nunca** lê resultados, documentos ou recomendações do paciente além do que a própria clínica escreveu.

### 6.2b Matriz por papel de todas as rotas `/clinic-portal/*` (M14 R, BR-CLN-39) — `CLINIC_ADMIN` · `CLINIC_MANAGER` (receção) · `CLINIC_DOCTOR` (Médico)
Legenda: **sim** · **não** = `FORBIDDEN` (papel insuficiente; não revela mais nada) · **suas** = só marcações cujo `clinic_slots.professional_id` é o `professionalId` da conta e pacientes com (ou que tiveram) marcação com ele; fora disso `NOT_FOUND`. Isolamento por clínica (§6.1) aplica-se sempre primeiro. O servidor decide por **papel + filtro**; esconder no UI não é segurança.
| Rotas | Admin | Gestor | Médico |
|---|---|---|---|
| `auth/login`, `auth/refresh`, `auth/logout` | sim | sim | sim |
| `staff` (`GET`/`POST`/`DELETE`; criar Gestor ou Médico) | sim | não | não |
| `profile` `GET` · `PATCH` | sim · sim | sim · **não** | não · não |
| `audit` `GET` | sim | não | não |
| `receipts` (`GET` lista/total, `GET /{id}`, `POST`, `POST /{id}/void`) | sim | sim | **não** |
| `reports/summary` | sim | sim | não |
| `slots` (`GET`/`POST`/`PATCH`/`DELETE`), `professionals*`, `services*`, `schedule-rules*`, `time-off*` | sim | sim | não |
| `requests` (listar, confirmar/recusar) | sim | sim | não |
| `agenda` `GET` | sim | sim | suas |
| `agenda/{id}/cancel`, `confirm`, `arrive`, `no-show` | sim | sim | não |
| `agenda/{id}/start`, `complete` (consulta ou visita; resultado, receita, BR-CLN-06) | sim | sim | suas |
| `agenda/{id}/follow-up` (`PUT`/`DELETE`), `follow-ups` `GET` | sim | sim | suas |
| `agenda/{id}/report` `GET`, `agenda/{id}/report/pdf` `GET` (relatório da consulta, M15 S, BR-CLN-44) | sim (lê) | sim (lê) | suas |
| `agenda/{id}/report` `PUT` (rascunho), `report/finalize` `PUT`, `report/addenda` `POST`; e `report` no corpo de `agenda/{id}/complete` | **não** | **não** | suas (**só o Médico escreve**) |
| `agenda/{id}/exam-orders` `GET` e `agenda/{id}/exam-orders/pdf` `GET` (pedido de exame, M15 U, BR-CLN-51/54) | sim (lê/imprime) | sim (lê/imprime) | suas |
| `agenda/{id}/exam-orders` `POST`, `agenda/{id}/exam-orders/{orderId}/cancel` `PUT`; e `examOrders` no corpo de `agenda/{id}/complete` | **não** | **não** | suas (**só o Médico escreve**) |
| `exam-service-types` `GET` (serviços de exame **ativos** da própria clínica; só `id`/`name`/`durationMinutes`, sem preços; escolha ao criar pedido de exame, M15 U, BR-CLN-51) | sim | sim | sim |
| `agenda/{id}/attendance-statement/pdf` `GET` (declaração de presença, M15 V, BR-CLN-55) | sim | sim | suas |
| `calendar` | sim | sim | só a sua coluna (`professionalId` de outro ⇒ `NOT_FOUND`) |
| `exam-agenda` `GET`, `complete`, `documents` (upload/remover) | sim | sim | suas |
| `exam-agenda/{id}/results-draft` (`GET`/`PUT`/`DELETE`) e `exam-agenda/{id}/report/pdf` `GET` (laudo, M15 T, BR-CLN-47..49) | sim | sim | suas |
| `exam-agenda/{id}/cancel` | sim | sim | não |
| `processes/{id}` `GET` (processo do atendimento da própria clínica, marco B fatia 1, BR-PRC-06) | sim | sim | **não** (`FORBIDDEN`) |
| `recommendations` (`GET`/`POST`) | sim | sim | suas |
| `patients` `GET` (lista/`q`) e `GET /{id}`, `record`, `shared-history` | sim | sim | suas |
| `patients` `POST`/`PATCH`, `patients/link` | sim | sim | não |
| `patient-lookup`, `walk-in-appointments`, `search` | sim | sim | não |
Notas: (1) o Médico nunca recebe `receiptId`/preços de recibos nem a lista de contas; (2) as `notes` do `ClinicPatient` são administrativas e visíveis aos três (BR-CLN-39); (3) (4) a regra "uma conta Médico por profissional" e a criação de contas são exclusivas do Admin; (5) o token de Médico traz `professionalId`; um token sem ele num papel Médico é inválido (`UNAUTHENTICATED`). (6) **Relatório da consulta (M15 S, ADR-027):** o Médico é o **único** que escreve (rascunho, finalizar, adenda, `report` em `complete`), só nas marcações cujo `clinic_slots.professional_id` é o seu; Admin e Gestor **leem** (relatório e PDF) mas **não escrevem** — uma escrita ou um `complete` com `report` por Admin/Gestor responde `FORBIDDEN` **sem efeito parcial**; marcação sem horário/profissional ⇒ `NOT_FOUND` para o Médico. Recomendação adotada: separar autoria clínica (assinatura textual, só o profissional) de leitura/impressão (receção); alargar a escrita ao Gestor é change control (OP-45). O rascunho/laudo do **exame** mantêm as permissões de `complete` de exame (Admin, Gestor, Médico suas): é entrada de valores, não autoria clínica. Testes gerados a partir desta matriz: `TC-AZ-CLN-V5` e, para M15, `TC-AZ-CLN-V6`. (7) **Pedido de exame e declaração (M15 U/V, ADR-028):** o Médico é o **único** que cria e cancela pedidos de exame (e `examOrders` em `complete`), só nas marcações do seu profissional; Admin e Gestor **leem e imprimem** o pedido e **não** criam nem cancelam (`FORBIDDEN`, sem efeito parcial); a **declaração de presença** é emitida pelos três papéis (Médico: suas) e não tem equivalente na família. Linhas a acrescentar à matriz em código (`CLINIC_PORTAL_ACCESS`, com `:appointmentId`/`:orderId`): `GET /clinic-portal/agenda/:appointmentId/exam-orders` e `…/exam-orders/pdf` e `…/attendance-statement/pdf` (`yes`,`yes`,`own`); `POST …/exam-orders` e `PUT …/exam-orders/:orderId/cancel` (`no`,`no`,`own`). Teste `TC-AZ-CLN-V7`.

### 6.3 Hierarquia de contas (BR-CLN-05) — quem administra quem
| Ação | Quem |
|---|---|
| Ver/suspender a clínica (inteira) | PLATFORM_ADMIN |
| Criar/repor a conta `CLINIC_ADMIN` raiz de uma clínica parceira | PLATFORM_ADMIN (`POST /admin/clinics/{id}/root-account`) |
| Criar/listar/remover contas `CLINIC_MANAGER` **e `CLINIC_DOCTOR`** (M14 R) da própria clínica | `CLINIC_ADMIN` da clínica (self-service, nunca o Platform Admin diretamente) |
| **Listar** as contas do portal de uma clínica; **suspender/reativar** cada uma (revoga `clinic_sessions`) — ADR-023, BR-ADM-03/04 | PLATFORM_ADMIN (`GET /admin/clinics/{id}/accounts`, `POST .../accounts/{accountId}/suspend\|reactivate`); não cria nem remove |

### 6.4 Consentimento e ligação a clínicas — lado família (M14 P, ADR-026)
| Ação (rotas `/families/{f}/members/{m}/clinic-consents*` e `clinic-link-codes`) | `SELF` (adulto) | `TUTOR_OF` | `DEPENDENT_SELF` | `OTHER` / Family Admin como OTHER |
|---|---|---|---|---|
| Listar "quem vê o quê" | sim (do próprio) | sim (do dependente) | não (`FORBIDDEN`) | não (`FORBIDDEN`) |
| Conceder/alterar/renovar nível (`PUT`) | sim | sim | não | não |
| Revogar (`DELETE`) | sim | sim | não | não |
| Gerar código/QR de ligação (`POST`) | sim | sim | não | não |

Sem categoria de partilha nova nem `SharingGrant` (como as restantes ligações da família, §3): só `SELF`/`TUTOR_OF` (N2: o dependente com conta não consente sozinho). Utilizador sem acesso ao membro ou família: `NOT_FOUND`. Um tutor que também é Admin usa `TUTOR_OF`. Mantém-se a regra de ADR-026: o consentimento é por clínica **parceira ativa**; revogar é sempre possível, mesmo com a clínica suspensa ou arquivada.

### 6.5 Recibos da clínica — lado família (M14 R, ADR-026)
| Ação (rotas `/families/{f}/members/{m}/clinic-receipts*`) | `SELF` (adulto) | `TUTOR_OF` | `DEPENDENT_SELF` | `OTHER` / Family Admin como OTHER |
|---|---|---|---|---|
| Listar e ver recibos recebidos (`GET`) | sim (do próprio) | sim (do dependente) | não (`FORBIDDEN`) | não (`FORBIDDEN`) |
Sem categoria de partilha nem `SharingGrant` (§3): documento financeiro, só `SELF`/`TUTOR_OF`. Recibo sem `clinic_receipt_links` para o membro (ou de outra família) ⇒ `NOT_FOUND`. A clínica nunca vê nem altera estas ligações.


### 6.6 Relatório da consulta — lado família (M15 S, ADR-027)
| Ação (rotas `/families/{f}/members/{m}/appointments/{id}/report` e `…/report/pdf`) | `SELF` (adulto) | `TUTOR_OF` | `DEPENDENT_SELF` | `OTHER` / Family Admin como OTHER |
|---|---|---|---|---|
| Ler o relatório e descarregar o PDF (só `FINAL`, partilhado, consulta Vita) | sim (do próprio; leitura JSON não auditada, **PDF auditado**) | sim (do dependente; auditado) | não (`FORBIDDEN`) | não (`FORBIDDEN`), **mesmo com `SharingGrant` de `APPOINTMENTS`** |
Critério: `READ(APPOINTMENTS)` do membro **e** relação `SELF`/`TUTOR_OF` (o relatório contém diagnóstico: mais sensível que a marcação e que a `Recommendation`, que herda `APPOINTMENTS` e é legível por `DEPENDENT_SELF`/`OTHER` com partilha, §3). **Não** depende de `ClinicConsent` (BR-CLN-45). **Implementação (decidida 2026-11-08):** o módulo `clinic-reports` não importa `access`; autoriza a leitura pela família através da porta `PatientAccess` (definida na sua `application`, implementada no composition root sobre `access`) que avalia a **nova ação de `access` `VIEW_CONSULTATION_REPORT`**: permitida **só** a `SELF`/`TUTOR_OF` (mesma regra de `VIEW_CLINIC_RECEIPTS`), negada a `DEPENDENT_SELF`/`OTHER` mesmo com `SharingGrant`. Alteração mínima ao módulo `access`: uma ação nova na `AccessPolicy` + teste da matriz; nenhuma outra regra muda. Sem relatório `FINAL` partilhado, visita manual ou consulta de outra família ⇒ `NOT_FOUND`; `Appointment.reportAvailable` é `false` para quem não pode ler (as listas filtram, §5.3). A clínica nunca escreve nem lê por esta via; a conta autora e os ids da clínica não são expostos.
O **laudo de exame gerado** (`Document.generatedBySystem`) segue as regras de documentos de `EXAMS` (§3 nota, BR-DOC-04, BR-CLN-08): lista e download mediado/auditado como o PDF atual; **não** há rota nova.

### 6.7 Pedido de exame (M15 U, ADR-028) — catálogo para o Médico e lado família
> **Catálogo de exames para o Médico (emenda ADR-028, 2026-11-10):** `GET /clinic-portal/exam-service-types` é a **única** leitura do catálogo de serviços permitida ao `CLINIC_DOCTOR`; devolve só serviços `EXAM` ativos da clínica do token com `id`/`name`/`durationMinutes` (nunca preço, moeda, `kind`, `active`). `services*` continua só Admin/Gestor (§6.2b). Leitura sem auditoria; isolamento por `clinic_id` do token.

#### Lado família
| Ação (rota `/families/{f}/members/{m}/exam-orders`; `examOrderId` em `POST …/examinations`) | `SELF` (adulto) | `TUTOR_OF` | `DEPENDENT_SELF` | `OTHER` / Family Admin como OTHER |
|---|---|---|---|---|
| Listar os pedidos de exame de consultas Vita e ligar um exame a um pedido `ORDERED` | sim (do próprio) | sim (do dependente) | não (`FORBIDDEN`) | não (`FORBIDDEN`), **mesmo com `SharingGrant` de `APPOINTMENTS`** |
Critério: `READ(APPOINTMENTS)` do membro **e** relação `SELF`/`TUTOR_OF` (o nome do exame pode sugerir diagnóstico), como §6.6. **Ligar** exige, além disso, `WRITE(EXAMS)` do membro (regra normal de `createExamination`) e que o pedido seja do **mesmo membro** (senão `NOT_FOUND`). **Implementação:** `clinic-reports` não importa `access`; autoriza pela porta `PatientAccess` (a mesma de §6.6) com a nova ação de `access` **`VIEW_EXAM_ORDERS`** (só `SELF`/`TUTOR_OF`, negada a `DEPENDENT_SELF`/`OTHER` mesmo com `SharingGrant`); a ligação ao criar o exame usa a porta `ExamOrderLinker` (definida em `examinations/application`) que chama `VIEW_EXAM_ORDERS` antes de ligar. Alteração mínima a `access`: uma ação nova + teste da matriz. **Não** depende de `ClinicConsent`. `Appointment.examOrderCount` é `0` para quem não pode ler. O alerta `EXAM_ORDER_ADDED` só tem como destinatários `SELF`/`TUTOR_OF`. A clínica nunca lê por esta via, e **não há rota da família para a declaração de presença**.
### 6.8 Processos (marco B, fatia 1, ADR-032) — lado família e portal da clínica
#### Lado família (`GET /families/{f}/members/{m}/processes` e `…/processes/{processId}`)
A decisão é `AccessPolicy.can(READ, categoria da origem)` com a categoria **do processo**: `originType=APPOINTMENT` ⇒ `APPOINTMENTS`; `EXAMINATION` ⇒ `EXAMS`. Calcula-se **uma vez por pedido e categoria** (§5.4).
| Relação do actor com o sujeito | Processo de consulta | Processo de exame |
|---|---|---|
| `SELF` (adulto) | lê | lê |
| `TUTOR_OF` | lê | lê |
| `DEPENDENT_SELF` | lê (N2) | **não** (omitido na lista; `404` no detalhe) |
| `OTHER` / Family Admin como OTHER | só com `SharingGrant` de `APPOINTMENTS` | só com `SharingGrant` de `EXAMS` |
| `PLATFORM_ADMIN` / sem pertença à família | `404` (sem enumeração) | `404` |
Regras: (1) a lista **filtra** (omite), nunca anula; sem nenhuma categoria legível devolve `[]` com `200`. (2) O detalhe de processo inexistente, de outro membro/família **ou de categoria não legível** devolve `404 NOT_FOUND` (não `403`: o `processId` não pode servir para sondar a existência de atos). (3) Membro `BLOCKED` ⇒ `MEMBER_BLOCKED` (§2.7). (4) Leitura por quem **não é o titular** (tutor, `OTHER` com partilha) é auditada `PROCESS_VIEW`; a do próprio titular não (§ audit.md). (5) Sem `CREATE/UPDATE/DELETE` para nenhuma relação (não há rotas). (6) O `processId` devolvido em `Appointment`/`Examination` não dá acesso por si: a rota do processo repete a decisão. **Sem ação nova em `AccessPolicy`** (reutiliza `READ` × categoria); o módulo `processes` depende de `access` só para esta decisão.
Arquivo do marco B (ADR-037): o `Process` não tem cobertura, a ação `MANAGE_INSURANCE` deixou de existir e os alertas `AUTHORIZATION_*` já não são gerados; os processos de origem `AUTHORIZATION` (inertes na BD) nunca são lidos.
#### Portal da clínica (`GET /clinic-portal/processes/{processId}`)
Algoritmo de §6.1: conta ativa ⇒ `processes.clinic_id` = `clinicId` do token, senão `404` (também para processo sem clínica); papel: `CLINIC_ADMIN` e `CLINIC_MANAGER` leem; `CLINIC_DOCTOR` ⇒ `FORBIDDEN` (o filtro "suas" por profissional não existe em `processes`; o Médico obtém o `processId` na sua agenda mas não lê o processo na fatia 1). Resposta mínima (BR-PRC-06): nunca ids Vita, `familyStatus` nem `nextStep`. Token de User nunca é aceite aqui, nem token de clínica nas rotas de família (claims distintas).
Testes gerados desta secção: `TC-AZ-PRC-01..06`.
## 7. Administração da plataforma (`PLATFORM_ADMIN`, ADR-023)

Segue §2.2: só ações `ADMIN_*`; **nunca** dados de saúde (BR-PRV-07, BR-ADM-01); `admin` não importa módulos de saúde.
| Ação | Quem | Notas |
|---|---|---|
| Listar/pesquisar utilizadores (`q`, `status`) e ver detalhe operacional | PLATFORM_ADMIN | Sem famílias/membros/saúde (BR-ADM-01). |
| Suspender/reativar utilizador | PLATFORM_ADMIN | BR-ACC-05. |
| Repor acesso de utilizador (`reset-access`) | PLATFORM_ADMIN | Revoga sessões + e-mail de recuperação; nunca vê palavra-passe/token; não a si próprio (BR-ADM-02). |
| Listar contas de clínica; suspender/reativar | PLATFORM_ADMIN | BR-ADM-03/04; `CLINIC_ADMIN` só reativável se não houver outro ativo. |
| Fila, detalhe e decisões sobre profissionais; descarregar credenciais; gerir o catálogo de especialidades (MK1, §10.3) | PLATFORM_ADMIN | BR-MKT-18/22/27; só identificação profissional; **nunca** dados de saúde nem `paymentInstructions`; ações `ADMIN_PROFESSIONAL_*`/`ADMIN_SPECIALTY_*`. |
Um token de `ClinicAccount` nunca autoriza rotas `/admin/*`.

## 8. Portal da seguradora (ARQUIVADO)

Secção retirada no R7 do arquivo do marco B (ADR-037): o portal da seguradora, as suas matrizes (§8.1–§8.5), o papel `SUPERVISOR` e a ação `MANAGE_INSURANCE` **já não existem** no `main`. Texto verbatim em `_arquivo/marco-b/extratos/authorization-seguradora.md`.

## 9. Testes
Os testes de autorização são **gerados a partir da matriz** acima (incl. §7: `TC-AZ-ADM-*`): para cada (relação × categoria × ação) um caso positivo ou negativo (Fase 15, `TC-AZ-*`). Adicionar uma categoria ou ação sem atualizar a matriz faz falhar a CI. A matriz §6.2 (clínica) segue a mesma regra: gerada a partir da tabela, com casos próprios `TC-AZ-CLN-*`; §6.8 gera `TC-AZ-PRC-*`; §10 (mercado de profissionais, MK1) gera `TC-AZ-MKT-*` (matriz estado × operação e matriz de atores).

## 10. Mercado de profissionais — portal do profissional (`ProfessionalAccount`, MK1, ADR-037)

> Contrato de MK1 (2026-11-16); **nada implementado**. Espaço de identidade **separado** (BR-MKT-13), independente de §1–§5 (`AccessPolicy`) e de §6 (portal da clínica). O ator é `ProfessionalActorInfo` (segundo/terceiro `AsyncLocalStorage`, como `ClinicActorInfo`): **nunca** `AccessPolicy`, que continua a decidir só o lado família. Procedimentos de MK2+ (pesquisa, marcação, partilha) acrescentam secções próprias.

### 10.1 Algoritmo (rotas `/professional-portal/*`)
1. **Token:** só o de `ProfessionalAccount` (claims `professionalAccountId`/`professionalId`/`sid`); tokens de User, de ClinicAccount e do Platform Admin ⇒ `401 UNAUTHENTICATED`; e o de profissional é inválido em todas as outras rotas (claims distintas, segundo `security` por rota, `professionalBearerAuth`).
2. **Conta:** `professional_accounts.status = ACTIVE` (e-mail verificado), senão `EMAIL_NOT_VERIFIED`. O estado de **validação** não bloqueia o login nem é decidido aqui (é a matriz §10.2).
3. **Isolamento:** todo o recurso (credencial, oferta, regra, bloqueio, horário) é procurado **por `professionalId` do token**; de outro profissional ou inexistente ⇒ `NOT_FOUND` (sem enumeração, igual `errors.md` regra 2).
4. **Estado de validação:** a operação tem de estar permitida no estado atual (§10.2), lido da BD **por pedido** (nunca do token), senão `PROFESSIONAL_LOCKED` (ou `INVALID_STATE_TRANSITION` na submissão).
5. **Auditoria** das ações sensíveis e das negações (`ACCESS_DENIED`), com `actor_type = PROFESSIONAL_ACCOUNT` (`audit.md` §3).

### 10.2 Matriz estado de validação × operação do profissional (BR-MKT-23, gerada para `TC-AZ-MKT-02`)
| Operação | DRAFT | PENDING_REVIEW | NEEDS_INFO | APPROVED | REJECTED | SUSPENDED |
|---|---|---|---|---|---|---|
| Ler perfil, estado/motivo, credenciais, ofertas, regras, bloqueios, horários próprios; descarregar as suas credenciais `CLEAN` | sim | sim | sim | sim | sim | sim |
| Alterar `displayName`, especialidades; carregar/remover credenciais | sim | `PROFESSIONAL_LOCKED` | sim | `PROFESSIONAL_LOCKED` | `PROFESSIONAL_LOCKED` | `PROFESSIONAL_LOCKED` |
| Alterar `bio`, `city`, `paymentInstructions` | sim | sim | sim | sim | `PROFESSIONAL_LOCKED` | `PROFESSIONAL_LOCKED` |
| Criar/alterar ofertas, regras de horário, bloqueios | sim | sim | sim | sim | `PROFESSIONAL_LOCKED` | `PROFESSIONAL_LOCKED` |
| Submeter (`POST /submission`) | sim (se BR-MKT-16) | `INVALID_STATE_TRANSITION` | sim (se BR-MKT-16) | `INVALID_STATE_TRANSITION` | `INVALID_STATE_TRANSITION` | `INVALID_STATE_TRANSITION` |
| Geração de horários e visibilidade a famílias | não | não | não | **sim** | não | não |
| **MK2** Ler conversas e mensagens próprias; marcar como lida; denunciar uma mensagem recebida | sim (sem conversas em `DRAFT`/`PENDING_REVIEW` na prática) | sim | sim | sim | sim | sim |
| **MK2** Responder (enviar), fechar e reabrir conversas | `PROFESSIONAL_LOCKED` | `PROFESSIONAL_LOCKED` | `PROFESSIONAL_LOCKED` | **sim** | `PROFESSIONAL_LOCKED` | `PROFESSIONAL_LOCKED` |
| **MK2** Ser contactado por famílias (nova conversa) | não (`404` à família) | não | não | **sim** | não | não |
| **MK3** Ler marcações, comprovativos (descarregar os `CLEAN` das suas marcações) e avaliações recebidas | sim (sem marcações em `DRAFT`/`PENDING_REVIEW` na prática) | sim | sim | sim | sim | sim |
| **MK3** Confirmar, recusar, cancelar, concluir e marcar falta; confirmar/rejeitar comprovativos; responder e denunciar avaliações | `PROFESSIONAL_LOCKED` | `PROFESSIONAL_LOCKED` | `PROFESSIONAL_LOCKED` | **sim** | `PROFESSIONAL_LOCKED` | `PROFESSIONAL_LOCKED` |
| **MK3** Receber marcações (famílias marcam) e ter horários oferecidos | não (`404` à família) | não | não | **sim** | não | não |
| **MK3** Criar bloqueio sobre horários **marcados** | — | — | — | `409 CONFLICT` (BR-MKT-53) | — | — |
Login, refresh, logout e recuperação de palavra-passe funcionam em todos os estados (OP-59). As operações de marcações (MK3) estão nas linhas «MK3» acima e em §12.2; as marcações futuras de um profissional que deixa de estar `APPROVED` são canceladas pelo sistema (BR-MKT-54).

### 10.3 Platform Admin (`/admin/professionals*`, `/admin/specialties*`) — complementa §7
| Ação | PLATFORM_ADMIN | Outros atores |
|---|---|---|
| Listar a fila e ver o detalhe (e-mail, perfil, especialidades, metadados das credenciais, histórico) | sim | `FORBIDDEN` (User) · `401` (profissional/clínica) |
| Descarregar uma credencial (`CLEAN`; **auditado**) | sim | idem |
| Decidir (`APPROVE`, `REJECT`, `REQUEST_INFO`, `SUSPEND`, `REACTIVATE`; tabela de `state-machines.md`) | sim, com motivo onde é obrigatório | idem |
| Criar/alterar/desativar especialidades | sim | idem |
| Editar perfil, ofertas, horários, credenciais ou palavra-passe de um profissional; ler `paymentInstructions`; criar contas de profissional | **não** (não há rota) | — |
| **MK2** Listar denúncias de mensagens, ver o detalhe (**a mensagem denunciada + as 2 anteriores da mesma conversa**, auditado) e decidir (`DISMISS`, `HIDE_MESSAGE`, `HIDE_AND_CLOSE`) (`/admin/message-reports*`) | sim | idem |
| **MK2** Ler conversas, mensagens além da denunciada e das 2 imediatamente anteriores (nem posteriores, nem de outras conversas), `participantLabel`, família ou membro de uma conversa | **não** (não há rota; BR-MKT-44/48) | — |
| **MK3** Listar disputas de comprovativos, ver o detalhe (**a marcação e os metadados do comprovativo**, auditado), descarregar o comprovativo **disputado** (auditado) e decidir (`CONFIRM_PAYMENT`, `UPHOLD_REJECTION`) (`/admin/payment-disputes*`) | sim | idem |
| **MK3** Listar denúncias de avaliações, ver o detalhe (**a avaliação denunciada**, auditado) e decidir (`DISMISS`, `HIDE_COMMENT`) (`/admin/review-reports*`) | sim | idem |
| **MK3** Ler marcações fora de uma disputa, comprovativos não disputados, avaliações não denunciadas, `participantLabel`, família ou membro; alterar preços, estados de marcação, avaliações ou o ranking | **não** (não há rota; BR-MKT-58/60/61/63) | — |
| Ler qualquer dado de saúde ou de família | **não** (BR-MKT-27; `admin`/`professionals` não importam módulos de saúde) | — |
Um token de `ProfessionalAccount` nunca autoriza `/admin/*`.

### 10.4 Lado família (User) em MK1
(MK2 acrescenta as rotas da família em §11.) Em MK1 sem rotas. O único leitor é a **raiz** de `professionals` (`ProfessionalDirectory`, BR-MKT-19), a consumir por MK2/MK3: devolve **só** `APPROVED`, só dados públicos; estados não `APPROVED` ⇒ ausente/`NOT_FOUND` (indistinguível de inexistente); **nunca** `paymentInstructions`, e-mail, credenciais nem estado de validação. A decisão de «pode esta família ver este profissional» é só a de visibilidade (não há dados de saúde em causa, logo **não** há `AccessPolicy`); a autorização de **ações** da família sobre o mercado: conversar (§11.2), marcar/pagar/avaliar (MK3, §12.1); partilhar fica para MK4.

Testes gerados desta secção: `TC-AZ-MKT-01..08`.

## 11. Mercado de profissionais — MK2: descoberta e conversas (ADR-037; contrato 2026-11-17, **nada implementado**)

> Complementa §4 (`access`), §10 (portal do profissional) e §7 (admin). Regras: BR-MKT-32..49.

### 11.1 Descoberta (`/marketplace/*`) — `AUTH` sem família
1. **Token:** só o de `User` (`bearerAuth`); sem token, ou token de `ProfessionalAccount`/`ClinicAccount` ⇒ `401 UNAUTHENTICATED`. User `ACTIVE`, termos aceites; `SUSPENDED` ⇒ `ACCOUNT_SUSPENDED` (regras de `authentication.md`).
2. **Sem `AccessPolicy`:** a descoberta só lê dados públicos de `APPROVED` (BR-MKT-19/32); não há família, membro nem categoria de saúde na decisão. O guard global do §5.1 mantém uma **lista fechada de rotas «sem decisão de política»** (`PUBLIC_DATA_ROUTES`: `getMarketplaceFilters`, `getRankingRules`, `searchProfessionals`, `compareProfessionals`, `getMarketplaceProfessional`); adicionar uma rota de dados de saúde a essa lista falha a CI (a lista é verificada contra o `openapi.yaml`: nenhuma rota `/families/*`).
3. **Visibilidade:** a decisão «este profissional é visível» é só `validation_status = 'APPROVED'` lida em cada pedido pela porta (BR-MKT-19); não-`APPROVED` ⇒ `404` idêntico a inexistente.
4. **Limites:** 60 pedidos/min por utilizador (BR-MKT-49). **Sem auditoria** (BR-MKT-32); sem registo de pesquisas.

### 11.2 Conversas — lado família (`/families/{f}/members/{m}/conversations*`)
Ação nova de `access`: **`MESSAGE_PROFESSIONALS`** (alteração mínima ao módulo `access`: uma ação na `AccessPolicy` + teste da matriz; **sem** categoria de dados nem `SharingGrant`, como `VIEW_CLINIC_RECEIPTS`). `messaging` não importa `access`: autoriza pela porta **`ConversationAccess`** (definida na sua `application`, implementada no composition root sobre `access`).
| Ação | `SELF` (adulto) | `TUTOR_OF` | `DEPENDENT_SELF` | `OTHER` / Family Admin como `OTHER` |
|---|---|---|---|---|
| Listar e ver conversas e mensagens do membro | sim (do próprio) | sim (do dependente) | não (`FORBIDDEN`) | não (`FORBIDDEN`) |
| Abrir/continuar, enviar, marcar como lida | sim | sim | não (`FORBIDDEN`) | não (`FORBIDDEN`) |
| Fechar e reabrir (a que a família fechou) | sim | sim | não (`FORBIDDEN`) | não (`FORBIDDEN`) |
| Denunciar uma mensagem do profissional | sim | sim | não (`FORBIDDEN`) | não (`FORBIDDEN`) |
Critério: relação `SELF`/`TUTOR_OF` com o membro-sujeito (nunca `SharingGrant`: o chat é do membro e pode conter dados sensíveis); `DEPENDENT_SELF` (dependente com conta, ≥ 13 anos) **não** conversa com profissionais (só o tutor; OP-77). Os dois tutores partilham a mesma conversa e o mesmo marcador de leitura. Membro `BLOCKED` ⇒ `MEMBER_BLOCKED`. **Isolamento:** a conversa procura-se **por (`familyId`, `memberId`, `conversationId`)** (repositório exige `familyId`, `conventions.md` §3.4); de outra família/membro ou inexistente ⇒ `404` sem enumeração; `403` só quando o membro existe na família mas a relação é insuficiente. Auditoria das ações sensíveis e das negações (`ACCESS_DENIED`), com `family_id` e `subject_member_id` (`audit.md` §3). Maioridade (M9): a mesma regra recalculada por pedido (o acesso do tutor cessa sem migração de dados).

### 11.3 Conversas — lado do profissional
Algoritmo de §10.1 (token, conta, isolamento por `professionalId` do token, estado de validação lido da BD por pedido). Matriz por estado em §10.2 (linhas «MK2»): **leitura sempre**; **enviar/fechar/reabrir só `APPROVED`**; denunciar e marcar como lida sempre. O profissional **nunca** recebe ids de família, membro nem utilizador em nenhuma resposta (BR-MKT-10/38; teste de chaves proibidas, TC-AZ-MKT-12).

### 11.4 Moderação (admin) — `/admin/message-reports*`
`PLATFORM_ADMIN` (§7/§10.3); User não-admin ⇒ `403`; token de profissional ⇒ `401`. **Só** a mensagem denunciada e as 2 mensagens imediatamente anteriores da mesma conversa (contexto, BR-MKT-44/OP-76; o servidor limita a consulta por `conversation_id` e `seq`); sem rota para listar/ler conversas ou outras mensagens; cada leitura de detalhe é **auditada**. `messaging` não importa `admin` e `admin` não importa `messaging` (o guard `PLATFORM_ADMIN` é injetado em `main/api.ts`, como em `professionals`/`clinics`).

Testes gerados desta secção: `TC-AZ-MKT-09..16`.

## 12. Mercado de profissionais — MK3: marcação, comprovativo e avaliações (ADR-037; contrato 2026-11-19, **nada implementado**)

> Complementa §4 (`access`), §10 (portal do profissional) e §7 (admin). Regras: BR-MKT-50..66.

### 12.1 Marcações — lado família (`/families/{f}/members/{m}/bookings*`)
Ação nova de `access`: **`BOOK_PROFESSIONALS`** (alteração mínima ao módulo `access`: uma ação na `AccessPolicy` + teste da matriz; **sem** categoria de dados nem `SharingGrant`, como `MESSAGE_PROFESSIONALS`). `consultations` não importa `access`: autoriza pela porta **`BookingAccess`** (definida na sua `application`, implementada no composition root sobre `access`).
| Ação | `SELF` (adulto) | `TUTOR_OF` | `DEPENDENT_SELF` | `OTHER` / Family Admin como `OTHER` |
|---|---|---|---|---|
| Listar e ver marcações do membro (incl. instruções de pagamento e `meetingInfo` quando `CONFIRMED`) | sim (do próprio) | sim (do dependente) | não (`FORBIDDEN`) | não (`FORBIDDEN`) |
| Marcar, cancelar | sim | sim | não (`FORBIDDEN`) | não (`FORBIDDEN`) |
| Carregar, listar, descarregar e disputar comprovativos | sim | sim | não (`FORBIDDEN`) | não (`FORBIDDEN`) |
| Ver, criar e editar a avaliação da marcação | sim | sim | não (`FORBIDDEN`) | não (`FORBIDDEN`) |
Critério: relação `SELF`/`TUTOR_OF` com o membro-sujeito (nunca `SharingGrant`: a marcação e o comprovativo têm dados pessoais e financeiros); `DEPENDENT_SELF` não marca (só o tutor; coerente com OP-77). Os dois tutores partilham as mesmas marcações. Membro `BLOCKED` ⇒ `MEMBER_BLOCKED`. **Isolamento:** a marcação procura-se **por (`familyId`, `memberId`, `bookingId`)**; o comprovativo e a avaliação **sempre através da marcação** (nunca por id solto); de outra família/membro ou inexistente ⇒ `404` sem enumeração; `403` só quando o membro existe na família mas a relação é insuficiente. O `Process` `BOOKING` e a consulta gerada leem-se pelas regras da categoria APPOINTMENTS (§3/§6.8) — o `DEPENDENT_SELF` vê a **consulta** (como qualquer consulta) mas não a marcação, o pagamento nem o comprovativo. Auditoria das ações sensíveis e das negações (`ACCESS_DENIED`) com `family_id` e `subject_member_id` (`audit.md` §3). A verificação **`SelfDealingGuard`** (BR-MKT-62) corre **depois** da autorização e antes de qualquer escrita.

### 12.2 Marcações — lado do profissional
Algoritmo de §10.1 (token, conta, isolamento por `professionalId` do token, estado de validação lido da BD por pedido). Matriz por estado em §10.2 (linhas «MK3»): **leitura sempre**; **confirmar, recusar, cancelar, concluir, falta, decidir comprovativos, responder e denunciar avaliações só `APPROVED`** (`PROFESSIONAL_LOCKED` nos outros). A marcação, o comprovativo e a avaliação procuram-se **por `professionalId` do token** (de outro profissional ou inexistente ⇒ `404` idêntico). O profissional **nunca** recebe ids de família, membro nem utilizador em nenhuma resposta (BR-MKT-10/63; teste de chaves proibidas, TC-AZ-MKT-21) e só descarrega comprovativos `CLEAN` das **suas** marcações (download auditado).

### 12.3 Admin — `/admin/payment-disputes*` e `/admin/review-reports*`
`PLATFORM_ADMIN` (§7/§10.3); User não-admin ⇒ `403`; token de profissional ⇒ `401`. **Disputas:** só comprovativos que foram disputados; o detalhe devolve a marcação e os metadados do comprovativo, o ficheiro descarrega-se por rota própria **só se disputado** (ambos **auditados**); **denúncias de avaliações:** só a avaliação denunciada. Sem rota para listar marcações, comprovativos ou avaliações fora destes conjuntos, nem para alterar preços, estados de marcação, notas ou o ranking (BR-MKT-61). `consultations` não importa `admin` e `admin` não importa `consultations` (o guard `PLATFORM_ADMIN` é injetado em `main/api.ts`, como em `messaging`).

### 12.4 Rotas públicas de MK3 (`/marketplace/professionals/{id}/slots` e `…/reviews`)
`AUTH` sem família, como §11.1: só `User` autenticado (`bearerAuth`); só dados públicos de `APPROVED` (horários livres; avaliações anónimas). Entram na lista fechada **`PUBLIC_DATA_ROUTES`** (`listBookableSlots`, `listProfessionalReviews`); a CI continua a verificar que nenhuma rota `/families/*` lá está. 60 pedidos/min por utilizador (BR-MKT-66). Não auditadas.

Testes gerados desta secção: `TC-AZ-MKT-17..25`.

## 13. Mercado de profissionais — MK4: partilha de registos e receita digital (ADR-037; contrato 2026-11-20, **nada implementado**)

> Complementa §4 (`access`), §10 (portal do profissional) e §12 (marcações). Regras: BR-MKT-67..81. A partilha com um profissional **não** usa `SharingGrant` (destinatário é um ator de outro espaço de identidade, ADR-037 §3) nem `AccessPolicy` do lado do profissional: usa o token de `ProfessionalAccount` e a **reavaliação a cada abertura** (BR-MKT-70, modelo do `ClinicConsent`, ADR-026).

### 13.1 Partilhas — lado família (`/families/{f}/members/{m}/record-shares*`)
Ação nova de `access`: **`SHARE_WITH_PROFESSIONALS`** (alteração mínima ao módulo `access`: uma ação na `AccessPolicy` + teste da matriz; **sem** categoria de dados, como `BOOK_PROFESSIONALS`). `record-sharing` não importa `access`: autoriza pela porta **`ShareAccess`** (definida na sua `application`, implementada no composition root sobre `access`).
| Ação | `SELF` (adulto) | `TUTOR_OF` | `DEPENDENT_SELF` | `OTHER` / Family Admin como `OTHER` |
|---|---|---|---|---|
| Ver as opções de partilha de uma marcação | sim (do próprio) | sim (do dependente) | não (`FORBIDDEN`) | não (`FORBIDDEN`) |
| Criar partilha | sim | sim | não (`FORBIDDEN`) | não (`FORBIDDEN`) |
| Listar e ver partilhas e **as vistas** («quem viu») | sim | sim | não (`FORBIDDEN`) | não (`FORBIDDEN`) |
| Revogar | sim | sim | não (`FORBIDDEN`) | não (`FORBIDDEN`) |
Critério: relação `SELF`/`TUTOR_OF` com o membro-sujeito (nunca `SharingGrant`: quem pode ler o registo de um irmão por `SharingGrant` **não** pode partilhá-lo com um profissional — a concessão é do titular/tutor, BR-PRV-02); `DEPENDENT_SELF` não partilha (só o tutor; coerente com OP-77 e N2). Os dois tutores veem e revogam as mesmas partilhas. Membro `BLOCKED` ⇒ `MEMBER_BLOCKED`. **Isolamento:** a partilha procura-se **por (`familyId`, `memberId`, `shareId`)** e as vistas **sempre através da partilha**; de outra família/membro ou inexistente ⇒ `404` sem enumeração; `403` só quando o membro existe na família mas a relação é insuficiente. A marcação âncora procura-se por (`familyId`, `memberId`, `bookingId`) pela porta `ShareAnchor` (de outro membro/família ⇒ `404`). Auditoria da criação, da revogação e das negações (`ACCESS_DENIED`) com `family_id` e `subject_member_id` (`audit.md` §3). **Esta vista é a única exceção a BR-PRV-09** (BR-MKT-73): o titular/tutor vê as aberturas **dos profissionais às suas partilhas**; não vê auditoria nem acessos de outros membros.

### 13.2 Partilhas — lado do profissional (`/professional-portal/shares*`)
Algoritmo de §10.1 (token, conta, isolamento por `professionalId` do token, estado de validação lido da BD por pedido). A partilha procura-se **por `professionalId` do token** (de outro profissional ou inexistente ⇒ `404` idêntico). **Abrir** reavalia, em cada pedido, as condições de BR-MKT-70 (estado, prazo, profissional `APPROVED`, marcação, membro). Matriz (gerada para `TC-AZ-MKT-28`):
| Operação | DRAFT | PENDING_REVIEW | NEEDS_INFO | APPROVED | REJECTED | SUSPENDED |
|---|---|---|---|---|---|---|
| Listar e ver (metadados) as partilhas próprias | sim | sim | sim | sim | sim | sim |
| **Abrir** uma partilha (`open`) | `SHARE_NOT_AVAILABLE` | `SHARE_NOT_AVAILABLE` | `SHARE_NOT_AVAILABLE` | sim (se as restantes condições de BR-MKT-70) | `SHARE_NOT_AVAILABLE` | `SHARE_NOT_AVAILABLE` |
| Ler a receita que emitiu (`GET …/prescription`) | sim | sim | sim | sim | sim | sim |
| Emitir receita digital (`POST …/prescriptions`) | `PROFESSIONAL_LOCKED` | `PROFESSIONAL_LOCKED` | `PROFESSIONAL_LOCKED` | sim (se BR-MKT-80; flag ligada) | `PROFESSIONAL_LOCKED` | `PROFESSIONAL_LOCKED` |
O profissional recebe do membro só o `participantLabel` e a `ageYears` (OP-119, sem data de nascimento) e **nunca** ids de família, membro nem utilizador (BR-MKT-75; teste de chaves proibidas, TC-AZ-MKT-30) e **não** pode revogar, prolongar nem apagar partilhas. Sem a flag, as rotas da receita respondem `404` (§13.4). Um profissional com especialidades `HEALTH` e `WELLNESS` recebe o conteúdo conforme a categoria **da marcação âncora** (fixa à criação), não a do perfil.

### 13.3 Admin
`PLATFORM_ADMIN` **não** tem rota de MK4: nenhuma lê partilhas, vistas, conteúdo partilhado nem receitas (D4, BR-MKT-75). `record-sharing` não importa `admin` e `admin` não importa `record-sharing`/`consultations` (inventário de rotas, TC-AZ-MKT-31).

### 13.4 Receita digital (`/professional-portal/bookings/{id}/prescription*`; BR-MKT-79..81)
Só `PROFESSIONAL_ACCOUNT` (token de profissional; token de `User`/clínica ⇒ `401`). Marcação procurada por `professionalId` do token (alheia ou inexistente ⇒ `404` idêntico). **Flag `DIGITAL_PRESCRIPTION_ENABLED=false` ⇒ `404`** em ambas as rotas (indistinguível de rota inexistente) e `canPrescribe=false`. Com a flag ligada: emitir exige `APPROVED` (`PROFESSIONAL_LOCKED` nos outros estados, §13.2), categoria `HEALTH` da marcação (`WELLNESS` ⇒ `FORBIDDEN`), marcação `COMPLETED` de **qualquer método** (OP-126) em ≤ 7 dias e sem receita (`INVALID_STATE_TRANSITION`/`CONFLICT`). Do lado da família **não há ação nova**: a receita lê-se e gere-se com as permissões de qualquer receita (categoria `MEDICATION`, §3; `DEPENDENT_SELF` lê, não edita), **mas** o conteúdo de uma receita `issuedBy=PROFESSIONAL` é **só leitura para todos os papéis da família** (OP-127, BR-MKT-81): `updatePrescription`, `addPrescriptionMedication` e a edição de conteúdo em `updateMedicationPlan` ⇒ `409 CONFLICT` (é regra de estado do recurso, não de papel: nem o `SELF`/`TUTOR_OF` com `WRITE(MEDICATION)` a contornam); cancelar/concluir/reabrir, apagar e ajustar horários continuam a depender de `WRITE(MEDICATION)`. O profissional **não** ganha leitura de nenhum registo: lê só a receita que emitiu.

Testes gerados desta secção: `TC-AZ-MKT-26..32`.
