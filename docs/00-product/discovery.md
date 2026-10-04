# Vita Family — Product Discovery (Fase 1)

> Estado: **v0.2 — decisões D1–D16 respondidas pelo proprietário em 2026-10-04 (ver secção 17)**
> Data: 2026-10-04
> Fonte única de informação desta versão: o *Prompt Mestre* fornecido pelo proprietário. Nada aqui foi validado com utilizadores reais.

Legenda de estado:
- **[CONFIRMADO]** — definido explicitamente pelo proprietário.
- **[PROPOSTO]** — sugestão minha, ainda não aprovada.
- **[TBD]** — a decidir.
- **[NEEDS DECISION]** — requer decisão do proprietário (ver secção 16).

---

## 1. Visão do Vita Family

**[CONFIRMADO]** Plataforma de gestão da saúde familiar que ajuda famílias a organizar a informação de saúde, gerir receitas e medicamentos, receber lembretes, acompanhar consultas e exames, manter histórico e gerar relatórios individuais e familiares.

**[CONFIRMADO — longo prazo]** Futuramente, ligar famílias a clínicas parceiras.

**[PROPOSTO] Frase de visão (para validar):**
> "Um lugar único e seguro onde cada família guarda, entende e acompanha a saúde de todos os seus membros."

---

## 2. Problema que estamos a tentar resolver

> Os pontos abaixo são **hipóteses** derivadas da lista de objetivos do prompt. Têm de ser validadas com utilizadores.

| # | Hipótese de problema | Estado |
|---|---|---|
| P1 | A informação de saúde da família está dispersa (papel, fotos, WhatsApp, e-mails, memória). | [PROPOSTO] |
| P2 | Esquecem-se doses, consultas e exames. | [PROPOSTO] |
| P3 | Quem cuida de vários familiares (filhos, idosos) não tem visão consolidada. | [PROPOSTO] |
| P4 | Em consulta ou urgência, é difícil recordar histórico, alergias e medicação atual. | [PROPOSTO] |
| P5 | Resultados fora do normal passam despercebidos ou sem seguimento. | [PROPOSTO] |

---

## 3. Público-alvo

**[TBD / NEEDS DECISION]** O prompt não define mercado, país, idioma, nem perfil demográfico.

Segmentos candidatos (nenhum aprovado):
- Pais/mães com filhos pequenos.
- Adultos que cuidam de pais idosos.
- Famílias com doentes crónicos.
- Famílias multigeracionais.

Tópicos em aberto: país/região inicial (afeta RGPD/leis locais, formato de receitas, idioma, notificações SMS), literacia digital, dispositivos principais.

---

## 4. Proposta de valor

**[PROPOSTO]** (derivada dos objetivos confirmados):
1. **Centralização** — toda a saúde da família num só sítio.
2. **Não esquecer** — lembretes de medicação, consultas e exames.
3. **Visão familiar** — o responsável vê quem precisa de quê.
4. **Histórico pronto** — informação organizada para mostrar a profissionais de saúde.
5. **Atenção, não diagnóstico** — sinaliza o que merece acompanhamento profissional.

---

## 5. Objetivos do produto

**[PROPOSTO]** — objetivos a confirmar; métricas são exemplos, **sem valores definidos**.

| Objetivo | Possível indicador | Meta |
|---|---|---|
| Validar que famílias registam e mantêm dados | Famílias com ≥2 membros ativos | TBD |
| Validar valor dos lembretes | Doses/consultas com lembrete entregue e confirmado | TBD |
| Validar retenção | Famílias ativas após 30/90 dias | TBD |
| Validar confiança/segurança | Zero incidentes de acesso indevido | 0 (a confirmar) |

---

## 6. O que o Vita Family NÃO é

**[CONFIRMADO]**
- Não faz diagnóstico automático nem assume que pode diagnosticar doenças.
- Não é um chatbot/IA médica nem prevê doenças (fora do MVP).
- Não substitui um profissional de saúde.

