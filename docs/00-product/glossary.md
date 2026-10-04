# Vita Family — Glossário

> v0.2 (2026-10-04). Termos ainda não aprovados formalmente estão marcados.

| Termo | Definição |
|---|---|
| **User** | Pessoa com conta e credenciais. Pode pertencer a várias famílias (D2). |
| **Family** | Grupo cuja saúde é gerida em conjunto. Fronteira de isolamento de dados. |
| **FamilyMember** | Pessoa dentro de uma família; pode ou não ter conta (D1). |
| **Dependente** | FamilyMember sob responsabilidade de um tutor; pode ter conta de acesso limitado (M4). |
| **Family Admin** | Papel com permissões de gestão da família. Âmbito exato: Fase 5. |
| **Family Member** | Papel com permissões limitadas. Âmbito exato: Fase 5. |
| **Adulto / Menor** | Adulto ≥18 anos controla os seus dados (D13, M1). Menor <18 está sob responsabilidade de tutor/responsável. |
| **Tutor / Responsável** | Pessoa responsável por um dependente; edita o seu perfil de saúde (M6). Relação por dependente — N1 pendente. |
| **Convite** | Pedido para uma conta existente entrar numa família (D14). |
| **Health Profile** | Resumo base de saúde de um membro. |
| **Medical Condition / Allergy** | Condição ou alergia registada. |
| **Prescription** | Receita registada manualmente, com medicamentos e documento. |
| **Medication** | Medicamento em texto livre (D8). |
| **Medication Schedule** | Plano de toma (horários, duração). |
| **Dose Log** | Registo de toma confirmada/não confirmada (D7). Nome provisório. |
| **Appointment** | Consulta, com estados simples (D9). |
| **Clinic** | Entidade de cadastro sem login no MVP (D3). |
| **Examination / Exam Result** | Exame e resultado estruturado simples (D8). |
| **Reference Range** | Intervalo de referência **informado pelo utilizador**, nunca determinado pelo sistema. |
| **Document** | Ficheiro anexo guardado fora da base de dados. |
| **Event → Rule → Alert → Notification** | Cadeia de alertas: facto → regra → aviso → entrega (push/e-mail). |
| **Health Alert** | Aviso informativo; **nunca diagnóstico**. |
| **Health Report** | Vista agregada de dados existentes, via API (D10). |
| **Audit Log** | Registo de operações sensíveis, anonimizado ao apagar dados (D15). |
| **Platform Admin** | Staff Vita sem acesso a dados de saúde (D4). |
| **PWA** | Web app instalável; cliente do MVP (D12). |
| **MVP** | Menor versão que valida o produto. |
| **ADR / RBAC** | Architecture Decision Record / controlo de acesso por papéis. |
