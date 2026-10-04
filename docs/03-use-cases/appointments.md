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
- **Fluxo:** escolhe dia(s), horas, especialidade, profissional (opcional) e duração → publica. Remove só horários livres (BR-CLN-04).

### UC-CLN-05 Confirmar ou recusar pedidos
- **Ator:** Gestor da clínica · **FR:** APT-06, APT-07
- **Fluxo:** vê os pedidos da clínica (dados mínimos, BR-CLN-03) → confirma (AGENDADA, geram-se lembretes) ou recusa com motivo opcional (RECUSADA, horário volta a ficar livre) → o titular/tutor é informado.

### UC-CLN-06 Ver a agenda da clínica e cancelar
- **Ator:** Gestor da clínica
- **Resultado:** consultas confirmadas por dia; pode cancelar uma consulta confirmada com motivo (o titular/tutor é informado; horário fica livre).

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
