# Vita Family — Critérios de aceitação (Fase 15)

> Estado: **v0.1**. Formato Given/When/Then (prompt §21). IDs `AC-<área>-nn` ligam aos requisitos (`FR-*`, `BR-*`) e aos casos de teste (`test-cases.md`).
> "Família F" = família de teste. "A" = Admin; "M" = membro adulto; "T" = tutor; "D" = dependente.

## Conta e acesso
- **AC-ACC-01 (FR-AUTH-01/06, BR-ACC-01/02)** *Given* um visitante com 18+ anos, *When* se regista com dados válidos, *Then* recebe resposta neutra, o e-mail de verificação é enviado, e só após verificar consegue fazer login.
- **AC-ACC-02** *Given* um visitante com <18 anos, *When* tenta registar-se sozinho, *Then* recebe `AGE_REQUIREMENT_NOT_MET`.
- **AC-ACC-03** *Given* um e-mail já registado, *When* alguém se regista com ele, *Then* a resposta é idêntica à de um e-mail novo.
- **AC-ACC-04 (BR-ACC-05)** *Given* uma conta suspensa, *When* tenta login ou usa token existente, *Then* é recusada (`ACCOUNT_SUSPENDED`) no máximo 60 s depois da suspensão e deixa de receber notificações.
- **AC-ACC-05 (BR-ACC-06/07)** *Given* um User que é único tutor de um dependente, *When* pede eliminação, *Then* `ACCOUNT_DELETION_BLOCKED`; *Given* já não o ser, *Then* os seus dados, documentos e sessões desaparecem e a auditoria fica anonimizada.
- **AC-ACC-06 (B6)** *Given* nova versão de termos, *When* o User usa a API, *Then* recebe `TERMS_REACCEPTANCE_REQUIRED` exceto para aceitar termos, exportar e eliminar.
- **AC-ACC-07 (ADR-007)** *Given* um refresh token já rodado, *When* é reutilizado, *Then* toda a cadeia de sessões é revogada e é auditado `AUTH_REFRESH_REUSE_DETECTED`.

## Família e membros
- **AC-FAM-01 (FR-FAM-01)** *Given* um User autenticado, *When* cria uma família, *Then* a família existe e ele é FAMILY_ADMIN e membro.
- **AC-FAM-02 (D2, B4)** *Given* um User em 5 famílias, *When* cria a 6.ª, *Then* `LIMIT_EXCEEDED`.
- **AC-FAM-03 (BR-FAM-02)** *Given* a família com um único Admin e outros membros, *When* o Admin tenta sair, remover o seu papel ou eliminar a conta, *Then* é recusado (`LAST_ADMIN`/`ACCOUNT_DELETION_BLOCKED`).
- **AC-FAM-04 (R2)** *Given* a família com 2 membros, *When* o Admin tenta eliminá-la, *Then* `FAMILY_NOT_EMPTY`; *Given* 1 membro, *Then* tudo é apagado, incluindo ficheiros.
- **AC-MEM-01 (D1, Q7)** *Given* A, *When* cria um menor sem conta com tutor, *Then* o perfil existe como dependente com esse tutor principal.
- **AC-MEM-02** *Given* A, *When* cria um menor sem tutor, *Then* `DEPENDENT_REQUIRES_GUARDIAN`.
- **AC-MEM-03 (BR-MEM-12)** *Given* um convite de 7 dias, *When* é aceite por conta com outro e-mail ou depois de expirado, *Then* `INVITATION_EMAIL_MISMATCH`/`INVITATION_EXPIRED`; o convite aceite não pode ser reutilizado.
- **AC-MEM-04 (BR-MEM-17)** *Given* convite ligado a perfil, *When* a data de nascimento do User não coincide, *Then* `BIRTHDATE_MISMATCH`.
- **AC-MEM-05 (P2, B3)** *Given* T, *When* autoriza conta para dependente de 12 anos, *Then* `DEPENDENT_ACCOUNT_AGE`; com 13+ o convite é criado e a conta resultante tem acesso limitado.
- **AC-MEM-06 (R4)** *Given* um adulto com conta, *When* sai escolhendo "levar", *Then* é gerado o pacote (JSON + documentos) e **só depois** os dados são apagados da família.
- **AC-MEM-07 (BR-MEM-16)** *Given* A remove um adulto com conta, *Then* essa pessoa recebe o pacote por e-mail antes de os dados serem apagados.
- **AC-MEM-08 (P4, B1)** *Given* um dependente menor cuja data de nascimento faz 18 anos em 30 dias, *Then* o jovem (se tiver conta) e os tutores recebem avisos aos 30 dias, aos 7 dias e no dia; *When* o dia chega, *Then* a tutela termina, o tutor perde o acesso e a partilha anterior mantém-se.
- **AC-MEM-09 (Q7, B2)** *Given* um menor sem conta que faz 18 anos, *Then* o perfil fica `BLOCKED` sem acesso de ninguém, o Admin é avisado nos dias 0/30/60/83 e, aos 90 dias sem conta, o perfil é apagado.

