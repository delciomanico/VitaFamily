# Casos de uso — Conta e Família (Fase 6)

> Estado: **RASCUNHO v0.1** — decisões Q1–Q6 em `alerts.md`/fim desta fase.
> Convenções comuns a **todos** os ficheiros de `03-use-cases/`:
> - Pré-condição implícita: User autenticado, com e-mail verificado (R1), a atuar no contexto de **uma** família, salvo nos casos de conta.
> - A autorização segue `02-users/permissions.md`; negar por defeito. Falha de permissão → `403`; recurso de outra família ou inexistente → `404` (sem enumeração, NFR-SEC-09).
> - Toda a operação sensível é auditada (FR-AUD).
> - `[PROPOSTO]` = comportamento sugerido por mim, ainda sem decisão do proprietário.
> - FR = requisito funcional de origem.

---

## UC-ACC — Conta

### UC-ACC-01 Registar conta
- **Ator:** Visitante · **FR:** AUTH-01, AUTH-06, PRV-03
- **Fluxo:** fornece e-mail, palavra-passe, nome, data de nascimento, fuso horário e aceita termos/política → sistema cria conta não verificada e envia e-mail de verificação → utilizador abre o link → conta verificada.
- **Alternativos:** e-mail já registado (resposta neutra, sem revelar a existência); link expirado → reenvio; aceitar termos é obrigatório.
- **Pós-condição:** User verificado, consentimento registado (versão + data).
- **Regra:** utilizador com <18 anos não se regista sozinho; só via tutor (UC-MEM-05, P2). `[PROPOSTO]`: se a data de nascimento indicar <18, o registo é recusado com mensagem a explicar.

### UC-ACC-02 Login / logout
- **Ator:** User · **FR:** AUTH-02
- **Fluxo:** e-mail + palavra-passe → sessão iniciada → logout termina a sessão.
- **Alternativos:** credenciais inválidas (mensagem genérica); conta não verificada; **conta suspensa** (UC-ADM-02) → recusado; rate limiting.
- **Auditoria:** login com sucesso/falha.

### UC-ACC-03 Recuperar conta
- **Ator:** Visitante · **FR:** AUTH-03
- **Fluxo:** pede recuperação com o e-mail → recebe link de uso único e temporário → define nova palavra-passe → sessões anteriores são terminadas.
- **Regra:** resposta idêntica exista ou não a conta.

### UC-ACC-04 Editar perfil e preferências
- **Ator:** User (SELF) · **FR:** AUTH-04, ALR-05
- **Fluxo:** altera nome, fuso horário, canais de notificação ativos (push/e-mail) e tipos de alerta.
- **Efeito:** alterar o fuso reprograma as ocorrências futuras de toma e os lembretes.

### UC-ACC-05 Eliminar conta
- **Ator:** User (SELF) · **FR:** AUTH-05, PRIV-03
- **Pré-condições:** não ser o **único tutor** de um dependente (P8); não ser o **único Admin** de uma família com outros membros (UC-FAM-07).
- **Fluxo:** pede eliminação → confirmação forte (palavra-passe) → sistema apaga os dados pessoais e de saúde do User e documentos → logs anonimizados → sessões terminadas.
- **Alternativos:** pré-condição falha → mensagem clara com a ação necessária.
- **Nota:** o que acontece a famílias em que o User era o único membro: a família é eliminada (R2). Em famílias com mais membros, a saída segue R4 (UC-MEM-09).

### UC-ACC-06 Exportar os meus dados
- **Ator:** User (SELF); tutor para dependentes · **FR:** PRIV-05
- **Fluxo:** pede exportação → sistema gera ficheiro JSON com os dados do titular (sem documentos binários? ver Q6) → disponibiliza para descarregar durante tempo limitado.
- **Auditoria:** pedido e download.

---

## UC-FAM — Família

### UC-FAM-01 Criar família
- **Ator:** User · **FR:** FAM-01, MEM-01
- **Fluxo:** indica nome → sistema cria Family, cria o FamilyMember do próprio User (com a sua data de nascimento) e atribui FAMILY_ADMIN.
- **Pós-condição:** família com 1 membro e 1 Admin.

### UC-FAM-02 Listar as minhas famílias / selecionar contexto
- **Ator:** User · **FR:** FAM-02
- **Fluxo:** vê as famílias a que pertence e o papel em cada; o cliente passa a identificar a família em cada pedido.

### UC-FAM-03 Editar nome da família
- **Ator:** Family Admin · **FR:** FAM-04.

### UC-FAM-04 Atribuir ou retirar papel de Family Admin
- **Ator:** Family Admin · **FR:** FAM-03
- **Alternativo:** retirar o papel ao último Admin é recusado.
- **Regra:** só membros com conta e adultos podem ser Admin (M1).

### UC-FAM-05 Ver membros da família
- **Ator:** qualquer membro · **FR:** MEM-01
- **Resultado:** lista de membros, papéis e relações de tutela visíveis a esse ator. Dependente com conta vê só nomes (P5).

### UC-FAM-06 Eliminar família
- **Ator:** Family Admin · **FR:** FAM-04, R2
- **Pré-condição:** o ator é o **único membro** da família.
- **Fluxo:** confirmação forte → apaga a família e todos os dados e documentos associados.
- **Alternativo:** existem outros membros → recusado; indica remover membros ou transferir administração.

### UC-FAM-07 Transferir a administração e sair (Admin único)
- **Ator:** Family Admin único com outros membros adultos com conta · **FR:** FAM-03, MEM-10
- **Fluxo:** `[PROPOSTO]` atribui o papel Admin a outro adulto com conta (UC-FAM-04) → sai da família (UC-MEM-09).
- **Alternativo:** não há outro adulto com conta (só dependentes): não pode sair; tem de remover os dependentes ou convidar outro adulto. Ver Q5.
