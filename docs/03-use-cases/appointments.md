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
- **M14 P (BR-CLN-18):** o paciente pode ser um **paciente da clínica** (`clinicPatientId`, UC-CLN-14): ligado a um membro Vita ⇒ consulta nesse membro; manual/sem ligação ⇒ visita presencial só da clínica. Com e-mail exato, o paciente da clínica é criado/ligado automaticamente.
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

### UC-CLN-14 Gerir pacientes da clínica, ver a ficha e marcar presencial (M14 P)
- **Ator:** conta da clínica (Admin ou Gestor) · **FR:** CLN-07 · **BR:** CLN-17, CLN-18, CLN-22
- **Fluxo:** em **Pacientes** pesquisa (nome, telefone ou e-mail) ou lista com paginação → **Novo paciente** (nome; telefone, e-mail, data de nascimento e notas opcionais; cliente de balcão sem conta Vita) → abre a **ficha**: resumo e notas editáveis, consultas, exames e recomendações **da clínica** com ele, e o **estado do consentimento** ("Sem partilha ativa", "Marcações" ou "Histórico até …"). Na marcação presencial (UC-CLN-08) escolhe o horário e o paciente: um **paciente da clínica** (da pesquisa) ou, para um utilizador Vita, o **e-mail exato** (cria/liga automaticamente o paciente da clínica).
- **Alternativos:** paciente de outra clínica → `NOT_FOUND`; campos inválidos → `VALIDATION_ERROR`; marcação com paciente manual gera uma **visita presencial** só da clínica (não aparece na app Vita); sobreposição → `CONFLICT`.
- **Pós-condição:** registo da clínica separado dos dados Vita; sem ids Vita nas respostas; auditoria `CLINIC_PATIENT_*`, `CLINIC_VISIT_*`/`CLINIC_WALKIN_BOOK` sem dados pessoais.

### UC-CLN-15 Ligar um paciente Vita com código/QR (M14 P)
- **Ator:** paciente (titular/tutor) na app e conta da clínica · **FR:** CLN-08 · **BR:** CLN-20, CLN-19
- **Fluxo:** o paciente abre **Clínicas → Ligar a uma clínica** e gera um código/QR (10 min, uso único; a app avisa que a clínica ficará com o nível "Marcações") → mostra-o na receção → a clínica introduz o código em **Pacientes → Ligar com código** (opcionalmente escolhendo um paciente existente) → fica criado/ligado o paciente da clínica com `vitaLink` e o paciente vê a clínica em "quem vê o quê".
- **Alternativos:** código inválido, expirado ou já usado → `404` idêntico; muitos pedidos → `RATE_LIMITED`; paciente já ligado a outra pessoa, ou membro já ligado a outro paciente da clínica → `CONFLICT`; mais de 5 códigos/hora → `RATE_LIMITED`.
- **Pós-condição:** ligação `via=CODE` e consentimento `BOOKINGS`; código consumido; auditoria `CLINIC_LINK_CODE_CREATE`/`CLINIC_PATIENT_LINK` sem o código.

### UC-CLN-16 Consentir, renovar e revogar por clínica (app) (M14 P)
- **Ator:** titular adulto ou tutor · **FR:** CLN-08 · **BR:** CLN-19, CLN-24
- **Fluxo:** em **Clínicas** vê as clínicas com acesso ("quem vê o quê") → por clínica escolhe **Marcações** ou **Partilhar histórico** (medicação e exames; válido 12 meses, a app avisa quando é preciso renovar) → pode **revogar** a qualquer momento (efeito imediato; a app explica que o que a clínica já registou é dela).
- **Alternativos:** dependente com conta ou outro membro → `FORBIDDEN`; clínica inexistente/privada/arquivada → `NOT_FOUND`.
- **Pós-condição:** `CLINIC_CONSENT_SET`/`CLINIC_CONSENT_REVOKE` auditados; revogar apaga consentimento e ligação, sem apagar o registo da clínica.

