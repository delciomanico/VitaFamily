# Vita Family — Mercado de profissionais de saúde e bem-estar (Angola)

> Estado: **v0.2 DECISÕES RATIFICADAS (2026-11-16)** — direção e decisões do §11 ratificadas pelo proprietário e registadas em **ADR-037 (aceite)**; o modelo e as regras BR-MKT continuam **candidatos** até ao contrato de cada marco. Sem contrato, schema nem código. **Não é parecer jurídico.** Princípios mantidos: família nunca vê vocabulário técnico; famílias gratuitas; admin da plataforma sem acesso a dados de saúde.

## 1. Em duas frases
O Vita guarda a saúde da família **e** deixa-a encontrar profissionais de saúde e bem-estar: ver preços, comparar, conversar, marcar, atender (presencial, vídeo, chat…), pagar **fora da app** com comprovativo controlado, avaliar e, se quiser, partilhar registos com prazo. Só Angola; preços em Kz.

## 2. Papéis
| Papel | Quem | Pode | Não pode |
|---|---|---|---|
| **Profissional** (`ProfessionalAccount`, ator próprio, `/professional-portal/*`) | Médico, nutricionista, personal trainer, outras especialidades | Cadastrar-se; submeter credenciais; publicar serviços (método, duração, preço Kz) e horários; conversar; confirmar/concluir marcações; confirmar pagamento; ver **só** o que a família partilhou, pelo prazo | Ver registos sem partilha; alterar avaliações; pagar por posição no ranking |
| **Família** (`User`, titular/tutor) | Adulto ou tutor | Pesquisar, comparar, conversar, marcar, enviar comprovativo, avaliar (só após consulta), partilhar registos com prazo e revogar | Ver credenciais internas; avaliar sem consulta |
| **Admin da plataforma** | Staff Vita | Validar conta e profissão (aprovar/rejeitar/suspender), gerir catálogo de especialidades e categorias, moderar denúncias (só o denunciado), resolver disputas de comprovativo | Ler registos de saúde ou chats não denunciados; mexer no ranking à mão |

## 3. Categorias e avisos
| | `HEALTH` (saúde: medicina, enfermagem, psicologia, fisioterapia, nutrição clínica…) | `WELLNESS` (bem-estar: personal trainer, coaching, nutrição desportiva…) |
|---|---|---|
| Validação (admin) | Identidade + comprovativo de inscrição/cédula profissional na entidade competente (**a confirmar no parecer**); **nutrição = HEALTH: cédula/ordem validada pelo admin** | Identidade + certificação (validação mais leve; personal trainers e afins) |
| Selo no perfil | «Profissional de saúde validado» | «Profissional de bem-estar validado» |
| Aviso à família | «Não substitui atendimento de urgência.» | «Serviço de bem-estar; não é um ato de saúde nem substitui o seu médico.» |
| Partilha de registos | Permitida (categorias escolhidas) | Só medidas simples (peso, altura, medicação ativa a pedido) |
| Receita digital | Só em vídeo/consulta concluída, **ativada no lançamento após parecer jurídico** (ADR-037 §9) | Nunca |

A categoria de cada especialidade é **dado do catálogo** (admin), nunca `if` no código. **Decidido:** nutrição = `HEALTH`; personal trainers e afins = `WELLNESS` (nutrição desportiva sem ato clínico pode ser entrada `WELLNESS` do catálogo, se o parecer o aceitar).

