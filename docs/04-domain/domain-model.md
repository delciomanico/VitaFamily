# Vita Family — Modelo de Domínio (Fase 8)

> Estado: **v0.1 — decisões DM1–DM8 adotadas com a recomendação do assistente (delegação do proprietário, 2026-10-04).**
> Base: `business-rules.md` v0.2, `permissions.md` v0.2, casos de uso v0.2.

## 1. Contextos do domínio (bounded contexts)

Agrupamento por **coerência de responsabilidade**, não por entidade (prompt §15). Cada contexto vira um ou mais módulos (Fase 11).

```text
┌───────────────────────────────────────────────────────────────────────┐
│ IDENTIDADE E ACESSO            FAMÍLIA E PESSOAS        PRIVACIDADE    │
│  User, AuthToken, Session       Family, FamilyMember     SharingGrant   │
│  NotificationPreference         Guardianship, Invitation               │
├───────────────────────────────────────────────────────────────────────┤
│ REGISTOS DE SAÚDE (por FamilyMember)                                  │
│  Allergy · MedicalCondition · Prescription · MedicationPlan ·         │
│  DoseOccurrence · Appointment · Examination · ExamResult · Document   │
│  Clinic (referência)                                                  │
├───────────────────────────────────────────────────────────────────────┤
│ ALERTAS                        TRANSVERSAL                            │
│  Alert · Notification ·         AuditLog · DataExport ·               │
│  PushSubscription               FileDeletion (outbox)                 │
└───────────────────────────────────────────────────────────────────────┘
   Relatórios: não persistem; são **vistas calculadas** sobre os registos.
```

## 2. Conceitos centrais

| Conceito | Significado |
|---|---|
| **User** | Quem tem conta. Autentica-se. Não carrega dados de saúde. |
| **FamilyMember** | Uma **pessoa dentro de uma família**. É o **sujeito** a quem os dados de saúde pertencem. Pode estar ligado a um User (conta) ou não. |
| **Titular (SELF)** | O User ligado ao FamilyMember. |
| **Tutor** | FamilyMember adulto com conta ligado por **Guardianship** a um dependente. |
| **Categoria de dados** | ALLERGIES (C2), CONDITIONS (C3), MEDICATION (C4), APPOINTMENTS (C5), EXAMS (C6). C1 (nome e data de nascimento) é sempre visível à família. |
| **Registo de saúde** | Qualquer entidade de saúde de um FamilyMember. Pertence a uma categoria. |

## 3. Alterações ao modelo inicial do prompt (análise exigida pelo prompt §10)

| Entidade inicial | Decisão | Razão |
|---|---|---|
| User | Mantida | Identidade. |
| Family | Mantida | Fronteira de isolamento. |
| FamilyMember | Mantida, **central** | Sujeito dos dados; permite membros sem conta (D1). |
| **HealthProfile** | **Removida**; tipo sanguíneo passa a atributo de FamilyMember | Seria 1:1 com FamilyMember e só teria um campo (simple first). Permissão tratada como categoria C2. |
| MedicalCondition, Allergy | Mantidas, separadas | Categorias de privacidade diferentes (C3/C2). |
| Prescription | Mantida | Documento clínico com estado próprio. |
| **PrescriptionMedication + Medication + MedicationSchedule** | **Fundidas numa só: MedicationPlan** | O medicamento é texto livre (D8), sem catálogo (`Medication` não tem razão para existir). A frequência é estruturada (Q1) e o plano é criado ao registar a receita (M2): os campos da "linha da receita" e do "plano" seriam os mesmos. `MedicationPlan` pode ou não ter `prescriptionId` (medicamento avulso, R7). |
| (novo) **DoseOccurrence** | Acrescentada | Cada toma individual com estado (D7). |
| Appointment | Mantida | |
| Clinic | Mantida com `type` PARTNER/PRIVATE | Resolve R11 (parceira vs. privada). |
| Examination, ExaminationResult | Mantidas | |
| HealthAlert | Renomeada **Alert**, acrescentada **Notification** | Separação Alerta vs. entrega (prompt §18). |
| **HealthReport** | **Removida como entidade** | Relatórios são vistas calculadas (D10), sem persistência. |
| Document | Mantida | |
| AuditLog | Mantida | |
| (novos) **Guardianship, Invitation, SharingGrant** | Acrescentadas | Tutela (N1), convites (D14), partilha (D13/R5). |
| (novos) **AuthToken, Session, NotificationPreference, PushSubscription, DataExport, FileDeletion** | Acrescentadas | Suporte técnico a requisitos já aprovados (verificação de e-mail, sessões, preferências, push, exportação, apagamento de ficheiros). |
| Regra de alerta (Rule) | **Não é entidade**: regras vivem no código com valores por defeito | R9: as antecedências são fixas (BR-APT-05); persistir regras seria overengineering. |