**[PROPOSTO]** (a confirmar)
- Não é um prontuário clínico oficial / registo de saúde legal de clínica ou hospital.
- Não é um dispositivo médico (a classificação regulatória deve ser confirmada — ver Riscos).
- Não é um marketplace, plataforma de pagamentos ou de telemedicina no MVP.

Linha de conduta para alertas **[CONFIRMADO]**: `DADOS → ANÁLISE → ALERTA`, nunca `DADOS → DIAGNÓSTICO`. Mensagem-tipo permitida:
> "Foi identificado um resultado fora do intervalo de referência informado. Recomenda-se discutir o resultado com um profissional de saúde."

---

## 7. Funcionalidades já identificadas

**[CONFIRMADO]** como ideias do produto (nem todas no MVP):

- Conta de utilizador, família, membros, convite/admissão, perfil de saúde, permissões familiares.
- Histórico de saúde: condições, alergias, tipo sanguíneo, histórico médico.
- Receitas: registo, medicamentos associados, dosagem, frequência, duração, observações, documento, estado.
- Medicamentos: ativos, horários, duração, lembretes, histórico.
- Consultas: data, hora, profissional/clínica, estado, lembretes.
- Exames: registo, upload de documento, resultados, data, histórico, estado.
- Alertas: medicamentos, consultas, exames, outros a definir.
- Relatórios: histórico individual, visão básica da família.
- Contexto de clínica (Clinic Admin / Clinic Manager) — preparado arquiteturalmente.
- Auditoria de operações sensíveis.

---

## 8. Funcionalidades candidatas ao MVP

O prompt lista o núcleo abaixo. Marco o que **ainda não está claro** no âmbito de cada bloco.

| Bloco | Itens | Pontos em aberto |
|---|---|---|
| Família | conta, família, membros, convite/admissão, perfil básico, permissões | Membros sem conta (crianças)? Uma pessoa em várias famílias? Ver D1, D2 |
| Histórico de saúde | condições, alergias, tipo sanguíneo, histórico | Texto livre ou catálogo/códigos? Ver D8 |
| Receitas | registo manual, medicamentos, posologia, documento, estado | OCR/leitura automática? (assumo **não**) Estados Ver D9 |
| Medicamentos | ativos, horários, lembretes, histórico | Registo de "tomei/não tomei"? Ver D7 |
| Consultas | criar, data/hora, profissional/clínica, estado, lembretes | Clínica é entidade do sistema ou texto livre no MVP? Ver D3 |
| Exames | registo, upload, resultados, estado | Resultados estruturados ou só documento? Ver D8 |
| Alertas | medicação, consultas, exames | Canais de notificação Ver D6 |
| Relatórios | individual e familiar básico | Formato (ecrã/PDF)? Ver D10 |

**Pergunta estrutural:** o MVP inclui o contexto **Clínica** (Clinic Admin/Manager) ou apenas Família? Ver D3.

---

## 9. Funcionalidades fora do MVP

**[CONFIRMADO] Fora do MVP:**
diagnóstico automático, IA médica, chatbot médico, previsão de doenças, integração complexa com hospitais, pagamentos, marketplace, telemedicina, farmácias, seguros, IoT, wearables, machine learning, análise médica avançada.

**[PROPOSTO] Também sugiro adiar** (a confirmar):
- Integração operacional família ↔ clínica (partilha de dados, agenda partilhada) — só preparar a arquitetura.
- OCR / leitura automática de receitas e exames.
- Deteção de interações medicamentosas (exige base clínica validada).
- Alertas baseados em intervalos de referência (ver D11 — pode ser MVP mínimo ou não).
- Aplicação móvel nativa (depende de D12).

---

## 10. Atores identificados

**[CONFIRMADO]**

