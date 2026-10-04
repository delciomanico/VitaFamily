# Casos de uso — Medicamentos e tomas (Fase 6)

> Estado: **RASCUNHO v0.1** — convenções comuns em `family.md`.
> Quem confirma tomas: titular, tutor e dependente com conta (M4, N2).

### UC-MED-01 Criar plano de toma (automático ou manual)
- **Ator:** Sistema (a partir de UC-RX-01) ou titular/tutor (medicamento avulso, R7) · **FR:** MED-02, MED-03, RX-05
- **Fluxo manual:** indica medicamento (texto livre), dosagem, frequência, **horários**, data de início, duração ou fim → sistema cria o plano e gera ocorrências de toma.
- **Regras:** horários interpretados no **fuso do titular**; para dependente `[PROPOSTO]` usa-se o fuso do tutor principal, e cada alerta é entregue no fuso de cada destinatário (ver Q8); plano avulso não tem receita associada.
- **Modelo de frequência:** Decidido em Q1 (horários fixos + "de X em X horas")..

### UC-MED-02 Ver medicamentos ativos
- **Ator:** titular, tutor, dependente com conta, membro com C4 partilhado · **FR:** MED-01
- **Resultado:** planos ativos por membro, com próximos horários e duração restante.

### UC-MED-03 Ver tomas do dia / agenda de tomas
- **Ator:** titular, tutor ou dependente com conta
- **Resultado:** lista de ocorrências de hoje (pendente / confirmada / não confirmada) por membro de quem é responsável.

### UC-MED-04 Editar ou terminar plano de toma
- **Ator:** titular ou tutor · **FR:** MED-06
- **Fluxo:** altera horários/duração (efeito só no futuro) ou termina o plano (ocorrências futuras removidas; histórico mantém-se).
- **Automático:** o plano termina no fim da duração.

### UC-MED-05 Confirmar toma
- **Ator:** titular, tutor ou dependente com conta · **FR:** MED-04, D7
- **Fluxo:** seleciona a ocorrência → confirma → sistema regista **quem** confirmou e **quando** → o alerta associado deixa de repetir `[ver Q3]`.
- **Alternativos:** ocorrência já confirmada → operação idempotente (sem duplicar); confirmar uma ocorrência futura além de um limite `[PROPOSTO]` recusado; janela para confirmação tardia: ver Q2.

### UC-MED-06 Marcar toma como não tomada
- **Ator:** titular, tutor ou dependente com conta
- **Fluxo:** marca a ocorrência como "não tomada" (opcionalmente com nota) → regista no histórico.
- **Nota:** diferente de "não confirmada" (sem ação do utilizador).

### UC-MED-07 Corrigir uma toma registada
- **Ator:** quem confirmou, o titular ou o tutor
- **Fluxo:** altera o estado ou a hora de uma toma `[PROPOSTO]` dentro de um prazo; a alteração é auditada (R6: só estado atual).

### UC-MED-08 Ver histórico de tomas
- **Ator:** titular, tutor, ou membro com C4 partilhado · **FR:** MED-05
- **Resultado:** por plano e período: confirmadas, não tomadas, não confirmadas; taxa de adesão calculada a partir dos registos (sem interpretação clínica).

### UC-MED-09 Marcar ocorrências como "não confirmadas" (processo do sistema)
- **Ator:** Scheduler · **FR:** MED-05
- **Fluxo:** passado o prazo (Q2) sem ação do utilizador, a ocorrência fica "não confirmada" no histórico.
- **Regra:** **não** gera alerta ao Admin nem ao tutor (FR-MED-07, D7-B); apenas histórico.
