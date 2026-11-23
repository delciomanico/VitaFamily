# Vita Family — Âmbito do MVP (Fase 2)

> Estado: **v0.2 — M1–M6 respondidas; N1–N3 respondidas; 1 ponto em aberto (secção 6)**
> Base: prompt mestre + decisões D1–D16 de `discovery.md` (+ D17, change control de 2026-10-05).
> Legenda: **[IN]** dentro do MVP · **[OUT]** fora · **[NEEDS DECISION]** pendente.
> Nota: isto define **âmbito**, não requisitos detalhados (Fase 3).

> **PIVÔ 2026-11-16 (ADR-037):** além do registo de saúde familiar descrito abaixo, o produto inclui um **mercado de profissionais de saúde e bem-estar** (cadastro e validação pelo admin, preços Kz visíveis, comparação, ranking por avaliações verificadas, chat, marcação, pagamento **fora da app** com comprovativo, partilha de registos com prazo/visualização única), **lançamento só em Angola**. Âmbito, marcos MK0–MK4 e decisões ratificadas em `marketplace-profissionais.md` §11. **Emenda a §3:** marketplace e telemedicina (consulta por vídeo por ligação externa) deixam de estar «fora»; **receita digital emitida por profissional entra no âmbito mas só é ativada no lançamento, após parecer jurídico** (ADR-037 §9); **pagamentos dentro da app e vídeo embebido continuam fora**; **seguros/seguradoras: ARQUIVADO e removido do `main`** (ADR-037 §12; `11-implementation/arquivo-marco-b.md`). O mercado é só para Angola (fuso `Africa/Luanda`, Kz, pt-PT).

> **CHANGE CONTROL 2026-11-21 (ADR-039, decisão do proprietário):** três blocos entram no âmbito, por esta ordem: **(1) M16 — registo rápido por OCR** (fotografar/escolher o documento e rever campos pré-preenchidos, no próprio dispositivo; `BR-OCR-01..12`, `ocr.md`); **(2) M17 — «Resumo de saúde»** (estatísticas **sem IA** sobre os dados já registados, com período; `BR-RPT-11..18`, UC-RPT-05/06); **(3) M18 — Assistente de IA ligado pelo utilizador** (relatórios inteligentes + análise de sintomas leve, com limites estritos; `BR-AI-01..16`, `ai-assistant.md`). Emendas a §1, §2 e §3 abaixo; o ADR-022 fica **parcialmente substituído**.

## 1. Objetivo do MVP
Permitir que uma família em Angola registe a saúde dos seus membros (incluindo dependentes sem conta), gira receitas, medicação, consultas e exames, receba lembretes por push e e-mail, e veja históricos e uma visão familiar básica — com privacidade controlada pelos adultos e sem qualquer diagnóstico. **Exceção estrita, por change control (ADR-022, 2026-10-17; alargada e parcialmente substituída pelo ADR-039, 2026-11-21):** um **assistente de IA ligado pelo utilizador** (a sua conta Google/Gemini ou a sua chave Claude/GPT), opt-in, que resume tendências nos dados já existentes e dá **orientação geral** sobre sintomas, podendo sugerir um **tipo de especialista** ligado ao mercado de profissionais; **nunca** diagnóstico definitivo, receitar nem indicar medicamentos/doses/tratamento; sinais de alarme ⇒ mensagem fixa de urgência (ver §2/§3).

## 2. Dentro do MVP

