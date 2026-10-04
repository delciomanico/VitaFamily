# Casos de uso — Relatórios (Fase 6)

> Estado: **RASCUNHO v0.1** — convenções comuns em `family.md`.
> Relatórios só por API, JSON (D10-A); sem PDF nem partilha por link.
> Só agregam dados existentes; **sem interpretação clínica** (prompt §19). Respeitam sempre as permissões e a partilha (FR-RPT-03).

### UC-RPT-01 Relatório individual de um membro
- **Ator:** titular, tutor, ou membro com partilha (só as categorias partilhadas) · **FR:** RPT-01
- **Conteúdo possível:** perfil (C1), alergias (C2), condições e histórico (C3), receitas e medicamentos ativos, histórico de tomas e adesão (C4), consultas passadas e futuras (C5), exames e resultados (C6).
- **Fluxo:** escolhe o membro e o período → sistema devolve apenas as secções que o pedinte pode ver; secções sem permissão **são omitidas**, não indicadas como vazias, para não revelar a sua existência.
- **Auditoria:** geração do relatório de outro titular.

### UC-RPT-02 Visão familiar
- **Ator:** qualquer membro · **FR:** RPT-02, RPT-03
- **Conteúdo:** por cada membro visível ao pedinte (ele próprio, os seus dependentes e membros com partilha): condições, alergias, medicamentos ativos, próximas consultas e exames, itens pendentes.
- **Itens pendentes (proposta):** tomas ativas "não confirmadas" recentes, consultas AGENDADAS já passadas (Q4), exames AGENDADOS já passados.
- **Regra:** o Family Admin **não** vê mais do que os outros membros por ser Admin (D13).

### UC-RPT-03 Resumo de adesão à medicação
- **Ator:** titular, tutor, ou com C4 partilhado
- **Conteúdo:** tomas confirmadas / não tomadas / não confirmadas num período, por medicamento; **só números e datas**, sem juízo clínico.

### UC-RPT-04 Exportar os meus dados
- Ver UC-ACC-06 (portabilidade, RGPD). Não é um relatório; é cópia integral dos dados do titular.

---

## Pontos ainda abertos
- **Q11 — Período por defeito e limites** dos relatórios (proposta: últimos 12 meses; máximo 5 anos; listas paginadas).
- A forma exata dos relatórios (campos) é definida na Fase 13 (contrato da API).