## Privacidade e permissões
- **AC-PRV-01 (BR-PRV-01/10)** *Given* M em F sem concessões, *When* outro membro (incl. Admin) lê dados de saúde de M, *Then* é negado; *And* nome e data de nascimento são visíveis.
- **AC-PRV-02 (BR-PRV-03/04)** *Given* M partilha MEDICATION com N, *When* N lê, *Then* só leitura; *When* N tenta escrever, *Then* `FORBIDDEN`; *When* M retira a partilha, *Then* N perde acesso imediatamente (inclui relatórios e downloads).
- **AC-PRV-03 (N2)** *Given* D com conta, *When* lê alergias, condições ou exames, *Then* negado; *When* lê medicamentos e consultas e confirma uma toma, *Then* permitido; *When* tenta editar, *Then* negado.
- **AC-PRV-04 (D4)** *Given* um Platform Admin, *When* tenta qualquer endpoint de dados de saúde, *Then* negado; as listagens `/admin` não contêm dados de saúde.
- **AC-ISO-01 (NFR-SEC-04)** *Given* um User de outra família, *When* acede por id a qualquer recurso de F, *Then* sempre `404`.
- **AC-PRV-05 (P8)** *Given* T é o único tutor de D, *When* tenta sair ou ser removido, *Then* `LAST_GUARDIAN`.

## Registos de saúde
- **AC-HLT-01 (FR-HP)** *Given* o titular, *When* cria/edita/remove alergia, condição ou tipo sanguíneo, *Then* as alterações ficam registadas na auditoria com autor, sem versionamento (R6).
- **AC-RX-01 (BR-RX-01/02, M2)** *Given* T, *When* regista receita com 2 medicamentos, *Then* a receita está ACTIVE, são criados 2 planos ACTIVE e as ocorrências dos próximos 14 dias.
- **AC-RX-02** *Given* receita sem data de emissão, ou com data futura, ou sem medicamentos, *Then* `VALIDATION_ERROR`.
- **AC-RX-03 (BR-RX-04)** *Given* receita ACTIVE, *When* é cancelada, *Then* os planos terminam, as tomas futuras são removidas e o histórico mantém-se.
- **AC-MED-01 (Q1)** *Given* plano com horários 08:00 e 20:00, *Then* existem ocorrências nesses horários locais do fuso efetivo; plano "de 8 em 8 horas" gera ocorrências a intervalos absolutos.
- **AC-MED-02 (Q2)** *Given* ocorrência PENDING às 08:00, *When* passam 2 h sem ação, *Then* passa a UNCONFIRMED; *When* o utilizador confirma até ao fim do dia seguinte, *Then* TAKEN; depois disso `DOSE_WINDOW_EXPIRED`.
- **AC-MED-03 (D7, M4)** *Given* D sem conta, *When* T confirma a toma, *Then* fica registado quem e quando; *And* confirmar duas vezes é idempotente.
- **AC-MED-04 (FR-MED-07)** *Given* tomas não confirmadas, *Then* não é gerado alerta ao Admin nem ao tutor por isso.
- **AC-MED-05 (BR-MED-08)** *Given* o utilizador muda de fuso, *Then* as ocorrências PENDING futuras são recalculadas sem duplicar nem perder doses.
- **AC-APT-01 (FR-APT)** *Given* uma consulta futura, *Then* são agendados lembretes às 24 h e 2 h antes; *When* é reagendada ou cancelada, *Then* os lembretes futuros são recalculados/removidos.
- **AC-APT-02 (Q4)** *Given* consulta SCHEDULED já passada, *Then* permanece SCHEDULED e 24 h depois é enviado um alerta a pedir o desfecho (uma vez); o sistema nunca a marca REALIZADA sozinho.
- **AC-CLN-01 (R8)** *Given* uma clínica privada de F, *Then* só é visível a F; parceiras são visíveis a todos; *When* uma clínica é arquivada, *Then* consultas existentes mantêm o nome.
- **AC-EXM-01 (D8, Q9, D11)** *Given* resultado com valor fora do intervalo informado, *Then* o sistema guarda e mostra mas **não** gera alerta nem sinalização.
- **AC-EXM-02 (ST5)** *Given* exame SCHEDULED, *When* se tenta adicionar resultado, *Then* `INVALID_STATE_TRANSITION`.

