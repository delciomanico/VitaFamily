# Vita Family — Modelo de negócio, partes e acessos

> **ARQUIVADO (pivô 2026-11-16, ADR-037; removido do `main`, sem interruptor):** o foco do produto passou para o registo de saúde da família + mercado de profissionais (`00-product/marketplace-profissionais.md`). Este documento **mantém-se, não foi apagado**; o que descreve está preservado no ramo `archive/marco-b-seguradoras` / tag `archive-marco-b-2026-11-16` (plano de remoção: `11-implementation/arquivo-marco-b.md`). Migrações aplicadas ficam.

> Estado: **v0.1 PROPOSTO (2026-11-14)** — direção de produto indicada pelo proprietário; formalização em ADR-029/030/031 (todos "Proposto — aguarda aprovação"). O **modelo comercial é HIPÓTESE não validada** (D16: sem validação com utilizadores). Não é parecer jurídico.

## 1. Posicionamento
O Vita é **software de ligação** entre **famílias, prestadores, seguradoras e empresas**. **Não é um TPA**: a seguradora continua a pagar e a decidir; o Vita processa autorizações e despesas. Tornar-se TPA só mais tarde, com parceiro licenciado (ADR-029). A **família é soberana dos dados clínicos**.

## 2. Partes
| Parte | Papel | Vê | Nunca vê |
|---|---|---|---|
| **Família** | Titular dos dados clínicos; consente por finalidade (ADR-026, BR-SEG-20) | Tudo o que é seu; cobertura, saldo, autorizações, reembolsos, rede coberta (dentro/fora da rede) | Dados de outras famílias; convenções/preços entre seguradora e prestador |
| **Prestador** (clínica, laboratório, imagem, farmácia) | Presta o ato; pode usar o Vita sem seguradora | Paciente que marcou ou consentiu; elegibilidade (sim/não, saldo, copagamento) | Apólice completa; histórico fora do consentimento; convenções de outros prestadores |
| **Seguradora** | Paga; define planos, tabelas, rede, regras | Beneficiários, autorizações, despesas, sinistros, planos, tabelas, rede | Dados clínicos do app (só o mínimo do ato autorizado, com consentimento — ver C2) |
| **Empresa** (tomador de grupo) | Contrata o seguro para colaboradores | Colaboradores ativos; custo e utilização **agregados e anónimos** (limiar k) | Dados clínicos individuais; utilização individual |
| **Backoffice Vita** (`PLATFORM_ADMIN`) | Verifica prestadores, gere contas | Metadados institucionais | Dados de saúde (D4) |

Rede de prestadores: **catálogo único e verificado** (ADR-030); a **Convenção** liga seguradora↔prestador (serviços cobertos, tabela de preços, regras de autorização, copagamento). Página pública: só dados institucionais, **nunca** seguradoras por prestador nem preços.

## 3. Matriz de acessos (alvo; estado atual em `authorization.md`)
Legenda: **L** lê · **E** escreve/decide · **A** só agregado anónimo · **C** só com consentimento da família · **—** sem acesso.

| Dado / função | Família | Prestador | Seguradora | Empresa | Backoffice |
|---|---|---|---|---|---|
| Dados clínicos (saúde, receitas, exames) | L/E | C (o que consentiu, por clínica/categoria/prazo) | — (mínimo do ato autorizado, com C) | — | — |
| Cartão, plano, saldo, copagamento | L | L (elegibilidade, resposta mínima) | L/E (seus) | A | — |
| Autorização | L | L/E (pedido, dos seus pacientes) | L/E (decide) | A | — |
| Despesa / sinistro | L | E (submete) | L/E (decide) | A | — |
| Reembolso | L/E | — | L/E | — | — |
| Planos e coberturas | L (o seu) | L (o do paciente, mínimo) | L/E | — | — |
| Tabela de preços da convenção | — | L (só a sua convenção) | L/E | — | — |
| Rede de prestadores | L (rede coberta, dentro/fora) | L (as suas convenções) | L/E (a sua) | — | L/E (verificação) |
| Colaboradores / adesão | L (o seu vínculo, revogável) | — | L/E | L/E (Fase 2) | — |
| Utilização e custo da empresa | — | — | L | A (k mínimo) | — |
| Catálogo público | — | E (opt-in de publicação) | — | — | L/E |

## 4. Modelo comercial (HIPÓTESE, preços NÃO validados)
| Parte | Hipótese |
|---|---|
| Famílias | **Grátis** |
| Seguradoras | Por **vida ativa/mês** + **taxa por transação** (autorização/despesa) |
| Empresas | Por **vida ativa/mês** + taxa por transação (quando aplicável) |
| Prestadores | **Grátis**; **nível pago opcional** (agenda avançada, visibilidade, relatórios) |
Sem valores até validação. Requer medição por tenant (vidas ativas, transações) — hoje inexistente.

## 5. Prestador sem seguradora
Porta de entrada: clínica privada usa agenda, pacientes, recibos, relatórios e laudos (ADR-026/027/028) sem convenção. As convenções acrescentam elegibilidade, autorização e despesas (ADR-030).

