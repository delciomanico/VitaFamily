# Casos de uso — Partilha de registos com prazo e visualização única; receita digital (MK4, ADR-037)

> Estado: **v0.1 — contrato de MK4 (2026-11-20); nada implementado.** Convenções comuns em `family.md`; marcação (MK3) em `consultations.md`; chat (MK2) em `marketplace.md`. Regras: `business-rules.md` §17 (BR-MKT-67..81); requisitos FR-MKT-37..45. Atores: **Família** (`User`; partilha como titular `SELF` ou tutor `TUTOR_OF` em nome do dependente), **Profissional** (`ProfessionalAccount`, portal), **Sistema** (jobs). **Não há ator admin:** o admin da plataforma nunca acede a partilhas, vistas nem receitas (BR-MKT-75, D4). **Fora de MK4:** documentos/PDF nas partilhas, pedido de partilha pelo profissional, reencaminhar a terceiros, pagamento. Todo o conteúdo partilhado e o `participantLabel` são dado de saúde potencial (BR-MKT-75): nunca em logs nem auditoria. **A receita digital está desligada até ao parecer jurídico** (BR-MKT-79): os casos UC-MKT-59..61 só valem com a flag ligada.

## Partilhar (família)

### UC-MKT-48 Ver as opções de partilha de uma marcação
- **Ator:** `SELF`/`TUTOR_OF` · **FR:** MKT-37 · **BR:** MKT-67, MKT-68, MKT-69 · **Rota:** `GET /families/{f}/members/{m}/record-shares/options?bookingId=`.
- **Fluxo:** numa marcação `CONFIRMED`/`COMPLETED` (o alerta `BOOKING_UPDATED` e a marcação levam aqui) a família pede as opções: o servidor devolve o profissional (nome público), a categoria dele (`HEALTH`/`WELLNESS`), as **categorias permitidas** (`HEALTH` ⇒ as cinco; `WELLNESS` ⇒ só medicação), cada **prazo** com a data em que acabaria e se é elegível (o «fim da consulta + 24 h» pode já ter passado), o máximo de partilhas ativas e quantas já existem. A UI mostra o texto honesto sobre capturas (BR-MKT-72).
- **Alternativos:** marcação de outro membro/família ou inexistente ⇒ `NOT_FOUND`; marcação `REQUESTED`/`REJECTED`/`CANCELLED`/`NO_SHOW` ⇒ `INVALID_STATE_TRANSITION`; `DEPENDENT_SELF`/`OTHER` ⇒ `FORBIDDEN`; membro `BLOCKED` ⇒ `MEMBER_BLOCKED`; `RATE_LIMITED`.
- **Pós-condição:** nada gravado nem auditado.

### UC-MKT-49 Criar uma partilha
- **Ator:** `SELF`/`TUTOR_OF` · **FR:** MKT-37, MKT-43 · **BR:** MKT-67, MKT-68, MKT-69, MKT-72, MKT-77 · **Rota:** `POST /families/{f}/members/{m}/record-shares` (`bookingId`, `categories` 1–5, `validity`, `viewOnce?`, `clientRequestId?`).
- **Fluxo:** a família escolhe categorias, prazo e se é de visualização única → lê o texto honesto → **Partilhar**. Numa transação, sob bloqueio do membro: autorização (`ShareAccess`) → factos da marcação (`ShareAnchor`: do membro, `CONFIRMED`/`COMPLETED`, profissional, rótulo, categoria, `endsAt`) → categorias permitidas para a categoria do profissional → `expiresAt` calculado (BR-MKT-69) → limites → grava `ACTIVE` com `professional_category`, `participant_label` e `expiresAt` fixados → auditoria `RECORD_SHARE_CREATE` → e-mail genérico ao profissional (fila).
- **Alternativos:** marcação inexistente/de outro membro ⇒ `NOT_FOUND`; marcação noutro estado ⇒ `INVALID_STATE_TRANSITION`; categoria não permitida (ex.: `EXAMS` a `WELLNESS`), repetida, lista vazia ou `validity` inválida ⇒ `VALIDATION_ERROR`; `expiresAt ≤ agora` ⇒ `VALIDATION_ERROR`; 20 ativas ⇒ `LIMIT_EXCEEDED`; 20 criações/dia ⇒ `RATE_LIMITED`; `DEPENDENT_SELF`/`OTHER` ⇒ `FORBIDDEN`; membro `BLOCKED` ⇒ `MEMBER_BLOCKED`; `clientRequestId` repetido ⇒ `200` com a partilha existente (corpo divergente ⇒ `CONFLICT`).
- **Pós-condição:** partilha `ACTIVE` sem conteúdo copiado; o profissional passa a vê-la na lista (e só pode abri-la se estiver `APPROVED`); `expiresAt` imutável.

