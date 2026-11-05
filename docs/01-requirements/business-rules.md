# Vita Family — Regras de Negócio (Fase 7)

> Estado: **v0.4 (+BR-SEG-01..23 e emenda a BR-INS-08, ADR-025) — v0.3 (+BR-CLN-10, ADR-024) — B1–B6 decididas (delegadas); acrescenta BR-CLN-07..09, BR-EXM-05..08, BR-APT-10/11 (exames com vagas, revisto 2026-11-04), BR-INS-09..10 e BR-ADM (ADR-023, D19)**
> Consolida as regras já decididas (D, M, N, R, P, Q) e acrescenta regras derivadas, assinaladas.
> Legenda: **[DECIDIDO]** com ID de origem · **[DERIVADO]** consequência lógica de decisões anteriores · **[PROPOSTO]** sugestão minha, requer aprovação · `[NEEDS DECISION]` ver secção 12.
> Cada regra tem ID `BR-<área>-nn` para ser referenciada em testes (Fase 15) e na API (Fase 13).

---

## 1. Identidade e conta (BR-ACC)

| ID | Regra | Estado |
|---|---|---|
| BR-ACC-01 | O e-mail é único por conta e tem de ser verificado antes de qualquer uso da conta. | DECIDIDO R1 |
| BR-ACC-02 | Um User autoregista-se apenas se tiver **18 anos ou mais**. Menores só têm conta criada por um tutor. | DECIDIDO M1, P2 |
| BR-ACC-03 | O consentimento (versão dos termos/política e data) é registado no registo e tem de ser repetido se a versão mudar (B6). | DECIDIDO B6 |
| BR-ACC-04 | Cada User tem um fuso horário; é a referência dos seus lembretes. | DECIDIDO M3 |
| BR-ACC-05 | Conta suspensa pelo Platform Admin não faz login nem recebe notificações; os dados não são alterados. | DERIVADO D4, R10 |
| BR-ACC-06 | Uma conta não pode ser eliminada enquanto o User for o único tutor de um dependente ou o único Admin de uma família com outros membros. | DECIDIDO P8, R2 |
| BR-ACC-07 | Eliminar uma conta apaga definitivamente os seus dados, documentos e o que é seu em cada família; logs de auditoria são anonimizados; backups expiram em ≤30 dias. | DECIDIDO D15, N6 |

## 2. Família e papéis (BR-FAM)

| ID | Regra | Estado |
|---|---|---|
| BR-FAM-01 | Quem cria uma família torna-se Family Admin. | DECIDIDO prompt §21 |
| BR-FAM-02 | Toda a família tem pelo menos um Family Admin, que é adulto com conta. | DECIDIDO FR-FAM-03, M1 |
| BR-FAM-03 | Um User pode pertencer a várias famílias; os dados nunca se misturam entre famílias. | DECIDIDO D2 |
| BR-FAM-04 | Só se elimina uma família quando o Admin é o único membro. | DECIDIDO R2 |
| BR-FAM-05 | O Admin único só sai depois de nomear outro adulto com conta como Admin. | DECIDIDO Q5 |
| BR-FAM-06 | O Family Admin gere a estrutura, não tem acesso privilegiado a dados de saúde. | DECIDIDO D13, P1 |
| BR-FAM-07 | Limites: 5 famílias por User; 20 membros por família; 20 convites pendentes por família; 10 clínicas privadas por família. | DECIDIDO B4 |

## 3. Membros, dependentes e tutela (BR-MEM)

| ID | Regra | Estado |
|---|---|---|
| BR-MEM-01 | Todo FamilyMember tem **data de nascimento** (não futura, e não anterior a 120 anos). | PROPOSTO |
| BR-MEM-02 | **Menor** = idade <18, calculada pela data de nascimento no fuso do titular. | DECIDIDO M1 |
| BR-MEM-03 | Todo menor é dependente e tem pelo menos um tutor. | DECIDIDO N1, M1 |
| BR-MEM-04 | Um adulto só é dependente com consentimento próprio (se tiver conta). Um perfil adulto sem conta só existe como dependente com tutor. | DECIDIDO N3, Q7 |
| BR-MEM-05 | O tutor é um adulto, FamilyMember da **mesma família**, com conta. | DECIDIDO N1 |
| BR-MEM-06 | Um dos tutores é o **tutor principal** (fuso dos alertas do dependente sem conta; contacto primário). Muda por decisão do Admin ou do tutor atual. | DECIDIDO Q8 + DERIVADO |
| BR-MEM-07 | Remover o último tutor de um dependente é proibido. | DECIDIDO P8 |
| BR-MEM-08 | O tutor gere todos os dados de saúde do dependente; o Admin só atribui/retira tutores, sem ver dados. | DECIDIDO M6, N1 |
| BR-MEM-09 | A conta de um dependente menor exige autorização expressa do tutor, e o dependente com conta tem acesso limitado: vê identificação, medicamentos e consultas e confirma tomas. Não edita dados clínicos, não sai da família, não exporta dados. | DECIDIDO P2, N2 |
| BR-MEM-10 | Aos 18 anos a tutela do menor termina: passa a titular dos próprios dados, o tutor perde o acesso, a partilha existente mantém-se até ele a alterar. | DECIDIDO P4 |
| BR-MEM-11 | Menor que faz 18 sem conta: dados bloqueados (sem acesso de ninguém), Admin avisado; se não houver conta em **90 dias**, os dados são apagados. | DECIDIDO Q7 |
| BR-MEM-12 | O convite expira em 7 dias, é de uso único e só pode ser aceite pelo e-mail convidado. | DECIDIDO R3 + DERIVADO |
| BR-MEM-13 | Ao aceitar um convite ligado a um perfil, os dados do perfil passam a ser do novo titular. | DERIVADO UC-MEM-03 |
| BR-MEM-14 | Adulto com conta que sai da família escolhe levar (pacote JSON + documentos) ou apagar os seus dados; em ambos os casos os dados deixam a família. | DECIDIDO R4, Q6 |
| BR-MEM-15 | Dependentes que ficam na família depois da saída de um membro mantêm-se sob a família até um tutor os apagar. | DECIDIDO R4 |