| Contexto | Ator | Nota |
|---|---|---|
| Família | Family Admin | Papel dentro de uma família |
| Família | Family Member | Papel dentro de uma família |
| Clínica | Clinic Admin | Papel dentro de uma clínica |
| Clinic | Clinic Manager | Papel dentro de uma clínica |

**[PROPOSTO] Atores/sistemas adicionais a considerar:**
- **Utilizador (User)** — pessoa com conta; pode ter papel numa família e/ou clínica? (D2, D3)
- **Sistema (Scheduler/Notifier)** — gera alertas e notificações automaticamente.
- **Administrador da plataforma (Vita staff)** — suporte/operação. **[NEEDS DECISION]** D4: existe? Que acesso a dados de saúde?
- **Profissional de saúde** — aparece como dado (médico numa consulta), **não** como ator com login no MVP (a confirmar).

---

## 11. Dúvidas e decisões pendentes (resumo)

Ver secção 16 para as perguntas objetivas. Áreas: modelo de membros e contas, papéis, clínicas, admin da plataforma, privacidade/consentimento, canais de notificação, registo de tomas, estrutura dos dados clínicos, estados, relatórios, alertas de resultados, plataforma cliente, mercado/regulação, idioma.

---

## 12. Riscos do produto

| # | Risco | Severidade | Mitigação inicial (proposta) |
|---|---|---|---|
| R1 | **Dados de saúde são categoria especial** (RGPD ou equivalente local): consentimento, retenção, direito ao apagamento, transferências. | Alta | Definir mercado e base legal antes do modelo de dados; privacy-by-design. |
| R2 | **Fuga ou acesso indevido** entre famílias/clínicas. | Alta | Isolamento por família no backend, auditoria, controlo de download de documentos. |
| R3 | **Classificação regulatória** (software como dispositivo médico) se houver lógica de análise/alerta clínico. | Alta | Limitar a alertas informativos; validação jurídica; sem diagnóstico. |
| R4 | **Responsabilidade clínica**: erro de dose/horário registado ou lembrete falhado com consequência para saúde. | Alta | Avisos claros; dados introduzidos pelo utilizador são da sua responsabilidade (a validar juridicamente). |
| R5 | **Fiabilidade dos lembretes** (falha de push/SMS/e-mail). | Média-Alta | Definir canais e SLAs; monitorização. |
| R6 | **Menores e dependentes**: quem consente e quem acede. | Alta | Decisão D1 antes de qualquer modelo. |
| R7 | **Scope creep** (IA, clínicas, pagamentos). | Média | Change control (secção 23 do prompt). |
| R8 | **Qualidade/formato dos dados** (receitas e exames variam muito). | Média | MVP com dados simples + documento anexo. |
| R9 | **Adoção**: o esforço de registar dados pode superar o benefício. | Média | Validar com utilizadores reais cedo; reduzir campos obrigatórios. |
| R10 | **Custo/complexidade de SMS** e notificações. | Baixa-Média | Decidir canais (D6). |

---

## 13. Premissas

Todas **[PROPOSTO]** até confirmação:

1. O MVP é uma API backend; o(s) cliente(s) serão definidos separadamente (D12).
2. Os dados clínicos são **introduzidos manualmente** pelo utilizador (sem integração com sistemas externos).
3. Documentos (receitas/exames) são anexos; o sistema **não interpreta** o conteúdo automaticamente.
4. Uma família tem pelo menos um Family Admin.
5. Todos os acessos a dados de saúde são autenticados e autorizados no backend.
6. A stack proposta (NestJS, PostgreSQL, Prisma, Redis, MinIO/S3, REST, OpenAPI, Docker) é **proposta**, a rever na Fase 11 com ADRs.
7. O sistema nunca produz diagnóstico; só apresenta dados e alertas informativos.

---

## 14. Glossário inicial