### UC-MKT-50 Ver as partilhas do membro
- **Ator:** `SELF`/`TUTOR_OF` · **FR:** MKT-40 · **BR:** MKT-67, MKT-73 · **Rotas:** `GET …/record-shares` (filtros `bookingId?`, `status?`; cursor), `GET …/record-shares/{shareId}`.
- **Fluxo:** a lista mostra, por partilha, o profissional (nome público), as categorias, o prazo, se é de visualização única, o **estado derivado** (`ACTIVE` | `EXPIRED` | `REVOKED` | `CONSUMED`), o total de vistas e a última; o detalhe devolve os mesmos campos (a autoria — qual dos tutores criou — fica só no servidor). Mais recentes primeiro.
- **Alternativos:** partilha de outro membro/família ou inexistente ⇒ `NOT_FOUND`; `DEPENDENT_SELF`/`OTHER` ⇒ `FORBIDDEN`; membro `BLOCKED` ⇒ `MEMBER_BLOCKED`; `RATE_LIMITED`.
- **Pós-condição:** nada gravado nem auditado. `EXPIRED` é derivado de `expiresAt ≤ agora` (não há job que o grave).

### UC-MKT-51 Ver quem viu o quê e quando
- **Ator:** `SELF`/`TUTOR_OF` · **FR:** MKT-40 · **BR:** MKT-73 · **Rota:** `GET …/record-shares/{shareId}/views` (`limit`, `cursor`).
- **Fluxo:** em «Quem viu» a família vê, por partilha, cada abertura bem-sucedida: nome público do profissional, categorias lidas e data/hora; mais recentes primeiro. Mostra também o aviso «Não conseguimos impedir capturas de ecrã…».
- **Alternativos:** como UC-MKT-50. Sem vistas ⇒ `items: []`.
- **Pós-condição:** nada gravado. As aberturas recusadas **não** aparecem (só na auditoria interna).

### UC-MKT-52 Revogar uma partilha
- **Ator:** `SELF`/`TUTOR_OF` (qualquer dos tutores) · **FR:** MKT-40, MKT-43 · **BR:** MKT-74 · **Rota:** `POST …/record-shares/{shareId}/revoke`.
- **Fluxo:** a família confirma → `ACTIVE` → `REVOKED` (`revoked_at`), efeito imediato; as vistas já registadas mantêm-se; auditoria `RECORD_SHARE_REVOKE`. Sem aviso ao profissional (OP-124).
- **Alternativos:** já `REVOKED`/`CONSUMED` ou expirada ⇒ `INVALID_STATE_TRANSITION`; partilha alheia ⇒ `NOT_FOUND`; `DEPENDENT_SELF`/`OTHER` ⇒ `FORBIDDEN`.
- **Pós-condição:** a abertura seguinte (mesmo a decorrer em paralelo, se ainda não comprometida) ⇒ `SHARE_NOT_AVAILABLE`.

## Ver (profissional)

### UC-MKT-53 Ver as partilhas recebidas
- **Ator:** profissional (todos os estados de validação, só leitura) · **FR:** MKT-38 · **BR:** MKT-70, MKT-75 · **Rotas:** `GET /professional-portal/shares` (`status?`, `bookingId?`, cursor), `…/{shareId}`.
- **Fluxo:** vê as partilhas que lhe foram feitas: rótulo do participante, categorias, prazo, se é de visualização única, estado derivado, quantas vezes **ele** abriu e `canOpen` (derivado: `ACTIVE`, não expirada, `APPROVED`, marcação válida). Sem conteúdo.
- **Alternativos:** partilha de outro profissional ou inexistente ⇒ `NOT_FOUND` idêntico; `RATE_LIMITED`.
- **Pós-condição:** nada gravado nem auditado; **nunca** ids de família/membro/utilizador (TC-AZ-MKT-30).

