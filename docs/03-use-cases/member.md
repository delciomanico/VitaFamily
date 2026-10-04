# Casos de uso — Membros, tutela, privacidade e perfil de saúde (Fase 6)

> Estado: **RASCUNHO v0.1** — convenções comuns em `family.md`.

---

## UC-MEM — Membros e tutela

### UC-MEM-01 Criar perfil de membro sem conta
- **Ator:** Family Admin · **FR:** MEM-02, MEM-05, MEM-06
- **Fluxo:** indica nome e data de nascimento; indica se é **dependente** → se for, atribui pelo menos um tutor (adulto da família) → sistema cria o FamilyMember sem conta.
- **Alternativos:** menor sem tutor indicado → recusado. Adulto não dependente sem conta: `[PROPOSTO]` permitido; fica sem tutor, com os dados geridos por ninguém até ter conta ou ser tornado dependente. **Ver Q7.**
- **Pós-condição:** perfil com campos de saúde vazios.

### UC-MEM-02 Convidar pessoa com conta
- **Ator:** Family Admin · **FR:** MEM-03, D14
- **Fluxo:** indica e-mail (e opcionalmente liga o convite a um perfil sem conta existente) → sistema gera convite válido 7 dias (R3) e envia e-mail com link.
- **Alternativos:** pessoa já é membro; limite de 20 convites pendentes (B4).

### UC-MEM-03 Aceitar convite
- **Ator:** User (autenticado ou a registar-se) · **FR:** MEM-04
- **Fluxo:** abre o link → entra ou regista-se com o e-mail convidado → confirma → fica ligado a um FamilyMember (novo, ou o perfil indicado no convite) com papel FAMILY_MEMBER.
- **Alternativos:** convite expirado/revogado/já usado → recusado; e-mail da conta diferente do convidado → recusado `[PROPOSTO]`.
- **Regra:** ao ligar a um perfil existente, os dados antigos desse perfil passam a ser do novo titular; os tutores mantêm a tutela se for dependente.

### UC-MEM-04 Revogar convite pendente
- **Ator:** Family Admin.

### UC-MEM-05 Criar conta para dependente (acesso limitado)
- **Ator:** Tutor do dependente · **FR:** MEM-08, P2
- **Fluxo:** o tutor autoriza e indica o e-mail do dependente → sistema envia convite específico → o dependente define a palavra-passe e fica com conta de acesso limitado (N2).
- **Regra:** a autorização do tutor é sempre exigida para menores (P2). Para dependentes adultos `[PROPOSTO]` o tutor também inicia o processo; o consentimento do adulto dependente **fica por definir** (ver Q7).

### UC-MEM-06 Atribuir / remover tutor
- **Ator:** Family Admin · **FR:** MEM-06
- **Regra:** o tutor é um adulto da família; um dependente tem sempre ≥1 tutor; remover o último tutor é recusado (P8).

### UC-MEM-07 Marcar / desmarcar membro como dependente
- **Ator:** Family Admin · **FR:** MEM-06, N3
- **Fluxo:** indica o membro adulto e tutores. `[PROPOSTO]` Para um adulto **com conta**, é necessário o **consentimento do próprio** antes de ser marcado como dependente (os tutores passam a gerir os seus dados). Ver Q7.

### UC-MEM-08 Remover membro
- **Ator:** Family Admin · **FR:** MEM-09, R4
- **Fluxo:** adulto com conta: sai da família (os seus dados saem com ele ou são apagados, à escolha dele, ver UC-MEM-09); dependente: os dados ficam sob a família até serem apagados por um tutor; dependente com conta: perde o acesso.
- **Alternativo:** remover o último Admin ou o único tutor de um dependente é recusado.

### UC-MEM-09 Sair da família (adulto)
- **Ator:** User adulto · **FR:** MEM-10, R4
- **Fluxo:** escolhe **levar** (exporta os seus dados em JSON, UC-ACC-06, e depois são apagados da família) ou **apagar**; confirma → deixa de ser membro; os seus dados na família são removidos.
- **Pré-condições:** não ser o único Admin (UC-FAM-07) nem único tutor (P8).
- **Nota:** `[PROPOSTO]` "levar" = exportação, não migração para outra família (ver Q6).

### UC-MEM-10 Menor completa 18 anos
- **Ator:** Sistema (Scheduler) · **FR:** MEM-05, P4
- **Fluxo:** antes do aniversário, avisa o jovem (se tiver conta) e os tutores aos 30 dias e 7 dias antes (B1) → no dia, a tutela termina, o FamilyMember passa a SELF, o tutor perde acesso aos dados de saúde, mantém-se a partilha anterior com outros membros até o titular a alterar.
- **Alternativo:** o jovem sem conta fica **sem ninguém a gerir os dados**; `[PROPOSTO]` o Admin é notificado para o convidar a criar conta; os dados ficam bloqueados (só leitura para ninguém) até lá (decidido em Q7).
- **Auditoria:** fim de tutela.

---

## UC-PRV — Partilha de dados

### UC-PRV-01 Definir partilha por categoria
- **Ator:** titular adulto (SELF) ou tutor (pelo dependente) · **FR:** PRIV-01, PRIV-02
- **Fluxo:** para cada categoria C1–C6 e cada outro membro (ou "todos"), concede ou retira acesso de leitura.
- **Regras:** por defeito só C1 é partilhado (P1); retirar a partilha tem efeito imediato inclusive em relatórios; notificações de alertas dependem do destinatário, não da partilha (FR-ALR-08).

### UC-PRV-02 Ver o que é partilhado comigo
- **Ator:** membro · **Resultado:** lista de titulares e categorias a que tem acesso.

---

## UC-HP — Perfil de saúde

### UC-HP-01 Ver perfil de saúde
- **Ator:** titular, tutor, ou membro com partilha · **FR:** HP-01
- **Resultado:** tipo sanguíneo, alergias, condições, histórico, conforme as categorias visíveis.
- **Auditoria:** visualização de perfil de outro titular (via partilha) é registada.

### UC-HP-02 Editar tipo sanguíneo e dados básicos
- **Ator:** titular ou tutor · **FR:** HP-01.

### UC-HP-03 Adicionar / editar / remover alergia
- **Ator:** titular ou tutor · **FR:** HP-02, HP-03
- **Campos:** nome, observações, datas (início) `[campos detalhados na Fase 9]`.

### UC-HP-04 Adicionar / editar / remover condição ou histórico médico
- **Ator:** titular ou tutor · **FR:** HP-02, HP-03.
- **Regra:** só estado atual; sem versionamento (R6); a auditoria regista a alteração.
