# ADR-030 — Rede de prestadores: catálogo único verificado, Convenção seguradora↔prestador e prestador sem seguradora

> **Nota (pivô 2026-11-16, ADR-037):** ADR-029/030/031 e o âmbito de seguradoras (ADR-021/025, marco B) ficam **adiados**; ver ADR-037.

**Estado:** **Proposto — aguarda aprovação do proprietário** (change control **D26**, proposto em 2026-11-14). Adenda a ADR-020/ADR-025/ADR-026; **proporia emendas** a `BR-SEG-22` e ao desenho de `insurer_providers` (ver Consequências) — **só se aprovado**. Funde a decisão "prestador sem seguradora" (originalmente item d) por serem a mesma entidade. Não substitui nenhum ADR.

> **Estado (atualizado 2026-11-14, fonte: ordem do proprietário): ACEITE COM ÂMBITO DE CONSTRUÇÃO LIMITADO.** O proprietário ordenou "pode avançar para construção" (marco B, `11-implementation/marco-b-construcao.md`). A aceitação cobre **só** o que a construção das fatias 0–6 do marco B exige; tudo o que está listado como pendente neste ADR e em `marco-b-construcao.md` §1 **continua Proposto/não aceite** e aplica-se o **default conservador** aí documentado. Onde o texto abaixo diz "Proposto", lê-se "aceite dentro deste âmbito".
> Âmbito aceite: Convenção mínima necessária à autorização e prestador sem seguradora (todo o ato tem `Process`). **Não aceite:** endpoint público da rede (`/public/providers`, C6), emendas a BR-SEG-22 e a `insurer_providers` (C5).

## Contexto
Hoje existem `clinics` (portal da clínica, ADR-020) e `insurer_providers` (ADR-025: por seguradora, com `name`, `tax_id`, `type` CLINIC/HOSPITAL/LABORATORY/PHARMACY e `clinic_id` opcional) — a **mesma entidade real pode existir várias vezes**, uma por seguradora. A UI pública (`apps/web/src/services/partners.service.ts`) já assume `GET /public/partners` que **não está no contrato** (`openapi.yaml`/`endpoints.md`). O proprietário quer uma rede única e verificada, e que o prestador possa usar o Vita sem seguradora.

## Decisão (proposta)
1. **Prestador** (clínica, laboratório, imagem, farmácia) é uma entidade que **existe uma só vez** num **catálogo único**, **verificado pelo backoffice** (`PLATFORM_ADMIN`). Nunca duplicado por seguradora.
2. **Convenção** = ligação **seguradora ↔ prestador**: serviços cobertos, tabela de preços, regras de autorização, copagamento, estado, vigência. Substitui (conceptualmente) `insurer_providers` + `insurer_provider_services`/`units` de ADR-025; `serviceCode` continua da seguradora (BR-SEG-22). O prestador **vê as suas convenções** (aceitação/estado) e os preços **apenas das suas**; nunca as de outros prestadores.
3. **Visibilidade:**
   - **Família:** a rede **coberta** pelo seu plano, marcando **dentro/fora da rede**.
   - **Prestador:** o paciente que **marcou ou consentiu** + elegibilidade (sim/não, saldo, copagamento); **nunca** a apólice completa nem histórico fora do consentimento (BR-SEG-18, BR-CLN-03/ADR-026).
   - **Seguradora:** vê a **sua** rede/convenções e o catálogo verificado para as propor; não vê as convenções de outras seguradoras.
4. **Página pública:** mostra só **dados institucionais** do prestador (nome, tipo, localização, contactos, serviços gerais). **Nunca** as seguradoras com que cada prestador tem convenção, **nem preços**.
5. **Consentimento de publicação:** o prestador **opta por ser listado** (flag `publicListing`, revogável, por defeito não listado; só `VERIFIED`+`ACTIVE`). Auditado.
6. **Endpoint público:** **proposta A (recomendada): `GET /public/providers`** — nome coerente com o catálogo ("prestadores"), `PublicProvider` = `{id, name, type, city?, province?, phone?, website?}`; **sem** lista de seguradoras por prestador. Alternativa B: manter `/public/partners` (nome do UI atual) e mudar a semântica. Recomenda-se A porque "partners" mistura prestadores e seguradoras; **a listagem pública de seguradoras (se existir) seria endpoint à parte e opt-in** (decisão pendente). Sem autenticação, cache curto, rate limit por IP, resposta mínima, sem ids internos reutilizáveis noutras rotas (a decidir). Contrato **não** alterado por este ADR.
7. **Prestador sem seguradora (porta de entrada):** um prestador pode usar o Vita **sem qualquer convenção** (clínica privada: agenda, pacientes, recibos, relatórios/laudos — já cobertos por ADR-026/027/028). Convenções são **opcionais** e acrescentam elegibilidade/autorização/despesas. **Nível pago opcional** (agenda avançada, visibilidade, relatórios) é hipótese comercial (ADR-029), sem implementação.