### UC-MKT-54 Abrir uma partilha (leitura repetível)
- **Ator:** profissional `APPROVED` · **FR:** MKT-38, MKT-39 · **BR:** MKT-68, MKT-70, MKT-72, MKT-73, MKT-77 · **Rota:** `POST /professional-portal/shares/{shareId}/open`.
- **Fluxo:** o profissional carrega em **Abrir** → numa transação o servidor reavalia (BR-MKT-70: pertença, estado, prazo, profissional `APPROVED`, marcação e membro, categorias) → lê as categorias concedidas pelas portas de leitura dos módulos de saúde → grava a vista (`record_share_views`, `view_count`) → auditoria `PROFESSIONAL_SHARE_OPEN` → devolve `SharedRecordsView` (secções só das categorias concedidas, `watermark`, `expiresAt`, `Cache-Control: no-store`). Pode repetir até `expiresAt`; cada abertura é uma vista.
- **Alternativos:** expirada/revogada/profissional não `APPROVED`/marcação cancelada/membro bloqueado ⇒ `403 SHARE_NOT_AVAILABLE` (auditoria `DENIED`, sem vista); já consumida ⇒ `403 SHARE_ALREADY_VIEWED`; partilha alheia ou inexistente ⇒ `404`; token de User/clínica ⇒ `401`; `RATE_LIMITED` (30/min; 120/dia por partilha).
- **Pós-condição:** o conteúdo **não** fica guardado em lado nenhum do servidor nem em auditoria; a família vê a vista (UC-MKT-51).

### UC-MKT-55 Abrir uma partilha de visualização única
- **Ator:** profissional `APPROVED` · **FR:** MKT-39 · **BR:** MKT-70, MKT-71 · **Rota:** `POST /professional-portal/shares/{shareId}/open` (a mesma de UC-MKT-54; a UI avisa «só pode ser aberta uma vez»).
- **Fluxo:** como UC-MKT-54, mas a **primeira** abertura bem-sucedida passa a partilha a `CONSUMED` na mesma transação da leitura; se a leitura falhar, nada se consome. Duas aberturas concorrentes: só uma vence.
- **Alternativos:** reabrir ⇒ `403 SHARE_ALREADY_VIEWED` («já foi visto»); resposta perdida depois do *commit* ⇒ a família cria nova partilha (OP-120).
- **Pós-condição:** `status=CONSUMED`, `consumed_at`, uma vista; o estado derivado da família passa a `CONSUMED`.

## Sistema e ciclo de vida

### UC-MKT-56 Avisar o profissional de uma nova partilha (sistema)
- **Ator:** sistema (job `record-sharing.notify-professional`, fila) · **FR:** MKT-42 · **BR:** MKT-78.
- **Fluxo:** depois do *commit* da criação, enfileira **um** e-mail genérico ao profissional (`singletonKey` = `shareId`; *retry*; melhor esforço); texto sem nome, rótulo, categorias nem prazo.
- **Alternativos:** falha de SMTP ⇒ *retry*; repetição ⇒ idempotente; profissional sem e-mail válido ⇒ ignorado (a lista do portal é a fonte).

### UC-MKT-57 Expurgar partilhas terminadas pela retenção (sistema)
- **Ator:** sistema (job `record-sharing.purge-expired`, diário) · **BR:** MKT-76.
- **Fluxo:** apaga as partilhas cujo fim (`GREATEST(expires_at, revoked_at, consumed_at)`) é há mais de 24 meses (as vistas vão em cascata); auditoria `RECORD_SHARES_PURGED` (`actor_type=SYSTEM`, `metadata.count`).
- **Alternativos:** repetição ⇒ idempotente; partilhas `ACTIVE` não expiradas nunca se tocam.

### UC-MKT-58 Exportar e apagar as partilhas do membro (ciclo de vida)
- **Ator:** titular (exportação/saída com pacote) ou apagamento do membro/família/profissional · **BR:** MKT-76.
- **Fluxo:** a exportação inclui a fonte opcional `recordShares` (partilhas e vistas, **sem** conteúdo); apagar o membro/família, o profissional ou a marcação apaga partilhas e vistas em cascata.
- **Alternativos:** eliminar a conta de `User` só anula as autorias (`SET NULL`).

## Receita digital (desligada até ao parecer jurídico)

