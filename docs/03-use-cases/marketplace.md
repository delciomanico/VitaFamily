# Casos de uso — Descoberta, comparação, ranking e conversas (MK2, ADR-037)

> Estado: **v0.1 — contrato de MK2 (2026-11-17); nada implementado.** Convenções comuns em `family.md`; MK1 (profissionais) em `professionals.md`. Regras: `business-rules.md` §17 (BR-MKT-32..49); requisitos FR-MKT-11..22. Atores: **Família** (`User` autenticado; nas conversas, titular `SELF` ou tutor `TUTOR_OF` em nome do dependente), **Profissional** (`ProfessionalAccount`, portal), **Platform Admin**, **Sistema** (jobs). Nenhum caso de uso partilha registos de saúde (isso é MK4); marcação, comprovativo e avaliações são MK3.

## Descoberta, comparação e ranking (`discovery`)

### UC-MKT-13 Pesquisar profissionais
- **Ator:** família (User autenticado) · **FR:** MKT-11, MKT-14 · **BR:** MKT-32, MKT-33, MKT-31
- **Fluxo:** em **Profissionais** o ecrã carrega os filtros (`GET /marketplace/filters`: especialidades com profissionais e a sua categoria, cidades, métodos) → a família escolhe especialidade (ou categoria), método, cidade, intervalo de preço em Kz e/ou «disponível nos próximos N dias» e escreve, se quiser, parte do nome → vê a lista paginada (cartões com nome, cidade, especialidades, **preço a partir de**, ofertas que correspondem, próxima disponibilidade e, com especialidade escolhida, razões do ranking) → ordena por «Melhores», preço (crescente/decrescente) ou «Mais cedo disponível».
- **Alternativos:** sem resultados ⇒ lista vazia com sugestão de alargar filtros; «Melhores» sem especialidade ⇒ `VALIDATION_ERROR` (a UI só oferece a ordenação com especialidade); preço mínimo > máximo ⇒ `VALIDATION_ERROR`; parâmetro fora do contrato/cursor inválido ⇒ `MALFORMED_REQUEST`; sem sessão ou com token de profissional ⇒ `401`; excesso de pedidos ⇒ `RATE_LIMITED`.
- **Pós-condição:** nada é gravado (sem registo de pesquisas nem auditoria; os *logs* de acesso não levam *query string*). Só aparecem profissionais `APPROVED` com ≥ 1 oferta ativa que cumpra **todos** os filtros de oferta em conjunto.

### UC-MKT-14 Ver o perfil público de um profissional
- **Ator:** família · **FR:** MKT-12 · **BR:** MKT-34, MKT-02, MKT-26
- **Fluxo:** abre o cartão → vê nome, cidade, bio, especialidades (a UI mostra o selo «validado» e o **aviso da categoria**: «Não substitui atendimento de urgência.» / «Serviço de bem-estar; não é um ato de saúde nem substitui o seu médico.»), todas as ofertas com método, duração e preço em Kz, a próxima disponibilidade e «Novo» (enquanto não houver avaliações) → ações: **Comparar**, **Escrever** (UC-MKT-17).
- **Alternativos:** profissional inexistente, não `APPROVED`, suspenso ou de outro estado ⇒ `NOT_FOUND` (sem oráculo); `?specialtyId=` de uma especialidade que o profissional não tem ⇒ `ranking` nulo.
- **Pós-condição:** nada gravado. O perfil **não** mostra e-mail, instruções de pagamento nem credenciais.

### UC-MKT-15 Comparar preços de 2–3 profissionais
- **Ator:** família · **FR:** MKT-13 · **BR:** MKT-35, MKT-31
- **Fluxo:** na lista (ou perfil) marca 2–3 profissionais para a mesma especialidade → **Comparar** → tabela lado a lado: por profissional, as ofertas (método × duração × preço em Kz × nota), «a partir de», próxima disponibilidade; linha de resumo por método com o **mais barato** destacado.
- **Alternativos:** < 2 ou > 3, ids repetidos ou sem `specialtyId` ⇒ `VALIDATION_ERROR`; um dos ids inexistente/não `APPROVED` ⇒ `NOT_FOUND` do pedido inteiro; profissional sem oferta ativa nessa especialidade ⇒ `VALIDATION_ERROR`.
- **Pós-condição:** nada gravado (a seleção vive no cliente).