### UC-CLN-17 Ver o histórico partilhado de um paciente (M14 P)
- **Ator:** conta da clínica (Admin ou Gestor) · **FR:** CLN-08 · **BR:** CLN-21
- **Fluxo:** na ficha, o separador **Consentimentos/Histórico** mostra a medicação ativa e os exames partilhados pelo paciente (só leitura) enquanto o consentimento "Partilhar histórico" for válido; senão "Sem partilha ativa" e a indicação de o pedir ao paciente (ligar por código, ou renovar na app).
- **Alternativos:** consentimento expirado/revogado ou sem ligação → `active=false` (sem dados); paciente de outra clínica → `NOT_FOUND`.
- **Pós-condição:** leitura auditada (`CLINIC_SHARED_HISTORY_VIEW`, sem conteúdo); nenhum documento, nota ou texto livre é exposto.

### UC-CLN-18 Pesquisa global do portal (M14 P)
- **Ator:** conta da clínica (Admin ou Gestor) · **FR:** CLN-09 · **BR:** CLN-22
- **Fluxo:** na barra de topo (`/` ou `Ctrl+K`) escreve ≥ 2 caracteres → resultados por secção: **Pacientes** (nome/telefone/e-mail) e **Marcações** (consultas, exames e visitas) da clínica → abre a ficha ou a marcação. Para marcar um utilizador Vita usa-se o fluxo de marcação (e-mail exato) ou a ligação por código; **nunca** a pesquisa global.
- **Alternativos:** `q` curto → `VALIDATION_ERROR`; excesso de pedidos → `RATE_LIMITED`.
- **Pós-condição:** sem efeitos; `q` fora de logs.

### UC-CLN-19 Calendário por profissional (M14 P)
- **Ator:** conta da clínica (Admin ou Gestor) · **FR:** CLN-10 · **BR:** CLN-23, CLN-03
- **Fluxo:** em **Agenda → Calendário** escolhe vista dia/semana e (opcional) um profissional → vê, por profissional, as marcações (consultas, exames, visitas) e os horários livres do período → abre uma marcação (drawer) ou escolhe um horário livre para marcar (UC-CLN-08).
- **Alternativos:** janela inválida ou > 31 dias → `VALIDATION_ERROR`; profissional de outra clínica → `NOT_FOUND`.
- **Pós-condição:** só leitura; mínimo necessário (BR-CLN-03).