## Consequências
- **Migração de dados futura**: unificar `clinics` + `insurer_providers` num `providers` (verificação, `publicListing`) e `provider_agreements`/convenções. **Não** especificada aqui; exige contrato, `schema.md`, `modules.md` §3 e `authorization.md` novos, e plano de migração sem perder `BR-SEG-14` (isolamento por `insurer_id`).
- **Backoffice**: nova ação "verificar prestador" e fila de verificação (PLATFORM_ADMIN **sem** dados de saúde, mantém `authorization.md` §7).
- **Tipos**: acrescentar `IMAGING` (imagem) a `provider_type` (hoje CLINIC/HOSPITAL/LABORATORY/PHARMACY).
- **Anti-enumeração**: o catálogo é público (institucional) mas a elegibilidade continua a depender do cartão (BR-SEG-18).
- **Conflitos**: `BR-SEG-22`/ADR-025 ("sem catálogo comum") aplica-se aos **serviços**, não aos prestadores — compatível, mas `insurer_providers` com `name/tax_id` próprios entra em conflito com "uma só vez" (C5 em `business-model.md`). `TC-SEG-11` (partner-clinics) a rever.

## Alternativas consideradas
| Alternativa | Porque não (proposta) |
|---|---|
| Manter `insurer_providers` por seguradora | Duplica prestadores, impede verificação única e página pública coerente. |
| Mostrar seguradoras por prestador na página pública | Decisão do proprietário: nunca (risco comercial/regulatório). |
| `/public/partners` | Mistura tipos de parte; ver proposta A. |

## Decisões do proprietário de 2026-11-14 com impacto neste ADR
- **Q-U1 (urgência):** atende-se primeiro; aviso à seguradora em 48 h; falha ⇒ revisão manual, não recusa automática. A **convenção** não precisa de fixar o prazo (é 48 h); pode apenas definir a revisão manual.
- **Q-S1 (análise):** 48 h; depois escala para o gestor e avisa o prestador (a convenção pode referir este compromisso); nunca aprova por silêncio.
- **Q-P1 (processo):** entidade `Process` liga marcação/autorização/atendimento/despesa; o prestador sem seguradora **tem `Process`** (DECIDIDO 2026-11-14, Q-P3: todo o ato tem `Process`, com ou sem seguradora; histórico único para a família), módulo dono `processes` (Q-P2). Modelo Proposto em `00-product/process-flows.md` §13.
- **Q-S1b:** prazo de decisão 48 h por omissão, configurável por seguradora/serviço (mínimo e máximo do Vita), que a convenção pode referir; «gestor» = novo papel `SUPERVISOR` (proposta em `authorization.md` §8.2c); `falta informação` caduca em 7 dias.
- **Q-S2 / Q-S3 / Q-A1 / Q-T1 / Q-F1:** vários recursos sem limite fixo (salvaguardas propostas); falta não cancela a autorização; auto-aprovação só por regras simples do plano; prestador vê só sim/não e copagamento; seguradora regista pagamento e prestador confirma receção. Ver `00-product/process-flows.md` §10.1 e §11a. Nenhuma alteração a contratos.
Este ADR continua **Proposto**. **ADR-032** «Entidade Process e Despesa unificada» redigido (Proposto, D28). Prazos decididos (Q-V1): decisão de autorização 24–120 h (48 h por omissão); recurso até 15 dias após a recusa, respondido em 72 h.

## Pendências para o proprietário
Aprovar; escolher `/public/providers` (A) ou `/public/partners` (B); decidir se seguradoras têm listagem pública própria; definir os critérios de verificação (documentos, licença sanitária) e os campos institucionais publicáveis.