### UC-MKT-16 Ver «como ordenamos»
- **Ator:** família · **FR:** MKT-14, MKT-15 · **BR:** MKT-36, MKT-37
- **Fluxo:** o link «Como ordenamos» abre `GET /marketplace/ranking-rules`: versão, os quatro critérios com o peso, a frase «O pagamento e os destaques pagos nunca influenciam a ordem» e a lista do que **não** é usado. O cartão mostra as razões do profissional («Perfil completo», «Boa disponibilidade»…).
- **Alternativos:** sem sessão ⇒ `401`.
- **Pós-condição:** nada gravado. O cálculo é uma função pura sobre a coorte da especialidade (ver BR-MKT-37); trocar pesos é mudança de contrato.

## Conversas (`messaging`) — lado da família

### UC-MKT-17 Escrever a um profissional (abrir a conversa)
- **Ator:** titular adulto ou **tutor em nome do dependente** · **FR:** MKT-16, MKT-20 · **BR:** MKT-38, MKT-39, MKT-42, MKT-46, MKT-47
- **Fluxo:** no perfil, **Escrever** → escolhe o membro (o próprio ou um dependente do qual é tutor) → vê o aviso fixo «Não envie dados de saúde sensíveis por aqui.» → indica como quer ser tratado/a (`participantLabel`, 1–40; sugestão: primeiro nome) e escreve a primeira mensagem → `POST /families/{f}/members/{m}/conversations` → conversa criada (`201`) com a primeira mensagem; se já existia conversa aberta com esse profissional para esse membro, a mensagem é acrescentada (`200`).
- **Alternativos:** dependente com conta (`DEPENDENT_SELF`) ou membro sem relação ⇒ `FORBIDDEN`; membro/família de outra conta ⇒ `NOT_FOUND`; profissional inexistente ou não `APPROVED` ⇒ `NOT_FOUND`; conversa fechada pelo profissional ⇒ `CONVERSATION_CLOSED`; > 5 conversas novas/24 h ⇒ `RATE_LIMITED`; > 20 abertas no membro ⇒ `LIMIT_EXCEEDED`; texto vazio/ > 1000/controlo ⇒ `VALIDATION_ERROR`; membro bloqueado ⇒ `MEMBER_BLOCKED`; repetir com o mesmo `clientMessageId` ⇒ `200` sem duplicar.
- **Pós-condição:** `conversations` + `messages(seq=1)` na mesma transação; auditoria `CONVERSATION_START` (`familyId`, `subjectMemberId`, `metadata.professionalId`; **sem** texto nem rótulo); alerta/e-mail ao profissional por UC-MKT-21.

### UC-MKT-18 Conversar: ler, enviar e marcar como lido
- **Ator:** titular ou tutor (família) · **FR:** MKT-16 · **BR:** MKT-39, MKT-40, MKT-42, MKT-47
- **Fluxo:** a lista de conversas do membro (`GET …/conversations`) mostra o profissional, o estado, `unreadCount` e `canSend` → abre uma (`GET …/{id}/messages`, mais recentes primeiro) → ao ficar visível, `PUT …/{id}/read` → envia mensagens (`POST …/{id}/messages`) → vê «lida» nas suas mensagens quando o profissional avança o marcador. Os dois tutores veem a mesma conversa.
- **Alternativos:** conversa fechada ou profissional que já não está `APPROVED` ⇒ `CONVERSATION_CLOSED` (a leitura continua); 4.ª mensagem seguida sem resposta ⇒ `LIMIT_EXCEEDED`; > 30/h por conversa ou > 200/dia ⇒ `RATE_LIMITED`; mensagem oculta pela moderação ⇒ vem com `hidden=true` e sem texto; conversa de outro membro/família ⇒ `NOT_FOUND`.
- **Pós-condição:** `messages` imutáveis; `familyReadSeq` monótono; auditoria só de abertura/fecho/denúncia (as mensagens e as leituras **não** se auditam).

