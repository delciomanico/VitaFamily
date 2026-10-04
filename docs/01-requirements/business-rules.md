# Vita Family — Regras de Negócio (Fase 7)

> Estado: **v0.2 — B1–B6 decididas (delegadas)**
> Consolida as regras já decididas (D, M, N, R, P, Q) e acrescenta regras derivadas, assinaladas.
> Legenda: **[DECIDIDO]** com ID de origem · **[DERIVADO]** consequência lógica de decisões anteriores · **[PROPOSTO]** sugestão minha, requer aprovação · `[NEEDS DECISION]` ver secção 12.
> Cada regra tem ID `BR-<área>-nn` para ser referenciada em testes (Fase 15) e na API (Fase 13).

---

## 1. Identidade e conta (BR-ACC)

| ID | Regra | Estado |
|---|---|---|
| BR-ACC-01 | O e-mail é único por conta e tem de ser verificado antes de qualquer uso da conta. | DECIDIDO R1 |
| BR-ACC-02 | Um User autoregista-se apenas se tiver **18 anos ou mais**. Menores só têm conta criada por um tutor. | DECIDIDO M1, P2 |
| BR-ACC-03 | O consentimento (versão dos termos/política e data) é registado no registo e tem de ser repetido se a versão mudar (B6). | DECIDIDO B6 |
| BR-ACC-04 | Cada User tem um fuso horário; é a referência dos seus lembretes. | DECIDIDO M3 |
| BR-ACC-05 | Conta suspensa pelo Platform Admin não faz login nem recebe notificações; os dados não são alterados. | DERIVADO D4, R10 |
| BR-ACC-06 | Uma conta não pode ser eliminada enquanto o User for o único tutor de um dependente ou o único Admin de uma família com outros membros. | DECIDIDO P8, R2 |
| BR-ACC-07 | Eliminar uma conta apaga definitivamente os seus dados, documentos e o que é seu em cada família; logs de auditoria são anonimizados; backups expiram em ≤30 dias. | DECIDIDO D15, N6 |

## 2. Família e papéis (BR-FAM)

| ID | Regra | Estado |
|---|---|---|
| BR-FAM-01 | Quem cria uma família torna-se Family Admin. | DECIDIDO prompt §21 |
| BR-FAM-02 | Toda a família tem pelo menos um Family Admin, que é adulto com conta. | DECIDIDO FR-FAM-03, M1 |
| BR-FAM-03 | Um User pode pertencer a várias famílias; os dados nunca se misturam entre famílias. | DECIDIDO D2 |
| BR-FAM-04 | Só se elimina uma família quando o Admin é o único membro. | DECIDIDO R2 |
| BR-FAM-05 | O Admin único só sai depois de nomear outro adulto com conta como Admin. | DECIDIDO Q5 |
| BR-FAM-06 | O Family Admin gere a estrutura, não tem acesso privilegiado a dados de saúde. | DECIDIDO D13, P1 |
| BR-FAM-07 | Limites: 5 famílias por User; 20 membros por família; 20 convites pendentes por família; 10 clínicas privadas por família. | DECIDIDO B4 |

## 3. Membros, dependentes e tutela (BR-MEM)

