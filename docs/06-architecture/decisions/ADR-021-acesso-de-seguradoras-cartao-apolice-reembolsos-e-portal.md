# ADR-021 — Acesso de seguradoras: cartão de apólice, pedidos de reembolso e portal da seguradora (`InsuranceAccount`)

**Estado:** Aceite — decisão **do proprietário** (2026-10-16, change control), aprovada explicitamente ("sim")
a uma proposta detalhada em conversa. Mirror de ADR-020 (D17/D18) para um segundo ator parceiro.

## Contexto

O proprietário pediu acesso de **seguradoras de saúde** à plataforma: (1) um cartão da apólice no app do
titular, independente de a seguradora ser parceira; (2) um pedido de reembolso, só quando a seguradora é
parceira, que referencia documentos já carregados (faturas/recibos); (3) um painel próprio para a
seguradora parceira rever e decidir esses pedidos. É o mesmo tipo de necessidade que originou o portal da
clínica (D17/D18, ADR-020): um **segundo ator**, externo à família, que precisa de ver uma fração mínima e
bem delimitada de informação, sem ser `User` nem ter acesso a dados de saúde.

## Decisão

| Tema | Escolha |
|---|---|
| Cartão da apólice | Nova entidade `InsurancePolicy` — nome da seguradora (texto livre, **não** exige que seja parceira), número de apólice, nome do titular/membro, validade, foto do cartão. Pertence a um `FamilyMember`, como qualquer dado de saúde (ADR-005). Reaproveita o módulo `documents` para a foto do cartão (um `Document` cujo `resourceType` passa a incluir `INSURANCE_POLICY` — **sem** upload novo, ver pendência de `schema.md`/`entities.md` abaixo). |
| Partilha do cartão | **Sem categoria de partilha nova** em `SharingGrant`. Só `SELF` (adulto) ou `TUTOR_OF` (pelo dependente) criam/editam/veem — a mesma relação de `authorization.md` §3, mas **sem** acesso de `OTHER` nesta versão (não há `SharingGrant` desta categoria). Se o proprietário pedir partilha com outro membro da família no futuro, é uma categoria C7 nova por change control; não se antecipa aqui. |
| Pedido de reembolso | Nova entidade `ReimbursementClaim` (só existe se `InsurancePolicy` referenciar uma seguradora **parceira**, i.e. com `InsurerAccount` ativo): `policyId`, valor, estado `SUBMITTED → APPROVED\|REJECTED → PAID` (ver `state-machines.md`). Criado/submetido por `SELF`/`TUTOR_OF`, como o cartão. |
| Documentos do pedido | **Sem entidade de anexo nova.** Uma tabela de associação simples `reimbursement_claim_documents (claim_id, document_id)` liga o pedido a `Document`s que o titular **já tem** carregados (faturas/recibos, qualquer `resourceType`). A seguradora só vê, de cada pedido, os documentos que estão nessa lista — nunca o resto do perfil de saúde do membro. É **opt-in por documento**, não acesso permanente à apólice ou ao histórico: cada pedido é um conjunto fechado e explícito, decidido pelo titular no momento de submeter. |
| Segundo ator | `InsurerAccount` (a seguradora parceira: nome, NIF, `status` ACTIVE\|SUSPENDED) — criada só por Platform Admin, mirror exato de `Clinic`(PARTNER). `InsuranceAccount` (conta de acesso ao painel): `insurerId`, `role` `INSURANCE_ADMIN`\|`INSURANCE_AGENT`, `status`, **sem FK** para `users`/`family_members` — mirror exato de `ClinicAccount` (ADR-020). |
| Hierarquia de contas | Igual a BR-CLN-05: o Platform Admin cria **só** a conta `INSURANCE_ADMIN` raiz de cada seguradora parceira (e pode repô-la). A própria conta `INSURANCE_ADMIN` cria/lista/remove as contas `INSURANCE_AGENT` da sua seguradora (self-service); o Platform Admin não gere agentes individualmente. |
| Transporte do ator do portal | **Terceiro `ActorInfo`** (depois do de `User` e do de `ClinicAccount`), com o seu próprio tipo e `AsyncLocalStorage`: `InsuranceActorInfo { insuranceAccountId, insurerId, role, sessionId }`, exposto por `getInsuranceActor()`/`runWithInsuranceActor()`. Nunca reutiliza os contextos de User ou de clínica (mesmo critério do ADR-020). |
| Fronteira de rotas | Prefixo **`/insurance-portal/*`** (`auth`, `agents`, `claims`). Sessões próprias `insurance_sessions` (refresh rotativo), tabela própria, independente de `sessions`/`clinic_sessions`. JWT com claims distintas (`insuranceAccountId`, `insurerId`, `role`), nunca aceites fora de `/insurance-portal/*` e vice-versa. |
| Autorização do portal | **Fora de `AccessPolicy`** (módulo `access`), tal como o portal da clínica — `AccessPolicy.can()` continua a decidir **só** sobre o ator de User/família. Algoritmo próprio, mirror exato de `authorization.md` §6: conta ativa → `insurerId` do caminho coincide com o do recurso → decidir por papel (matriz §6.2, troca `CLINIC_ADMIN/CLINIC_MANAGER` por `INSURANCE_ADMIN/INSURANCE_AGENT`, mesmas permissões operacionais para ambos) → auditar com `actor_type` próprio (`INSURANCE_ACCOUNT`, nunca `USER`/`SYSTEM`/`PLATFORM_ADMIN`/`CLINIC_ACCOUNT`). |
| Âmbito funcional do portal (MVP desta funcionalidade) | Listar `ReimbursementClaim`s da própria seguradora, abrir um pedido, ver os documentos anexados (só os da lista do pedido), aprovar/rejeitar com motivo obrigatório. **Sem** marcar `PAID` pelo portal nesta versão (fica como ação do titular/tutor ao confirmar o pagamento — ver `state-machines.md`; revisitar por change control se o proprietário quiser que a seguradora marque `PAID`). |
| Fora do MVP (explícito) | Sem pré-autorização, sem verificação automática do número de apólice junto da seguradora, sem consulta de cobertura separada. A seguradora valida o pedido ao revê-lo — mesmo princípio de BR-CLN-03/06 (o Clinic Manager confirma sem API externa). Sem partilha do cartão com `OTHER`. Sem anexo clínico direto da seguradora ao perfil de saúde: o `ReimbursementClaim` e os seus documentos são a **única** superfície que a seguradora vê; nunca condições, alergias, medicação, consultas ou exames do membro. |
| Módulo | Novo `insurance` (titular: `InsurancePolicy`, `ReimbursementClaim`) e `insurance-portal` (ou secção própria dentro de `insurance`, decisão de implementação tal como ADR-020 deixou para `clinics`/`clinic-portal`). Dependências a declarar em `modules.md` §3 quando a implementação arrancar: `insurance` depende de `access`, `documents`, `audit`; `insurance-portal` não importa `auth`/`access`/`families` (só lê `insurance` pela sua `index.ts`), mesmo critério do ADR-020 para `clinic-portal`. |