### UC-MKT-19 Receber o aviso de uma nova mensagem (família)
- **Ator:** sistema → `SELF`/`TUTOR_OF` do membro · **FR:** MKT-17 · **BR:** MKT-41
- **Fluxo:** quando o profissional escreve, é criado um alerta `MESSAGE_RECEIVED` (dentro da app com o nome do membro) e as notificações push/e-mail com o texto genérico «Tem uma nova mensagem de um profissional.»; novas mensagens na mesma conversa **não** criam outro alerta até a família a ler; ler a conversa marca o alerta como lido.
- **Alternativos:** canais desativados ⇒ só o alerta na app; a família já leu entretanto ⇒ novo alerta na mensagem seguinte; destinatário suspenso ⇒ `SKIPPED` (regras existentes).
- **Pós-condição:** `alerts`/`notifications` na mesma transação da mensagem; nenhum conteúdo, nome do profissional ou hora fora da app.

## Conversas — lado do profissional

### UC-MKT-20 Responder às conversas (profissional)
- **Ator:** profissional · **FR:** MKT-18 · **BR:** MKT-38..40, MKT-42, MKT-43, MKT-47, MKT-48
- **Fluxo:** **Conversas** no portal (`GET /professional-portal/conversations`, ordem da última mensagem, `unreadCount`, `participantLabel`, **sem** ids de família) → abre uma, lê, marca como lido e responde → pode **fechar** (travar abuso) e **reabrir** as que fechou.
- **Alternativos:** profissional não `APPROVED` ⇒ leitura sim, enviar/fechar/reabrir ⇒ `PROFESSIONAL_LOCKED`; conversa fechada pela família ⇒ `CONVERSATION_CLOSED` ao enviar; conversa de outro profissional ou inexistente ⇒ `NOT_FOUND` idêntico; reabrir uma que não fechou ⇒ `INVALID_STATE_TRANSITION`; excesso de taxa ⇒ `RATE_LIMITED`.
- **Pós-condição:** como UC-MKT-18; auditoria `PROFESSIONAL_CONVERSATION_CLOSE/REOPEN` (`actor_type=PROFESSIONAL_ACCOUNT`).

### UC-MKT-21 Avisar o profissional de uma nova mensagem
- **Ator:** sistema (job `messaging.notify-professional`) · **FR:** MKT-17 · **BR:** MKT-41
- **Fluxo:** quando a família escreve, o sistema enfileira (na mesma transação) o aviso; o job envia **um** e-mail genérico («Tem uma nova mensagem no Vita») se não houve outro para a conversa nos últimos 30 minutos; o portal mostra sempre o contador atualizado.
- **Alternativos:** falha de SMTP ⇒ *retry* com recuo; profissional entretanto sem conta ⇒ descarta; repetição do job ⇒ idempotente (`professional_notified_at`).
- **Pós-condição:** `conversations.professional_notified_at` atualizado; sem conteúdo no e-mail nem nos *logs*.

## Fecho, denúncia e moderação

### UC-MKT-22 Fechar e reabrir uma conversa (família)
- **Ator:** titular ou tutor · **FR:** MKT-16 · **BR:** MKT-43
- **Fluxo:** **Arrumar** (`POST …/close`) fecha a conversa (leitura continua); **Reabrir** (`POST …/reopen`) só se foi a família a fechar.
- **Alternativos:** já fechada/aberta ⇒ `INVALID_STATE_TRANSITION`; fechada pelo profissional ou pelo sistema ⇒ `CONVERSATION_CLOSED` ao reabrir; `DEPENDENT_SELF`/`OTHER` ⇒ `FORBIDDEN`.
- **Pós-condição:** auditoria `CONVERSATION_CLOSE/REOPEN` (`familyId`, `subjectMemberId`).

