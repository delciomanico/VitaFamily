# Vita Family — Glossário

> v0.2 (2026-10-04). Termos ainda não aprovados formalmente estão marcados.

| Termo | Definição |
|---|---|
| **User** | Pessoa com conta e credenciais. Pode pertencer a várias famílias (D2). |
| **Family** | Grupo cuja saúde é gerida em conjunto. Fronteira de isolamento de dados. |
| **FamilyMember** | Pessoa dentro de uma família; pode ou não ter conta (D1). |
| **Process / Processo** | (ADR-032, marco B fatia 1) Registo agregador com identificador único (`processId`) por ato com ids Vita (consulta, exame). Mostra à família **um** de 4 estados (Marcado / A tratar / Feito / Cancelado) e uma frase "o que falta e de quem", ambos **derivados** do ato; não tem estados próprios nem dados clínicos. Termo de UI da família: "processo" (sem "autorização/despesa/glosa/elegibilidade/sinistro" no ecrã da família). |
| **Concluir ato** | (BR-CLN-57) Ação única da clínica que conclui a consulta e grava, na mesma transação, o relatório (Médico), os pedidos de exame (Médico) e o recibo (Admin/Gestor). |
| **Profissional** | (ADR-037, MK1) Pessoa que presta serviços de saúde ou bem-estar no mercado do Vita; conta própria (`ProfessionalAccount`), validada pelo admin. Categoria **Saúde** ou **Bem-estar** (do catálogo de especialidades), com avisos diferentes. |
| **Mercado de profissionais** | (ADR-037) Parte do Vita onde a família descobre, compara preços, conversa, marca e avalia profissionais. Pagamento **fora da app**; ranking só por avaliações verificadas, nunca por pagamento. |
| **Como ordenamos** | (MK2) Regra pública do ranking por especialidade: completude do perfil, disponibilidade, preço relativo e antiguidade na plataforma; **nunca** pagamento nem destaques pagos. Cada profissional mostra as razões. Desde MK3 (`v2`) inclui também as **avaliações verificadas** de quem consultou (média suavizada; «Novo» com menos de 3). |
| **Conversa** | (MK2) Troca de mensagens de texto entre uma família (titular ou tutor, em nome do membro) e um profissional **antes de marcar**; sem anexos; o profissional só vê o nome que a família escolheu; o admin só lê a mensagem denunciada e as 2 anteriores da mesma conversa; guarda-se 24 meses desde a última mensagem. |
| **Comparar preços** | (MK2) Ver 2–3 profissionais lado a lado numa especialidade, com preços por método em Kz. |
| **Comprovativo de pagamento** | (MK3, BR-MKT-56..58) Ficheiro que a família envia a provar que pagou fora da app; o profissional confirma ou rejeita (com motivo) e a família pode disputar uma rejeição, caso em que o admin vê só o comprovativo e a marcação. O Vita regista o estado, não valida o dinheiro. |
| **Avaliação verificada** | (MK3, BR-MKT-59) Nota (1–5) e comentário curto de uma marcação concluída com pagamento satisfeito, feita só por quem consultou; **anónima** e pública para famílias autenticadas; o profissional responde uma vez; é a única fonte de avaliações do ranking. |
| **Marcação** | (MK3, BR-MKT-50..55) Pedido da família a um profissional para um horário e uma oferta (método e preço em Kz copiados); o profissional confirma ou recusa; ao confirmar cria-se a consulta no registo do membro. Não tem motivo em texto livre. |
| **Partilha com prazo / visualização única** | (MK4) Concessão da família para o profissional ver categorias escolhidas até um prazo (24 h, 7 d, 30 d, fim da consulta) ou uma só vez; revogável; cada acesso fica registado e visível à família. O app não impede capturas de ecrã e diz-o. |
| **Episódio de cuidado** | (ADR-037) Uso do `Process` para uma marcação do mercado (`originType=BOOKING`); a família vê os 4 estados simples. |
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