## 4. Privacidade e partilha (BR-PRV)

| ID | Regra | Estado |
|---|---|---|
| BR-PRV-01 | Os dados de saúde estão em 6 categorias (C1–C6). Por defeito partilha-se só C1 (nome, data de nascimento). | DECIDIDO P1 |
| BR-PRV-02 | O titular adulto decide a partilha por categoria; para dependentes decide o tutor. | DECIDIDO D13, P3 |
| BR-PRV-03 | A partilha dá só leitura. Não há delegação de escrita no MVP. | DECIDIDO P6 |
| BR-PRV-04 | Retirar a partilha tem efeito imediato em listas, relatórios e downloads. | DERIVADO |
| BR-PRV-05 | Documentos seguem a categoria do recurso associado. | DECIDIDO P1 |
| BR-PRV-06 | Alertas são enviados a quem é destinatário pela regra, independentemente da partilha; para dependentes: tutores e o próprio com conta. | DECIDIDO FR-ALR-08 |
| BR-PRV-07 | O Platform Admin nunca acede a dados de saúde. | DECIDIDO D4 |
| BR-PRV-08 | Alertas e notificações não revelam dados clínicos fora da app (texto genérico). | DECIDIDO N8 |
| BR-PRV-09 | O titular não consegue ver quem acedeu aos seus dados (no MVP). | DECIDIDO P7 |

## 5. Dados de saúde (BR-HLT)

| ID | Regra | Estado |
|---|---|---|
| BR-HLT-01 | O sistema guarda **apenas o estado atual**; quem alterou fica na auditoria. | DECIDIDO R6 |
| BR-HLT-02 | Todos os dados são introduzidos manualmente; o sistema não os valida clinicamente, não os interpreta e não gera diagnóstico. | DECIDIDO prompt §8, D11 |
| BR-HLT-03 | O sistema não sugere doses, interações nem intervalos de referência. | DERIVADO D8, D11 |
| BR-HLT-04 | Tipo sanguíneo: valores permitidos A/B/AB/O com Rh+/Rh- ou "desconhecido". | PROPOSTO |
| BR-HLT-05 | O texto livre é tratado como dado de saúde: nunca vai para logs técnicos nem notificações. | DERIVADO NFR-PRV-07 |

## 6. Receitas e medicação (BR-RX / BR-MED)

| ID | Regra | Estado |
|---|---|---|
| BR-RX-01 | Receita: data de emissão **obrigatória** (não futura); médico opcional; pelo menos 1 medicamento. | DECIDIDO R7 |
| BR-RX-02 | Registar os medicamentos de uma receita cria um plano de toma por medicamento, editável. | DECIDIDO M2 |
| BR-RX-03 | Medicamentos avulsos (sem receita) são permitidos. | DECIDIDO R7 |
| BR-RX-04 | Concluir ou cancelar uma receita termina os planos associados; o histórico de tomas mantém-se. | DERIVADO |
| BR-RX-05 | Editar um plano só afeta ocorrências **futuras**; o passado não é reescrito. | PROPOSTO |
| BR-RX-06 | Eliminar uma receita apaga também os planos, o histórico de tomas e os documentos associados. | DERIVADO D15 |
| BR-RX-07 | Receita emitida pela clínica parceira (BR-CLN-06): `issuedBy=CLINIC`, `issuedByClinicAccountId` e `appointmentId` de origem, para auditoria/rastreabilidade; se a conta da clínica for removida o autor fica nulo mas `issuedBy=CLINIC` mantém-se (ADR-023, correção da CHECK). `issuedBy=FAMILY` (default) nas restantes. A clínica só pode criar/editar enquanto o `Appointment` de origem está `SCHEDULED` e é dela; depois de `COMPLETED`, só o titular/tutor edita (como qualquer receita). | DECIDIDO D18 |
| BR-MED-01 | Cada plano usa horários fixos (com dias da semana opcionais) **ou** "de X em X horas" a partir de uma hora de início. | DECIDIDO Q1 |
| BR-MED-02 | O plano tem data de início e fim (por duração ou data), ou é marcado "uso contínuo" até ser terminado. | DECIDIDO B5 |
| BR-MED-03 | Uma ocorrência de toma é **pendente** até à ação; após **2 h** sem ação passa a **não confirmada**; confirmação tardia permitida até ao fim do dia seguinte. | DECIDIDO Q2 |
| BR-MED-04 | Estados da ocorrência: PENDENTE, CONFIRMADA, NÃO_TOMADA, NÃO_CONFIRMADA. Confirmar é idempotente. | DECIDIDO D7, Q2 + DERIVADO |
| BR-MED-05 | Quem confirma e quando fica registado. Confirmam: titular, tutor, dependente com conta. | DECIDIDO M4, D7 |
| BR-MED-06 | Não existe alerta ao Admin ou tutor por tomas não confirmadas no MVP. | DECIDIDO D7-B |
| BR-MED-07 | A adesão é só contagem de estados; sem interpretação. | DERIVADO |
| BR-MED-08 | Alterar o fuso do User recalcula as ocorrências futuras, sem duplicar nem perder doses. | DERIVADO NFR-AVL-05 |

## 7. Consultas e clínicas (BR-APT / BR-CLN)