### UC-CLN-20 Confirmar presença (paciente na app; clínica por telefone) (M14 Q)
- **Atores:** titular/tutor (ou dependente com conta) · conta da clínica (Admin ou Gestor) · **FR:** CLN-11 · **BR:** CLN-25/26/27
- **Fluxo (paciente):** recebe o alerta (UC-CLN-22) ou abre a consulta → vê **"Vou" / "Não posso"** → "Vou" ⇒ `CONFIRMED`; "Não posso" ⇒ confirma "Cancelar a consulta?" → a consulta fica `CANCELLED`, o horário volta a ficar livre e a app propõe **"Escolher outro horário"** (fluxo UC-APT-07 já existente).
- **Fluxo (clínica):** em **Hoje**/**Agenda** vê cada marcação com o estado (**Confirmado / Recusou / Sem resposta / Confirmado por telefone**) e, nas que estão "Sem resposta", o botão **"Confirmado por telefone"** (também para visitas manuais).
- **Alternativos:** consulta já passada/não `SCHEDULED` ⇒ `INVALID_STATE_TRANSITION`; consulta de clínica privada ⇒ `VALIDATION_ERROR` (a confirmação ativa só existe em clínica parceira); "Vou" depois de "Não posso" ⇒ `INVALID_STATE_TRANSITION`; a clínica não pode marcar "Recusou" (cancela com motivo, UC-CLN-06).
- **Pós-condição:** `confirmationStatus` atualizado; "Não posso" liberta o horário e a clínica vê-o livre e a consulta como "Recusou" até ao fim do dia; auditoria sem dados pessoais.

### UC-CLN-21 Fluxo do dia na página Hoje: chegou, iniciar, concluir, faltou (M14 Q)
- **Ator:** conta da clínica (Admin ou Gestor) · **FR:** CLN-12 · **BR:** CLN-28, CLN-06
- **Fluxo:** **Hoje** lista as marcações do dia por hora (consultas Vita e visitas manuais) com um **botão principal** conforme o estado: `SCHEDULED` → **Chegou** (e **Faltou** depois da hora); `ARRIVED` → **Iniciar** (mostra "a aguardar há N min"); `IN_PROGRESS` → **Concluir**, que abre o fluxo **existente** de resultado/receita (concluir consulta, BR-CLN-06; visita: só nota). Um toque, sem formulário, exceto Concluir.
- **Alternativos:** marcar "Chegou" a quem já estava como `NO_SHOW` ⇒ volta a `SCHEDULED` com chegada; "Iniciar" sem "Chegou" ⇒ regista as duas; "Faltou" antes da hora ou após iniciar ⇒ `INVALID_STATE_TRANSITION`; fora do dia da marcação ⇒ `INVALID_STATE_TRANSITION`.
- **Pós-condição:** `arrivedAt`/`startedAt` guardados; estado Vita só muda em Faltou (`NO_SHOW`) e Concluir (`COMPLETED`); tempo de espera calculado; auditoria sem dados pessoais.

### UC-CLN-22 Pedido de confirmação e lembrete de retorno (sistema) (M14 Q)
- **Ator:** Scheduler (módulo `alerts`) · **FR:** CLN-11, CLN-14 · **BR:** ALR-09, CLN-26, CLN-30
- **Fluxo:** o scanner (UC-ALR-01) emite `APPOINTMENT_CONFIRM_REQUEST` 48 h antes das consultas `SCHEDULED` de clínica parceira ainda `PENDING`; o lembrete de 24 h existente mostra "Vou / Não posso" enquanto `PENDING`; 7 dias antes de `followUpDueOn` emite `FOLLOWUP_REMINDER`. Idempotente por `dedupeKey`; texto genérico.
- **Alternativos:** marcação com <48 h de antecedência ⇒ só o lembrete de 24 h; já `CONFIRMED`/`CANCELLED` ⇒ não se emite; retorno limpo antes da hora ⇒ não se emite.

### UC-CLN-23 Propor retorno (M14 Q)
- **Ator:** conta da clínica (Admin ou Gestor) · **FR:** CLN-14 · **BR:** CLN-30
- **Fluxo:** ao **concluir** (ou depois, na marcação concluída) escolhe **"Voltar em"** 2 semanas / 1 mês / 3 meses / 6 meses (atalhos) ou N semanas/meses → fica registado. Paciente Vita: recebe o lembrete 7 dias antes e toca para pedir horário (UC-APT-07). Visita manual: a clínica vê o retorno em **Hoje → Retornos a contactar** (nome, telefone do registo da clínica, data) e dá por tratado.
- **Alternativos:** marcação não concluída ⇒ `INVALID_STATE_TRANSITION`; N fora de 1–24 ⇒ `VALIDATION_ERROR`; "Já tratado" limpa o retorno.

### UC-CLN-24 Ver indicadores (M14 Q)
- **Ator:** conta da clínica (Admin ou Gestor) · **FR:** CLN-13 · **BR:** CLN-29
- **Fluxo:** em **Mais → Relatórios** escolhe o período (7 dias, 30 dias, mês, ou datas) e, opcionalmente, um profissional → vê cartões: **Ocupação**, **Consultas realizadas**, **Faltas** (e taxa), **Cancelamentos**, **Novos pacientes**, e a tabela por profissional.
- **Alternativos:** janela inválida ou > 366 dias ⇒ `VALIDATION_ERROR`; profissional de outra clínica ⇒ `NOT_FOUND`; excesso de pedidos ⇒ `RATE_LIMITED`.
- **Pós-condição:** só leitura; só contagens, sem dados de pacientes.

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