## 4. Jornadas
1. **Cadastro e validação:** profissional regista-se → verifica e-mail → escolhe especialidade(s) → carrega credenciais (antivírus, como os anexos existentes) → estado `PENDING_REVIEW` → admin aprova/rejeita com motivo (ou pede mais documentos) → `APPROVED` publica o perfil; `SUSPENDED` retira-o da pesquisa sem apagar histórico. Credencial caducada → nova validação.
2. **Descoberta e comparação:** família pesquisa (**só com login**) por especialidade, cidade, método e preço; vê perfil (selo, aviso, métodos, preços, avaliações verificadas, nº de consultas); seleciona 2–3 e **compara preços lado a lado**; ordena por «Melhor avaliados» (ranking §6), preço ou disponibilidade.
3. **Chat:** a família pode escrever **antes** de marcar (dúvidas, preço, método); depois da marcação o chat continua ligado à marcação. Aviso fixo: «Não envie dados de saúde sensíveis por aqui; use a partilha com prazo.» Sem anexos no MVP; denunciar mensagem.
4. **Marcação:** escolhe serviço (método+preço) e horário livre → `REQUESTED` → profissional confirma (`CONFIRMED`) ou recusa; cancelamento com antecedência mostrada; lembretes pelos `alerts` existentes; cria um `Process` (episódio de cuidado) e, ao confirmar, uma `Appointment` no registo da família (privada ao membro).
5. **Consulta:** pelo método marcado (presencial, vídeo/chamada por ligação externa — sem vídeo embebido —, chat). Profissional marca `COMPLETED` ou `NO_SHOW`. **Receita digital (ADR-037 §9):** depois de `COMPLETED`, um profissional `HEALTH` pode emitir uma receita (reaproveita `prescriptions`: medicamentos em texto livre, dosagem, frequência, duração); a família recebe-a como receita no membro da marcação, com plano de toma; só ativa no lançamento depois do parecer jurídico.
6. **Comprovativo de pagamento (fora da app):** o profissional mostra os dados de pagamento do perfil; a família paga fora e **carrega o comprovativo** (PDF/imagem, antivírus) → `PROOF_SUBMITTED` → profissional **confirma** (`CONFIRMED`) ou rejeita com motivo; disputa → admin vê **só o comprovativo e a marcação**. O app regista estado, quem e quando; **não valida o dinheiro**.
7. **Avaliação:** só depois de `COMPLETED` **e** pagamento `CONFIRMED` (por defeito); 1–5 + comentário curto; uma por marcação; o profissional pode responder uma vez; denúncia → admin.
8. **Partilha com prazo:** na marcação (ou depois), a família escolhe **categorias** (alergias/tipo sanguíneo, medicação, exames, consultas…), **prazo** (24 h · 7 dias · 30 dias · até ao fim da consulta + 24 h) ou **visualização única** (máx. 30 dias, com marca de água); o profissional vê só isso; a família vê «quem viu o quê e quando» e pode **revogar**. Texto honesto: «Não conseguimos impedir capturas de ecrã. Partilhe só o que quer que o profissional veja. Todos os acessos ficam registados.»

## 5. Modelo de dados proposto (nomes provisórios; contrato e migração por marco)
| Tabela | Conteúdo essencial |
|---|---|
| `professional_accounts`, `professional_sessions` | Conta e sessões **separadas de `users`** (padrão ADR-020); e-mail, estado, `locked/suspended` |
| `professionals` | Perfil público: nome, bio, cidade, `validation_status` (`PENDING_REVIEW/NEEDS_INFO/APPROVED/REJECTED/SUSPENDED`), `category`, dados de pagamento externo (texto), `created_at` |
| `specialties` | Catálogo: nome, `category` (`HEALTH/WELLNESS`), ativo (admin) |
| `professional_specialties`, `professional_credentials` | Ligação; ficheiros de credenciais (storage+antivírus), tipo, nº, entidade, validade |
| `validation_cases` | Histórico de decisões do admin (estado, motivo, quem, quando) — imutável |
| `professional_offers` | Serviço: `specialty_id`, `method` (`IN_PERSON/VIDEO/CHAT/PHONE`), duração, `price_kz` (inteiro, Kz), ativo |
| `professional_availability` / `professional_slots` | Regras semanais e horários gerados (reaproveita o motor de regras/geração de `clinics`) |
| `bookings` | `family_id`, `member_id`, `professional_id`, `offer_id`, `slot_id`, `status` (`REQUESTED/CONFIRMED/COMPLETED/NO_SHOW/CANCELLED/REJECTED`), `payment_status` (`AWAITING_PROOF/PROOF_SUBMITTED/CONFIRMED/REJECTED`), `price_kz` copiado, `process_id` |
| `payment_proofs` | `booking_id`, ficheiro, quem enviou, estado, quem decidiu, motivo |
| `threads`, `messages` | Conversa família↔profissional (opcionalmente `booking_id`); texto; `reported_at` |
| `reviews`, `review_replies` | `booking_id` único, nota, texto, resposta, estado (`VISIBLE/REPORTED/HIDDEN`) |
| `record_shares`, `record_share_views` | Concessão (membro, profissional, categorias, `expires_at`, `view_once`, `revoked_at`) e **registo de cada acesso** (quando, o quê) |
| `professional_audit` / `audit` | Ações sensíveis (validação, comprovativo, partilha, acessos) sem dados de saúde |

