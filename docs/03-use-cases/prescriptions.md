# Casos de uso — Receitas (Fase 6)

> Estado: **RASCUNHO v0.1** — convenções comuns em `family.md`.
> Quem pode: titular ou tutor (categoria C4). Outros membros só leem se houver partilha. Dependente com conta lê (N2) mas não edita.

### UC-RX-01 Registar receita
- **Ator:** titular ou tutor · **FR:** RX-01 a RX-06, M2, R7
- **Fluxo:** escolhe o membro → indica **data de emissão** (obrigatória), médico (opcional), observações → adiciona 1+ medicamentos (nome em texto livre, dosagem, frequência, duração, observações) → opcionalmente anexa documento (UC-DOC-01) → sistema cria a receita **ATIVA** e, para cada medicamento, **cria o plano de toma** (UC-MED-01) → gera alertas futuros (UC-ALR-01).
- **Alternativos:** sem medicamentos → recusado; data de emissão futura → recusado `[PROPOSTO]`; frequência/duração não interpretáveis para gerar horários → o plano é criado sem horários e o utilizador é avisado para os definir (ver Q1).
- **Pós-condição:** receita ATIVA, planos de toma ativos e editáveis.

### UC-RX-02 Editar receita
- **Ator:** titular ou tutor
- **Fluxo:** altera campos da receita ou de um medicamento.
- **Regra:** `[PROPOSTO]` editar dosagem/frequência/duração de um medicamento **não reescreve o passado**: as tomas já registadas mantêm-se; as ocorrências futuras são recalculadas.

### UC-RX-03 Ver receitas
- **Ator:** titular, tutor ou membro com partilha C4
- **Resultado:** lista por membro, filtrável por estado; detalhe com medicamentos e documento.

### UC-RX-04 Concluir ou cancelar receita
- **Ator:** titular ou tutor · **FR:** RX-04, MED-06
- **Fluxo:** muda o estado para CONCLUÍDA ou CANCELADA → planos de toma associados terminam; ocorrências futuras são removidas; histórico de tomas mantém-se.
- **Automático:** `[PROPOSTO]` receita passa a CONCLUÍDA quando todos os seus planos terminam por duração. Estados finais: Fase 10.

### UC-RX-05 Adicionar / remover medicamento de uma receita ativa
- **Ator:** titular ou tutor
- **Regra:** remover medicamento termina o seu plano (UC-MED-04); adicionar cria novo plano.

### UC-RX-06 Eliminar receita
- **Ator:** titular ou tutor · **FR:** DOC-04, PRIV-03
- **Fluxo:** confirmação → apaga a receita, planos, histórico de tomas associado e documentos.
- **Alternativo:** `[PROPOSTO]` aconselhar CANCELAR em vez de eliminar, por perder histórico de tomas.
