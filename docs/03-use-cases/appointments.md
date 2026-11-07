# Casos de uso — Consultas e clínicas (Fase 6)

> Estado: **RASCUNHO v0.1** — convenções comuns em `family.md`.
> Quem pode: titular ou tutor criam/editam/cancelam. Dependente com conta vê (N2). Membros com C5 partilhado veem.

### UC-APT-01 Criar consulta (clínica privada ou sem clínica)
> D17: numa clínica **parceira**, usar UC-APT-07.
- **Ator:** titular ou tutor · **FR:** APT-01, APT-02, APT-04
- **Fluxo:** escolhe o membro → indica data e hora (no fuso do utilizador), profissional (texto), clínica (parceira, entrada privada ou nenhuma), motivo/observações → sistema cria a consulta **AGENDADA** → gera lembretes (UC-ALR-01).
- **Alternativos:** data no passado → `[PROPOSTO]` permitido para registo retroativo; entra já como REALIZADA se escolhido, sem lembretes.

### UC-APT-02 Editar / reagendar consulta
- **Ator:** titular ou tutor
- **Efeito:** lembretes futuros recalculados; lembretes já enviados não são anulados.

### UC-APT-03 Cancelar consulta
- **Ator:** titular ou tutor · **FR:** APT-03
- **Fluxo:** estado CANCELADA; lembretes futuros removidos.

### UC-APT-04 Marcar como realizada ou faltou
- **Ator:** titular ou tutor
- **Fluxo:** depois da hora, atualiza para REALIZADA ou FALTOU; pode acrescentar notas.
- **Automático:** Decidido em Q4: permanece AGENDADA e 24 h depois o sistema pede o desfecho (uma vez).

### UC-APT-05 Ver consultas
- **Ator:** titular, tutor, dependente com conta, membro com C5 partilhado · **FR:** APT-01
- **Resultado:** próximas e passadas, filtros por membro, estado e período.

### UC-APT-06 Eliminar consulta
- **Ator:** titular ou tutor · **Regra:** apaga lembretes associados; documentos associados à consulta não existem no MVP.

### UC-APT-07 Pedir consulta num horário de clínica parceira (D17)
- **Ator:** titular ou tutor · **FR:** APT-05, APT-06
- **Fluxo:** escolhe o membro → especialidade → clínica parceira → horário livre (dia e hora, com o profissional quando indicado) → observações opcionais → é informado de que a clínica recebe nome, especialidade, profissional, data/hora e observações → envia → consulta **PEDIDA** (aguarda confirmação).
- **Alternativos:** horário entretanto ocupado → recusado, escolher outro (BR-APT-06); desistir do pedido → CANCELADA.
- **Pós-condição:** horário reservado até à resposta; sem lembretes enquanto PEDIDA (BR-APT-07).

### UC-APT-08 Mudar data/hora de uma consulta de clínica parceira (D17)
- **Regra:** cancelar e pedir outro horário (BR-APT-09); só as observações se editam.

---

## Portal da clínica (D17)

### UC-CLN-04 Publicar e remover horários
- **Ator:** Gestor da clínica · **FR:** APT-06
- **D19:** cada horário tem `kind` (`APPOINTMENT` por defeito ou `EXAM`, UC-CLN-07; BR-APT-10).
- **Fluxo:** escolhe dia(s), horas, especialidade, profissional (opcional) e duração → publica. Remove só horários sem marcações ativas (BR-CLN-04). Em `EXAM` define também as vagas (`capacity`, BR-APT-11); `APPOINTMENT` tem sempre 1 vaga e mantém o fluxo UC-CLN-05.

### UC-CLN-05 Confirmar ou recusar pedidos
- **Ator:** Gestor da clínica · **FR:** APT-06, APT-07
- **Fluxo:** vê os pedidos da clínica (dados mínimos, BR-CLN-03) → confirma (AGENDADA, geram-se lembretes) ou recusa com motivo opcional (RECUSADA, horário volta a ficar livre) → o titular/tutor é informado.

