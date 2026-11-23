# Casos de uso — Relatórios (Fase 6)

> Estado: **RASCUNHO v0.1** — convenções comuns em `family.md`.
> Relatórios só por API, JSON (D10-A); sem PDF nem partilha por link.
> Só agregam dados existentes; **sem interpretação clínica** (prompt §19). **Change control 2026-11-21:** UC-RPT-05/06 («Resumo de saúde», estatísticas sem IA, M17); a IA opcional está em `ai-assistant.md` (ADR-039). Respeitam sempre as permissões e a partilha (FR-RPT-03).

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

### UC-RPT-05 Resumo de saúde de um membro (M17, change control 2026-11-21)
- **Ator:** titular, tutor, ou membro com partilha (só as categorias partilhadas) · **FR:** RPT-05 · **BR:** BR-RPT-01, BR-RPT-11..17
- **Fluxo:** escolhe o membro e o **período** (30 dias / 90 dias / 12 meses (omissão) / personalizado ≤ 5 anos) → `GET /families/{f}/members/{m}/health-summary?from&to` → o sistema devolve, **calculado sem IA**, apenas as secções visíveis ao pedinte:
  1. **Adesão à medicação** (MEDICATION): global e por medicamento, `adherencePct` e contagens, série por semana/mês (BR-RPT-13);
  2. **Séries de parâmetros de exames** (EXAMS): `count`, `min`, `max`, `first`, `last`, variação absoluta e %, pontos, referência do utilizador (BR-RPT-14);
  3. **Consultas e exames por período** (APPOINTMENTS/EXAMS): por estado e mês; próximos 30 dias (BR-RPT-15);
  4. **Receitas** (MEDICATION): ativas, **a terminar** (≤ 14 dias), concluídas/canceladas no período (BR-RPT-15);
  5. **Alertas** do membro dirigidos ao pedinte: total, não lidos, por tipo (BR-RPT-15);
  6. **O que falta registar**: completude, não clínica (BR-RPT-17).
- **Regras:** secções sem permissão **omitidas** (D13); nenhum valor é assinalado fora da referência (BR-EXM-02); sem metas nem rótulos («boa adesão»); sem texto de IA; sem tabelas novas.
- **Alternativos:** sem dados no período ⇒ secção com contagens a 0 e `adherencePct=null`; `from > to` ou > 5 anos ⇒ `VALIDATION_ERROR`; membro de outra família ⇒ `NOT_FOUND`.
- **Auditoria:** `REPORT_VIEW` (`kind=HEALTH_SUMMARY`) quando inclui outro titular.

### UC-RPT-05b Resumo de saúde da família (M17)
- **Ator:** qualquer membro · **FR:** RPT-06 · **BR:** BR-RPT-11/12/16
- `GET /families/{f}/health-summary?from&to`: um bloco por membro **visível** ao pedinte (ele próprio, dependentes, partilhas) com o resumo reduzido (adesão global, contagens, o que falta) e a **atividade por membro** (BR-RPT-16). O Family Admin não vê mais por ser Admin (D13).

### UC-RPT-06 Imprimir / guardar o Resumo de saúde (M17; **proposta**, OP-134)
- **Ator:** o que pode ver o Resumo · **BR:** BR-RPT-18
- **Fluxo:** na vista do Resumo → «Imprimir / Guardar como PDF» → a app abre a impressão do browser com uma folha formatada (período, «gerado em», só o que o utilizador vê). **Gerado no dispositivo**: o servidor não cria PDF, não guarda cópia, não cria ligação.
- **Regras:** aviso «ao partilhar este ficheiro os dados saem da Vita Family»; para dar acesso a um profissional usa-se a partilha de MK4 (o Resumo não é categoria de partilha); a exportação RGPD (UC-RPT-04) não muda.

### UC-RPT-04 Exportar os meus dados
- Ver UC-ACC-06 (portabilidade, RGPD). Não é um relatório; é cópia integral dos dados do titular.

---

## Pontos ainda abertos
- **Q11 — Período por defeito e limites** dos relatórios (proposta: últimos 12 meses; máximo 5 anos; listas paginadas).
- A forma exata dos relatórios (campos) é definida na Fase 13 (contrato da API).
