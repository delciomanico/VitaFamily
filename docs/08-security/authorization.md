# Vita Family — Autorização (Fase 14)

> **Pendente (D17, change control 2026-10-05):** acrescentar ClinicSlot, ClinicStaff, os estados REQUESTED/REJECTED de Appointment e as operações do portal da clínica. Até lá, este documento não cobre a marcação com clínica parceira (ver `00-product/discovery.md` → D17).

> Estado: **v0.1**. Implementa `02-users/permissions.md` (v0.2). Racional: ADR-008.

## 1. Entradas e saída da decisão

```text
AccessPolicy.can( actor, action, target ) → ALLOW | DENY(reason)

actor  = { userId, platformRole, membership na família do pedido?, status da conta }
action = READ | CREATE | UPDATE | DELETE | CONFIRM_DOSE | MANAGE_SHARING | MANAGE_STRUCTURE | EXPORT ...
target = { família, categoria?, sujeito (memberId)?, recurso }
```

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
| Clínicas privadas | Criar: adulto da família; editar/arquivar/eliminar: criador ou FAMILY_ADMIN. |
| Clínicas parceiras e contas | PLATFORM_ADMIN. |

## 5. Regras de implementação
1. **Toda** a rota de negócio chama `AccessPolicy` no application service; um guard global *verifica* (em testes e em runtime de desenvolvimento) que a policy foi invocada — uma rota sem decisão registada falha.
2. Repositórios recebem `familyId` obrigatório; não existe método "buscar por id" sem família.
3. As respostas de relatório e listas **filtram** por permissão (omitir, não anular).
4. A decisão de visibilidade ao listar (ex.: família) é calculada **uma vez** por pedido e reutilizada (evita N+1 e inconsistências).
5. Mensagens de negação não revelam o motivo detalhado.

## 6. Testes
Os testes de autorização são **gerados a partir da matriz** acima: para cada (relação × categoria × ação) um caso positivo ou negativo (Fase 15, `TC-AZ-*`). Adicionar uma categoria ou ação sem atualizar a matriz faz falhar a CI.