| Termo | Definição provisória |
|---|---|
| **User** | Pessoa com conta e credenciais de acesso. |
| **Family** | Grupo de pessoas cuja saúde é gerida em conjunto. Fronteira de isolamento de dados. |
| **Family Admin** | Membro com permissões de gestão da família. (âmbito exato: TBD) |
| **Family Member** | Membro da família com permissões limitadas. (âmbito exato: TBD) |
| **FamilyMember** | Pessoa na família: pode ou não ter conta (D1). |
| **Health Profile** | Resumo base de saúde de um membro (ex.: tipo sanguíneo, alergias). |
| **Medical Condition** | Condição de saúde registada. |
| **Allergy** | Alergia registada. |
| **Prescription** | Receita médica registada, com medicamentos e documento. |
| **Medication** | Medicamento (catálogo? texto livre? — D8). |
| **Medication Schedule** | Plano de toma (horários, duração) derivado de uma receita ou criado à mão. |
| **Appointment** | Consulta marcada/registada. |
| **Clinic** | Organização de saúde. Papel no MVP: TBD (D3). |
| **Examination / Exam Result** | Exame e respetivo resultado. |
| **Document** | Ficheiro anexo (receita, exame) armazenado fora da base de dados. |
| **Event → Rule → Alert → Notification** | Cadeia de alertas: facto ocorrido → regra → alerta → entrega ao utilizador. |
| **Health Alert** | Aviso informativo gerado por regra; **não é diagnóstico**. |
| **Health Report** | Documento/visão agregada de dados existentes. |
| **Audit Log** | Registo imutável de operações sensíveis (quem, o quê, quando, resultado). |
| **MVP** | Menor versão que valida o produto. |
| **ADR** | Architecture Decision Record. |
| **RBAC** | Controlo de acesso baseado em papéis. |

---

## 15. Próxima etapa

1. O proprietário responde às decisões da secção 16 (pode ser em lote; as marcadas **bloqueantes** impedem a Fase 2).
2. Atualizo este documento e crio `vision.md`, `scope.md`, `glossary.md` e `roadmap.md` em `docs/00-product/`.
3. **Fase 2 — Definição do MVP** (escopo fechado, critérios de "feito", itens fora do escopo).

Alteração à estrutura de `docs/` proposta: **nenhuma por agora**.

---

## 16. DECISÕES QUE PRECISO TOMAR

Cada decisão segue o formato: contexto → opções → recomendação → impacto. Responde com a letra (ou outra opção).

### D1 — Membros sem conta (**bloqueante**)
- **Contexto:** crianças e idosos podem não ter conta; define o modelo central.
- **Opções:** A) Todo membro é um User com conta. B) Membro pode existir **sem conta** (perfil gerido por um Admin) e ser ligado a uma conta depois. C) B, mas só para menores.
- **Recomendação:** **B**.
- **Impacto:** separa `User` de `FamilyMember`; afeta permissões, convites, auditoria e consentimento.

### D2 — Uma pessoa em várias famílias (**bloqueante**)
- **Opções:** A) Um User pertence a exatamente uma família. B) Pode pertencer a várias (ex.: família própria + pais).
- **Recomendação:** **B** a nível de modelo de dados, mas UI/MVP pode expor só uma, se quiseres simplicidade.
- **Impacto:** relação User↔Family 1:N vs N:M; isolamento de dados e seleção de contexto na API.

### D3 — Papel da Clínica no MVP (**bloqueante**)
- **Opções:** A) Fora do MVP: clínica é só texto livre numa consulta. B) Entidade `Clinic` existe (cadastro), mas sem utilizadores/login. C) Clinic Admin/Manager existem com acesso à plataforma, sem acesso a dados de famílias. D) Clínicas com acesso a dados de famílias (partilha consentida).
- **Recomendação:** **B** (prepara sem inventar).
- **Impacto:** C e D exigem consentimento, permissões e auditoria cruzadas, e quase duplicam o escopo.

### D4 — Administrador da plataforma
- **Opções:** A) Não existe no MVP (operação via base de dados/ferramentas internas). B) Existe, sem acesso a dados de saúde (só gestão de contas). C) Existe com acesso auditado para suporte.
- **Recomendação:** **A/B**.
- **Impacto:** privacidade, RBAC e auditoria.