## 4. Decisões de modelação (adotadas)

| ID | Decisão | Recomendação adotada | Impacto |
|---|---|---|---|
| **DM1** | Onde pertencem os dados de saúde de quem está em duas famílias (D2)? | **Ao FamilyMember** (por família). Um User em duas famílias tem dois perfis independentes. Alternativa rejeitada: uma entidade `Person` global partilhada entre famílias. | Simples; "sair e levar dados" (R4) e apagar família funcionam por cascata; privacidade por família. Custo: o utilizador regista duas vezes se estiver em duas famílias (aceite). Ver ADR-005. |
| **DM2** | Quem é "dependente"? | Flag `isDependent` em FamilyMember; menor ⇒ `isDependent=true`; adulto só com consentimento. A idade deriva de `birthDate`, não é guardada. | Regras BR-MEM-02/03/04. |
| **DM3** | Como se representa "todos" na partilha? | `SharingGrant.granteeMemberId` **nulo = toda a família**. | Novo membro herda a partilha sem criar linhas. |
| **DM4** | Tutor principal | `Guardianship.isPrimary`, **exatamente um** por dependente. | Fuso dos alertas de dependente sem conta (Q8). |
| **DM5** | Geração das tomas | O **plano** guarda a regra; as **ocorrências** são materializadas numa janela móvel de 14 dias por um job e recalculadas quando o plano/fuso muda. | Alertas e histórico trabalham sobre linhas reais (idempotência). |
| **DM6** | Fuso horário do plano | Não é guardado no plano: usa-se o fuso efetivo do sujeito (User titular ou, sem conta, o do tutor principal). | Mudar o fuso recalcula tomas futuras (BR-MED-08). |
| **DM7** | Documento | Pertence a **um** recurso (receita ou exame) e à família; metadados na BD, ficheiro no armazenamento de objetos. | Regra BR-DOC-04. |
| **DM8** | Médico, profissional | **Texto livre**, não entidade. | Sem catálogo de profissionais no MVP. |

## 5. Invariantes do domínio (devem ser garantidas por código **e** por testes)

1. Todo registo de saúde pertence a **exatamente um** FamilyMember e à família desse membro (`family_id` coerente).
2. Uma família tem sempre ≥1 Admin; todo Admin é adulto com conta.
3. Todo dependente tem ≥1 tutor e exatamente 1 tutor principal; todo tutor é adulto com conta da mesma família.
4. Menor ⇒ dependente. Menor com conta ⇒ tutor autorizou (convite DEPENDENT_ACCOUNT) e idade ≥13.
5. Um User tem no máximo 1 FamilyMember por família.
6. `SharingGrant` só existe para as 5 categorias partilháveis, só concede leitura, e o dono é adulto ou dependente (gerido por tutor).
7. Documento só está disponível com `scanStatus = CLEAN`.
8. Alert tem `dedupeKey` único.
9. Estados só mudam pelas transições definidas em `state-machines.md`.
10. Nenhum dado de saúde aparece em logs técnicos, notificações externas ou mensagens de erro.