| Bloco | Itens [IN] | Decisões que o moldam |
|---|---|---|
| **Conta** | registo, login, recuperação de conta, eliminação de conta (hard delete) | D15 |
| **Família** | criar família; um User em várias famílias; membros com ou sem conta; convite por e-mail/link; criação direta de perfil; papéis Family Admin / Family Member | D1, D2, D14 |
| **Privacidade familiar** | cada adulto controla o que partilha; dependentes geridos pelo Admin | D13 |
| **Perfil de saúde** | tipo sanguíneo, alergias, condições, histórico médico (campos simples) | D8 |
| **Receitas** | registo manual, medicamentos (texto livre), dosagem, frequência, duração, observações, documento anexo, estado simples; **registo rápido por OCR no próprio dispositivo (M16, `BR-OCR-01..12`): «fotografar primeiro» (câmara/galeria/PDF), medicamentos/dosagem/frequência/duração/médico-clínica/data pré-preenchidos, campos de baixa confiança assinalados, revisão obrigatória antes de guardar, original anexado; melhor esforço, nada sai do dispositivo** | D8, D9, change control 2026-10-17 e 2026-11-21 |
| **Medicamentos** | ativos, horários, duração, lembretes, **confirmação de toma** e histórico de adesão | D7 |
| **Consultas** | criar/editar, data/hora, profissional, clínica (cadastro `Clinic` ou texto), estados, lembretes; **marcação em horários publicados por clínicas parceiras, com confirmação da clínica** | D3, D9, D17 |
| **Portal da clínica** | Gestor da clínica parceira: publica horários, confirma/recusa pedidos, vê a agenda da clínica — só dados mínimos da marcação, nunca dados de saúde | D17 |
| **Exames** | registo, upload de documento, resultados estruturados simples (valor, unidade, intervalo de referência informado pelo utilizador), data, histórico, estado; **registo rápido por OCR no próprio dispositivo (M16, `BR-OCR-01..12`): tipo, data, laboratório e parâmetros (valor/unidade/referência) pré-preenchidos, baixa confiança assinalada, revisão obrigatória, original anexado; melhor esforço, nada sai do dispositivo** | D8, D9, change control 2026-10-17 e 2026-11-21 |
| **Alertas** | só de agenda: medicação, consulta, exame; cadeia Evento → Regra → Alerta → Notificação | D11 |
| **Notificações** | push (PWA) + e-mail | D6, D12 |
| **Relatórios** | histórico individual e visão básica da família, **via API**; **«Resumo de saúde» com estatísticas calculadas sem IA** (adesão por período/medicamento, séries de parâmetros com mín./máx./variação, consultas e exames por período, receitas ativas/a terminar, alertas, atividade por membro, o que falta registar; período selecionável; impressão/guardar como PDF **no dispositivo**, sem PDF no servidor nem links) (M17, `BR-RPT-11..18`) | D10, change control 2026-11-21 |
| **Assistente de IA** (M18) | **Ligado pelo utilizador** (Gemini com «Continuar com Google»; Claude e GPT com chave de API guardada só no dispositivo), **chamada direta do dispositivo ao fornecedor** (a Vita não é intermediária): resumo/insights em linguagem simples e **análise de sintomas leve** (orientação geral; **nunca** diagnóstico, receita, medicamentos/doses); recomendação de **tipo de especialista** com ligação ao mercado; sinais de alarme ⇒ urgência; aviso permanente; filtro de saída; só tutor para dependentes; consentimento por fornecedor e membro. **Gate de lançamento: AIPD + parecer jurídico** (dispositivo médico) (`BR-AI-01..16`) | ADR-022 (parcial), ADR-039 |
| **Documentos** | armazenamento fora da BD, acesso controlado, validação de uploads | prompt §17 |
| **Auditoria** | log de operações sensíveis; anonimizado ao apagar | D15 |
| **Plataforma** | admin da plataforma **sem acesso a dados de saúde** | D4 |