### D5 — Mercado e enquadramento legal (**bloqueante para segurança/privacidade**)
- **Pergunta:** país/região inicial e idioma(s)? Aplica-se RGPD/LGPD/outra? Há assessoria jurídica?
- **Impacto:** retenção, consentimento, localização dos dados (hosting), SMS, formato de receitas.

### D6 — Canais de notificação no MVP
- **Opções:** A) Só push. B) Push + e-mail. C) Push + e-mail + SMS.
- **Recomendação:** **B** (SMS tem custo e complexidade).
- **Impacto:** infraestrutura de jobs, fornecedores externos, dados de contacto, consentimento.

### D7 — Registo de tomas ("tomei / não tomei")
- **Opções:** A) Só lembretes (sem confirmação). B) Utilizador confirma toma; histórico de adesão. C) B + alertar o Admin se não confirmado.
- **Recomendação:** **B**.
- **Impacto:** nova entidade (registo de toma), "histórico" de medicamentos fica significativo, privacidade entre membros.

### D8 — Estruturação dos dados clínicos
- **Opções:** A) Texto livre. B) Campos estruturados simples (nome, valor, unidade, intervalo de referência **informado pelo utilizador**), sem catálogos. C) Catálogos/códigos padronizados (medicamentos, doenças).
- **Recomendação:** **B** para exames e condições; medicamentos em texto livre com campo normalizável no futuro.
- **Impacto:** viabilidade de alertas e relatórios; esforço de UI e de dados.

### D9 — Estados do ciclo de vida
- Preciso da tua aprovação dos estados de: Prescription (ex.: ATIVA/CONCLUÍDA/CANCELADA?), Appointment (REQUESTED?/CONFIRMED/COMPLETED/CANCELLED/NO_SHOW — "REQUESTED" só faz sentido se houver clínica, ver D3), Examination, Alert. **Proposta detalhada na Fase 10;** aqui só confirmo: queres que o MVP tenha estados simples (agendada/realizada/cancelada)?

### D10 — Relatórios
- **Opções:** A) Visão em ecrã via API (JSON). B) A + exportação PDF. C) Partilha por link com profissional de saúde.
- **Recomendação:** **A** no MVP; PDF depois.
- **Impacto:** geração de documentos, partilha de dados fora do sistema (risco de privacidade).

### D11 — Alertas baseados em resultados de exames
- **Contexto:** o prompt dá o exemplo "resultado fora do intervalo informado". Isto é lógica médica.
- **Opções:** A) Fora do MVP; MVP só tem alertas de agenda (medicação, consulta, exame). B) MVP inclui alerta simples **só quando o utilizador forneceu o intervalo de referência**.
- **Recomendação:** **A** para MVP; **B** como primeira evolução.
- **Impacto:** regulação (R3), validação clínica, estrutura de dados (D8).

### D12 — Plataforma cliente e quem consome a API
- **Pergunta:** web, mobile (nativo/PWA) ou ambos? Já existe frontend/design? Quem desenvolve?
- **Impacto:** autenticação (cookies vs tokens), push notifications, CORS, upload de ficheiros.

### D13 — Privacidade dentro da família
- **Contexto:** nem todos os membros devem ver tudo (ex.: saúde mental, saúde sexual de um adulto).
- **Opções:** A) Admin vê tudo; Member vê só o seu e o que lhe for partilhado. B) Todos veem tudo. C) Cada membro adulto controla o que partilha.
- **Recomendação:** **C** como princípio, com regras para menores via D1.
- **Impacto:** é o núcleo de `permissions.md`; afeta todas as consultas à API.

### D14 — Convite/admissão de membros
- **Opções:** A) Admin convida por e-mail/link; pessoa aceita. B) Admin cria perfil sem convite (só D1-B). C) Ambos.
- **Recomendação:** **C**.
- **Impacto:** fluxo de convite, expiração, fusão de perfil com conta existente.