| ID | Regra | Estado |
|---|---|---|
| BR-APT-01 | Estados: PEDIDA, AGENDADA, RECUSADA, REALIZADA, CANCELADA, FALTOU. PEDIDA/RECUSADA só existem em clínicas parceiras. Estados finais: ver Fase 10. | DECIDIDO D9, D17 |
| BR-APT-02 | Uma consulta passada sem atualização permanece AGENDADA; o sistema pede confirmação do desfecho e nunca assume. | DECIDIDO Q4 |
| BR-APT-03 | Lembretes: 24 h e 2 h antes (configurável por utilizador, R9). Editar/cancelar recalcula/remove lembretes futuros. | DECIDIDO R9 |
| BR-APT-04 | A clínica é uma clínica parceira, uma entrada privada, ou ausente. **Parceira:** a consulta só se marca num horário publicado e livre; nasce PEDIDA e só fica AGENDADA quando a clínica confirma. **Privada ou ausente:** registo direto, nasce AGENDADA. | DECIDIDO R8, D3, D17 |
| BR-APT-06 | Um horário (ClinicSlot) `kind=APPOINTMENT` aceita **uma** marcação ativa (PEDIDA ou AGENDADA); fica livre de novo se for recusada ou cancelada. Para `kind=EXAM` aplica-se a capacidade (BR-APT-11). | DECIDIDO D17; emendado ADR-023 (2026-11-04) |
| BR-APT-07 | Lembretes de consulta só existem para consultas AGENDADAS (não para pedidos). | DECIDIDO D17 |
| BR-APT-08 | Um pedido sem resposta até à hora do horário passa a CANCELADA pelo sistema (motivo: sem resposta da clínica). | PROPOSTO D17 |
| BR-APT-09 | Numa consulta de clínica parceira, mudar a data/hora é cancelar e pedir outro horário; só as observações são editáveis. | PROPOSTO D17 |
| BR-APT-10 | `ClinicSlot.kind` é `APPOINTMENT` (default) ou `EXAM`. Uma consulta só se marca num horário `APPOINTMENT` e um exame só num horário `EXAM` (senão `VALIDATION_ERROR`). Para `EXAM`, `specialty` é o tipo de exame. A listagem pública de horários filtra por `kind` (default `APPOINTMENT`). | DECIDIDO ADR-023 (D19, 2026-11-04) |
| BR-APT-11 | **Capacidade de horário** (`ClinicSlot.capacity`, 1–50, default 1): só `kind=EXAM` pode ter `capacity > 1`; `kind=APPOINTMENT` tem sempre 1 e mantém o fluxo REQUESTED→confirmar/recusar. Um horário de exame está **cheio** quando as marcações ativas (exames `SCHEDULED` com esse `slotId`) atingem `capacity`; a vaga liberta-se quando o exame é cancelado (pela família ou pela clínica). A reserva de vaga, a edição de `capacity` e a remoção do horário são **serializadas por bloqueio da linha do horário** (sem overbooking sob concorrência; ADR-023). Reduzir `capacity` abaixo das marcações ativas ou remover um horário de exame com marcações ativas → `CONFLICT`. O mesmo membro não pode ter duas marcações ativas no mesmo horário (`CONFLICT`). | DECIDIDO ADR-023 (revisão 2026-11-04); regra do mesmo membro PROPOSTA |
| BR-CLN-01 | Parceiras: criadas pelo Platform Admin, visíveis a todos. Privadas: criadas por membros adultos, visíveis só à família. | DECIDIDO R8 |
| BR-CLN-02 | Arquivar/apagar uma clínica não destrói consultas: mantêm o nome como texto. | PROPOSTO |
| BR-CLN-03 | ~~Nenhuma clínica tem login~~ (alterado por D17). Clínicas **privadas** não têm login. Clínicas **parceiras** têm contas próprias do portal (`ClinicAccount`, D18 — **não** são `User`/não têm `family_members`; ver BR-CLN-05). O Gestor (`CLINIC_MANAGER`) vê só as marcações na própria clínica com o mínimo necessário (nome do paciente, especialidade, profissional, data/hora, observações do pedido) e **nunca** dados de saúde da família, nem o histórico de outras consultas do paciente. **Exceção (D18):** na consulta em curso que está a atender, pode registar o resultado e emitir a receita (BR-CLN-06); fora disso, a minimização mantém-se. **D19:** a exceção alarga-se, com o mesmo limite, ao exame em curso da própria clínica (resultados e PDF, BR-CLN-08) e à recomendação (BR-CLN-09); nunca a mais dados do paciente. O utilizador é avisado disso antes de enviar o pedido. **D20 (ADR-024), emenda estreita:** a única exceção ao "a clínica não conhece utilizadores" é a pesquisa por e-mail exato de BR-CLN-10, que devolve apenas um nome de apresentação mínimo; a clínica **nunca** obtém ids de utilizador/família/membro. | DECIDIDO D3, D17, D18; emendado ADR-024 |
| BR-CLN-04 | O Gestor da clínica publica horários (tipo, especialidade/tipo de exame, profissional opcional, início, duração; em `EXAM` também `capacity`, BR-APT-11) e só remove horários **sem marcações ativas** (consulta `REQUESTED`/`SCHEDULED`; exame `SCHEDULED`). Pode alterar a `capacity` de um horário de exame (BR-APT-11). | DECIDIDO D17; emendado ADR-023 |
| BR-CLN-05 | Hierarquia de contas do portal (D18): o Platform Admin cria **apenas** a conta `CLINIC_ADMIN` raiz de cada clínica parceira (e pode repô-la em caso de perda de acesso). É a própria conta `CLINIC_ADMIN` que cria, lista e remove as contas `CLINIC_MANAGER` da sua clínica — o Platform Admin não gere Gestores individualmente. Uma clínica tem **no máximo** uma conta `CLINIC_ADMIN` ativa (ADR-023: o Platform Admin pode suspendê-la, BR-ADM-04; reposição por `root-account`). | DECIDIDO D18, emendado ADR-023 |
| BR-CLN-06 | Controlo do fluxo da consulta (D18): o Gestor da clínica que atende a consulta `SCHEDULED` pode registar o resultado e, através do módulo `prescriptions` (M6), emitir a receita associada (`issuedBy=CLINIC`, BR-RX-07); a receita passa a aparecer automaticamente no histórico/app do paciente. Só a consulta em curso que a própria clínica está a atender; nunca consultas de outros pacientes ou fora da sua clínica. | DECIDIDO D18 |
| BR-CLN-07 | **Exames: marcação direta com vagas** (D19, **revisto 2026-11-04**): a clínica parceira publica horários `kind=EXAM` com um número de vagas (BR-APT-10/11); a família marca diretamente e, havendo vaga, o `Examination` nasce `SCHEDULED` (confirmado logo; **sem** passo `REQUESTED`/`REJECTED` nem expiração de pedidos, BR-EXM-05). A clínica vê a agenda de exames e a ocupação por horário, **cancela** uma marcação futura com motivo obrigatório (vaga liberta; titular/tutor informado) e **completa-a** com resultados/PDF/nota (BR-CLN-08). A clínica vê só o mínimo (nome do paciente, tipo de exame, data/hora, observações da marcação, BR-CLN-03). Aplicam-se BR-EXM-06..08. | DECIDIDO D19, ADR-023 (2026-11-04), revisto 2026-11-04 |
| BR-CLN-08 | **Resultados emitidos pela clínica** (D19): ao completar um exame `SCHEDULED` da própria clínica (`SCHEDULED → COMPLETED`, atómico) a clínica regista **parâmetros estruturados** (`ExamResult`, 0–50) e/ou **PDF** (0–5, via módulo `documents`: quarentena + antivírus, BR-DOC-02; só PDF; a clínica nunca descarrega — vê só metadados); pelo menos um dos dois. **Sem interpretação** nem alertas por valor (D11, BR-EXM-02). Rastreável: `Examination.issuedBy=CLINIC`, `issuedByClinicAccountId`, `resultsIssuedAt`; `Document.uploadedByClinic` (marca **permanente**, nunca anulada) e `Document.uploadedByClinicAccountId` (autor; pode ficar nulo se a conta for removida — a marca de origem `issuedBy`/`uploadedByClinic` mantém-se e a visibilidade nunca depende do autor; espelho de BR-RX-07). Depois de `COMPLETED` só o titular/tutor edita. Documentos com `uploadedByClinic=true` só ficam visíveis ao paciente com o exame `COMPLETED`; download mediado e auditado só para quem lê `EXAMS` (BR-DOC-04). O paciente é notificado (`EXAM_RESULTS_AVAILABLE`, texto genérico). | DECIDIDO D19, ADR-023 (2026-11-04) |
| BR-CLN-09 | **Recomendações** (D19): `Recommendation` é uma nota clínica em texto (1–2000 caracteres) criada pela conta da clínica sobre **uma** consulta **ou** **um** exame da **própria clínica** em estado `SCHEDULED` ou `COMPLETED`. Sem interpretação nem alertas automáticos por conteúdo; imutável (sem editar/eliminar pela clínica); eliminada em cascata com a consulta/exame/membro (D15). Notifica o paciente (`RECOMMENDATION_ADDED`, texto genérico, BR-HLT-05/BR-ALR-07) e é auditada. Lida por quem tem `READ` na categoria da origem (consulta ⇒ APPOINTMENTS, exame ⇒ EXAMS; dependente com conta lê só as de consulta, N2). | DECIDIDO D19, ADR-023 (2026-11-04) |

