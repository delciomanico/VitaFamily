# Casos de uso — Seguros e reembolsos (ADR-021, completados por ADR-023)

> Estado: **v0.1** — convenções comuns em `family.md`. Quem pode (titular): `SELF` (adulto) ou `TUTOR_OF`; sem partilha (BR-INS-02). Portal da seguradora: `authorization.md` §8.

### UC-INS-01 Registar cartão da apólice
- **Ator:** titular/tutor · **BR:** BR-INS-01/02/09 · **Fluxo:** escolhe o membro → (opcional) seguradora parceira da lista `GET /families/{id}/insurers` → nome da seguradora, nº de apólice, titular, validade, foto do cartão (upload de documento existente, `resourceType=INSURANCE_POLICY`).
### UC-INS-02 Ver/editar/eliminar apólice
- **Ator:** titular/tutor · Eliminar apaga também a foto (outbox) e os pedidos.
### UC-INS-03 Submeter pedido de reembolso
- **Ator:** titular/tutor · **BR:** BR-INS-03/04 · **Fluxo:** apólice com seguradora parceira ativa → valor e 1–10 itens entre documentos já carregados **e recibos de clínica** (M14 R, BR-CLN-36, UC-CLN-28) → `SUBMITTED`. Apólice sem parceira ou seguradora suspensa ⇒ `VALIDATION_ERROR`/`CONFLICT`.
### UC-INS-04 Confirmar pagamento
- **Ator:** titular/tutor · `APPROVED → PAID` (BR-INS-05).
### UC-INS-05 Gerir agentes da seguradora
- **Ator:** `INSURANCE_ADMIN` · listar/criar/remover `INSURANCE_AGENT` (BR-INS-06).
### UC-INS-06 Rever pedidos
- **Ator:** conta da seguradora · lista só da própria seguradora; abre um pedido (dados da apólice mínimos + documentos listados, BR-INS-04).
### UC-INS-07 Aprovar ou rejeitar
- **Ator:** conta da seguradora · `SUBMITTED → APPROVED|REJECTED`; rejeição exige motivo (BR-INS-05); `CONFLICT` se já decidido.
### UC-ADM-07 Gerir seguradoras
- Ver `appointments.md` (secção Administração).