Preços em Kz inteiros (sem centavos); fuso por omissão `Africa/Luanda`; texto pt-PT (§11).

## 6. Regras de negócio candidatas (BR-MKT-xx, ainda não em `business-rules.md`)
- **01** Só `APPROVED` aparece na pesquisa e pode receber marcações; `SUSPENDED` cancela marcações futuras com aviso.
- **02** A categoria vem do catálogo; os avisos de §3 são sempre mostrados no perfil e na marcação.
- **03** Preço visível antes de marcar; o preço da marcação é copiado e não muda depois.
- **04** O ranking de uma especialidade usa **só** avaliações verificadas (marcação `COMPLETED` + pagamento `CONFIRMED`), média **suavizada** (bayesiana) com mínimo de N avaliações para entrar no ranking (por defeito N=3; abaixo disso, «Novo»). **Nenhum** campo de pagamento, destaque ou ordem manual entra no cálculo; o cálculo é função pura testada.
- **05** Uma avaliação por marcação; não editável após 7 dias; denúncias só escondem após decisão do admin; o profissional não apaga avaliações.
- **06** O Vita não recebe nem custodia dinheiro; o estado do pagamento é declarativo (comprovativo + confirmação do profissional); sem `PAID` por silêncio.
- **07** Chat: rate limit, tamanho máximo, sem anexos no MVP; só os dois participantes leem; admin lê **só** mensagens denunciadas; retenção a decidir (por defeito 24 meses após a última mensagem).
- **08** Partilha: por categoria **e** prazo, avaliada a **cada leitura** (como `ClinicConsent`); a concessão é do titular/tutor (`SELF`/`TUTOR_OF`); prazo máximo 30 dias; revogável a qualquer momento; cada acesso gravado e visível à família.
- **09** Visualização única: o servidor entrega o conteúdo **uma vez** (token consumido na primeira leitura bem-sucedida; releitura → «já foi visto»); marca de água com nome do profissional e data (candidato); sem garantia contra capturas e é dito à família.
- **10** O profissional nunca recebe ids de família/membro além do que a partilha mostra; o admin nunca recebe registos de saúde.
- **11** Quando o membro é eliminado ou sai, as partilhas e conversas do membro são removidas/anonimizadas (ciclo de vida); avaliações ficam anónimas.
- **12** Profissional não pode ser avaliador nem marcar consulta consigo próprio (mesma pessoa/e-mail).

## 7. Estados (resumo)
`Profissional`: PENDING_REVIEW → (NEEDS_INFO ↔) → APPROVED | REJECTED; APPROVED ↔ SUSPENDED. `Marcação`: REQUESTED → CONFIRMED → COMPLETED | NO_SHOW; REQUESTED/CONFIRMED → CANCELLED; REQUESTED → REJECTED. `Pagamento`: AWAITING_PROOF → PROOF_SUBMITTED → CONFIRMED | REJECTED (→ AWAITING_PROOF). `Partilha`: ACTIVE → EXPIRED | REVOKED | CONSUMED (visualização única). Máquinas formais em `state-machines.md` no contrato de cada marco.

## 8. Riscos
| Risco | Mitigação / decisão |
|---|---|
| **Regulação saúde vs. bem-estar** (quem pode anunciar o quê, publicidade em saúde, nutrição) | Categorias com validação e avisos distintos; **parecer jurídico** antes do lançamento; catálogo gerido pelo admin |
| **Ranking** (viés, avaliações falsas, queixas de profissionais) | Só avaliações verificadas; suavização; mínimo de N; denúncia; função pura e pública na descrição («como ordenamos»); nunca por pagamento |
| **Chat com dados de saúde** | Aviso, sem anexos, rate limit, retenção curta, admin só lê o denunciado; AIPD cobre o chat |
| **Visualização única** | Impossível impedir capturas; texto honesto; registo e marca de água; **não** vender como proteção forte |
| **Parecer jurídico** (Lei 22/11 e autoridade de proteção de dados, RGPD como referência, telemedicina, **receita digital**, publicidade em saúde, consentimento do tutor) | **Gate de lançamento, a contratar pelo proprietário.** **Receita digital decidida pelo proprietário (difere da recomendação anterior, que era sem prescrição digital): risco regulatório alto e não verificado; só é ativada no lançamento, depois do parecer** (flag desligada até lá); consulta por vídeo = ferramenta externa |
| **Pagamentos** (comprovativos falsos, disputas; comissão/assinatura no futuro; fiscalidade) | O Vita não custodia; confirmação pelo profissional + disputa ao admin; comissão/assinatura só por ADR futuro com parecer fiscal |
| **Qualidade e fraude** (falso profissional) | Validação manual + credenciais com validade + suspensão rápida |
| **Menores** (tutela) | Marcação/partilha só por titular adulto ou tutor |
| **Dois mundos no mesmo produto** | Resolvido: marco B arquivado em ramo/tag e removido do `main` (`11-implementation/arquivo-marco-b.md`); módulos novos isolados por portas |