## 8. Exames e documentos (BR-EXM / BR-DOC)

| ID | Regra | Estado |
|---|---|---|
| BR-EXM-01 | Resultado = parâmetro, valor (numérico opcional + texto livre), unidade, intervalo de referência opcional **informado pelo utilizador**. | DECIDIDO D8, Q9 |
| BR-EXM-02 | O sistema nunca assinala valores fora do intervalo nem gera alertas por resultado. | DECIDIDO D11 |
| BR-EXM-03 | Exame futuro gera lembrete 24 h antes. | DECIDIDO R9 |
| BR-EXM-04 | Estados simples de exame: AGENDADO, REALIZADO, CANCELADO (Fase 10). Os valores `REQUESTED`/`REJECTED` do enum de BD ficam **obsoletos** (ADR-023 revisto: sem pedido/recusa de exames); não são produzidos nem expostos. | PROPOSTO; revisto ADR-023 |
| BR-CLN-10 | **Marcação presencial (walk-in, D20/ADR-024):** `CLINIC_ADMIN`/`CLINIC_MANAGER` pode (a) pesquisar um utilizador por **e-mail exato** (normalizado: trim + minúsculas; sem pesquisa parcial) e (b) marcar-lhe uma consulta num `ClinicSlot` `kind=APPOINTMENT` **da própria clínica**, livre e futuro. Pesquisa: `200 {displayName}` (primeiro nome + inicial do último apelido) ou `404 NOT_FOUND` **idêntico** para e-mail inexistente, utilizador não `ACTIVE` ou sem membro `SELF`. Marcação: o servidor re-resolve o e-mail (sem ids na API); a consulta nasce `SCHEDULED` no membro `SELF` (sem `REQUESTED`; BR-APT-04/06 aplicam-se ao horário, BR-APT-03/07 geram lembretes), `walk_in=true`, e daí em diante é gerida só pela clínica pelos fluxos existentes (BR-CLN-06/09). Horário de outra clínica/inexistente ⇒ `NOT_FOUND`; `kind` errado ⇒ `VALIDATION_ERROR`; ocupado ou passado ⇒ `CONFLICT`; paciente com consulta `SCHEDULED` sobreposta ao horário ⇒ `CONFLICT`. **Rate limit (PROPOSTO):** por conta de clínica 30 pesquisas+marcações/hora e 10 respostas 404 em 15 min; por IP 60 pedidos/hora aos dois endpoints; excedido ⇒ `RATE_LIMITED` + `Retry-After`. Auditoria `CLINIC_WALKIN_LOOKUP`/`CLINIC_WALKIN_BOOK` sem e-mail em claro. O paciente recebe alerta `APPOINTMENT_CONFIRMED` (texto genérico) quando o mecanismo existir (OP-22). Sem fichas de paciente da clínica. | DECIDIDO ADR-024 (D20); limites PROPOSTOS |
| BR-EXM-05 | Exame de clínica parceira (marcado num horário `EXAM`) **nasce `SCHEDULED`** se o horário tem vaga (BR-APT-11); horário cheio, passado ou removido ⇒ `CONFLICT` (`VALIDATION_ERROR` se `kind` errado). Data/hora (`scheduledAt`, `examDate` = data local do horário), tipo (`name`) e clínica ficam congelados do horário. Exame privado/sem clínica: registo direto como hoje (ST5). | DECIDIDO ADR-023, revisto 2026-11-04 |
| BR-EXM-06 | Lembrete 24 h antes (BR-EXM-03) desde a marcação, para exames `SCHEDULED` (incluindo os marcados em horário da clínica). | DECIDIDO D19; revisto 2026-11-04 |
| BR-EXM-07 | **Obsoleta (revisto 2026-11-04):** não há pedidos de exame, logo não há expiração por falta de resposta nem job `examinations.expire-requests`. A família cancela um exame `SCHEDULED` (liberta a vaga); a clínica cancela com motivo (BR-CLN-07). | OBSOLETO ADR-023 revisto |
| BR-EXM-08 | Num exame de horário da clínica, mudar data/hora é cancelar e marcar outro horário; um exame `CANCELLED` com `slotId` não se reagenda (`INVALID_STATE_TRANSITION`). Só `notes` são editáveis. Espelho de BR-APT-09. | PROPOSTO D19 |
| BR-DOC-01 | Tipos permitidos: PDF, JPG, PNG; tamanho ≤ 10 MB; tipo verificado pelo conteúdo. | DECIDIDO M5, N4 |
| BR-DOC-02 | Um documento só fica disponível depois de passar a análise antivírus; positivo → eliminado e auditado. | DECIDIDO N4 |
| BR-DOC-03 | Máximo 5 ficheiros por recurso e 100 MB por família. | DECIDIDO Q10 |
| BR-DOC-04 | O acesso a um documento exige permissão de ver a categoria do recurso; é sempre mediado e auditado. | DECIDIDO prompt §17, FR-DOC-03 |
| BR-DOC-05 | Eliminar um recurso elimina os seus documentos do armazenamento. | DECIDIDO D15 |

