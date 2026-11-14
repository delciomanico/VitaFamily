# Vita Family — Pesquisa de fluxos reais (seguradora, prestador, família)

> Estado: **v0.1 PESQUISA (2026-11-14)** — insumo para `process-flows.md` v0.2 e `digital-card.md`. Não é decisão, contrato nem parecer jurídico.
> **Legenda de confiança:** **[V]** verificado em fonte primária citada; **[V-sec]** verificado em fonte secundária/comercial (menor fiabilidade); **[I]** inferido (não confirmado em fonte); **[C]** por confirmar com seguradora/regulador/proprietário. Onde a fonte é o PDF/site, a referência é o nome do documento tal como entregue pelo proprietário/consultado; não há citações de página porque este ficheiro não reproduz os PDFs.
> **Limites gerais:** nenhuma seguradora angolana forneceu o seu fluxo interno (prazos reais, critérios de glosa, SLA); os PDFs são formulários, não contratos. Não se obteve norma ARSEG específica sobre TPA/sinistros de saúde. Os sites da BAI Seguros e da Fidelidade Angola não abriram. Nada aqui valida a cobertura de um plano concreto.

## Critérios do proprietário — pendente
Os critérios de aprovação/funcionamento do proprietário **ainda não foram enviados**. Esta secção fica vazia até serem recebidos; nada foi inventado em sua substituição. Quando chegarem, registar aqui (id, critério, impacto em `process-flows.md`/`digital-card.md`) e reconciliar com §6.

## 1. Angola
### 1.1 Impressos de reembolso ENSA/TRA (administradora ADVAngola) [V — PDFs reais]
- **Identificação:** nº do cartão/apólice, contacto, **IBAN** (o pagamento é por **transferência** para o IBAN indicado).
- **Tabela de despesas** (uma linha por despesa), com tipo codificado: **I** internamento, **P** parto, **C** consulta, **EAD** exames auxiliares de diagnóstico, **T** tratamentos, **E** estomatologia, **PO** próteses/ortóteses, **M** medicamentos, **SD** subsídio diário. Colunas: data, quantidade, diagnóstico, descritivo/código do ato, valor.
- **Motivo de ter pago a totalidade** (campo próprio no impresso).
- **Assinatura** que autoriza o médico a partilhar informação com a seguradora e a administradora.
- **Documentos exigidos por tipo:** fatura/recibo **original** com **NIF do prestador**; internamento: nota de alta/relatório; tratamentos, próteses e medicamentos: **prescrição**; relatório com diagnóstico; declaração de **pré-comparticipação** de outra entidade (se existir); cópia do cartão e BI.
- **Nota:** o impresso pede o diagnóstico ao beneficiário/médico. Isto **colide com BR-SEG-23/C2** (diagnóstico não viaja por defeito): ver `process-flows.md` §11 (D29).

### 1.2 Pedido de autorização de deslocação ao estrangeiro (Nossa Seguros) [V — PDF real]
- Todo o procedimento sujeito a **análise e autorização prévia**.
- Exceto consultas, análises, raios X e ecografias, exige **prescrição com diagnóstico**; **cirurgia** exige relatório do médico assistente e exames.
- Fora do âmbito do Vita inicial (evacuação/estrangeiro); regista-se por completar o catálogo de percursos.

### 1.3 Fortaleza/Atlântico, produto Cuida [V-sec — material comercial]
Rede Angola + Portugal; níveis Base/Mais/Extra; **prazo anunciado de regularização de sinistros 10 dias úteis com documentação completa** (anunciado para Danos Próprios, **não** para saúde: **[C]** se aplica a saúde); participação de sinistros por WhatsApp; médico online 24/7; 2.ª opinião.

### 1.4 BFA, ficha técnica [V-sec]
Planos Easy/Plus com tetos (internamento 10–40 milhões Kz); idade de subscrição 18–65 (empresa até 70).

### 1.5 ADVAngola e Medicare (PT) [V-sec]
ADVAngola tem áreas reservadas/portais de prestadores e de seguradoras. A Medicare (Portugal) valida cartão de Angola por login no portal do prestador ou por telefone.

