# Vita Family — Âmbito do MVP (Fase 2)

> Estado: **v0.2 — M1–M6 respondidas; N1–N3 respondidas; 1 ponto em aberto (secção 6)**
> Base: prompt mestre + decisões D1–D16 de `discovery.md` (+ D17, change control de 2026-10-05).
> Legenda: **[IN]** dentro do MVP · **[OUT]** fora · **[NEEDS DECISION]** pendente.
> Nota: isto define **âmbito**, não requisitos detalhados (Fase 3).

## 1. Objetivo do MVP
Permitir que uma família em Portugal registe a saúde dos seus membros (incluindo dependentes sem conta), gira receitas, medicação, consultas e exames, receba lembretes por push e e-mail, e veja históricos e uma visão familiar básica — com privacidade controlada pelos adultos e sem qualquer diagnóstico.

## 2. Dentro do MVP

| Bloco | Itens [IN] | Decisões que o moldam |
|---|---|---|
| **Conta** | registo, login, recuperação de conta, eliminação de conta (hard delete) | D15 |
| **Família** | criar família; um User em várias famílias; membros com ou sem conta; convite por e-mail/link; criação direta de perfil; papéis Family Admin / Family Member | D1, D2, D14 |
| **Privacidade familiar** | cada adulto controla o que partilha; dependentes geridos pelo Admin | D13 |
| **Perfil de saúde** | tipo sanguíneo, alergias, condições, histórico médico (campos simples) | D8 |
| **Receitas** | registo manual, medicamentos (texto livre), dosagem, frequência, duração, observações, documento anexo, estado simples | D8, D9 |
| **Medicamentos** | ativos, horários, duração, lembretes, **confirmação de toma** e histórico de adesão | D7 |
| **Consultas** | criar/editar, data/hora, profissional, clínica (cadastro `Clinic` ou texto), estados, lembretes; **marcação em horários publicados por clínicas parceiras, com confirmação da clínica** | D3, D9, D17 |
| **Portal da clínica** | Gestor da clínica parceira: publica horários, confirma/recusa pedidos, vê a agenda da clínica — só dados mínimos da marcação, nunca dados de saúde | D17 |
| **Exames** | registo, upload de documento, resultados estruturados simples (valor, unidade, intervalo de referência informado pelo utilizador), data, histórico, estado | D8, D9 |
| **Alertas** | só de agenda: medicação, consulta, exame; cadeia Evento → Regra → Alerta → Notificação | D11 |
| **Notificações** | push (PWA) + e-mail | D6, D12 |
| **Relatórios** | histórico individual e visão básica da família, **via API** | D10 |
| **Documentos** | armazenamento fora da BD, acesso controlado, validação de uploads | prompt §17 |
| **Auditoria** | log de operações sensíveis; anonimizado ao apagar | D15 |
| **Plataforma** | admin da plataforma **sem acesso a dados de saúde** | D4 |

## 3. Fora do MVP [OUT]
- Tudo o que o prompt exclui: diagnóstico, IA/chatbot médico, previsão de doenças, integração com hospitais, pagamentos, marketplace, telemedicina, farmácias, seguros, IoT, wearables, ML, análise médica avançada.
- Acesso de clínicas a dados de saúde das famílias (D3). O login de Gestor da clínica parceira entrou com D17, limitado às marcações.
- SMS (D6); exportação PDF e partilha por link (D10).
- Alertas por resultados de exames (D11).
- OCR/leitura automática de documentos; interações medicamentosas; catálogos de medicamentos/doenças (D8).
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