### UC-MKT-23 Denunciar uma mensagem
- **Ator:** titular/tutor (família) ou profissional · **FR:** MKT-19 · **BR:** MKT-44
- **Fluxo:** numa mensagem **do outro lado** → **Denunciar** → escolhe o motivo (abuso, spam, pagamento fora da plataforma/esquema, dados sensíveis, outro) e, opcionalmente, uma nota (≤ 300) → o texto «A Vita Family só verá esta mensagem e as 2 anteriores da conversa» esclarece o que o admin vê.
- **Alternativos:** mensagem própria ⇒ `VALIDATION_ERROR`; mensagem de outra conversa ⇒ `NOT_FOUND`; denunciar de novo (mesmo lado) ⇒ `200` com a existente; > 10/dia ⇒ `RATE_LIMITED`.
- **Pós-condição:** `message_reports` `OPEN`; auditoria `MESSAGE_REPORT_CREATE` (`resourceId` = denúncia; `metadata.reason`; **sem** texto nem nota); a mensagem **continua visível** até decisão.

### UC-MKT-24 Moderar denúncias (admin)
- **Ator:** Platform Admin · **FR:** MKT-19 · **BR:** MKT-44, MKT-48
- **Fluxo:** **Administração → Denúncias** (fila `OPEN`, mais antigas primeiro) → abre o detalhe (a **mensagem denunciada** e, como contexto, as **2 mensagens imediatamente anteriores** da mesma conversa por `seq` — menos se não existirem —, motivo/nota, profissional, `reportedUserId` se a denunciada for da família) — **auditado** → decide: **Arquivar**, **Ocultar mensagem** ou **Ocultar e fechar a conversa** → se for preciso, usa as rotas já existentes para suspender o profissional ou a conta (sem automatismo).
- **Alternativos:** decisão sobre denúncia já decidida ⇒ `INVALID_STATE_TRANSITION`; User não-admin ⇒ `FORBIDDEN`; denúncia inexistente ⇒ `NOT_FOUND`.
- **Pós-condição:** transação única com bloqueio da denúncia; `messages.hidden_at` e, se for o caso, conversa `CLOSED` (`SYSTEM`); auditoria `ADMIN_MESSAGE_REPORT_VIEW`/`ADMIN_MESSAGE_REPORT_DECIDE` (`metadata.decision`; **sem** conteúdo). O admin **não** lê mais mensagens do que a denunciada e as 2 anteriores (nem posteriores, nem de outras conversas; uma anterior já oculta vem sem texto) nem vê a família, o membro ou o `participantLabel`.

### UC-MKT-25 Expurgar conversas pela retenção (sistema)
- **Ator:** sistema (job `messaging.purge-expired`, diário) · **BR:** MKT-45
- **Fluxo:** apaga as conversas com `lastMessageAt` há mais de 24 meses (mensagens e denúncias em cascata) → regista uma entrada de auditoria com a contagem.
- **Alternativos:** execução repetida ⇒ idempotente; conversa com atividade recente ⇒ não toca.
- **Pós-condição:** sem restos de mensagens nem denúncias; auditoria `MESSAGES_PURGED` (`actor_type=SYSTEM`, `metadata.count`).

## Efeitos noutros fluxos
- **Suspensão/caducidade do profissional (MK1):** as conversas ficam legíveis e bloqueadas para envio; ao reativar, retomam (BR-MKT-47). **Eliminar membro/família ou sair com pacote:** as conversas do membro apagam-se; a exportação do titular inclui-as (BR-MKT-45). **MK3:** a conversa poderá ligar-se à marcação (coluna `booking_id` na migração de MK3). **MK4:** a mensagem de aviso passa a referir a partilha com prazo (OP-85).