| ID | Regra | Estado |
|---|---|---|
| BR-MEM-01 | Todo FamilyMember tem **data de nascimento** (não futura, e não anterior a 120 anos). | PROPOSTO |
| BR-MEM-02 | **Menor** = idade <18, calculada pela data de nascimento no fuso do titular. | DECIDIDO M1 |
| BR-MEM-03 | Todo menor é dependente e tem pelo menos um tutor. | DECIDIDO N1, M1 |
| BR-MEM-04 | Um adulto só é dependente com consentimento próprio (se tiver conta). Um perfil adulto sem conta só existe como dependente com tutor. | DECIDIDO N3, Q7 |
| BR-MEM-05 | O tutor é um adulto, FamilyMember da **mesma família**, com conta. | DECIDIDO N1 |
| BR-MEM-06 | Um dos tutores é o **tutor principal** (fuso dos alertas do dependente sem conta; contacto primário). Muda por decisão do Admin ou do tutor atual. | DECIDIDO Q8 + DERIVADO |
| BR-MEM-07 | Remover o último tutor de um dependente é proibido. | DECIDIDO P8 |
| BR-MEM-08 | O tutor gere todos os dados de saúde do dependente; o Admin só atribui/retira tutores, sem ver dados. | DECIDIDO M6, N1 |
| BR-MEM-09 | A conta de um dependente menor exige autorização expressa do tutor, e o dependente com conta tem acesso limitado: vê identificação, medicamentos e consultas e confirma tomas. Não edita dados clínicos, não sai da família, não exporta dados. | DECIDIDO P2, N2 |
| BR-MEM-10 | Aos 18 anos a tutela do menor termina: passa a titular dos próprios dados, o tutor perde o acesso, a partilha existente mantém-se até ele a alterar. | DECIDIDO P4 |
| BR-MEM-11 | Menor que faz 18 sem conta: dados bloqueados (sem acesso de ninguém), Admin avisado; se não houver conta em **90 dias**, os dados são apagados. | DECIDIDO Q7 |
| BR-MEM-12 | O convite expira em 7 dias, é de uso único e só pode ser aceite pelo e-mail convidado. | DECIDIDO R3 + DERIVADO |
| BR-MEM-13 | Ao aceitar um convite ligado a um perfil, os dados do perfil passam a ser do novo titular. | DERIVADO UC-MEM-03 |
| BR-MEM-14 | Adulto com conta que sai da família escolhe levar (pacote JSON + documentos) ou apagar os seus dados; em ambos os casos os dados deixam a família. | DECIDIDO R4, Q6 |
| BR-MEM-15 | Dependentes que ficam na família depois da saída de um membro mantêm-se sob a família até um tutor os apagar. | DECIDIDO R4 |

## 4. Privacidade e partilha (BR-PRV)

| ID | Regra | Estado |
|---|---|---|
| BR-PRV-01 | Os dados de saúde estão em 6 categorias (C1–C6). Por defeito partilha-se só C1 (nome, data de nascimento). | DECIDIDO P1 |
| BR-PRV-02 | O titular adulto decide a partilha por categoria; para dependentes decide o tutor. | DECIDIDO D13, P3 |
| BR-PRV-03 | A partilha dá só leitura. Não há delegação de escrita no MVP. | DECIDIDO P6 |
| BR-PRV-04 | Retirar a partilha tem efeito imediato em listas, relatórios e downloads. | DERIVADO |
| BR-PRV-05 | Documentos seguem a categoria do recurso associado. | DECIDIDO P1 |
| BR-PRV-06 | Alertas são enviados a quem é destinatário pela regra, independentemente da partilha; para dependentes: tutores e o próprio com conta. | DECIDIDO FR-ALR-08 |
| BR-PRV-07 | O Platform Admin nunca acede a dados de saúde. | DECIDIDO D4 |
| BR-PRV-08 | Alertas e notificações não revelam dados clínicos fora da app (texto genérico). | DECIDIDO N8 |
| BR-PRV-09 | O titular não consegue ver quem acedeu aos seus dados (no MVP). | DECIDIDO P7 |

## 5. Dados de saúde (BR-HLT)

| ID | Regra | Estado |
|---|---|---|
| BR-HLT-01 | O sistema guarda **apenas o estado atual**; quem alterou fica na auditoria. | DECIDIDO R6 |
| BR-HLT-02 | Todos os dados são introduzidos manualmente; o sistema não os valida clinicamente, não os interpreta e não gera diagnóstico. | DECIDIDO prompt §8, D11 |
| BR-HLT-03 | O sistema não sugere doses, interações nem intervalos de referência. | DERIVADO D8, D11 |
| BR-HLT-04 | Tipo sanguíneo: valores permitidos A/B/AB/O com Rh+/Rh- ou "desconhecido". | PROPOSTO |
| BR-HLT-05 | O texto livre é tratado como dado de saúde: nunca vai para logs técnicos nem notificações. | DERIVADO NFR-PRV-07 |