### UC-CLN-06 Ver a agenda da clínica e cancelar
- **Ator:** Gestor da clínica
- **Resultado:** consultas confirmadas por dia; pode cancelar uma consulta confirmada com motivo (o titular/tutor é informado; horário fica livre).

### UC-CLN-08 Marcar consulta presencial para um utilizador registado (D20, ADR-024)
- **Ator:** Gestor/Admin da clínica · **BR:** CLN-10, CLN-03, APT-04/06
- **Fluxo:** escolhe um horário `APPOINTMENT` livre da clínica → introduz o e-mail do paciente → vê o `displayName` devolvido (confirma presencialmente que é a pessoa) → confirma → consulta `SCHEDULED` na agenda da clínica e no membro `SELF` do utilizador; o paciente é avisado (OP-22).
- **Alternativos:** 404 genérico (sem conta/suspenso/sem `SELF`: a clínica não sabe qual); horário ocupado/passado → `CONFLICT`; sobreposição com outra consulta do paciente → `CONFLICT`; rate limit → `RATE_LIMITED`.
- **M14 (BR-CLN-13/16):** a sobreposição é por **duração** (`[início, início+duração)`) e, num horário com `professionalId`, também por profissional.
- **Pós-condição:** `walk_in=true`; gestão posterior só pela clínica (cancelar com motivo UC-CLN-06, completar, recomendações); auditoria `CLINIC_WALKIN_LOOKUP`/`CLINIC_WALKIN_BOOK`.

### UC-CLN-11 Gerir profissionais e tipos de serviço (M14 a1, ADR-026)
- **Ator:** conta da clínica (Admin ou Gestor) · **FR:** CLN-04 · **BR:** CLN-11, CLN-12
- **Fluxo:** em **Serviços** vê duas listas (Profissionais; Consultas e exames) → cria (nome, especialidade; ou nome, tipo consulta/exame, duração, preço opcional) → edita ou **desativa** (nunca apaga; pode reativar). A moeda é a da clínica (AOA por omissão).
- **Alternativos:** nome duplicado entre ativos ou limite atingido → `CONFLICT`; duração fora de {15,20,30,45,60} ou preço negativo → `VALIDATION_ERROR`; mudar o tipo (consulta/exame) de um serviço → `VALIDATION_ERROR` (criar outro).
- **Pós-condição:** desativar remove os horários futuros livres gerados (BR-CLN-15); marcações existentes intactas; auditoria `CLINIC_PROFESSIONAL_*`/`CLINIC_SERVICE_*` sem nomes.

### UC-CLN-12 Definir regras de horário e gerar horários (M14 a2)
- **Ator:** conta da clínica (Admin ou Gestor) · **FR:** CLN-05 · **BR:** CLN-12, CLN-13, CLN-15, CLN-16
- **Fluxo:** em **Agenda → Horários e disponibilidade** escolhe profissional, serviço, dias da semana, hora de início e fim (e, opcionalmente, validade e vagas se for exame) → guarda → o sistema mostra o resumo ("criados N horários; M ignorados por sobreposição/bloqueio") e os horários aparecem no calendário e na marcação (família e presencial). Pode editar, **desativar** ou **regenerar** a regra; todos os dias o sistema acrescenta as semanas seguintes (job).
- **Alternativos:** regra sobreposta a outra ativa do profissional, profissional/serviço inativo → `CONFLICT`; intervalo menor que a duração, vagas > 1 em consulta → `VALIDATION_ERROR`; outra clínica → `NOT_FOUND`.
- **Pós-condição:** `ClinicSlot` gerados com `professionalId`/`serviceTypeId`/`scheduleRuleId`; repetir não duplica; marcações nunca alteradas; auditoria `CLINIC_SCHEDULE_RULE_*`/`CLINIC_SCHEDULE_GENERATE`.

