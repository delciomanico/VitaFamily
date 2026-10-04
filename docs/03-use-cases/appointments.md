# Casos de uso — Consultas e clínicas (Fase 6)

> Estado: **RASCUNHO v0.1** — convenções comuns em `family.md`.
> Quem pode: titular ou tutor criam/editam/cancelam. Dependente com conta vê (N2). Membros com C5 partilhado veem.

### UC-APT-01 Criar consulta
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
