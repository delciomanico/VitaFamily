# Vita Family — Autorização (Fase 14)

> Estado: **v0.3** — acrescenta o portal da clínica parceira (D17/D18, ADR-020) e o portal da seguradora parceira (ADR-021). Implementa `02-users/permissions.md` (v0.2). Racional: ADR-008 (ator de User/família), ADR-020 (segundo ator, `ClinicAccount`), ADR-021 (terceiro ator, `InsuranceAccount`).

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
verificação própria e mais simples (§7) — nunca pelo `AccessPolicy` de família. As rotas
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
| Ver/gerir horários, pedidos ou agenda de **outra** clínica | não (`NOT_FOUND`) | não (`NOT_FOUND`) |

Não há ação do portal que leia dados fora do mínimo de BR-CLN-03 (nome do paciente, especialidade,
profissional, data/hora, observações do pedido); nunca condições, alergias, medicação prévia,
histórico de outras consultas, nem dados de família/tutela. A exceção de BR-CLN-06 (registar
resultado/receita) só se aplica à consulta `SCHEDULED` que a própria clínica está a atender.

### 6.3 Hierarquia de contas (BR-CLN-05) — quem administra quem
| Ação | Quem |
|---|---|
| Ver/suspender a clínica (inteira) | PLATFORM_ADMIN |
| Criar/repor a conta `CLINIC_ADMIN` raiz de uma clínica parceira | PLATFORM_ADMIN (`POST /admin/clinics/{id}/root-account`) |
| Criar/listar/remover contas `CLINIC_MANAGER` da própria clínica | `CLINIC_ADMIN` da clínica (self-service, nunca o Platform Admin diretamente) |

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

### 8.3 Hierarquia de contas (ADR-021, mirror de §6.3) — quem administra quem
| Ação | Quem |
|---|---|
| Ver/suspender a seguradora (inteira) | PLATFORM_ADMIN |
| Criar/repor a conta `INSURANCE_ADMIN` raiz de uma seguradora parceira | PLATFORM_ADMIN |
| Criar/listar/remover contas `INSURANCE_AGENT` da própria seguradora | `INSURANCE_ADMIN` da seguradora (self-service, nunca o Platform Admin diretamente) |

## 9. Testes
Os testes de autorização são **gerados a partir da matriz** acima: para cada (relação × categoria × ação) um caso positivo ou negativo (Fase 15, `TC-AZ-*`). Adicionar uma categoria ou ação sem atualizar a matriz faz falhar a CI. As matrizes §6.2 (clínica) e §8.2 (seguradora) seguem a mesma regra: geradas a partir da tabela, com casos próprios `TC-AZ-CLN-*`/`TC-AZ-INS-*`.
