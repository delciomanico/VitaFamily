# Casos de uso — Recomendações da clínica (D19, ADR-023)

> Estado: **v0.1** — convenções comuns em `family.md`. Regras: BR-CLN-09. A recomendação é **nota de texto** da clínica; o sistema não a interpreta nem gera alertas por conteúdo (D11).

### UC-REC-01 Emitir recomendação
- **Ator:** conta da clínica (`CLINIC_ADMIN`/`CLINIC_MANAGER`) · **FR:** REC-01
- **Fluxo:** na agenda, escolhe uma consulta ou um exame **da própria clínica** em estado `SCHEDULED` ou `COMPLETED` → escreve o texto (1–2000 caracteres) → grava → o paciente/tutor recebe uma notificação genérica (`RECOMMENDATION_ADDED`, sem conteúdo).
- **Alternativos:** origem de outra clínica, inexistente ou noutro estado ⇒ `NOT_FOUND`/`CONFLICT`; origem dupla ou nenhuma ⇒ `VALIDATION_ERROR`.
- **Regras:** imutável pela clínica; auditada (`RECOMMENDATION_CREATE`, sem o texto); o texto nunca vai para logs nem notificações (BR-HLT-05).

### UC-REC-02 Ver as recomendações que a clínica emitiu
- **Ator:** conta da clínica · **Resultado:** lista (filtrável por consulta/exame) só das recomendações da própria clínica.

### UC-REC-03 Ler recomendações recebidas
- **Ator:** titular, tutor, dependente com conta (só as de consulta), membro com partilha da categoria da origem · **FR:** REC-01
- **Resultado:** lista por membro (filtro por consulta/exame), com nome da clínica e data; a leitura por quem não é o titular é auditada. Listas filtram por permissão (omitir, não anular).
