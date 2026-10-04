# Vita Family — Requisitos Não Funcionais (Fase 4)

> Estado: **v0.2 — N4–N11 respondidas (secção 12)**
> Base: `scope.md` v0.2, `functional-requirements.md` v0.2, decisões D1–D16.
> Legenda: **[CONFIRMADO]** vem de uma decisão ou do prompt · **[PROPOSTO]** valor sugerido por mim, a validar · `[NEEDS DECISION]` depende da secção 12.
> **Nenhum número abaixo marcado [PROPOSTO] é compromisso até ser aprovado.** Não há dados de carga reais (D16: sem validação com utilizadores).
> Detalhes técnicos de segurança ficam na Fase 14; aqui só os requisitos mensuráveis.

---

## 1. Segurança (SEC)

| ID | Requisito | Estado |
|---|---|---|
| NFR-SEC-01 | Toda a autorização é aplicada no backend; nunca depender do frontend. | CONFIRMADO (prompt §16) |
| NFR-SEC-02 | Todo o tráfego usa TLS. | PROPOSTO |
| NFR-SEC-03 | Palavras-passe guardadas apenas com hash lento e salgado (algoritmo: Fase 14). | CONFIRMADO (prompt §16) |
| NFR-SEC-04 | Isolamento entre famílias garantido em cada pedido e verificado por testes automáticos. | CONFIRMADO |
| NFR-SEC-05 | Rate limiting nos endpoints de autenticação, recuperação de conta e convites. | CONFIRMADO (prompt §16); limites: Fase 14 |
| NFR-SEC-06 | Uploads validados por tipo real (não só extensão), tamanho (≤10 MB) e analisados antes de ficarem disponíveis (decidido em N4). | M5 + PROPOSTO |
| NFR-SEC-07 | Documentos nunca ficam publicamente acessíveis; o acesso é sempre mediado e autorizado. | CONFIRMADO (prompt §17) |
| NFR-SEC-08 | Segredos e credenciais fora do código e do repositório. | PROPOSTO |
| NFR-SEC-09 | Respostas de erro não revelam existência de recursos de outras famílias nem de contas (sem enumeração). | PROPOSTO |
| NFR-SEC-10 | O Platform Admin não consegue, por nenhum endpoint, aceder a dados de saúde. | D4 |

## 2. Privacidade e conformidade (PRV)

| ID | Requisito | Estado |
|---|---|---|
| NFR-PRV-01 | Cumprir o RGPD; dados de saúde tratados como categoria especial. | D5 |
| NFR-PRV-02 | Dados pessoais e de saúde armazenados na UE, incluindo documentos e cópias de segurança (decidido em N5). | D5 + PROPOSTO |
| NFR-PRV-03 | Registar o consentimento do utilizador (versão dos termos/política e data) no registo. | PROPOSTO |
| NFR-PRV-04 | Direito ao apagamento: eliminação definitiva de conta/dados/documentos a pedido, incluindo cópias de segurança dentro de um prazo (decidido em N6). | D15 |
| NFR-PRV-05 | Direito de acesso e portabilidade: o utilizador pode obter uma cópia dos seus dados. Forma e formato (decidido em N7). | RGPD (PROPOSTO) |
| NFR-PRV-06 | Minimização: só se recolhem os dados necessários às funcionalidades do MVP. | PROPOSTO |
| NFR-PRV-07 | Logs técnicos e de aplicação não contêm dados de saúde nem palavras-passe. | PROPOSTO |
| NFR-PRV-08 | O conteúdo de notificações (push/e-mail) não revela dados clínicos (ex.: nome do medicamento) (decidido em N8). | PROPOSTO |

> Aviso: esta lista é técnica, **não é parecer jurídico**. A conformidade RGPD precisa de validação por jurista/DPO antes de lançamento.

## 3. Auditoria (AUD)