### Porquê um segundo ator em vez de estender `AccessPolicy`

`AccessPolicy` decide sobre o ator de User/família: papel + relação (`SELF`/`TUTOR_OF`/`OTHER`) + partilha
por categoria. Uma seguradora não é um `FamilyMember`, não tem relação de tutela nem pertence a nenhuma
família — forçá-la a passar por `AccessPolicy` exigiria uma relação fictícia (`OTHER` com uma `SharingGrant`
"automática" por `ReimbursementClaim`) que misturaria dois modelos de autorização diferentes e abriria uma
exceção em todas as outras verificações (`§2.3` "o actor tem de ter `FamilyMember` com conta ligada").
ADR-020 já resolveu exatamente este problema para a clínica: um ator externo ganha o seu próprio contexto,
as suas próprias rotas e a sua própria verificação, isolado por construção (nenhuma fuga cruzada possível
porque as árvores de rotas são disjuntas). Reaproveitar essa solução em vez de inventar uma nova reduz a
superfície de risco e mantém `AccessPolicy` com uma única responsabilidade.

### Porquê opt-in por documento em vez de acesso permanente à apólice

Dar à seguradora acesso contínuo ao `InsurancePolicy` (ou pior, ao perfil de saúde) violaria a minimização
de dados do mesmo princípio usado para a clínica (BR-CLN-03): a seguradora só precisa de ver o que está
em discussão num pedido concreto, no momento em que o titular decide submetê-lo. Uma tabela de associação
simples `claim↔document`, escolhida pelo titular a cada submissão, torna esse limite explícito nos dados
(não depende de filtrar em tempo de leitura) e é auditável por pedido. Evita também criar uma entidade de
"anexo" nova quando `Document` já cobre o caso (reutilização, `conventions.md` §2).

### Porquê sem anexo clínico direto nesta versão

Ligar o pedido de reembolso a condições, receitas ou histórico de consultas resolveria um problema que o
proprietário não pediu (verificação clínica da seguradora) e duplicaria a superfície de dados de saúde
exposta a um terceiro — o oposto do que ADR-020 estabeleceu para a clínica (mínimo necessário). Falta de
pré-autorização e de verificação automática da apólice são aceites como no MVP do portal da clínica: a
seguradora decide ao rever o pedido, sem integração externa.

## Consequências

- Isolamento total entre os três mundos (User/família, `ClinicAccount`, `InsuranceAccount`): uma fuga ou
  bug num não expõe sessões/tokens dos outros.
- Platform Admin gere só: ver/suspender `InsurerAccount` e criar/repor a conta `INSURANCE_ADMIN` raiz —
  nunca lista/edita `INSURANCE_AGENT` individualmente (self-service, mirror de BR-CLN-05).
- **Já preenchido por esta revisão** (mesmo critério de D18 fechar as pendências de D17): `02-users/actors.md`,
  `02-users/roles.md`, `08-security/authorization.md` (nova secção §8, mirror de §6), `04-domain/entities.md`,
  `04-domain/relationships.md`, `04-domain/state-machines.md`, `01-requirements/business-rules.md` (`BR-INS-*`),
  `05-api/openapi.yaml` + `endpoints.md` (endpoints do titular e do portal, schemas, `actorType`/roles),
  `07-database/schema.md` (`insurer_accounts`, `insurance_accounts`, `insurance_sessions`, `insurance_policies`,
  `reimbursement_claims`, `reimbursement_claim_documents`, `documents.resource_type = INSURANCE_POLICY`,
  `actor_type = INSURANCE_ACCOUNT`), `11-implementation/plan.md` (novo milestone).
- **Pendências explícitas que ficam para quando a implementação arrancar** (mesmo critério do ADR-020, que
  também deixou `clinic-portal` fora de `modules.md` até ser implementado):
  - `06-architecture/modules.md` §3: linhas `insurance`/`insurance-portal` e as suas dependências.
  - `08-security/audit.md` §3: catálogo de ações do portal da seguradora (`INSURANCE_LOGIN`, `CLAIM_SUBMIT`,
    `CLAIM_DECIDE`, etc.) — nota: o catálogo **nunca chegou a listar** as ações do portal da clínica (D17/D18)
    também; pendência pré-existente, não fechada por esta revisão, assinalada aqui para o dono do módulo.
  - Detalhe fino de tarefas do milestone (ver `plan.md`), a decidir no arranque.