## 3. Fora do MVP [OUT]
- Tudo o que o prompt exclui: diagnóstico, previsão de doenças, integração com hospitais, pagamentos, marketplace, telemedicina, farmácias, seguros, IoT, wearables, ML, análise médica avançada. **Continua fora:** chatbot médico geral, qualquer IA que **diagnostique, receite, indique medicamentos/doses ou alterações de tratamento**, IA fornecida/paga pela Vita, e qualquer relé de dados de saúde pelo backend. **Entrou no MVP (ADR-022 de 2026-10-17, alargado e parcialmente substituído pelo ADR-039 de 2026-11-21):** o assistente de IA **ligado pelo utilizador** descrito em §2, com limites estritos e gate de lançamento pela AIPD e pelo parecer jurídico.
- Acesso de clínicas a dados de saúde das famílias (D3). O login de Gestor da clínica parceira entrou com D17, limitado às marcações.
- SMS (D6); exportação PDF **gerada no servidor** e partilha por link (D10). **Emenda 2026-11-21 (proposta, OP-134):** o «Resumo de saúde» pode ser impresso/guardado como PDF **no dispositivo** a partir dos dados já visíveis (sem ficheiro no servidor nem ligação partilhável).
- Alertas por resultados de exames (D11).
- Interações medicamentosas; catálogos de medicamentos/doenças (D8).
- App móvel nativa (D12).
- ~~Fluxos REQUESTED/CONFIRMED de consulta com clínica (D9).~~ Entrou no MVP por D17 (só clínicas parceiras).

## 4. Pontos de extensão a preparar (sem implementar)
Clínica como entidade própria; canal de notificação abstrato (para SMS futuro); regras de alerta separadas dos eventos (para alertas clínicos futuros). Nada mais.

## 5. Critério de "MVP pronto" (proposta)
Uma família consegue, ponta a ponta: criar conta e família → adicionar um dependente sem conta → registar uma receita com medicamento → receber lembrete e confirmar toma → registar consulta e exame com documento → ver o relatório individual e familiar; com isolamento entre famílias verificado por testes e todas as operações sensíveis auditadas.

## 6. DECISÕES DESTA FASE (respondidas em 2026-10-04)

| ID | Decisão | Escolha | Consequência registada |
|---|---|---|---|
| M1 | Maioridade | **18 anos** | Menor = <18, sempre sob responsabilidade de um tutor/responsável. |
| M2 | Receita → plano de toma | **Sim, automático** | Ao registar a medicação de uma receita, é criado um Medication Schedule, editável manualmente. |
| M3 | Fuso horário | **Por utilizador** | Cada User tem fuso horário; lembretes calculados nesse fuso. Dependentes: fuso a definir (ver N1). |
| M4 | Confirmação de toma de dependente | **O próprio dependente ou o seu representante, ambos com conta e acesso limitado** | Dependente pode ter conta de acesso limitado; o representante também confirma. Introduz o conceito de **tutor/responsável** (ver N1, N2). |
| M5 | Limites de upload | **Aprovado:** PDF, JPG, PNG, máx. 10 MB | Entra em requisitos não funcionais. |
| M6 | Edição do perfil de saúde de dependente | **Tutor legal ou responsável** | Permissão ligada à relação de tutela, não ao papel Family Admin. |

### Decisões derivadas (respondidas em 2026-10-04)

| ID | Decisão | Escolha | Consequência registada |
|---|---|---|---|
| N1 | Tutor/responsável | **Relação por dependente** | Cada dependente tem 1+ responsáveis. Family Admin não é automaticamente tutor. |
| N2 | Dependente com conta limitada | **Aprovado:** vê os próprios medicamentos e consultas e confirma tomas; não edita dados clínicos | Entra em `permissions.md` (Fase 5). |
| N3 | Adulto dependente (ex.: idoso) | **Mesma relação de tutela** | "Dependente" cobre menores e adultos sob responsabilidade; a tutela não depende da idade. |

### Ponto ainda em aberto
- **[RESOLVIDO — P2/P4 na Fase 5]** Consentimento do tutor para dependente com conta:** quando o dependente é menor com conta, o tutor tem de autorizar a criação? E até que idade o tutor vê tudo? (Fase 5.) Para adultos dependentes: o consentimento e a visibilidade do tutor sobre os dados do adulto também ficam por definir.