| ID | Requisito | Estado |
|---|---|---|
| NFR-AUD-01 | Registos de auditoria só de acrescento (append-only) para a aplicação. | PROPOSTO |
| NFR-AUD-02 | Os registos incluem utilizador, ação, recurso, id, data/hora, IP, user-agent, resultado. | CONFIRMADO |
| NFR-AUD-03 | Retenção dos logs de auditoria: **24 meses**, depois eliminados (decidido na Fase 14). | DECIDIDO |

## 4. Desempenho (PERF)

| ID | Requisito | Estado |
|---|---|---|
| NFR-PERF-01 | 95 % dos pedidos de leitura da API respondem em ≤ 500 ms em condições normais. | PROPOSTO |
| NFR-PERF-02 | 95 % dos pedidos de escrita respondem em ≤ 1 s (excluindo uploads). | PROPOSTO |
| NFR-PERF-03 | Os lembretes são enviados com atraso ≤ 1 minuto do horário previsto. | PROPOSTO |
| NFR-PERF-04 | Todas as listas são paginadas. | PROPOSTO |
| NFR-PERF-05 | O MVP deve suportar a escala alvo definida em N9. | (decidido em N9) |

## 5. Disponibilidade e fiabilidade (AVL)

| ID | Requisito | Estado |
|---|---|---|
| NFR-AVL-01 | Objetivo de disponibilidade da API (decidido em N10). | PROPOSTO |
| NFR-AVL-02 | O envio de lembretes é fiável: falhas de entrega são repetidas e registadas; um lembrete não é enviado duas vezes para a mesma ocorrência (idempotência). | PROPOSTO |
| NFR-AVL-03 | A falha de um canal (push ou e-mail) não impede o outro. | PROPOSTO |
| NFR-AVL-04 | Cópias de segurança automáticas da base de dados e dos documentos, com restauro testado (decidido em N10). | PROPOSTO |
| NFR-AVL-05 | Comportamento no horário de verão/inverno: lembretes seguem o fuso do utilizador sem duplicar nem perder horários. | M3 + PROPOSTO |

## 6. Integridade de dados (DATA)

| ID | Requisito | Estado |
|---|---|---|
| NFR-DATA-01 | Alterações de múltiplos registos relacionados são transacionais. | PROPOSTO |
| NFR-DATA-02 | Documentos têm checksum guardado e verificado. | CONFIRMADO (prompt §17) |
| NFR-DATA-03 | Datas/horas guardadas em UTC; conversão para o fuso do utilizador na apresentação. | PROPOSTO |
| NFR-DATA-04 | Migrações da base de dados versionadas e reversíveis em desenvolvimento. | PROPOSTO |
| NFR-DATA-05 | Eliminação em cascata coerente: apagar um recurso apaga documentos associados no armazenamento. | D15 |

## 7. Observabilidade e operação (OPS)

| ID | Requisito | Estado |
|---|---|---|
| NFR-OPS-01 | Logs estruturados com identificador de pedido, sem dados sensíveis (NFR-PRV-07). | PROPOSTO |
| NFR-OPS-02 | Endpoint de saúde (health check) para a infraestrutura. | PROPOSTO |
| NFR-OPS-03 | Métricas básicas (taxa de erros, latência, fila de lembretes) e alertas técnicos à equipa. | PROPOSTO |
| NFR-OPS-04 | Ambientes separados: desenvolvimento, teste, produção; sem dados reais fora de produção. | PROPOSTO |
| NFR-OPS-05 | Configuração por variáveis de ambiente; aplicação em contentores Docker. | prompt §14 (proposta tecnológica a rever na Fase 11) |

## 8. Qualidade e testes (QA)

| ID | Requisito | Estado |
|---|---|---|
| NFR-QA-01 | Testes unitários, de integração e E2E conforme prompt §21; estratégia detalhada na Fase 15. | CONFIRMADO |
| NFR-QA-02 | Cada requisito funcional importante tem critérios de aceitação (Given/When/Then). | CONFIRMADO |
| NFR-QA-03 | Testes automáticos de isolamento entre famílias e de permissões são obrigatórios antes de cada release. | PROPOSTO |
| NFR-QA-04 | Integração contínua executa testes e verificação de tipos/lint em cada alteração. | PROPOSTO |