## 9. O que cada módulo existente reaproveita
| Existente | Papel no mercado |
|---|---|
| `processes` | Episódio de cuidado (`originType=BOOKING`, porta `ProcessFacts` implementada por `consultations`); a família vê 4 estados + «o que falta» |
| `clinics` / portal da clínica (ADR-020/026) | Padrão de ator separado, catálogo de profissionais/serviços, regras de horário e geração; **portal do profissional** parte daqui; o portal da clínica fica ativo e congelado |
| `clinic-patients` (consentimento por categoria/prazo, `SharedHistoryReader`) | Modelo e portas da partilha com prazo (`record-sharing`) |
| `clinic-reports`/`recommendations` | Relatório da consulta e pedido de exame do profissional (fase posterior; não no MVP do mercado) |
| `appointments` | A marcação confirmada gera a consulta no registo da família |
| `documents` + antivírus | Credenciais e comprovativos (via porta, como anexos da seguradora) |
| `alerts`/`notifications` | Lembretes, nova mensagem, estado do comprovativo (`raise*Event`) |
| `access` | `AccessPolicy` para o lado família (nova ação de partilha, só `SELF`/`TUTOR_OF`) |
| `lifecycle`/`audit`/`admin` | Exportação/apagamento (partilhas, conversas), auditoria, fila de validação (admin sem dados de saúde) |
| `prescriptions` | Receita digital emitida pelo profissional (padrão `issue-for-clinic`), só após parecer jurídico |
| `insurance*`/`insurer-ops` (marco B) | **Removidos do `main`** (arquivo `archive-marco-b-2026-11-16`), não reaproveitados |

## 10. Plano de marcos novos (prefixo **MK** para não colidir com M0–M15)
Ordem: **MK0 → MK1 → MK2 → MK3 → MK4**. Cada marco: contrato primeiro (`vita-architect`), gates `pnpm gen && lint && test && build`, isolamento e matriz de autorização, auditoria, revisão do proprietário. Sem datas (capacidade TBD).

