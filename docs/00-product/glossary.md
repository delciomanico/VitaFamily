# Vita Family — Glossário

> v0.2 (2026-10-04). Termos ainda não aprovados formalmente estão marcados.

| Termo | Definição |
|---|---|
| **User** | Pessoa com conta e credenciais. Pode pertencer a várias famílias (D2). |
| **Family** | Grupo cuja saúde é gerida em conjunto. Fronteira de isolamento de dados. |
| **FamilyMember** | Pessoa dentro de uma família; pode ou não ter conta (D1). |
| **Process / Processo** | (ADR-032, marco B fatia 1) Registo agregador com identificador único (`processId`) por ato com ids Vita (consulta, exame). Mostra à família **um** de 4 estados (Marcado / A tratar / Feito / Cancelado) e uma frase "o que falta e de quem", ambos **derivados** do ato; não tem estados próprios nem dados clínicos. Termo de UI da família: "processo" (sem "autorização/despesa/glosa/elegibilidade/sinistro" no ecrã da família). |
| **Pedido de autorização / Autorização** | (ADR-034, marco B fatia 3) Pedido do **prestador** à seguradora para um serviço do catálogo, com justificação **administrativa** (sem diagnóstico). Estados (profissional): `SUBMITTED`, `IN_REVIEW` (em análise), `INFO_REQUESTED` (falta informação), `APPROVED`, `REJECTED` (recusada), `CANCELLED`; «aprovada em parte» = `APPROVED` com valor autorizado menor (derivado). **Não** é termo do ecrã da família (a família vê o `Process`). |
| **Semáforo (elegibilidade)** | (BR-SEG-43) Resposta de cobertura à clínica para um serviço: **verde** (coberto, sem autorização), **amarelo** (pedir autorização), **vermelho** (não coberto), mais o copagamento; nunca a razão nem o saldo. |
| **Recurso** | (BR-AUT-08) Novo pedido de autorização ligado a um pedido recusado, dentro de 15 dias (valor da seguradora); o recusado não muda; vários, sem limite fixo. |
| **Concluir ato** | (BR-CLN-57) Ação única da clínica que conclui a consulta e grava, na mesma transação, o relatório (Médico), os pedidos de exame (Médico) e o recibo (Admin/Gestor); a despesa junta-se na fatia 2b. |
| **Fila de autorizações** | (ADR-035, marco B fatia 4) Lista de pedidos de autorização a decidir pela seguradora, o mais atrasado primeiro; vê-se no portal da seguradora (não é termo da família nem da clínica). |
| **Regra de auto-aprovação** | (BR-AUT-23) Regra simples da **seguradora**: um tipo de serviço (ou serviço) e um valor máximo. Se um pedido a cumpre e o serviço está coberto, sem carência nem limite esgotado, nasce aprovado pelo sistema (decisão automática, auditada, com o rasto visível ao analista e reversível só pelo Supervisor). Sem IA; o Vita não decide. |
| **Supervisor** | (ADR-035, `authorization.md` §8.2c) Papel da seguradora que atribui pedidos, decide **recursos**, reabre recusas, reverte aprovações (a automática só ele) e gere as regras de auto-aprovação; não decide pedidos normais. Quem analisa ≠ quem supervisiona. |
| **Prazo de decisão / SLA** | (BR-AUT-06/20) Prazo (24–120 h, 48 h por omissão, configurável pela seguradora) em que a seguradora deve decidir. É **medido**, não decide: ultrapassá-lo só marca o pedido para o Supervisor; **nunca** aprova por silêncio. |
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
| **Appointment** | Consulta. Em clínica parceira: pedida → confirmada/recusada (D17); noutras, registada diretamente (D9). |
| **ClinicSlot** | Horário livre publicado por uma clínica parceira, onde o utilizador pode pedir consulta (D17). |
| **Clinic** | Cadastro de clínicas (D3). As parceiras têm Gestor da clínica com portal próprio (D17). |
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
