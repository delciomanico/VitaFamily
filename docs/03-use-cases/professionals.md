# Casos de uso — Profissionais do mercado (MK1, ADR-037)

> Estado: **v0.1 — contrato de MK1 (2026-11-16); nada implementado.** Convenções comuns em `family.md`. Regras: `business-rules.md` §17 (BR-MKT-01..31); requisitos FR-MKT-01..10. Atores: **Profissional** (`ProfessionalAccount`, portal `/professional-portal/*`), **Platform Admin** (`/admin/*`), **Sistema** (jobs). A família **não** tem casos de uso em MK1 (pesquisa e perfil público: MK2). Nenhum caso de uso toca em dados de saúde.

### UC-MKT-01 Registar-se e verificar o e-mail
- **Ator:** visitante (futuro profissional) · **FR:** MKT-01 · **BR:** MKT-13, MKT-14
- **Fluxo:** indica e-mail, palavra-passe e aceita os termos do profissional → mensagem neutra «Se o e-mail for válido, enviámos um código» → recebe o código de 6 dígitos (24 h) → introduz-o com o e-mail → conta `ACTIVE`; existe um `Professional` em `DRAFT`.
- **Alternativos:** e-mail já registado ⇒ a mesma resposta neutra (não se cria nada nem se envia código); palavra-passe fraca ⇒ `PASSWORD_WEAK`; código errado/expirado ⇒ `NOT_FOUND` genérico; reenvio com limite (3/h).
- **Pós-condição:** `professional_accounts` + `professionals(DRAFT)` + versão dos termos; auditoria `PROFESSIONAL_REGISTER`, `PROFESSIONAL_EMAIL_VERIFIED`.

### UC-MKT-02 Entrar, sair e recuperar a palavra-passe
- **Ator:** profissional · **FR:** MKT-01 · **BR:** MKT-13, MKT-14, MKT-29
- **Fluxo:** login com e-mail e palavra-passe → access token (15 min) + cookie de refresh próprio → refresh rotativo → logout revoga a sessão. «Esqueci-me»: pedido neutro → código de 1 h → nova palavra-passe → **todas as sessões revogadas**.
- **Alternativos:** credenciais erradas ⇒ `AUTH_INVALID_CREDENTIALS` genérico; e-mail por verificar (após palavra-passe certa) ⇒ `EMAIL_NOT_VERIFIED`; reutilização de refresh ⇒ cadeia revogada; token de User/clínica ⇒ `401`; `SUSPENDED`/`REJECTED` entram só em leitura (OP-59).
- **Pós-condição:** auditoria `PROFESSIONAL_LOGIN[_FAILED]`, `PROFESSIONAL_LOGOUT`, `PROFESSIONAL_REFRESH_REUSE_DETECTED`, `PROFESSIONAL_PASSWORD_RESET`.

### UC-MKT-03 Preencher o perfil e escolher especialidades
- **Ator:** profissional · **FR:** MKT-02 · **BR:** MKT-02, MKT-22, MKT-23, MKT-26
- **Fluxo:** em **Perfil** preenche nome de apresentação, cidade, bio e instruções de pagamento (texto livre, «só mostrado depois de marcar») → escolhe 1–5 especialidades do catálogo (cada uma mostra a sua categoria e o aviso correspondente) → a página mostra o que falta («Falta: cédula profissional»).
- **Alternativos:** `PENDING_REVIEW`/`APPROVED` + alterar nome ou especialidades ⇒ `PROFESSIONAL_LOCKED` («Para alterar, peça ao administrador para reabrir»); `REJECTED`/`SUSPENDED` ⇒ só leitura; especialidade inativa ⇒ `VALIDATION_ERROR`; retirar especialidade com ofertas ⇒ `CONFLICT`.
- **Pós-condição:** auditoria `PROFESSIONAL_PROFILE_UPDATE` (nomes dos campos), `PROFESSIONAL_SPECIALTIES_SET` (ids).

