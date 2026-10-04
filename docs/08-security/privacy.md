# Vita Family — Privacidade e RGPD (Fase 14)

> Estado: **v0.1**. Documento **técnico-funcional**; **não é parecer jurídico**. Antes do lançamento é necessária validação por jurista/DPO e uma **AIPD/DPIA** (avaliação de impacto, RGPD art. 35) por tratar dados de saúde em grande escala, incluindo menores.

## 1. Papéis RGPD
- **Responsável pelo tratamento:** a entidade que opera o Vita Family (**Cassfrei**; dados legais completos — NIF, morada, contacto de privacidade — a fornecer pelo proprietário).
- **Subcontratantes (com DPA obrigatório):** alojamento/infraestrutura UE, armazenamento de objetos UE, fornecedor SMTP UE, backups. **Push:** serviços dos fabricantes de browsers (ver risco §6).
- **Titulares:** utilizadores, dependentes (menores e adultos), e terceiros mencionados em texto livre (médicos).

## 2. Inventário de dados

| Categoria | Dados | Sensível (art. 9)? | Finalidade | Base de licitude proposta |
|---|---|---|---|---|
| Conta | e-mail, nome, data de nascimento, fuso, hash da palavra-passe | Não | Prestar o serviço | Contrato (art. 6.º/1/b) |
| Estrutura familiar | nome, data de nascimento, papéis, tutela | Não (mas de menores) | Prestar o serviço | Contrato; tutor por conta do menor |
| Registos de saúde | alergias, condições, receitas, medicação, tomas, consultas, exames, resultados, documentos, tipo sanguíneo | **Sim** | Gestão da saúde familiar | **Consentimento explícito** (art. 9.º/2/a) |
| Alertas/notificações | alertas gerados, subscrições push | Indireto | Lembretes | Contrato/consentimento |
| Auditoria | ações, IP, user-agent | Não | Segurança e prestação de contas | Interesse legítimo (art. 6.º/1/f) |
| Técnicos | logs de aplicação (sem saúde) | Não | Operação e segurança | Interesse legítimo |

## 3. Princípios aplicados
| Princípio | Como |
|---|---|
| Minimização | Só campos do MVP; texto livre opcional; sem catálogos externos, sem localização, sem contactos. |
| Limitação da finalidade | Dados de saúde usados só para as funcionalidades aprovadas; sem *analytics* sobre saúde, sem publicidade, sem partilha com terceiros. |
| Exatidão | O utilizador edita e corrige; sem interpretação pelo sistema. |
| Limitação da conservação | Ver §5. |
| Integridade e confidencialidade | `security.md`. |
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
| Decisões automatizadas (art. 22) | **Não existem** (sem diagnóstico, sem perfilagem). |

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

## 6. Riscos e pontos em aberto
| Item | Estado |
|---|---|
| **Menores:** consentimento digital de 13 anos em Portugal; o tutor autoriza contas de menores (P2); dependentes <13 não têm conta. Validar redação legal e verificação do estatuto de tutor (o sistema **não** verifica a tutela legal: declara-se). | A validar juridicamente |
| **Transferências para fora da UE:** push passa por fabricantes de browsers (payload genérico, sem dados de saúde); e-mail e hosting na UE. | Risco aceite, registado |
| **Tutela e autonomia de adultos dependentes:** o adulto que se marca dependente mantém direitos próprios; documentar na política. | A validar |
| **AIPD** | Obrigatória antes do lançamento (M10) |
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