### D15 — Retenção e eliminação
- **Pergunta:** o utilizador pode apagar conta/família/dados? Apaga-se de facto ou fica arquivado? Por quanto tempo se mantêm logs de auditoria?
- **Impacto:** *soft vs hard delete*, backups, conformidade (D5).

### D16 — Validação com utilizadores
- **Pergunta:** já falaste com famílias/potenciais utilizadores? Existe algum material (entrevistas, protótipos)? Se não, aceitas que as hipóteses P1–P5 sejam validadas em paralelo com a documentação?

---

---

## 17. REGISTO DE DECISÕES (respondidas em 2026-10-04)

| ID | Decisão | Escolha | Consequência registada |
|---|---|---|---|
| D1 | Membros sem conta | **B** — membro com ou sem conta | `User` separado de `FamilyMember`; membro sem conta é gerido por um Admin e pode ser ligado a uma conta depois. |
| D2 | Várias famílias | **B** — um User em várias famílias | Relação User↔Family N:M; a API precisa de contexto de família em cada pedido. |
| D3 | Clínica no MVP | **B** — entidade `Clinic` sem login | Sem Clinic Admin/Manager com acesso no MVP; sem acesso de clínicas a dados de famílias. Arquitetura preparada. |
| D4 | Admin da plataforma | **B** — existe, sem acesso a dados de saúde | Gere contas/suporte; nunca vê dados clínicos. |
| D5 | Mercado | **Portugal / UE (RGPD)** | Idioma pt-PT; RGPD aplicável; hosting na UE (a confirmar na Fase 11). |
| D6 | Notificações | **B** — push + e-mail | Sem SMS no MVP. |
| D7 | Tomas | **B** — confirmar toma | Nova entidade de registo de toma; histórico de adesão. |
| D8 | Dados clínicos | **B** — campos estruturados simples | Valor, unidade, intervalo de referência informado pelo utilizador; medicamentos em texto livre; sem catálogos. |
| D9 | Estados | **Simples** | Sem REQUESTED/CONFIRMED por agora; detalhe na Fase 10. |
| D10 | Relatórios | **A** — vista via API | Sem PDF nem partilha por link no MVP. |
| D11 | Alertas por resultados | **A** — fora do MVP | Só alertas de agenda (medicação, consulta, exame). |
| D12 | Cliente | **Web app (PWA)** | Push via PWA; autenticação a decidir na Fase 14 tendo isto em conta. |
| D13 | Privacidade na família | **C** — cada adulto controla o que partilha | Núcleo de `permissions.md`; menores/dependentes geridos pelo Admin. |
| D14 | Admissão | **C** — convite e criação direta | Fluxo de convite com expiração; ligação de perfil a conta existente. |
| D15 | Eliminação | **Hard delete a pedido** | Remoção real de dados e documentos; logs de auditoria anonimizados; prazo de retenção dos logs **TBD (Fase 14)**. |
| D16 | Validação com utilizadores | **Não validar** | Risco R9 (adoção) **aceite pelo proprietário**; P1–P5 mantêm-se como hipóteses não validadas. |

### Pontos que ficam em aberto (derivados das decisões)

- **[NEEDS DECISION] Maioridade/menores (D1+D13):** idade a partir da qual um membro é considerado adulto (RGPD/PT: consentimento digital aos 13 anos; maioridade civil aos 18). Decidir na Fase 5.
- **[TBD] Retenção de logs de auditoria (D15):** prazo e anonimização.
- **[TBD] Autenticação para PWA (D12):** tokens vs cookies — Fase 14.
- **[NOTA] D16:** sem validação com utilizadores, recomenda-se manter o MVP o mais pequeno possível; registado.

---

*Fim da Fase 1 (v0.2). Fase 2 — Definição do MVP: pronta a iniciar mediante a tua aprovação.*