### UC-MKT-59 Emitir uma receita digital (profissional)
- **Ator:** profissional `HEALTH` `APPROVED` · **FR:** MKT-44 · **BR:** MKT-79, MKT-80, MKT-81 · **Rota:** `POST /professional-portal/bookings/{bookingId}/prescriptions` (`notes?`, `medications` 1–10).
- **Fluxo:** numa marcação `COMPLETED` de vídeo com `canPrescribe=true`, o profissional preenche medicamentos (texto livre, dosagem, frequência, duração, observações) → **Emitir**. Numa transação, sob bloqueio da marcação: flag ligada → profissional `APPROVED` → marcação do profissional, `COMPLETED`, `VIDEO`, categoria `HEALTH`, ≤ 7 dias após `completedAt` e sem receita → a porta `PrescriptionIssuer` cria no membro a `Prescription` (`issuedBy=PROFESSIONAL`, `issuedOn` = hoje em Luanda, `doctorName` = nome público, `bookingId`) e os planos de toma → auditoria `PRESCRIPTION_ISSUED_BY_PROFESSIONAL` → alerta `BOOKING_UPDATED` à família.
- **Alternativos:** flag desligada ⇒ `404 NOT_FOUND`; `WELLNESS` ⇒ `FORBIDDEN`; não `COMPLETED`, método diferente de `VIDEO` ou fora dos 7 dias ⇒ `INVALID_STATE_TRANSITION`; já existe receita ⇒ `CONFLICT`; não `APPROVED` ⇒ `PROFESSIONAL_LOCKED`; corpo inválido ⇒ `VALIDATION_ERROR`; 20/dia ⇒ `RATE_LIMITED`; marcação de outro profissional ou inexistente ⇒ `404` idêntico.
- **Pós-condição:** a receita pertence ao registo do membro; o profissional **não** ganha acesso ao resto do registo.

### UC-MKT-60 Ver a receita emitida (profissional)
- **Ator:** profissional (todos os estados de validação, só leitura) · **FR:** MKT-45 · **BR:** MKT-79, MKT-81 · **Rota:** `GET /professional-portal/bookings/{bookingId}/prescription`.
- **Fluxo:** devolve o que o profissional escreveu (medicamentos, dosagem, frequência, duração, observações) e `issuedOn`; é a única forma de reler a receita (inclui recuperar de uma resposta perdida).
- **Alternativos:** flag desligada, sem receita ou receita apagada pela família ⇒ `404`; marcação alheia ⇒ `404` idêntico.
- **Pós-condição:** nada gravado; leitura não auditada (o conteúdo é do próprio autor).

### UC-MKT-61 Receber a receita digital (família)
- **Ator:** `SELF`/`TUTOR_OF`/`DEPENDENT_SELF` (como qualquer receita) · **FR:** MKT-45 · **BR:** MKT-81 · **Rotas existentes:** `GET …/prescriptions*`, `GET …/bookings/{bookingId}` (`prescriptionId?`).
- **Fluxo:** a família recebe o alerta genérico «Tem uma atualização numa marcação.», abre a marcação, vê «Receita disponível» e a receita em **Receitas** do membro, com a origem «emitida por profissional», e os planos de toma gerados (M2); gere-a como qualquer receita (OP-127).
- **Alternativos:** `OTHER` só com `SharingGrant` de `MEDICATION` (regras existentes).
- **Pós-condição:** apagar a receita, o membro ou a marcação segue BR-RX-06 e BR-MKT-81.

### UC-MKT-62 Ligar a receita digital (gate de lançamento)
- **Ator:** operação (proprietário/devops) · **BR:** MKT-79.
- **Fluxo:** só depois do parecer jurídico favorável e da ratificação de OP-125/OP-126 se define `DIGITAL_PRESCRIPTION_ENABLED=true` no ambiente e se reinicia a API; até lá, `canPrescribe=false` e as rotas respondem `404`.
- **Alternativos:** esquecer-se de desligar após reverter ⇒ não há (a flag é lida no arranque; desligar exige reiniciar).
- **Pós-condição:** nenhuma outra funcionalidade muda com a flag; receitas já emitidas mantêm-se.

## Efeitos noutros fluxos
- **MK2 (chat):** o aviso do chat passa a remeter para a partilha com prazo quando a UI de partilha existir (BR-MKT-75; texto em OP-85/OP-128, constante da UI); a conversa **não** é ligada às partilhas.
- **MK3 (marcações):** `FamilyBooking` ganha `prescriptionId?` e `ProfessionalBooking` ganha `canPrescribe`/`prescriptionId?` (aditivos); cancelar a marcação torna as suas partilhas **inabertas** (`SHARE_NOT_AVAILABLE`, BR-MKT-70 (4)) sem alterar a linha.
- **`access`:** ação `SHARE_WITH_PROFESSIONALS` (só `SELF`/`TUTOR_OF`; sem `SharingGrant`).
- **`prescriptions`:** `issuedBy=PROFESSIONAL`, `issuedByProfessionalId`, `bookingId`; BR-RX-07 emendada (BR-MKT-81).
- **`lifecycle`:** fonte opcional `recordShares` na exportação; apagamentos por cascata.