### 1.6 Não verificado
Norma ARSEG sobre TPA/sinistros de saúde (não encontrada); sites BAI e Fidelidade (não abriram); prazos reais de análise de autorização/reembolso em Angola; formato do cartão físico (campos, QR/barras?) das seguradoras; se existe API de elegibilidade em alguma seguradora angolana.

## 2. Brasil (ANS/TISS) — referência de processo
- **TISS (RN 114/2005)** padrão obrigatório [V-sec]. **Guias:** consulta; SP/SADT (serve autorização e cobrança); solicitação de internação (SP/SADT e honorários ligados à guia de internação).
- **Faturação em lote** por prestador; a operadora devolve o **demonstrativo de análise de conta médica**; **glosa e recurso** [V-sec].
- **Urgência/emergência:** atendimento imediato **sem autorização prévia** [V — regra ANS].
- **Prazos de atendimento (RN 566/2022):** consulta básica até 7 dias úteis; internação eletiva/alta complexidade até 21 — **fontes divergem [C]**. **Prazos de resposta (RN 623/2024): números divergem entre fontes; NÃO citar sem confirmar.**
- **Canais prestador↔operadora:** portal, web service (elegibilidade e autorização), TISSNet, lote, POS; verificação por número do cartão [V-sec].

## 3. Nigéria (HMO/NHIA) — fontes de blogue, fiabilidade menor [V-sec]
Capitação nos cuidados primários (prestador designado); pré-autorização por **código** para especialista/internamento/cirurgia/imagem, pedida pelo prestador; **regra NHIA (maio 2025): código em 1 hora; se a HMO não responder, o prestador pode avançar**; só prestadores da rede são cobertos sem pré-autorização. **[C]** confirmar a regra em fonte primária NHIA antes de a usar como argumento.

## 4. EUA/FHIR — referência técnica [V-sec]
Elegibilidade em tempo real X12 **270/271** (metas ≤ 20 s; fornecedores dizem < 5 s); pré-verificação em lote + verificação à chegada; **278** autorização; **FHIR** `CoverageEligibilityRequest/Response` e Da Vinci PAS (prior authorization). Serve só de modelo de mensagem; não implica adotar os padrões.

## 5. Cartão digital [V-sec]
Titular vê os cartões dos dependentes, dependente só o seu; QR de validade curta (caso: 5 min); nunca enviar imagem do cartão por e-mail/SMS; cartão digital com o mesmo valor do físico (ADSE); carteira Apple/Google varia por seguradora (Cigna: Apple sim/Google não; BCBS MI: ambos).

## 6. Moçambique [V-sec]
Só produto BCI (rede, 24/7); nada sobre prazos/documentos. Sem valor para os fluxos.

## 7. O que a pesquisa muda no produto (resumo; detalhe em `process-flows.md` §0)
1. Autorização em **3 tipos de guia** (consulta, serviços/exames, internação) e tipos de despesa **I/P/C/EAD/T/E/PO/M/SD** como catálogo.
2. Despesa com **duas formas** (fatura em lote do prestador com demonstrativo/glosa/recurso; pedido de reembolso da família com documentos por tipo, NIF e IBAN).
3. Urgência atende primeiro (**confirmado por ANS**; já decidido Q-U1).
4. Questão nova **Q-V2** (prazo com consequência para urgentes) — não altera nenhuma decisão.
5. Capitação/médico de família: fora do âmbito (nota).
6. Fallbacks reais: telefone/WhatsApp, fotografia da fatura/impresso, número do cartão ditado.

## 8. Lista de fontes a consultar (para fechar os [C])
ARSEG (regulamentação de seguros de saúde/TPA); seguradoras piloto (prazos reais, formato do cartão, canal de elegibilidade); ANS (RN 566/2022 e RN 623/2024, texto oficial); NHIA (regra de 1 hora); documentação Apple PassKit e Google Wallet API (ver `digital-card.md` §7).