## 6. Receitas e medicação (BR-RX / BR-MED)

| ID | Regra | Estado |
|---|---|---|
| BR-RX-01 | Receita: data de emissão **obrigatória** (não futura); médico opcional; pelo menos 1 medicamento. | DECIDIDO R7 |
| BR-RX-02 | Registar os medicamentos de uma receita cria um plano de toma por medicamento, editável. | DECIDIDO M2 |
| BR-RX-03 | Medicamentos avulsos (sem receita) são permitidos. | DECIDIDO R7 |
| BR-RX-04 | Concluir ou cancelar uma receita termina os planos associados; o histórico de tomas mantém-se. | DERIVADO |
| BR-RX-05 | Editar um plano só afeta ocorrências **futuras**; o passado não é reescrito. | PROPOSTO |
| BR-RX-06 | Eliminar uma receita apaga também os planos, o histórico de tomas e os documentos associados. | DERIVADO D15 |
| BR-MED-01 | Cada plano usa horários fixos (com dias da semana opcionais) **ou** "de X em X horas" a partir de uma hora de início. | DECIDIDO Q1 |
| BR-MED-02 | O plano tem data de início e fim (por duração ou data), ou é marcado "uso contínuo" até ser terminado. | DECIDIDO B5 |
| BR-MED-03 | Uma ocorrência de toma é **pendente** até à ação; após **2 h** sem ação passa a **não confirmada**; confirmação tardia permitida até ao fim do dia seguinte. | DECIDIDO Q2 |
| BR-MED-04 | Estados da ocorrência: PENDENTE, CONFIRMADA, NÃO_TOMADA, NÃO_CONFIRMADA. Confirmar é idempotente. | DECIDIDO D7, Q2 + DERIVADO |
| BR-MED-05 | Quem confirma e quando fica registado. Confirmam: titular, tutor, dependente com conta. | DECIDIDO M4, D7 |
| BR-MED-06 | Não existe alerta ao Admin ou tutor por tomas não confirmadas no MVP. | DECIDIDO D7-B |
| BR-MED-07 | A adesão é só contagem de estados; sem interpretação. | DERIVADO |
| BR-MED-08 | Alterar o fuso do User recalcula as ocorrências futuras, sem duplicar nem perder doses. | DERIVADO NFR-AVL-05 |

## 7. Consultas e clínicas (BR-APT / BR-CLN)

| ID | Regra | Estado |
|---|---|---|
| BR-APT-01 | Estados: PEDIDA, AGENDADA, RECUSADA, REALIZADA, CANCELADA, FALTOU. PEDIDA/RECUSADA só existem em clínicas parceiras. Estados finais: ver Fase 10. | DECIDIDO D9, D17 |
| BR-APT-02 | Uma consulta passada sem atualização permanece AGENDADA; o sistema pede confirmação do desfecho e nunca assume. | DECIDIDO Q4 |
| BR-APT-03 | Lembretes: 24 h e 2 h antes (configurável por utilizador, R9). Editar/cancelar recalcula/remove lembretes futuros. | DECIDIDO R9 |
| BR-APT-04 | A clínica é uma clínica parceira, uma entrada privada, ou ausente. **Parceira:** a consulta só se marca num horário publicado e livre; nasce PEDIDA e só fica AGENDADA quando a clínica confirma. **Privada ou ausente:** registo direto, nasce AGENDADA. | DECIDIDO R8, D3, D17 |
| BR-APT-06 | Um horário (ClinicSlot) aceita **uma** marcação ativa (PEDIDA ou AGENDADA); fica livre de novo se for recusada ou cancelada. | DECIDIDO D17 |
| BR-APT-07 | Lembretes de consulta só existem para consultas AGENDADAS (não para pedidos). | DECIDIDO D17 |
| BR-APT-08 | Um pedido sem resposta até à hora do horário passa a CANCELADA pelo sistema (motivo: sem resposta da clínica). | PROPOSTO D17 |
| BR-APT-09 | Numa consulta de clínica parceira, mudar a data/hora é cancelar e pedir outro horário; só as observações são editáveis. | PROPOSTO D17 |
| BR-CLN-01 | Parceiras: criadas pelo Platform Admin, visíveis a todos. Privadas: criadas por membros adultos, visíveis só à família. | DECIDIDO R8 |
| BR-CLN-02 | Arquivar/apagar uma clínica não destrói consultas: mantêm o nome como texto. | PROPOSTO |
| BR-CLN-03 | ~~Nenhuma clínica tem login~~ (alterado por D17). Clínicas **privadas** não têm login. O Gestor da clínica **parceira** vê só as marcações na própria clínica com o mínimo necessário (nome do paciente, especialidade, profissional, data/hora, observações do pedido) e **nunca** dados de saúde da família. O utilizador é avisado disso antes de enviar o pedido. | DECIDIDO D3, D17 |
| BR-CLN-04 | O Gestor da clínica publica horários (especialidade, profissional opcional, início, duração) e só remove horários **livres**. | DECIDIDO D17 |