## Documentos
- **AC-DOC-01 (M5, N4)** *Given* um PDF válido ≤10 MB, *When* é carregado, *Then* nasce `PENDING`, passa a `CLEAN` após antivírus e só então pode ser descarregado.
- **AC-DOC-02** *Given* ficheiro EICAR, *Then* é apagado, o upload é recusado e fica auditado `DOCUMENT_SCAN_INFECTED`.
- **AC-DOC-03** *Given* ficheiro `.pdf` que na verdade é executável, ou >10 MB, ou 6.º ficheiro do recurso, ou quota de 100 MB excedida, *Then* `FILE_TYPE_NOT_ALLOWED`/`FILE_TOO_LARGE`/`DOCUMENT_LIMIT_EXCEEDED`/`STORAGE_QUOTA_EXCEEDED`.
- **AC-DOC-04 (BR-DOC-04)** *Given* um utilizador sem permissão sobre a categoria do recurso, *When* pede o download, *Then* negado; *When* permitido, *Then* é entregue com `Cache-Control: no-store` e fica auditado.
- **AC-DOC-05 (D15)** *Given* uma receita eliminada, *Then* os seus ficheiros desaparecem do armazenamento (outbox concluída).

## Alertas
- **AC-ALR-01 (R9, Q3)** *Given* plano com toma às 08:00 e canais push+e-mail ativos, *Then* às 08:00 é gerado **um** alerta e duas notificações; *When* a toma continua PENDING 15 min depois, *Then* é gerado um segundo e último alerta; *When* é confirmada antes, *Then* não há repetição.
- **AC-ALR-02 (idempotência)** *Given* o scanner executa duas vezes sobre o mesmo minuto, *Then* não há alertas nem notificações duplicados.
- **AC-ALR-03 (FR-ALR-08)** *Given* toma de D sem conta, *Then* os tutores recebem o alerta; *Given* D com conta, *Then* D e os tutores recebem.
- **AC-ALR-04 (N8)** *Given* qualquer notificação externa, *Then* o texto é genérico, sem nomes de pessoas, medicamentos ou horas.
- **AC-ALR-05 (R9)** *Given* o utilizador desativa alertas de toma, *Then* não gera notificações desse tipo; *And* a falha do e-mail não impede o push.
- **AC-ALR-06 (ST6)** *Given* o envio falha, *Then* repete até 5 vezes com backoff e regista o erro.

## Relatórios
- **AC-RPT-01 (FR-RPT-03)** *Given* um membro com partilha apenas de MEDICATION, *When* gera o relatório de outro titular, *Then* só aparecem as secções de medicação; as restantes são omitidas.
- **AC-RPT-02 (D13)** *Given* A sem partilhas, *When* gera a visão familiar, *Then* vê só os seus dados, os dos seus dependentes e o que lhe foi partilhado.
- **AC-RPT-03 (Q11)** *Given* intervalo >5 anos, *Then* `VALIDATION_ERROR`; sem intervalo, usa 12 meses.

## Auditoria, exportação e RGPD
- **AC-AUD-01 (FR-AUD-01)** *Given* ação sensível, *Then* existe registo com utilizador, ação, recurso, hora, IP, user-agent e resultado; **sem** dados de saúde.
- **AC-AUD-02 (D15)** *Given* um User eliminado, *Then* os seus registos de auditoria têm `actorUserId`, IP e user-agent a nulo.
- **AC-PRV-06 (FR-PRIV-05, N7)** *Given* o titular, *When* pede exportação, *Then* recebe pacote JSON + documentos válido 7 dias; o tutor exporta os do dependente; o dependente menor não.
- **AC-NFR-01 (NFR-PRV-07)** *Given* fluxos com dados canário, *Then* esses dados não aparecem em logs técnicos.