| Marco | Conteúdo | Depende de | Donos (agentes) | Critério de aceitação resumido |
|---|---|---|---|---|
| **MK0 — Preparação** | **Remoção do marco B do `main`** (passos R1–R6 de `arquivo-marco-b.md`); agente `vita-marketplace`; parecer jurídico encomendado pelo proprietário; fuso/locale Angola; contratos de MK1 | ADR-037 (aceite) | `vita-platform`, `vita-architect`, `vita-devops`, `vita-marketplace` | `main` sem código/rotas/jobs/contrato de seguradora e suite verde; docs de MK1 fechados |
| **MK1 — Profissionais + validação** | `professionals`: conta/sessões próprias, perfil, especialidades/categorias, credenciais, fila e decisões do admin, ofertas e preços Kz, horários; portal do profissional (mínimo) | MK0 | `vita-identity` (conta/sessões), `vita-health` (perfil/ofertas/horários), `vita-documents` (credenciais), `vita-platform` (admin/fila) | Profissional regista-se, carrega credenciais, admin aprova/rejeita com motivo; só `APPROVED` é visível; admin não acede a nada de saúde; testes de isolamento e auditoria |
| **MK2 — Descoberta + chat** | Pesquisa/filtros por especialidade/cidade/método/preço, perfil público, comparação de preços, ranking (função pura, inicialmente sem avaliações → «Novo»), `messaging` (chat pré/pós marcação, denúncia), alertas de nova mensagem | MK1 | `vita-health` (descoberta), `vita-alerts` (notificações), `vita-qa-security` (chat/dados) | Família compara ≥2 profissionais por preço e conversa antes de marcar; só participantes leem; limites e avisos presentes; ranking não depende de pagamento (teste) |
| **MK3 — Marcação + comprovativo + avaliações** | `consultations`: marcação por horário/método, estados, `Process` de origem `BOOKING`, consulta no registo da família, comprovativo e confirmação, avaliações verificadas e ranking real, denúncias | MK2, `processes` | `vita-health`, `vita-documents` (comprovativos), `vita-alerts`, `vita-qa-security` | Fluxo ponta a ponta (marcar → atender → comprovativo confirmado → avaliar); só quem consultou avalia; ranking só com avaliações verificadas; disputa visível ao admin só com o comprovativo |
| **MK4 — Partilha com prazo e visualização única** (e receita digital, desligada até ao parecer) | `record-sharing`: concessão por categoria/prazo, leitura pelo profissional via portas, registo e vista de acessos para a família, revogação, visualização única, textos honestos; exportação/apagamento | MK3, `access`, módulos de saúde (portas) | `vita-family` (`access`/ações), `vita-health` (leitores), `vita-qa-security`, `vita-architect` | Profissional vê só categorias e prazo concedidos; expirado/revogado → 403; visualização única só abre uma vez; família vê cada acesso; sem capturas garantidas e dito |
| **Transversal (antes do lançamento)** | AIPD/DPA alargados (M10), parecer jurídico, textos legais, carga, backups, monitorização | MK1–MK4 | `vita-qa-security`, `vita-devops` | Gate de lançamento do ADR-037 cumprido |

## 11. Decisões (RATIFICADAS pelo proprietário em 2026-11-16; ADR-037)
1. **Conta do profissional separada de `User`** (`ProfessionalAccount`, padrão ADR-020). **Decidido.**
2. **Categorias:** nutrição = **`HEALTH`** (cédula/ordem validada pelo admin); personal trainers e afins = **`WELLNESS`** (validação mais leve e aviso próprio). **Decidido.**
3. **Pesquisa:** **só com login** no MVP. **Decidido.**
4. **Avaliação:** exige consulta `COMPLETED` **e** pagamento `CONFIRMED`. **Decidido.**
5. **Ranking:** média suavizada, N mínimo = 3, nenhum destaque pago (nunca), regra pública. **Aceite (default).**
6. **Chat:** sem anexos, retenção 24 meses, admin só lê o denunciado. **Decidido.**
7. **Partilha:** prazos 24 h / 7 d / 30 d / fim da consulta + 24 h; visualização única (máx. 30 dias); marca de água e texto honesto sobre capturas; WELLNESS só com medidas simples. **Decidido.**
8. **Vídeo:** ligação externa **com receita digital** (reaproveita `prescriptions`; o profissional `HEALTH` emite após consulta concluída, a família recebe-a no registo). **Difere da recomendação anterior**; risco regulatório documentado (§8); **ativada só no lançamento, depois do parecer jurídico.** **Decidido.**
9. **Marco B:** **arquivado** (ramo `archive/marco-b-seguradoras`, tag `archive-marco-b-2026-11-16`, commit `b6ff812`) e **removido do `main`; sem interruptor**; fatias 2b e 6 canceladas; portal da clínica mantido (sem as ligações de seguradora). Plano: `11-implementation/arquivo-marco-b.md`. **Decidido.**
10. **Angola:** fuso `Africa/Luanda`, Kz inteiro, pt-PT (a rever para vocabulário angolano); `scope.md` corrigido («Portugal» → Angola). **Aceite (default).**
11. **Agente novo** `vita-marketplace` (módulos `professionals`, `consultations`, `messaging`, `record-sharing`). **Aceite (default); a criar em `.claude/agents/` no MK0.**
12. **Parecer jurídico = gate de lançamento**, a contratar pelo proprietário (Lei 22/11, telemedicina, receita digital, publicidade em saúde). **Decidido.**

## 12. Lacunas
Sem pesquisa de mercado nem validação com utilizadores (D16); regulação angolana de telemedicina/publicidade em saúde não verificada (hipótese); modelo de comissão/assinatura não desenhado; moderação de conteúdo e SLA do admin por definir; cadastro de clínicas como organização no mercado fora do âmbito; carteira/pagamentos em Kz e fiscalidade por validar.
