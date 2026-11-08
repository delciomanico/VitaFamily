# Vita Family — Papéis e relações (Fase 5)

> Estado: **RASCUNHO v0.2 (+ papéis do módulo operacional de seguradoras, ADR-025)** — depende das decisões P1–P8 em `permissions.md`.

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
| **PLATFORM_ADMIN** | Listar/pesquisar contas, ver o detalhe operacional, suspender, reativar e repor o acesso; gerir clínicas e seguradoras parceiras (incl. editar), criar a conta raiz de cada uma e listar/suspender/reativar as contas do portal de cada clínica (R8, R10, D17/D18, ADR-021, ADR-023). Nenhum endpoint de saúde (NFR-SEC-10). |
| **CLINIC_ADMIN** | Conta raiz de cada clínica parceira (D18, BR-CLN-05), criada só pelo Platform Admin. Mesmas permissões operacionais que `CLINIC_MANAGER` (ver `authorization.md` §6.2) e, além disso, cria/lista/remove as contas `CLINIC_MANAGER` e `CLINIC_DOCTOR` da própria clínica (self-service), edita o perfil e vê a auditoria da clínica (M14 R). |
| **CLINIC_MANAGER** | Por clínica parceira (D17), criada pelo `CLINIC_ADMIN` da sua clínica: gerir horários (consulta e exame, com vagas nos de exame), confirmar/recusar pedidos de consulta, ver a ocupação e cancelar marcações de exame com motivo, completar consultas (resultado + receita) e exames (resultados + PDF), emitir recomendações e ver a agenda da clínica com dados mínimos (BR-CLN-03/06/07/08/09; ADR-023). Nenhum endpoint de família ou de saúde. |
| **CLINIC_DOCTOR** (M14 R, BR-CLN-39) | Médico da clínica parceira, criado pelo `CLINIC_ADMIN` e ligado a **um** profissional do catálogo: vê a sua agenda e os pacientes marcados com o seu profissional, inicia e conclui consultas/visitas/exames (resultado, receita), emite recomendações e propõe retornos. **Não** vê Financeiro, relatórios, equipa, perfil, catálogo, auditoria nem faz pesquisa global. A receção é o `CLINIC_MANAGER` (sem papel novo). Matriz em `authorization.md` §6.2b. |
| **INSURANCE_ADMIN** | Conta raiz de cada seguradora parceira (ADR-021, mirror de `CLINIC_ADMIN`), criada só pelo Platform Admin. Mesmas permissões operacionais que `INSURANCE_AGENT` (ver `authorization.md` §8.2) e, além disso, cria/lista/remove as contas `INSURANCE_AGENT` da própria seguradora (self-service). **ADR-025:** nas seguradoras com módulo operacional gere também as contas dos papéis `BENEFICIARY_MANAGER`, `AUTHORIZATION_ANALYST`, `CLAIMS_MANAGER` e `FINANCE_MANAGER` e tem acesso total ao módulo (matriz §8.2b). |
| **INSURANCE_AGENT** | Por seguradora parceira (ADR-021), criada pelo `INSURANCE_ADMIN` da sua seguradora: ver/abrir os pedidos de reembolso (`ReimbursementClaim`) da própria seguradora e os documentos anexados a cada pedido, aprovar/rejeitar com motivo. Nenhum endpoint de família ou de resto do perfil de saúde. |
| **BENEFICIARY_MANAGER** | Por seguradora com módulo operacional (ADR-025), criada pelo `INSURANCE_ADMIN`: gere empresas, beneficiários, apólices e importações; confirma ligações paciente ↔ beneficiário. Leitura de planos, rede, autorizações e despesas conforme `authorization.md` §8.2b. |
| **AUTHORIZATION_ANALYST** | Por seguradora com módulo operacional (ADR-025): analisa e decide pedidos de autorização (aprovar/rejeitar/pedir informação/cancelar). Leitura de beneficiários, planos e despesas. |
| **CLAIMS_MANAGER** | Por seguradora com módulo operacional (ADR-025): analisa despesas das clínicas (aprovar/rejeitar/devolver). Leitura de beneficiários, planos e autorizações. |
| **FINANCE_MANAGER** | Por seguradora com módulo operacional (ADR-025): vê despesas, autorizações e o dashboard financeiro; pagamentos e preços de prestadores só na fase 2. |
| **CLINIC_ADMIN / CLINIC_MANAGER (extensão ADR-025)** | Sem novo papel de médico no módulo de seguradoras (Q6; o `CLINIC_DOCTOR` de M14 R **não** tem permissões do módulo operacional): ambos validam elegibilidade, registam atendimentos, pedem autorizações e submetem despesas **só** para seguradoras a que a clínica está ligada como prestador (`Provider`). |

## 5. Regras estruturais

1. Um **Family Admin** não é tutor por defeito (N1); tem de ser atribuído como tutor.
2. O tutor tem de ser um FamilyMember **adulto** da mesma família (M1).
3. Cada dependente tem sempre pelo menos um tutor; remover o último tutor exige atribuir outro.
4. Um dependente que passa a ser adulto (18 anos): consequências em P4.
5. Papéis e relações aplicam-se **só no contexto da família do pedido**; nunca entre famílias (NFR-SEC-04).