### UC-MKT-04 Carregar e gerir credenciais
- **Ator:** profissional · **FR:** MKT-03 · **BR:** MKT-16, MKT-17
- **Fluxo:** em **Credenciais** escolhe o tipo (identificação, cédula/inscrição, certificação), nº, entidade e validade opcionais e o ficheiro (PDF/JPG/PNG ≤ 10 MB) → o ficheiro fica «em verificação» até o antivírus o aprovar → lista com estado (`PENDING`/`CLEAN`/`INFECTED`); pode descarregar a sua e removê-la.
- **Alternativos:** tipo/tamanho inválidos ⇒ `FILE_TYPE_NOT_ALLOWED`/`FILE_TOO_LARGE`; 11.ª ⇒ `LIMIT_EXCEEDED`; estado não editável ⇒ `PROFESSIONAL_LOCKED`; `INFECTED` ⇒ não descarregável, tem de ser removida e substituída; quota de uploads (20/h) ⇒ `RATE_LIMITED`.
- **Pós-condição:** `professional_credentials` + objeto em storage; auditoria `PROFESSIONAL_CREDENTIAL_UPLOAD/DELETE/DOWNLOAD` (sem nº, entidade nem nome do ficheiro).

### UC-MKT-05 Submeter para validação
- **Ator:** profissional · **FR:** MKT-04 · **BR:** MKT-15, MKT-16
- **Fluxo:** com os requisitos cumpridos clica **Submeter** → estado `PENDING_REVIEW` («Em análise») → o perfil e as credenciais ficam bloqueados à edição de identidade.
- **Alternativos:** faltam requisitos ⇒ `422` com a lista (`errors[]`); já em análise/aprovado ⇒ `INVALID_STATE_TRANSITION`; credencial ainda `PENDING` no antivírus ⇒ falta `CREDENTIAL_SCAN_PENDING`.
- **Pós-condição:** `ValidationCase SUBMITTED`; auditoria `PROFESSIONAL_SUBMIT`.

### UC-MKT-06 Validar um profissional (admin)
- **Ator:** Platform Admin · **FR:** MKT-04, MKT-09 · **BR:** MKT-15, MKT-16, MKT-17, MKT-18
- **Fluxo:** **Administração → Profissionais** (fila `PENDING_REVIEW`, mais antigo primeiro; filtro por estado, categoria e pesquisa) → abre o detalhe (e-mail, perfil, especialidades, credenciais, histórico) → descarrega cada credencial (auditado) → decide: **Aprovar**; **Rejeitar** (motivo); **Pedir informação** (motivo) → o profissional vê o estado e o motivo.
- **Alternativos:** decisão sobre estado que já mudou (outro admin decidiu) ⇒ `INVALID_STATE_TRANSITION`; sem motivo onde é obrigatório ⇒ `VALIDATION_ERROR`; aprovar com requisitos em falta (p. ex. credencial entretanto caducada) ⇒ `VALIDATION_ERROR`; credencial `PENDING`/`INFECTED` ⇒ `DOCUMENT_NOT_AVAILABLE`; profissional inexistente ⇒ `NOT_FOUND`.
- **Pós-condição:** `ValidationCase` imutável + estado + `statusReason` na mesma transação; `APPROVED` ⇒ gera os horários das regras existentes; auditoria `ADMIN_PROFESSIONAL_*` (sem motivo) e `ADMIN_PROFESSIONAL_CREDENTIAL_DOWNLOAD`. O admin **não** vê dados de saúde nem `paymentInstructions`.

### UC-MKT-07 Gerir o catálogo de especialidades (admin)
- **Ator:** Platform Admin · **FR:** MKT-08 · **BR:** MKT-02, MKT-22
- **Fluxo:** lista (todas, com nº de profissionais) → cria (nome, categoria `HEALTH`/`WELLNESS`) → renomeia ou **desativa/reativa** (nunca apaga).
- **Alternativos:** nome duplicado ⇒ `CONFLICT`; mudar a categoria de uma especialidade em uso ⇒ `CONFLICT`; nome fora de 2–80 ⇒ `VALIDATION_ERROR`.
- **Pós-condição:** auditoria `ADMIN_SPECIALTY_CREATE/UPDATE`.

