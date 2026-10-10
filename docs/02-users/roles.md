# Vita Family — Papéis e relações (Fase 5)

> Estado: **RASCUNHO v0.1** — depende das decisões P1–P8 em `permissions.md`.

## 1. Modelo de autorização: quatro conceitos

O acesso a um dado resulta da combinação de **papel + relação + partilha**, não só do papel.

```text
Papel de família (por User, por família)   FAMILY_ADMIN | FAMILY_MEMBER
Relação com o titular dos dados            SELF | TUTOR_OF | OUTRO_MEMBRO
Partilha de dados (por categoria)          decidida pelo titular adulto (D13, R5)
Papel de plataforma                        PLATFORM_ADMIN | (nenhum)
```

## 2. Papéis de família (escopo: uma família)

Um User pode ter papéis diferentes em famílias diferentes (D2).

| Papel | Âmbito |
|---|---|
| **FAMILY_ADMIN** | Gere a **estrutura** da família: nome, convites, criação e remoção de membros, atribuição de papéis, atribuição de tutores. Pelo menos um por família (FR-FAM-03). **Não** vê dados de saúde de outros por ser Admin. |
| **FAMILY_MEMBER** | Participa na família; gere os seus próprios dados e vê o que lhe foi partilhado. |

## 3. Relações por titular dos dados

| Relação | Significado | Permissões típicas |
|---|---|---|
| **SELF** | O titular dos dados com conta. | Controlo total dos seus dados (adulto). |
| **TUTOR_OF(dependente)** | Relação por dependente (N1). Cada dependente tem ≥1 tutor. | Gere os dados do dependente: editar perfil de saúde (M6), receitas, tomas, consultas, exames. |
| **DEPENDENTE_COM_CONTA** | O próprio dependente com conta. | Acesso limitado: ver os seus medicamentos e consultas, confirmar tomas (N2). |
| **OUTRO_MEMBRO** | Qualquer outro membro da família. | Só o que o titular partilhou, por categoria. |

## 4. Papel de plataforma

| Papel | Âmbito |
|---|---|
| **PLATFORM_ADMIN** | Listar, suspender e reativar contas; gerir clínicas parceiras e criar contas de Gestor da clínica (R8, R10, D17). Nenhum endpoint de saúde (NFR-SEC-10). |
| **CLINIC_MANAGER** | Por clínica parceira (D17): gerir horários, confirmar/recusar pedidos, cancelar consultas da clínica com motivo, ver a agenda da clínica com dados mínimos (BR-CLN-03). Nenhum endpoint de família ou de saúde. |

## 5. Regras estruturais

1. Um **Family Admin** não é tutor por defeito (N1); tem de ser atribuído como tutor.
2. O tutor tem de ser um FamilyMember **adulto** da mesma família (M1).
3. Cada dependente tem sempre pelo menos um tutor; remover o último tutor exige atribuir outro.
4. Um dependente que passa a ser adulto (18 anos): consequências em P4.
5. Papéis e relações aplicam-se **só no contexto da família do pedido**; nunca entre famílias (NFR-SEC-04).