## 8. Exames e documentos (BR-EXM / BR-DOC)

| ID | Regra | Estado |
|---|---|---|
| BR-EXM-01 | Resultado = parâmetro, valor (numérico opcional + texto livre), unidade, intervalo de referência opcional **informado pelo utilizador**. | DECIDIDO D8, Q9 |
| BR-EXM-02 | O sistema nunca assinala valores fora do intervalo nem gera alertas por resultado. | DECIDIDO D11 |
| BR-EXM-03 | Exame futuro gera lembrete 24 h antes. | DECIDIDO R9 |
| BR-EXM-04 | Estados simples de exame: AGENDADO, REALIZADO, CANCELADO (Fase 10). | PROPOSTO |
| BR-DOC-01 | Tipos permitidos: PDF, JPG, PNG; tamanho ≤ 10 MB; tipo verificado pelo conteúdo. | DECIDIDO M5, N4 |
| BR-DOC-02 | Um documento só fica disponível depois de passar a análise antivírus; positivo → eliminado e auditado. | DECIDIDO N4 |
| BR-DOC-03 | Máximo 5 ficheiros por recurso e 100 MB por família. | DECIDIDO Q10 |
| BR-DOC-04 | O acesso a um documento exige permissão de ver a categoria do recurso; é sempre mediado e auditado. | DECIDIDO prompt §17, FR-DOC-03 |
| BR-DOC-05 | Eliminar um recurso elimina os seus documentos do armazenamento. | DECIDIDO D15 |

## 9. Alertas e notificações (BR-ALR)

| ID | Regra | Estado |
|---|---|---|
| BR-ALR-01 | Só alertas de agenda: toma, consulta, exame (D11-A). | DECIDIDO |
| BR-ALR-02 | Cadeia Evento → Regra → Alerta → Notificação; um alerta por evento e regra (idempotente). | DECIDIDO prompt §18, NFR-AVL-02 |
| BR-ALR-03 | Lembrete de toma no horário; repete uma vez 15 min depois se não confirmado. | DECIDIDO Q3 |
| BR-ALR-04 | O utilizador escolhe canais (push, e-mail) e tipos de alerta, incluindo desativar alertas de toma. | DECIDIDO R9, Q3 |
| BR-ALR-05 | Falha de um canal não impede o outro; tentativas limitadas e registadas. | DECIDIDO NFR-AVL-03 |
| BR-ALR-06 | Cada destinatário recebe no seu fuso; o plano segue o do titular, e o do tutor principal para dependente sem conta. | DECIDIDO Q8 |
| BR-ALR-07 | Nenhum alerta contém diagnóstico nem dados clínicos fora da app. | DECIDIDO prompt §8, N8 |

## 10. Relatórios (BR-RPT)

