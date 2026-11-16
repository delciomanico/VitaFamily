# Vita Family — Papéis e relações (Fase 5)

> Estado: **RASCUNHO v0.3 (R7 do arquivo do marco B, 2026-11-16, ADR-037: retirados os papéis de seguradora, no extrato `_arquivo/marco-b/extratos/roles-actors-glossary-seguradora.md`)** — depende das decisões P1–P8 em `permissions.md`.

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
| **PLATFORM_ADMIN** | Listar/pesquisar contas, ver o detalhe operacional, suspender, reativar e repor o acesso; gerir clínicas parceiras (incl. editar), criar a conta raiz de cada uma e listar/suspender/reativar as contas do portal de cada clínica (R8, R10, D17/D18, ADR-021, ADR-023). Nenhum endpoint de saúde (NFR-SEC-10). |
| **CLINIC_ADMIN** | Conta raiz de cada clínica parceira (D18, BR-CLN-05), criada só pelo Platform Admin. Mesmas permissões operacionais que `CLINIC_MANAGER` (ver `authorization.md` §6.2) e, além disso, cria/lista/remove as contas `CLINIC_MANAGER` e `CLINIC_DOCTOR` da própria clínica (self-service), edita o perfil e vê a auditoria da clínica (M14 R). |
| **CLINIC_MANAGER** | Por clínica parceira (D17), criada pelo `CLINIC_ADMIN` da sua clínica: gerir horários (consulta e exame, com vagas nos de exame), confirmar/recusar pedidos de consulta, ver a ocupação e cancelar marcações de exame com motivo, completar consultas (resultado + receita) e exames (resultados + PDF), emitir recomendações e ver a agenda da clínica com dados mínimos (BR-CLN-03/06/07/08/09; ADR-023). Nenhum endpoint de família ou de saúde. |
| **CLINIC_DOCTOR** (M14 R, BR-CLN-39) | Médico da clínica parceira, criado pelo `CLINIC_ADMIN` e ligado a **um** profissional do catálogo: vê a sua agenda e os pacientes marcados com o seu profissional, inicia e conclui consultas/visitas/exames (resultado, receita), emite recomendações e propõe retornos; **M15:** escreve o relatório da consulta e **pede exames** (ADR-027/028), e emite a declaração de presença. **Não** vê Financeiro, relatórios, equipa, perfil, catálogo, auditoria nem faz pesquisa global. A receção é o `CLINIC_MANAGER` (sem papel novo). Matriz em `authorization.md` §6.2b. |

## 5. Regras estruturais

1. Um **Family Admin** não é tutor por defeito (N1); tem de ser atribuído como tutor.
2. O tutor tem de ser um FamilyMember **adulto** da mesma família (M1).
3. Cada dependente tem sempre pelo menos um tutor; remover o último tutor exige atribuir outro.
4. Um dependente que passa a ser adulto (18 anos): consequências em P4.
5. Papéis e relações aplicam-se **só no contexto da família do pedido**; nunca entre famílias (NFR-SEC-04).