### UC-CLN-13 Bloquear um profissional (bloqueio/férias) (M14 a2)
- **Ator:** conta da clínica (Admin ou Gestor) · **FR:** CLN-06 · **BR:** CLN-14
- **Fluxo:** escolhe profissional, início e fim (e nota interna opcional) → o sistema remove os horários livres do intervalo e **mostra a lista de horários já marcados** que a clínica tem de tratar (reagendar/cancelar com motivo, UC-CLN-06) → o aviso mantém-se na lista de bloqueios enquanto houver marcações. Remover o bloqueio repõe os horários que as regras ainda prevêem.
- **Alternativos:** intervalo inválido (fim ≤ início, > 366 dias, no passado) → `VALIDATION_ERROR`; profissional de outra clínica → `NOT_FOUND`.
- **Pós-condição:** nenhuma marcação é cancelada automaticamente; auditoria `CLINIC_TIME_OFF_*` sem a nota.

---

## Clínicas

### UC-CLN-01 Criar clínica privada
- **Ator:** qualquer membro da família (adulto) · **FR:** CLN-01, R8
- **Fluxo:** indica nome, morada/contacto (opcionais) → entrada visível **só para a família**.
- **Regra:** `[PROPOSTO]` qualquer membro adulto cria; editar/apagar: quem criou ou o Admin. R11 resolvido: `type` PARTNER/PRIVATE.

### UC-CLN-02 Ver / pesquisar clínicas
- **Ator:** membro · **Resultado:** parceiras (globais) + privadas da sua família.

### UC-CLN-03 Eliminar clínica privada
- **Ator:** criador ou Family Admin
- **Alternativo:** em uso por consultas → `[PROPOSTO]` as consultas mantêm o nome da clínica como texto, sem perder dados.

### UC-ADM-03 Gerir clínicas parceiras
- **Ator:** Platform Admin · **FR:** ADM-01, R8
- **Fluxo:** criar, editar, arquivar clínicas parceiras.
- **Regra:** arquivar não apaga consultas existentes; impede novas seleções.

---

## Administração da plataforma

### UC-ADM-01 Listar contas
- **Ator:** Platform Admin · **Resultado:** e-mail, estado e data de registo; **nunca** dados de saúde.

### UC-ADM-02 Suspender / reativar conta
- **Ator:** Platform Admin · **FR:** ADM-01
- **Efeito:** conta suspensa não faz login, sessões terminadas, notificações pausadas `[PROPOSTO]`; os dados ficam intactos.
- **Auditoria:** quem, quando, motivo.

### UC-ADM-04 Pesquisar utilizadores e ver detalhe (ADR-023)
- **Ator:** Platform Admin · **FR:** ADM-02 · **BR:** BR-ADM-01
- **Fluxo:** pesquisa por `q` (e-mail/nome) e estado → abre o detalhe operacional. **Nunca** dados de saúde, famílias ou membros.

### UC-ADM-05 Repor o acesso de um utilizador (ADR-023)
- **Ator:** Platform Admin · **FR:** ADM-02 · **BR:** BR-ADM-02
- **Fluxo:** pede `reset-access` → sessões revogadas → o utilizador recebe o e-mail de recuperação (ou nova verificação se `PENDING_VERIFICATION`). Auditado; o Admin nunca vê palavra-passe/token.

### UC-ADM-06 Gerir contas do portal de uma clínica (ADR-023)
- **Ator:** Platform Admin · **FR:** ADM-03 · **BR:** BR-ADM-03/04
- **Fluxo:** abre a clínica → lista as contas (`CLINIC_ADMIN` + `CLINIC_MANAGER`) → suspende (motivo) ou reativa uma conta; suspender revoga `clinic_sessions`. Não cria nem remove Gestores (BR-CLN-05); reposição da raiz por UC-ADM-03/`root-account`.

### UC-ADM-07 Gerir seguradoras parceiras (ADR-021/ADR-023)
- **Ator:** Platform Admin · **FR:** ADM-04 · **BR:** BR-ADM-05/06, BR-INS-06/10
- **Fluxo:** lista, cria (nome, NIF único), edita, suspende/reativa; cria/repõe a conta `INSURANCE_ADMIN` raiz. Sem eliminação.