| ID | Regra | Estado |
|---|---|---|
| BR-RPT-01 | Só dados existentes e visíveis ao pedinte; secções sem permissão omitidas. | DECIDIDO D10, UC-RPT |
| BR-RPT-02 | Período por defeito 12 meses, máximo 5 anos; listas paginadas. | DECIDIDO Q11 |
| BR-RPT-03 | Relatórios não contêm interpretação clínica. | DECIDIDO prompt §19 |

## 11. Auditoria e retenção (BR-AUD)

| ID | Regra | Estado |
|---|---|---|
| BR-AUD-01 | São auditados pelo menos: login, visualização/download de documentos e exames, alterações a receitas, membros, tutela, partilha; eliminações; ações do Platform Admin. | DECIDIDO prompt §20 + DERIVADO |
| BR-AUD-02 | Ao apagar dados de um User, os logs são anonimizados. | DECIDIDO D15 |
| BR-AUD-03 | Os logs de auditoria são conservados **24 meses** e depois eliminados. | DECIDIDO Fase 14 (delegada) |
| BR-AUD-04 | A eliminação definitiva de dados remove-os da base de dados e do armazenamento de objetos; as cópias de segurança expiram em ≤30 dias. | DECIDIDO D15, N6 |

---

## 12. DECISÕES DESTA FASE (B1–B6) E REGRAS DERIVADAS

> **Delegadas pelo proprietário ao assistente em 2026-10-04** ("adota a recomendação" / "faz todas as fases restantes com a sua recomendação"). Adotada a recomendação em todas. Sujeitas a revisão por change control.

| ID | Decisão | Escolha |
|---|---|---|
| B1 | Aviso dos 18 anos (P4) | **30 dias e 7 dias antes + no dia**, ao jovem (se tiver conta) e aos tutores. |
| B2 | Avisos antes de apagar (90 dias, Q7) | Ao Admin nos dias **0, 30, 60 e 83**; dados bloqueados durante o período. |
| B3 | Idade mínima de conta de dependente menor | **13 anos**; abaixo disso o tutor opera sem o menor ter conta. |
| B4 | Limites | **5 famílias por User; 20 membros por família; 20 convites pendentes por família; 10 clínicas privadas por família.** |
| B5 | Plano sem fim | **Permitido** ("uso contínuo"), até ser terminado. |
| B6 | Reaceitação de termos | **Obrigatória** quando a versão muda; sem aceitar, a API só permite aceitar os termos, exportar dados e eliminar a conta. |

### Regras derivadas nas Fases 8–16 (a considerar parte desta especificação)
| ID | Regra |
|---|---|
| BR-MEM-16 | Quando o Admin remove um adulto com conta, o sistema gera para essa pessoa o pacote de dados (como "levar", BR-MEM-14), envia-lho por e-mail e só depois apaga os dados na família. Nada é perdido sem a pessoa ter hipótese de os obter. |
| BR-MEM-17 | Ao aceitar um convite ligado a um perfil existente, a data de nascimento do User tem de coincidir com a do perfil. Se for um convite de conta de dependente, a data de nascimento do User é a do perfil. |
| BR-PRV-10 | Nome e data de nascimento são visíveis a todos os membros da família (necessários à estrutura familiar) e **não** são partilha opcional. O tipo sanguíneo passa a pertencer à categoria **Alergias e tipo sanguíneo** (C2). Refina P1. |
| BR-APT-05 | As antecedências dos lembretes (24 h e 2 h) são **fixas** no MVP; o utilizador só escolhe canais e tipos (clarifica R9 e BR-APT-03). |
| BR-ALR-08 | O texto de notificações externas não inclui nome do membro nem hora; essa informação só existe dentro da app. |
| BR-DATA-01 | O identificador de cada recurso é um UUID; os dados de saúde de um **FamilyMember** pertencem a essa família e ao seu perfil; um User em duas famílias tem **dois perfis independentes**, sem partilha de registos entre famílias (ver ADR-005). |

---

*Fim da Fase 7 (v0.2). Regras de negócio fechadas. Próxima: Fase 8.*