## 9. API (API)

| ID | Requisito | Estado |
|---|---|---|
| NFR-API-01 | API REST descrita por OpenAPI, fonte de verdade do contrato. | CONFIRMADO (prompt §13) |
| NFR-API-02 | Versionamento da API (esquema: Fase 13). | PROPOSTO |
| NFR-API-03 | Formato de erro único e consistente. | PROPOSTO |
| NFR-API-04 | Validação de todas as entradas no backend. | CONFIRMADO (prompt §16) |

## 10. Idioma, acessibilidade e compatibilidade (UX)

| ID | Requisito | Estado |
|---|---|---|
| NFR-UX-01 | Idioma do MVP: pt-PT (D5). Mensagens de erro e notificações vêm do backend em pt-PT; preparar para outros idiomas só se necessário (decidido em N11). | D5 + PROPOSTO |
| NFR-UX-02 | Acessibilidade do cliente: nível WCAG a definir (decidido em N11). Aplica-se ao frontend; o backend não impede (ex.: textos claros e códigos de erro estáveis). | PROPOSTO |
| NFR-UX-03 | O cliente é uma PWA; a API suporta Web Push (D12). | D12 |

## 11. Manutenção (MNT)

| ID | Requisito | Estado |
|---|---|---|
| NFR-MNT-01 | Arquitetura modular por responsabilidade de domínio (prompt §15). | CONFIRMADO |
| NFR-MNT-02 | Decisões arquiteturais registadas em ADR. | CONFIRMADO (prompt §22) |
| NFR-MNT-03 | Documentação e código mantidos coerentes (prompt §29). | CONFIRMADO |
| NFR-MNT-04 | Dependências atualizadas regularmente, com verificação de vulnerabilidades. | PROPOSTO |

---

## 12. DECISÕES DESTA FASE (respondidas em 2026-10-04)

| ID | Decisão | Escolha | Consequência registada |
|---|---|---|---|
| N4 | Verificação de uploads | **Validar tipo/tamanho + antivírus** | Ficheiro fica indisponível até passar a análise (NFR-SEC-06). Novo componente: serviço antivírus. |
| N5 | Localização dos dados | **Tudo na UE, incl. backups** | Hosting e armazenamento de objetos na UE (NFR-PRV-02). |
| N6 | Apagamento vs. backups | **≤ 30 dias** | Backups com rotação de 30 dias (NFR-PRV-04). |
| N7 | Portabilidade | **Endpoint de exportação JSON** | Utilizador exporta os seus dados; serve também o "levar dados" da R4. Passa a requisito funcional (**FR-PRIV-05**, a acrescentar). |
| N8 | Conteúdo das notificações | **Genérico** | Sem nomes de medicamentos nem dados clínicos em push/e-mail (NFR-PRV-08). |
| N9 | Escala alvo | **1 000 famílias / 5 000 utilizadores em 12 meses** | Sem arquitetura distribuída (NFR-PERF-05). |
| N10 | Disponibilidade | **99,5 %/mês; backups diários; RPO ≤ 24 h; RTO ≤ 8 h** | NFR-AVL-01/04. |
| N11 | Idioma e acessibilidade | **Só pt-PT; WCAG 2.1 AA** | Sem camada i18n no MVP (NFR-UX-01/02). |

### Notas derivadas
- Acrescentado **FR-PRIV-05** em `functional-requirements.md`: o utilizador pode exportar os seus dados em JSON.
- Os valores [PROPOSTO] de desempenho (NFR-PERF-01 a 03) ficam assumidos como aprovados por defeito até contestares; não foram perguntados individualmente.

---

*Fim da Fase 4 (v0.2). Requisitos não funcionais fechados. Próxima: Fase 5 — Atores e permissões.*