## 9. Alertas e notificações (BR-ALR)

| ID | Regra | Estado |
|---|---|---|
| BR-ALR-01 | Só alertas de agenda: toma, consulta, exame (D11-A). | DECIDIDO |
| BR-ALR-02 | Cadeia Evento → Regra → Alerta → Notificação; um alerta por evento e regra (idempotente). | DECIDIDO prompt §18, NFR-AVL-02 |
| BR-ALR-03 | Lembrete de toma no horário; repete uma vez 15 min depois se não confirmado. | DECIDIDO Q3 |
| BR-ALR-04 | O utilizador escolhe canais (push, e-mail) e tipos de alerta, incluindo desativar alertas de toma. | DECIDIDO R9, Q3 |
| BR-ALR-05 | Falha de um canal não impede o outro; tentativas limitadas e registadas. | DECIDIDO NFR-AVL-03 |
| BR-ALR-06 | Cada destinatário recebe no seu fuso; o plano segue o do titular, e o do tutor principal para dependente sem conta. | DECIDIDO Q8 |
| BR-ALR-07 | Nenhum alerta contém diagnóstico nem dados clínicos fora da app. | DECIDIDO prompt §8, N8 |

## 10. Relatórios (BR-RPT)

| ID | Regra | Estado |
|---|---|---|
| BR-RPT-01 | Só dados existentes e visíveis ao pedinte; secções sem permissão omitidas. | DECIDIDO D10, UC-RPT |
| BR-RPT-02 | Período por defeito 12 meses, máximo 5 anos; listas paginadas. | DECIDIDO Q11 |
| BR-RPT-03 | Relatórios não contêm interpretação clínica **por omissão**. Única exceção estrita: o "Resumo com IA" (BR-RPT-04..09, ADR-022), que **contextualiza tendências** nos dados já existentes, em linguagem simples, e nunca sugere ação clínica, diagnóstico ou juízo sobre normal/perigoso. | DECIDIDO prompt §19; revisto ADR-022 (2026-10-17, proprietário) |
| BR-RPT-04 | O "Resumo com IA" tem sempre, visível e não dispensável, o aviso "Gerado por IA a partir dos seus dados; não é um conselho médico.", mostrado sempre ao lado dos dados em bruto que o geraram — nunca texto de IA isolado sem a fonte. | DECIDIDO ADR-022 |
| BR-RPT-05 | O "Resumo com IA" só é gerado com consentimento explícito e prévio (opt-in, desligado por omissão) de SELF (adulto) ou do tutor pelo dependente, nomeando o fornecedor externo de IA — modelo de consentimento próprio, distinto do `SharingGrant` por categoria. | DECIDIDO ADR-022 |
| BR-RPT-06 | Minimização: só se envia ao fornecedor de IA a série estruturada necessária à tendência pedida (valores/unidades/datas; estatística de adesão); nunca documentos, imagens, texto livre ou o nome do membro (referência interna/pseudónimo). | DECIDIDO ADR-022 |
| BR-RPT-07 | A resposta da IA passa sempre por um filtro de saída que bloqueia frases de aconselhamento clínico/diagnóstico antes de ser mostrada — defesa em profundidade, não se confia só na instrução dada ao modelo. | DECIDIDO ADR-022 |
| BR-RPT-08 | A geração de um "Resumo com IA" é sempre auditada (quem pediu, quando, tipo de resumo); a auditoria nunca guarda os dados de saúde enviados nem a resposta da IA. | DECIDIDO ADR-022 |
| BR-RPT-09 | Gate de lançamento: o "Resumo com IA" não pode ficar ativo em produção para utilizadores reais antes de (a) a AIPD cobrir explicitamente este tratamento e (b) existir DPA assinado com o fornecedor de IA escolhido. | DECIDIDO ADR-022 |
| BR-RPT-10 | O plano gratuito — único disponível no MVP, sem pagamentos (D/scope §3) — tem **zero** utilizações do "Resumo com IA": a funcionalidade fica reservada para um plano pago futuro, fora do MVP. A conta é informada disto no registo (mensagem, sem cobrança real). | DECIDIDO change control 2026-10-17 (proprietário) |

## 11. Auditoria e retenção (BR-AUD)

| ID | Regra | Estado |
|---|---|---|
| BR-AUD-01 | São auditados pelo menos: login, visualização/download de documentos e exames, alterações a receitas, membros, tutela, partilha; eliminações; ações do Platform Admin. | DECIDIDO prompt §20 + DERIVADO |
| BR-AUD-02 | Ao apagar dados de um User, os logs são anonimizados. | DECIDIDO D15 |
| BR-AUD-03 | Os logs de auditoria são conservados **24 meses** e depois eliminados. | DECIDIDO Fase 14 (delegada) |
| BR-AUD-04 | A eliminação definitiva de dados remove-os da base de dados e do armazenamento de objetos; as cópias de segurança expiram em ≤30 dias. | DECIDIDO D15, N6 |

