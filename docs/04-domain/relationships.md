# Vita Family — Relações (Fase 9)

> Estado: **v0.1**. Cada relação tem uma razão de negócio (prompt §11). Cardinalidade: `1`, `0..1`, `N`.
> "Apaga em cascata" = hard delete (D15).

## 1. Diagrama

```text
 User 1 ──── 0..N ──── FamilyMember N ──── 1 ──── Family
  │                        │  │  │
  │                        │  │  └── Guardianship (dependente N ── N tutor, ambos FamilyMember)
  │                        │  └───── SharingGrant (dono N ── 0..N destinatário FamilyMember | família)
  │                        │
  │                        ├── 0..N Allergy
  │                        ├── 0..N MedicalCondition
  │                        ├── 0..N Prescription ── 1..N MedicationPlan ── 0..N DoseOccurrence
  │                        ├── 0..N MedicationPlan (avulso, sem Prescription)
  │                        ├── 0..N Appointment ── 0..1 Clinic ; ── 0..1 ClinicSlot (D17)
  │                        ├── 0..N Examination ── 0..N ExamResult ; ── 0..1 Clinic
  │                        └── 0..N Document (→ Prescription | Examination)
  │
  ├── 0..N Session, AuthToken, PushSubscription ; 1 NotificationPreference
  ├── 0..N Alert (destinatário) ── 0..N Notification
  └── 0..N DataExport

 Family 1 ── 0..N Invitation ;  Family 1 ── 0..N Clinic(PRIVATE) ;  Clinic(PARTNER) é global
 Clinic(PARTNER) 1 ── 0..N ClinicSlot ;  Clinic(PARTNER) 1 ── 0..N ClinicStaff ── 1 User   (D17)
```

## 2. Relações e razão de negócio

| Relação | Cardinalidade | Razão de negócio | Ao apagar |
|---|---|---|---|
| Family → FamilyMember | 1 : N | Uma família agrupa pessoas; o isolamento é por família. | Apagar a família apaga membros e tudo o que lhes pertence. |
| User → FamilyMember | 1 : 0..N (≤1 por família) | Um User pode estar em várias famílias (D2); um FamilyMember pode não ter conta (D1). | Apagar o User **apaga** os FamilyMember a ele ligados, e com eles os seus dados (BR-ACC-07). Dependentes da conta ficam, se houver tutor (P8 impede se for único tutor). |
| FamilyMember ↔ FamilyMember (Guardianship) | N : N | Tutela por dependente, com ≥1 tutor (N1). | Remover o último tutor é recusado. Apagar o dependente apaga as suas tutelas. |
| FamilyMember → SharingGrant (dono) | 1 : N | Cada titular decide a sua partilha (D13). | Cascata. |
| FamilyMember → SharingGrant (destinatário) | 0..1 : N | Partilha com membro concreto ou família (DM3). | Cascata (a partilha deixa de existir). |
| FamilyMember → registos de saúde | 1 : N | Os dados pertencem à pessoa dentro da família (DM1). | Cascata + `FileDeletion` para documentos. |
| Prescription → MedicationPlan | 1 : 1..N | Uma receita prescreve medicamentos; cada um é um plano (M2). | Eliminar receita apaga planos, doses e documentos (BR-RX-06). |
| MedicationPlan → DoseOccurrence | 1 : N | Histórico de tomas (D7). | Cascata. |
| Appointment/Examination → Clinic | N : 0..1 | Clinica parceira ou privada (R8). `clinicName` guarda texto de reserva. | `ON DELETE SET NULL`; o nome persiste. |
| Examination → ExamResult | 1 : N | Resultados estruturados (D8). | Cascata. |
| Document → Prescription ou Examination | N : 1 (polimórfico) | Anexos (M5). Integridade garantida por colunas separadas `prescription_id`/`examination_id` em `schema.md`. | Eliminar recurso apaga documentos e enfileira `FileDeletion`. |
| Clinic(PRIVATE) → Family | N : 1 | Cadastro privado da família (R8). | Cascata com a família. |
| User → Alert | 1 : N | Destinatários dos alertas (FR-ALR-08). | Cascata com o User. |
| Alert → Notification | 1 : N | Um alerta, uma entrega por canal ativo. | Cascata. |
| Invitation → Family | N : 1 | Convites pertencem a uma família (D14). | Cascata. |
| Invitation → FamilyMember (`memberId`) | N : 0..1 | Ligar convite a perfil existente (BR-MEM-13). | Se o perfil for apagado, o convite fica EXPIRED/REVOKED. |
| AuditLog → User | N : 0..1 | Quem agiu. | **Não** é cascata: anonimiza (`actorUserId`, `ip`, `userAgent` a nulo) (D15). |

## 3. Cardinalidades-chave resumidas

- Família ≥1 Admin; dependente ≥1 tutor, =1 principal; User ≤1 membro por família.
- Receita ≥1 plano; plano avulso permitido.
- Documentos: ≤5 por recurso, ≤100 MB por família.
- Clinic PARTNER: global; PRIVATE: ≤10 por família.
- Membros: ≤20 por família; convites pendentes: ≤20 por família; famílias por User: ≤5.