## 6. Fases (proposta; milestones em `plan.md` §4)
Fase 1: seguradora gere empresas, colaboradores e rede. Fase 2: portal da empresa (ADR-031). Depois: segurança medicamentosa, assistente de sintomas, wearables e incentivos — **bloqueados** por conflitos (§7).

## 7. Conflitos com a documentação existente (NÃO resolvidos; a decidir pelo proprietário)
| # | Conflito | Onde | Proposta (para decisão) |
|---|---|---|---|
| C1 | "Dados do app nunca alimentam prémio/cobertura/autorização/reembolso", vedado a nível de tratamento; indicadores de empresa e **incentivos** (wearables) poderiam usá-los. | `08-security/privacy.md:36`, `11-implementation/insurer-phase-a.md` §3.4, BR-SEG-18, TC-SEG-08 | Manter a regra; indicadores da empresa só a partir de dados **da seguradora**; incentivos só com **consentimento específico e separado**, sem efeito em prémio/cobertura, e emenda expressa por ADR. |
| C2 | Seguradora "mínimo do ato autorizado, com consentimento" versus "sem acesso a condições/alergias/medicação/consultas/exames" e "sem diagnóstico (Q5)". | `business-rules.md` BR-INS-08 (última parte), BR-SEG-18/23, ADR-025 | Definir lista fechada do mínimo (ex.: tipo de serviço/exame autorizado) e emenda a BR-INS-08 / ADR-025 Q5. |
| C3 | BR-HLT-03: sistema não sugere doses, interações nem intervalos de referência. Fase D (segurança medicamentosa) fá-lo. | `business-rules.md:74`; `roadmap.md` (interações "com validação clínica"); BR-EXM-02 (já emendado por ADR-027) | Novo ADR + validação clínica + eventual qualificação regulatória (dispositivo médico) antes de qualquer emenda. |
| C4 | Assistente de sintomas vs "sem diagnóstico", BR-RPT-03 e ADR-022 (rejeitou "quando procurar médico"); `vision.md` "não é IA/chatbot médico". | `scope.md` §1/§3, `vision.md`, ADR-022, BR-RPT-03 | Nenhuma implementação sem ADR que reverta explicitamente, AIPD e parecer jurídico/clínico. |
| C5 | Prestador "uma só vez" vs `insurer_providers` por seguradora (nome/NIF próprios); `provider_type` sem imagem; `BR-SEG-22`/`TC-SEG-11`. | `schema.md` §insurer_providers, ADR-025 | ADR-030 (migração futura, sem alterar BR-SEG-14). |
| C6 | `GET /public/partners` usado pelo web mas **não existe** em `openapi.yaml`/`endpoints.md`; o comentário do UI inclui "seguradoras parceiras", contra "nunca seguradoras por prestador". | `apps/web/src/services/partners.service.ts:6` | ADR-030 §6 (`/public/providers` recomendado); rever o UI se aprovado. |
| C7 | Wearables: sem partilha, sem IA; incentivos exigiriam partilha com seguradora/empresa. | `wearables/05-security-and-privacy.md` §1/§3, `wearables/07-open-questions.md` | Fase F só após decisão C1 e ADR próprio (categoria de dados nova + matriz de autorização). |
| C8 | `vision.md` "O que NÃO é": marketplace/pagamentos; mercado inicial Portugal/UE vs seguradoras Kz/AOA e Angola. | `vision.md`, `scope.md`, `README.md` (pendências: Lei 22/11, alojamento) | Rever visão/âmbito após aprovação de ADR-029; alojamento/transferência de dados a validar. |
| C9 | Medição/faturação por vida ativa e por transação: sem módulo, sem `audit` nem esquema. | `modules.md`, `schema.md` | Decidir se é interno (relatório) ou externo; só medição no 1.º marco. |
| C10 | Quarto ator (Empresa) exige `ActorInfo`/claims/rotas novos e teste de arquitetura; `Company` hoje é da seguradora. | `modules.md` §3, `authorization.md` §8, ADR-020/021/025 | ADR-031; decisão entidade global vs por seguradora. |

## 8. Riscos regulatórios — Angola (a validar com jurista; NÃO é parecer)
- **ARSEG** (regulador de seguros): risco de enquadramento do Vita como **mediador de seguros** ou **TPA** pela sua intervenção em autorizações/despesas e por cobrar por transação; a distinção "software" vs "administrador" tem de ser sustentada contratual e operacionalmente (a seguradora decide e paga).
- **Lei 22/11 (proteção de dados pessoais, Angola)**: dados de saúde são dados sensíveis; aplicabilidade, autorização prévia da autoridade de proteção de dados, consentimento por finalidade, transferências internacionais e alojamento fora de Angola. Já pendente no `README.md`.
- **Empresa/empregador**: risco de uso discriminatório de dados de saúde; agregação com k mínimo e proibição de dados individuais (ADR-031).
- **Faturação por transação**: tratamento fiscal e licenças comerciais a confirmar.
- **Passagem a TPA**: exige parceiro licenciado e novo ADR.
