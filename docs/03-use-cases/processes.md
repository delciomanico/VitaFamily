# Casos de uso — Processos (marco B fatia 1, ADR-032)

> Estado: **v0.2** (R7 do arquivo do marco B, 2026-11-16, ADR-037: sem cobertura, autorização nem despesa). Convenções comuns em `family.md`. Regras: BR-PRC-01..11. O `Process` é um **agregador de leitura**: id único por ato (consulta/exame) e estado simples para a família. Não há caso de uso de criação pelo utilizador: o processo nasce como efeito da criação do ato.

### UC-PRC-01 Abrir o processo de um ato (automático)
- **Ator:** o fluxo existente que cria o ato — família (`createAppointment`, `createExamination`), clínica (marcação presencial D20, exame de horário). Sem endpoint próprio · **Regras:** BR-PRC-01, BR-PRC-04.
- **Fluxo:** o caso de uso do módulo dono chama a porta `ProcessLinker.open` **dentro da transação** do ato → `processes` cria a linha (ou devolve a existente, idempotente por `(originType, originId)`) → o dono grava o `processId` no ato → auditoria `PROCESS_OPEN`.
- **Alternativos:** falha ao abrir ⇒ a transação do ato reverte (não existe ato sem processo); visita manual da clínica / recibo (sem ids Vita) ⇒ não abre (BR-CLN-24).

### UC-PRC-02 Fechar o ciclo ao apagar o ato (automático)
- **Ator:** o fluxo que apaga consulta/exame · **Regras:** BR-PRC-07.
- **Fluxo:** o dono apaga o ato e chama `ProcessLinker.discard` na mesma transação → auditoria `PROCESS_DISCARD`. Apagar membro/família: cascata por FK.

### UC-PRC-03 Ver os processos de um membro (família)
- **Ator:** titular (`SELF`), tutor (`TUTOR_OF`), dependente com conta (só consultas), membro com partilha da categoria · **Regras:** BR-PRC-02/03/05/09 · **Rota:** `GET /families/{f}/members/{m}/processes`.
- **Fluxo:** a aplicação decide `READ` por categoria (uma vez por pedido) → lê processos do membro em lotes (`openedAt` desc) → pede os factos ao `ProcessFacts` → `deriveFamilyStatus` por processo → aplica o filtro `status` → devolve até `limit` itens e `nextCursor`.
- **Alternativos:** nenhuma categoria legível ⇒ `[]`; membro de outra família/inexistente ⇒ `NOT_FOUND`; `BLOCKED` ⇒ `MEMBER_BLOCKED`; ato desaparecido ⇒ processo omitido (BR-PRC-09). **Resultado:** cartões "Marcado / A tratar / Feito / Cancelado" + "o que falta e de quem" (`nextStep`, traduzido na UI); passos novos para a família: **0**.

### UC-PRC-04 Ver o detalhe de um processo (família)
- **Ator:** os de UC-PRC-03 · **Rota:** `GET /families/{f}/members/{m}/processes/{processId}` · **Regras:** BR-PRC-05.
- **Alternativos:** inexistente, de outro membro/família ou de categoria não legível ⇒ `NOT_FOUND` (sem enumeração). Leitura por quem não é o titular ⇒ `PROCESS_VIEW`.


### UC-PRC-05 Ver o processo do meu atendimento (clínica)
- **Ator:** `CLINIC_ADMIN`/`CLINIC_MANAGER` · **Rota:** `GET /clinic-portal/processes/{processId}` (o `processId` vem em `ClinicBooking`/`ClinicExamBooking`) · **Regras:** BR-PRC-06.
- **Resultado:** id, tipo, origem, fase do ato e abertura. **Alternativos:** de outra clínica, sem clínica ou inexistente ⇒ `NOT_FOUND`; `CLINIC_DOCTOR` ⇒ `FORBIDDEN`.

### UC-PRC-06 Backfill dos atos existentes (migração)
- **Ator:** migração `0036` · **Regras:** BR-PRC-08 · **Resultado:** cada consulta e exame existente tem `Process` e `process_id`; idempotente; verificação de contagens (TC-PRC-14).