---

## 12. DECISÕES DESTA FASE (B1–B6) E REGRAS DERIVADAS

> **Delegadas pelo proprietário ao assistente em 2026-10-04** ("adota a recomendação" / "faz todas as fases restantes com a sua recomendação"). Adotada a recomendação em todas. Sujeitas a revisão por change control.

| ID | Decisão | Escolha |
|---|---|---|
| B1 | Aviso dos 18 anos (P4) | **30 dias e 7 dias antes + no dia**, ao jovem (se tiver conta) e aos tutores. |
| B2 | Avisos antes de apagar (90 dias, Q7) | Ao Admin nos dias **0, 30, 60 e 83**; dados bloqueados durante o período. |
| B3 | Idade mínima de conta de dependente menor | **13 anos**; abaixo disso o tutor opera sem o menor ter conta. |
| B4 | Limites | **5 famílias por User; 20 membros por família; 20 convites pendentes por família; 10 clínicas privadas por família.** |
| B5 | Plano sem fim | **Permitido** ("uso contínuo"), até ser terminado. |
| B6 | Reaceitação de termos | **Obrigatória** quando a versão muda; sem aceitar, a API só permite aceitar os termos, exportar dados e eliminar a conta. |

### Regras derivadas nas Fases 8–16 (a considerar parte desta especificação)
| ID | Regra |
|---|---|
| BR-MEM-16 | Quando o Admin remove um adulto com conta, o sistema gera para essa pessoa o pacote de dados (como "levar", BR-MEM-14), envia-lho por e-mail e só depois apaga os dados na família. Nada é perdido sem a pessoa ter hipótese de os obter. |
| BR-MEM-17 | Ao aceitar um convite ligado a um perfil existente, a data de nascimento do User tem de coincidir com a do perfil. Se for um convite de conta de dependente, a data de nascimento do User é a do perfil. |
| BR-PRV-10 | Nome e data de nascimento são visíveis a todos os membros da família (necessários à estrutura familiar) e **não** são partilha opcional. O tipo sanguíneo passa a pertencer à categoria **Alergias e tipo sanguíneo** (C2). Refina P1. |
| BR-APT-05 | As antecedências dos lembretes (24 h e 2 h) são **fixas** no MVP; o utilizador só escolhe canais e tipos (clarifica R9 e BR-APT-03). |
| BR-ALR-08 | O texto de notificações externas não inclui nome do membro nem hora; essa informação só existe dentro da app. |
| BR-DATA-01 | O identificador de cada recurso é um UUID; os dados de saúde de um **FamilyMember** pertencem a essa família e ao seu perfil; um User em duas famílias tem **dois perfis independentes**, sem partilha de registos entre famílias (ver ADR-005). |

---

## 13. Seguradoras e reembolsos (BR-INS) — ADR-021

> Acrescentada 2026-10-16 (change control, decisão do proprietário, ADR-021). Mirror de BR-CLN para um terceiro ator.

| ID | Regra | Estado |
|---|---|---|
| BR-INS-01 | O cartão da apólice (`InsurancePolicy`) não exige que a seguradora seja parceira: nome da seguradora é texto livre. Pertence ao `FamilyMember`, como qualquer dado de saúde (ADR-005). | DECIDIDO ADR-021 |
| BR-INS-02 | Criar, editar e ver a apólice: só `SELF` (adulto) ou `TUTOR_OF` (pelo dependente); sem `SharingGrant` desta categoria, sem acesso de `OTHER` nesta versão. | DECIDIDO ADR-021 |
| BR-INS-03 | O pedido de reembolso (`ReimbursementClaim`) só existe sobre uma apólice de seguradora **parceira** (`InsurancePolicy.insurerId` preenchido, seguradora `ACTIVE`; BR-INS-09/10); criado/submetido por `SELF`/`TUTOR_OF`. | DECIDIDO ADR-021, emendado ADR-023 |
| BR-INS-04 | O titular escolhe, a cada submissão, os `Document`s já carregados que acompanham o pedido (opt-in por documento); a seguradora só vê essa lista, nunca o resto do perfil de saúde do membro. | DECIDIDO ADR-021 |
| BR-INS-05 | Estados: `SUBMITTED → APPROVED\|REJECTED → PAID` (ver `state-machines.md`). `REJECTED` exige motivo; `PAID` é marcado pelo titular/tutor, não pelo portal, nesta versão. | DECIDIDO ADR-021 |
| BR-INS-06 | Contas do portal da seguradora (D18 mirror, BR-CLN-05): o Platform Admin cria **só** a conta `INSURANCE_ADMIN` raiz de cada seguradora parceira (e pode repô-la). A própria conta `INSURANCE_ADMIN` cria, lista e remove as contas `INSURANCE_AGENT` da sua seguradora. Uma seguradora tem **no máximo** uma conta `INSURANCE_ADMIN` ativa (mirror de BR-CLN-05). | DECIDIDO ADR-021, emendado ADR-023 |
| BR-INS-07 | `INSURANCE_ADMIN` e `INSURANCE_AGENT` têm as mesmas permissões operacionais sobre pedidos (ver `authorization.md` §8.2); só a criação/remoção de agentes é exclusiva do `INSURANCE_ADMIN`. | DECIDIDO ADR-021 |
| BR-INS-08 | Fora do MVP do **fluxo de reembolso**: sem pré-autorização, sem verificação automática do número de apólice, sem consulta de cobertura separada, sem partilha do cartão com `OTHER`, sem acesso da seguradora a condições/alergias/medicação/consultas/exames do membro. **Emenda ADR-025 (D21):** as três primeiras exclusões **não se aplicam** às seguradoras com módulo operacional ativo (`insurer_accounts.operational_module_enabled`), que fazem elegibilidade, autorização e consulta de cobertura nos termos de BR-SEG; as restantes (sem partilha com `OTHER`, sem acesso a dados de saúde) mantêm-se sempre. | DECIDIDO ADR-021, emendado ADR-025 |
| BR-INS-09 | `InsurancePolicy.insurerId?` liga a apólice a uma seguradora **parceira** escolhida na lista `GET /families/{familyId}/insurers` (só `ACTIVE`); `insurerName` mantém-se texto livre (preenchido com o nome da parceira quando escolhida). Sem `insurerId` a apólice não admite pedidos de reembolso. | DECIDIDO ADR-023 (fecha lacuna de ADR-021) |
| BR-INS-10 | Seguradora `SUSPENDED`: as suas contas não fazem login nem refresh e as sessões são revogadas; novos pedidos sobre as suas apólices são recusados (`CONFLICT`); pedidos existentes mantêm-se. | DECIDIDO ADR-023 |

