# Vita Family — Privacidade e RGPD (Fase 14)

> Estado: **v0.1**. Documento **técnico-funcional**; **não é parecer jurídico**. Antes do lançamento é necessária validação por jurista/DPO e uma **AIPD/DPIA** (avaliação de impacto, RGPD art. 35) por tratar dados de saúde em grande escala, incluindo menores.

## 1. Papéis RGPD
- **Responsável pelo tratamento:** a entidade que opera o Vita Family (**Cassfrei**; dados legais completos — NIF, morada, contacto de privacidade — a fornecer pelo proprietário).
- **Subcontratantes (com DPA obrigatório):** alojamento/infraestrutura UE, armazenamento de objetos UE, fornecedor SMTP UE, backups. **Push:** serviços dos fabricantes de browsers (ver risco §6). **Fornecedor de IA do "Resumo com IA"** (Anthropic ou OpenAI, a decidir; ADR-022) — subcontratante de **dados de saúde** (categoria especial, art. 9.º), não UE por omissão; só pode ficar ativo em produção com DPA assinado e depois de a AIPD cobrir este tratamento (gate de lançamento, §6).
- **Titulares:** utilizadores, dependentes (menores e adultos), e terceiros mencionados em texto livre (médicos).

## 2. Inventário de dados

| Categoria | Dados | Sensível (art. 9)? | Finalidade | Base de licitude proposta |
|---|---|---|---|---|
| Conta | e-mail, nome, data de nascimento, fuso, hash da palavra-passe | Não | Prestar o serviço | Contrato (art. 6.º/1/b) |
| Estrutura familiar | nome, data de nascimento, papéis, tutela | Não (mas de menores) | Prestar o serviço | Contrato; tutor por conta do menor |
| Registos de saúde | alergias, condições, receitas, medicação, tomas, consultas, exames, resultados, documentos, tipo sanguíneo | **Sim** | Gestão da saúde familiar | **Consentimento explícito** (art. 9.º/2/a) |
| Séries estruturadas enviadas ao fornecedor de IA ("Resumo com IA", ADR-022) | Valores/unidades/datas de um parâmetro de exame; estatística de adesão por período; referência interna pseudonimizada do membro — **nunca** documentos, imagens, texto livre nem o nome | **Sim** | Contextualizar tendências nos dados já existentes (sem diagnóstico) | **Consentimento explícito e específico**, distinto do consentimento geral de registos de saúde — opt-in por SELF/tutor, desligado por omissão (art. 9.º/2/a) |
| Resultados, PDF e recomendações emitidos pela clínica (BR-CLN-08/09, ADR-023) | Dados de saúde de categoria `EXAMS`/`APPOINTMENTS` escritos por um terceiro (conta de clínica, sem `User`). A clínica **só escreve** e vê o que ela própria escreveu/carregou (nunca descarrega PDF nem lê o resto do perfil); o paciente lê/descarrega com download mediado e auditado; texto e valores nunca vão para logs, e-mails ou notificações (BR-HLT-05). Apagam-se com o exame/consulta/membro (D15). A AIPD (M10) deve cobrir este fluxo. | Sim | Entregar ao paciente resultados e notas da clínica parceira | Consentimento explícito/execução do serviço pedido pelo titular (a confirmar na AIPD) |
| Registo de pacientes da clínica e consentimento (BR-CLN-17..24, ADR-026, M14 P) | `ClinicPatient` (nome, telefone, e-mail, data de nascimento, notas internas): dados **da clínica**, que é **responsável pelo tratamento**; a Vita (Cassfrei) é **subcontratante/canal** (DPA, gate de lançamento). Dados Vita só chegam por **consentimento** por clínica, 2 níveis (Marcações; Partilhar histórico = medicação e exames, 12 meses renovável), revogável a qualquer momento pelo titular/tutor; a leitura é auditada sem conteúdo. Código de ligação: HMAC, uso único, 10 min. Ao apagar o membro/conta/família apagam-se consentimentos, ligações e códigos, e o registo da clínica fica **desligado e sem ids Vita** (retenção da clínica: OP-32). Cópias que a clínica fez do que viu são dela (aviso ao consentir). A AIPD (M10) deve cobrir este tratamento. | Sim (medicação/exames partilhados) | Prestar o serviço à clínica; partilha opcional | **Consentimento explícito do titular/tutor** por clínica e nível; a clínica é responsável pelo seu registo |
| Confirmação, chegada e retorno (BR-CLN-25..30, ADR-026, M14 Q) | `confirmationStatus` (sim/não/sem resposta), `arrivedAt`/`startedAt` (instantes do atendimento) e `followUpDueOn` (data de retorno, sem motivo clínico) nas marcações da clínica; indicadores **agregados** sem PII (BR-CLN-29). Os alertas (`APPOINTMENT_CONFIRM_REQUEST`, `FOLLOWUP_REMINDER`) têm texto genérico, sem nome nem hora (BR-ALR-08). "Não posso" é decisão do paciente e não leva motivo. A visita manual é dado da clínica (responsável pelo tratamento). Apagar o membro apaga a confirmação e o retorno com a consulta (D15); cobrir na AIPD (M10). | Não (administrativo; sem dados de saúde) | Reduzir faltas e organizar o dia | Execução do serviço de agendamento / interesse legítimo da clínica (a confirmar na AIPD) |
| Recibos, perfil e equipa da clínica (BR-CLN-31..40, ADR-026, M14 R) | Recibo interno não fiscal: nome do paciente (retrato), serviço/descrição das linhas, valores, método de pagamento e data — **registo financeiro da clínica** (responsável pelo tratamento; a Vita é subcontratante/canal). Não contém diagnóstico nem resultados; as descrições de linha são nomes de serviço escolhidos pela clínica (podem revelar a especialidade). Chega ao paciente Vita só com consentimento na emissão (BR-CLN-35) e fica na clínica ao apagar o membro (BR-CLN-24); a seguradora só vê o resumo dos recibos que o titular **escolher anexar** (BR-CLN-36, opt-in por item). Retenção: a da clínica (obrigação contabilística/mínimo legal, OP-32); anulado ≠ apagado. Perfil da clínica: texto institucional, sem dados de pacientes. Papel `CLINIC_DOCTOR`: acesso restrito por profissional (minimização, BR-CLN-39). Auditoria da clínica: só ações de funcionários, sem PII, vista só do `CLINIC_ADMIN` (BR-CLN-40; sem IP nem e-mails); a regra P7 (titular não vê acessos) mantém-se. Cobrir na AIPD e no DPA (M10). | Parcial (financeiro; pode inferir especialidade) | Comprovativo de pagamento e de reembolso; gestão financeira da clínica | Obrigação legal/contabilística da clínica; execução do serviço; consentimento do titular para a cópia na app e o anexo ao reembolso (a confirmar na AIPD) |
| Relatório da consulta e laudo gerado (BR-CLN-41..50, ADR-027, M15) | **Relatório:** quatro secções de texto livre da clínica (motivo, achados, diagnóstico/impressão, conduta) + adendas, com retrato do nome do paciente (data de nascimento só se o `ClinicPatient` a tem) e do profissional; **dado de saúde produzido pela clínica**, que é **responsável pelo tratamento** (a Vita/Cassfrei é subcontratante: DPA, gate de lançamento). É registo da clínica: **sobrevive ao apagamento do membro** (sem ids Vita) e a retenção é a da clínica (OP-32/**OP-46**, a validar juridicamente — tensão assumida com D15). Chega ao paciente Vita (titular/tutor) **sem consentimento prévio** (fluxo clínica → paciente, como receita e resultados; BR-CLN-45), com **opção da clínica de não partilhar** por relatório; nunca a `DEPENDENT_SELF`/`OTHER`; o PDF é gerado a pedido e não fica guardado. Texto nunca em logs, auditoria, e-mails nem alertas (BR-HLT-05). **Laudo:** PDF gerado pelo servidor a partir dos resultados que a clínica registou, guardado como `Document` do exame (apaga-se com o exame/membro, D15); **sem quarentena/antivírus** por ser produzido pelo servidor (exceção a ADR-006); o realce "Fora da referência" é comparação aritmética, **não** interpretação nem decisão automatizada (art. 22.º não se aplica). Rascunhos de resultados: dado de saúde pré-emissão, invisível ao paciente. A AIPD (M10) e o DPA têm de cobrir relatórios e laudos. | **Sim** | Documentar a consulta e o exame; entregar ao paciente | Prestação de cuidados de saúde / obrigação de registo clínico da clínica (art. 9.º/2/h, a confirmar na AIPD); para a cópia na app, execução do serviço pedido pelo titular |
| Pedido de exame e declaração de presença (BR-CLN-51..56, ADR-028, M15 U/V) | **Pedido:** nome do exame (≤80), nota (≤200) e rótulo "urgente", com retrato do nome do paciente (data de nascimento só se o `ClinicPatient` a tem) e do profissional; **dado de saúde produzido pela clínica** (responsável pelo tratamento; a Vita/Cassfrei é subcontratante: DPA, AIPD M10 a cobrir). É **registo da clínica**: sobrevive ao apagamento do membro (sem ids Vita; a ponte `clinic_exam_order_links` apaga-se) e a retenção é a da clínica (OP-32/**OP-46**). Chega ao paciente Vita (titular/tutor) **sem consentimento** (fluxo clínica → paciente); nunca a `DEPENDENT_SELF`/`OTHER`. **Minimização entre clínicas:** a clínica que pediu só vê o exame marcado/cumprido se for ela a fazê-lo (`booked_here`); a clínica de destino nunca conhece o pedido. O alerta ao paciente é genérico, sem o nome do exame (BR-ALR-07/08). Texto nunca em logs, auditoria nem alertas (BR-HLT-05). **Declaração de presença:** não guarda nada; o PDF só leva nome, data/hora, clínica e (opcional) profissional — **sem especialidade nem diagnóstico** — para poder ser entregue a terceiros (ex.: empregador); cada emissão é auditada sem PII. | **Sim**, como o relatório (DPA/AIPD; OP-46) |
| Alertas/notificações | alertas gerados, subscrições push | Indireto | Lembretes | Contrato/consentimento |
| Auditoria | ações, IP, user-agent | Não | Segurança e prestação de contas | Interesse legítimo (art. 6.º/1/f) |
| Técnicos | logs de aplicação (sem saúde) | Não | Operação e segurança | Interesse legítimo |

## 3. Princípios aplicados
| Princípio | Como |
|---|---|
| Minimização | Só campos do MVP; texto livre opcional; sem catálogos externos, sem localização, sem contactos. "Resumo com IA" (ADR-022): só a série estruturada necessária à tendência pedida sai para o fornecedor externo — nunca documentos/imagens, texto livre ou nome do membro. |
| Limitação da finalidade | Dados de saúde usados só para as funcionalidades aprovadas; sem *analytics* sobre saúde, sem publicidade, sem partilha com terceiros. |
| Exatidão | O utilizador edita e corrige; sem interpretação pelo sistema. |
| Limitação da conservação | Ver §5. |
| Integridade e confidencialidade | `security.md`. |
| Finalidade vedada: seguros (ADR-025) | **Os dados do app** (adesão à medicação, consultas, exames, registos de saúde, relatórios, alertas e qualquer outro tratamento do app) **nunca** alimentam subscrição, preço de prémio nem decisão de cobertura, autorização ou reembolso da seguradora; não são lidos nem agregados para esses fins, e a seguradora só vê dados **seus** (`Beneficiary`, `Policy`) e o que a clínica submete, nunca o perfil de saúde. A única ponte é a ligação consentida e revogável do cartão (BR-SEG-20), que não transporta dados de saúde. Verificado por teste (TC-SEG-08). |
| Privacy by design/default | Privado por defeito (só nome e data de nascimento visíveis à família, BR-PRV-01/10); texto genérico em notificações; Platform Admin sem acesso a saúde. |

## 4. Direitos dos titulares → funcionalidade

| Direito | Implementação |
|---|---|
| Informação (arts. 13–14) | Política de privacidade e termos versionados; aceitação registada (versão+data); reaceitação em mudança (B6). |
| Acesso e portabilidade (arts. 15, 20) | Exportação JSON + documentos (FR-PRIV-05, N7, Q6); tutor pelo dependente. |
| Retificação (art. 16) | Edição de todos os registos. |
| Apagamento (art. 17) | Hard delete de conta/família/membro/recurso; backups ≤30 dias; auditoria anonimizada (D15, N6). |
| Limitação e oposição (arts. 18, 21) | Preferências de notificação; partilha por categoria; pedido de limitação via suporte `[processo operacional TBD]`. |
| Retirada do consentimento (art. 7.º/3) | Eliminar conta/dados; retirar partilha. |
| Decisões automatizadas (art. 22) | **Não existem** (sem diagnóstico, sem perfilagem). O "Resumo com IA" (ADR-022) não decide nem aconselha — descreve tendências nos dados; não é decisão automatizada na aceção do art. 22.º. |
| Consentimento específico para o "Resumo com IA" (ADR-022) | Opt-in explícito, desligado por omissão, por SELF (adulto) ou tutor pelo dependente; texto nomeia o fornecedor externo e informa que os dados saem da Vita Family; revogável em qualquer momento (retirada do consentimento, art. 7.º/3, §4 abaixo). Vive nas definições de privacidade do utilizador (implementação futura) — distinto do `SharingGrant` por categoria (D13/R5). |

## 5. Retenção

| Dados | Prazo |
|---|---|
| Conta e dados de saúde | Enquanto a conta existir; apagados a pedido. |
| Perfil de maior de 18 sem conta (BR-MEM-11) | Bloqueado até 90 dias; depois apagado. |
| Sessões e tokens | Expirados limpos diariamente. |
| Convites | Expirados limpos após 30 dias. |
| Exportações | Ficheiro apagado ao fim de 7 dias. |
| Auditoria | **24 meses**, depois eliminada; anonimizada se o titular pedir apagamento. |
| Backups | Rotação de 30 dias. |
| Dados de conta eliminada | Nenhuns, exceto auditoria anonimizada. |
| Relatório da consulta da clínica (ADR-027) | Retenção **da clínica** (não apaga com o membro, BR-CLN-50); prazo a fixar com OP-32/OP-46 antes do lançamento. O laudo e os rascunhos de resultados seguem o exame (D15). |
| Pedido de exame da clínica (ADR-028) | Retenção **da clínica** (não apaga com o membro, BR-CLN-56); prazo a fixar com OP-32/OP-46. A ponte e o estado Vita seguem o membro (D15). A declaração de presença não se guarda. |

## 6. Riscos e pontos em aberto
| Item | Estado |
|---|---|
| **Menores:** consentimento digital de 13 anos em Portugal; o tutor autoriza contas de menores (P2); dependentes <13 não têm conta. Validar redação legal e verificação do estatuto de tutor (o sistema **não** verifica a tutela legal: declara-se). | A validar juridicamente |
| **Transferências para fora da UE:** push passa por fabricantes de browsers (payload genérico, sem dados de saúde); e-mail e hosting na UE. | Risco aceite, registado |
| **Tutela e autonomia de adultos dependentes:** o adulto que se marca dependente mantém direitos próprios; documentar na política. | A validar |
| **AIPD** | Obrigatória antes do lançamento (M10). **Gate adicional (ADR-022):** o "Resumo com IA" não pode ficar ativo em produção para utilizadores reais antes de a AIPD cobrir explicitamente este tratamento (novo subcontratante de dados de saúde) **e** de existir DPA assinado com o fornecedor de IA escolhido — condição específica desta funcionalidade, além da AIPD geral do MVP. |
| **DPO:** avaliar obrigatoriedade (art. 37.º: tratamento em grande escala de dados de saúde) | TBD (jurídico) |
| **Registo de atividades de tratamento (art. 30.º)** | A produzir antes do lançamento |
| **Notificação de violações** | `security.md` §4 |

## 7. Requisitos técnicos derivados (checklist)
- [ ] Registo de consentimento e versão dos termos (FR/BR-ACC-03).
- [ ] Exportação completa e testada (JSON + documentos).
- [ ] Hard delete testado (BD, objetos, backups ≤30 dias, auditoria anonimizada).
- [ ] Logs sem dados de saúde (teste automático com padrões de dados falsos).
- [ ] Ambientes não produtivos sem dados reais.
- [ ] Textos legais (termos, privacidade, informação sobre push) fornecidos pelo proprietário/jurista.