### UC-MKT-08 Gerir ofertas e preços
- **Ator:** profissional · **FR:** MKT-06 · **BR:** MKT-03, MKT-24, MKT-31
- **Fluxo:** em **Serviços** cria uma oferta (especialidade, método, duração, preço em Kz, nota, p. ex. a morada) → altera o preço/nota ou **desativa/reativa**. O preço é visível às famílias só com o perfil `APPROVED` (MK2).
- **Alternativos:** especialidade que não é do profissional ⇒ `VALIDATION_ERROR`; duplicado ativo ⇒ `CONFLICT`; 21.ª ativa ⇒ `LIMIT_EXCEEDED`; preço não inteiro/negativo ⇒ `VALIDATION_ERROR`; mudar método/duração ⇒ `VALIDATION_ERROR` (criar outra); `REJECTED`/`SUSPENDED` ⇒ `PROFESSIONAL_LOCKED`.
- **Pós-condição:** desativar remove os horários futuros livres gerados pelas regras da oferta; auditoria `PROFESSIONAL_OFFER_CREATE/UPDATE` (sem preços).

### UC-MKT-09 Definir horários e bloqueios
- **Ator:** profissional · **FR:** MKT-07 · **BR:** MKT-25
- **Fluxo:** em **Horários** escolhe a oferta, os dias da semana, a hora de início e fim (hora de Luanda) e, opcionalmente, a validade → guarda → vê «criados N horários; M ignorados por sobreposição/bloqueio» (só se já estiver `APPROVED`; antes disso as regras ficam guardadas e os horários nascem na aprovação) → pode editar, desativar, e criar/remover **bloqueios/férias**; consulta os horários gerados por intervalo.
- **Alternativos:** regra sobreposta a outra ativa do profissional ⇒ `CONFLICT`; intervalo menor que a duração ⇒ `VALIDATION_ERROR`; oferta de outro profissional/inexistente ⇒ `NOT_FOUND`; bloqueio inválido (fim ≤ início, > 366 dias, passado) ⇒ `VALIDATION_ERROR`; 21.ª regra ⇒ `LIMIT_EXCEEDED`.
- **Pós-condição:** `professional_slots` idempotentes; auditoria `PROFESSIONAL_SCHEDULE_RULE_*`, `PROFESSIONAL_TIME_OFF_*` (sem a nota); repetir a geração não duplica.

### UC-MKT-10 Suspender e reativar (admin)
- **Ator:** Platform Admin · **FR:** MKT-04, MKT-05 · **BR:** MKT-01, MKT-19, MKT-20
- **Fluxo:** no detalhe de um `APPROVED` → **Suspender** (motivo obrigatório) → deixa de aparecer; mais tarde **Reativar** → volta a `APPROVED`. Também **Pedir informação** a um `APPROVED` ou `REJECTED` (reabre para `NEEDS_INFO`).
- **Alternativos:** suspender um estado que não é `APPROVED` ⇒ `INVALID_STATE_TRANSITION`; reativar com credencial caducada ⇒ `VALIDATION_ERROR`.
- **Pós-condição:** nada é apagado (ofertas, horários, histórico); o profissional vê o estado e o motivo em leitura; marcações futuras: MK3.

### UC-MKT-11 Caducidade de credencial (sistema)
- **Ator:** Sistema (job `professionals.expire-credentials`, diário) · **BR:** MKT-21
- **Fluxo:** para cada `APPROVED` com credencial exigida caducada → `NEEDS_INFO`, motivo fixo «Credencial caducada.», deixa de ser visível → o profissional carrega a nova credencial e volta a submeter (UC-MKT-04/05).
- **Alternativos:** profissional com credencial renovada e `CLEAN` entretanto ⇒ não muda; execução repetida ⇒ idempotente.
- **Pós-condição:** `ValidationCase EXPIRED` (`SYSTEM`); auditoria com contagem por execução.

### UC-MKT-12 Ver o estado e o motivo (profissional)
- **Ator:** profissional · **FR:** MKT-02, MKT-05 · **BR:** MKT-15, MKT-16, MKT-23
- **Fluxo:** a página inicial do portal mostra o estado em linguagem simples («A preencher», «Em análise», «Aprovado e visível», «Falta informação», «Rejeitado», «Suspenso»), o último motivo do admin e a lista `requirements.missing`.
- **Alternativos:** qualquer estado pode ler; as escritas seguem a matriz de `authorization.md` §10.2.