---

## 14. Administração da plataforma (BR-ADM) — ADR-023

> Acrescentada 2026-11-04 (change control D19, decisão do proprietário). Reforça R10/D4: o Platform Admin **nunca** acede a dados de saúde (BR-PRV-07); `admin` não importa módulos de saúde.

| ID | Regra | Estado |
|---|---|---|
| BR-ADM-01 | O Platform Admin pesquisa utilizadores (`q`: e-mail ou nome, parcial) e vê o **detalhe operacional**: id, e-mail, nome, estado, `platformRole`, datas (registo, verificação, suspensão), motivo da suspensão, nº de famílias e de sessões ativas, último uso de sessão. **Nunca** dados de saúde, nomes de famílias ou de membros (R10, D4). | DECIDIDO ADR-023 |
| BR-ADM-02 | **Reposição de acesso** de um utilizador (`reset-access`): revoga todas as sessões e envia ao e-mail da conta o e-mail de recuperação de palavra-passe (token de uso único, 1 h; conta `PENDING_VERIFICATION` recebe novo e-mail de verificação). O Platform Admin nunca define, vê nem recebe a palavra-passe ou o token. Auditado (`ADMIN_USER_RESET_ACCESS`). Não se aplica a si próprio. | DECIDIDO ADR-023 |
| BR-ADM-03 | O Platform Admin **lista** as contas do portal de uma clínica parceira (`CLINIC_ADMIN` e `CLINIC_MANAGER`): `id`, `email`, `role`, `status`, `createdAt`, `lastLoginAt`. Não cria nem remove Gestores (BR-CLN-05). | DECIDIDO ADR-023 (emenda ADR-020) |
| BR-ADM-04 | O Platform Admin **suspende** (motivo obrigatório) e **reativa** uma conta do portal da clínica; suspender revoga de imediato as `clinic_sessions` e a conta deixa de autenticar (`ACCOUNT_SUSPENDED`, ≤60 s). Reativar um `CLINIC_ADMIN` quando já existe outro ativo ⇒ `CONFLICT`. Auditado (`ADMIN_CLINIC_ACCOUNT_SUSPEND/REACTIVATE`). | DECIDIDO ADR-023 |
| BR-ADM-05 | **Seguradoras** (CRUD, sem eliminação): o Platform Admin lista, cria (nome, NIF único), edita (`PATCH`, nome/NIF) e suspende/reativa seguradoras parceiras (BR-INS-10). Auditado (`ADMIN_INSURER_CREATE/UPDATE/STATUS`). | DECIDIDO ADR-023 (completa ADR-021) |
| BR-ADM-06 | A conta `INSURANCE_ADMIN` raiz de cada seguradora é criada/reposta só pelo Platform Admin (BR-INS-06); não lista nem gere `INSURANCE_AGENT`. | DECIDIDO ADR-021 |
| BR-ADM-07 | Toda ação `ADMIN_*` é auditada com `actor_type=PLATFORM_ADMIN`, sem dados de saúde nem palavras-passe/tokens em `metadata`. | DECIDIDO ADR-023 |

---

## 15. Módulo operacional de seguradoras (BR-SEG) — ADR-025

> Acrescentada 2026-11-05 (change control D21, decisão do proprietário). Aplica-se às seguradoras com módulo operacional ativo; multi-tenancy por `insurer_id`. Valores monetários em `numeric` na moeda da seguradora (Kz/AOA por omissão, Q1). Origem: `docs/insurer-module/`. BR-SEG-01..17 vêm da especificação; **BR-SEG-18..23** são derivadas das decisões do proprietário (Q1, Q2, Q3, Q7, Q11, C3).

### 15.1 Elegibilidade e autorização
| ID | Regra | Estado |
|---|---|---|
| BR-SEG-01 | Validação = elegibilidade + plano + validade + serviços cobertos + limites disponíveis + necessidade de autorização, filtrados por permissão (resposta mínima, BR-SEG-18). Elegível ⇔ beneficiário `ACTIVE` **e** apólice `ACTIVE` **e** data dentro de `validFrom..validTo`. | DECIDIDO ADR-025 |
| BR-SEG-02 | `requiresAuthorization` é por cobertura; serviços sem esta marca validam-se automaticamente (consulta geral não exige). | DECIDIDO ADR-025 |
| BR-SEG-03 | Autorização automática (`AUTO_APPROVED`) só quando todas as condições configuradas pela seguradora forem verdadeiras (coberto, dentro do limite, fora de carência, valor abaixo do **teto de auto-aprovação do plano**). Caso contrário `IN_REVIEW`. Alto custo (acima do teto) nunca é automático. | DECIDIDO ADR-025 (Q9) |
| BR-SEG-04 | Carência: serviço dentro de `waitingDays` desde `Policy.validFrom` → não coberto (a decisão manual pode sobrepor-se, com motivo). | DECIDIDO ADR-025 |
| BR-SEG-05 | Código de autorização único, não adivinhável, com validade; uma autorização só cobre o serviço/prestador/beneficiário para que foi emitida. | DECIDIDO ADR-025 |

### 15.2 Limites e comparticipação
| ID | Regra | Estado |
|---|---|---|
| BR-SEG-06 | Comparticipação = `valor × copayPct`, limitada ao saldo; o excedente é do paciente. Exemplo: 20.000 × 80 % → 16.000 seguradora / 4.000 paciente. | DECIDIDO ADR-025 |
| BR-SEG-07 | Saldo disponível = limite − `used` − `reserved`. Aprovar autorização reserva o `authorizedAmount`; despesa aprovada converte reserva em `used`; expirar/cancelar liberta. | DECIDIDO ADR-025 |
| BR-SEG-08 | Limites por beneficiário, por família (soma do agregado) e anual; vence o **menor saldo** entre eles. Cálculo em `numeric`; **arredondamento (PROPOSTO, a ratificar):** *half-up* à unidade menor da moeda, sobre o total da despesa, `patientShare = total − insurerShare`; ordem comparticipação → limite → excedente. Testes de propriedade obrigatórios. | DECIDIDO ADR-025 (Q8: menor saldo); arredondamento PROPOSTO |
| BR-SEG-09 | Exclusões prevalecem sobre inclusões. | DECIDIDO ADR-025 |

### 15.3 Despesas
| ID | Regra | Estado |
|---|---|---|
| BR-SEG-10 | Despesa deve associar beneficiário, apólice vigente na data do atendimento e, se exigida, autorização válida para esse serviço. | DECIDIDO ADR-025 |
| BR-SEG-11 | Duplicado = mesmo beneficiário + prestador + serviço + data (+ valor); sinalizado para revisão humana (fica `IN_REVIEW` com flag; nunca rejeitado automaticamente). | DECIDIDO ADR-025 |
| BR-SEG-12 | Devolver (`RETURNED`) exige motivo; a clínica só edita despesas devolvidas. | DECIDIDO ADR-025 |
| BR-SEG-13 | Valor faturado > valor autorizado (+ tolerância configurável por plano) → `IN_REVIEW` obrigatória. | DECIDIDO ADR-025 |

### 15.4 Dados, auditoria e importação
| ID | Regra | Estado |
|---|---|---|
| BR-SEG-14 | Multi-tenancy por `insurer_id` em todas as consultas e FKs compostas `(insurer_id, id)` (**sem RLS**, Q13); testes de isolamento entre seguradoras obrigatórios (`vita-qa-security`). | DECIDIDO ADR-025 (Q13) |
| BR-SEG-15 | Auditar: alterações de apólice/plano/cobertura, decisões, despesas, permissões e validações de elegibilidade (`actor_type` `INSURANCE_ACCOUNT`/`CLINIC_ACCOUNT`); catálogo em `audit.md` §3. | DECIDIDO ADR-025 |
| BR-SEG-16 | Sem decisão financeira/clínica sensível apenas automática: a auto-aprovação é configurável, auditada e **reversível** por revisão humana (`AUTO_APPROVED → CANCELLED` com motivo, antes de `USED`). | DECIDIDO ADR-025 |
| BR-SEG-17 | Importação de beneficiários em **CSV ou XLSX, até 5.000 linhas** por lote: pré-visualização + relatório de erros por linha, transação por lote, deteção de duplicados por documento de identificação; nunca ativa beneficiários sem validação (entram `PENDING`). | DECIDIDO ADR-025 (Q12) |

### 15.5 Regras derivadas das decisões do proprietário
| ID | Regra | Estado |
|---|---|---|
| BR-SEG-18 | **Minimização e anti-enumeração (C3):** a resposta de elegibilidade à clínica contém só nome, estado, plano, validade, serviços cobertos, limites e necessidade de autorização — nunca histórico clínico nem dados de outras seguradoras. Cada validação é auditada (finalidade: atendimento) e sujeita a rate limit por conta de clínica e por IP; respostas de "não encontrado/não elegível" não revelam o motivo além do necessário. O QR do cartão é um token assinado, de validade curta e revogável. A clínica só opera sobre seguradoras a que está ligada (`Provider`); caso contrário `NOT_FOUND`. | DECIDIDO ADR-025 |
| BR-SEG-19 | **Moeda (Q1):** cada seguradora tem a sua moeda (`currency`, ISO 4217; por omissão `AOA`/Kz). Todos os valores de limites, autorizações e despesas usam essa moeda; não há conversão nem comparação entre seguradoras. | DECIDIDO ADR-025 (Q1) |
| BR-SEG-20 | **Ligação paciente ↔ beneficiário (Q2):** o paciente (`SELF`/`TUTOR_OF`) "reclama" o cartão com nº de apólice + código fornecido pela seguradora; a seguradora confirma (`BENEFICIARY_MANAGER`/`INSURANCE_ADMIN`). Sem ligação confirmada, o paciente só tem o cartão manual (BR-INS-01). Só com ligação o paciente vê saldo, cartão digital e histórico (UC-SEG-14/15). O paciente pode desligar; a seguradora nunca acede por esta via a dados de saúde. | DECIDIDO ADR-025 (Q2) |
| BR-SEG-21 | **Dois fluxos de dinheiro (Q3):** despesa `APPROVED` marca o atendimento `DIRECT_BILLED`; um `ReimbursementClaim` que referencie um atendimento `DIRECT_BILLED` é recusado (`CONFLICT`). Pedidos sem referência ao atendimento são verificados pelo revisor (pendência ADR-025). | DECIDIDO ADR-025 (Q3) |
| BR-SEG-22 | **Serviços por seguradora (Q7):** `serviceCode` pertence à lista de serviços da seguradora (`insurer_services`); coberturas, autorizações, atendimentos e despesas só usam códigos da própria seguradora. Sem catálogo comum. | DECIDIDO ADR-025 (Q7) |
| BR-SEG-23 | **Várias seguradoras (Q11):** o mesmo paciente pode ser beneficiário em várias seguradoras; a seguradora a usar é a do **cartão apresentado**; sem coordenação de benefícios nem somas entre seguradoras. Sem diagnóstico no atendimento (Q5): só código de serviço. | DECIDIDO ADR-025 (Q5, Q11); seguradora por cartão = pendência Q4 |

---

*Fim da Fase 7 (v0.2). Regras de negócio fechadas. Próxima: Fase 8.*
