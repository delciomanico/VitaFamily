# Vita Family — Erros da API (Fase 13)

> Estado: **v0.1**. Formato único `application/problem+json` (RFC 9457), com `code` estável (os clientes dependem do `code`, não da mensagem).

```json
{
  "type": "https://vitafamily.cassfrei.com/problems/FORBIDDEN",
  "title": "Sem permissão",
  "status": 403,
  "code": "FORBIDDEN",
  "detail": "Mensagem curta em pt-PT, sem dados de saúde.",
  "requestId": "01J...",
  "errors": [{ "field": "email", "message": "inválido" }]
}
```

## Regras

1. A mensagem `detail` está em **pt-PT**, é curta e **nunca** contém dados de saúde, nomes de membros nem a existência de recursos de outras famílias (NFR-SEC-09, NFR-PRV-07).
2. `404` é devolvido para recursos de outra família **e** inexistentes. `403` só quando o recurso existe na família a que o utilizador pertence.
3. `errors[]` só aparece em `VALIDATION_ERROR`.
4. `5xx` devolvem `INTERNAL_ERROR` genérico; o detalhe fica nos logs com o `requestId`.
5. `Retry-After` presente em `RATE_LIMITED`.

## Catálogo

| Código | HTTP | Significado |
|---|---|---|
| `MALFORMED_REQUEST` | 400 | Pedido malformado (JSON inválido, parâmetro inválido). |
| `AUTH_INVALID_CREDENTIALS` | 401 | E-mail ou palavra-passe incorretos (mensagem genérica). |
| `TOKEN_EXPIRED` | 401 | Access token expirado; usar /auth/refresh. |
| `UNAUTHENTICATED` | 401 | Sem sessão válida. |
| `ACCOUNT_SUSPENDED` | 403 | Conta suspensa pelo Platform Admin. |
| `EMAIL_NOT_VERIFIED` | 403 | E-mail ainda não verificado. |
| `FORBIDDEN` | 403 | Sem permissão para a ação (no contexto de uma família a que se pertence e que existe). |
| `INVITATION_EMAIL_MISMATCH` | 403 | O e-mail da conta não coincide com o do convite. |
| `TERMS_REACCEPTANCE_REQUIRED` | 403 | Nova versão dos termos por aceitar (B6). |
| `INVITATION_INVALID` | 404 | Convite inexistente, revogado ou já usado. |
| `NOT_FOUND` | 404 | Recurso inexistente **ou** de outra família (sem enumeração). |
| `ACCOUNT_DELETION_BLOCKED` | 409 | Conta é único tutor ou único Admin com outros membros (P8, R2). |
| `CONFLICT` | 409 | Conflito com o estado atual do recurso. |
| `DOCUMENT_LIMIT_EXCEEDED` | 409 | Máximo de 5 ficheiros por recurso (Q10). |
| `DOCUMENT_NOT_AVAILABLE` | 409 | Documento ainda em verificação antivírus. |
| `DOSE_IN_FUTURE` | 409 | Toma futura não pode ser confirmada ainda (ST3). |
| `DOSE_WINDOW_EXPIRED` | 409 | Fora da janela de confirmação/correção da toma (Q2, ST2). |
| `EXPORT_NOT_READY` | 409 | Exportação ainda não está pronta. |
| `FAMILY_NOT_EMPTY` | 409 | Só se elimina a família quando resta um único membro (R2). |
| `INVALID_STATE_TRANSITION` | 409 | Transição de estado não permitida. |
| `PROFESSIONAL_LOCKED` | 409 | Escrita não permitida no estado de validação atual do profissional (BR-MKT-23; MK1). |
| `CONVERSATION_CLOSED` | 409 | Não se pode escrever na conversa: está fechada ou o profissional já não está `APPROVED` (BR-MKT-43/47; MK2). |
| `SLOT_UNAVAILABLE` | 409 | O horário já está ocupado (ou deixou de estar livre) no momento de marcar (BR-MKT-53; MK3). |
| `SELF_BOOKING_NOT_ALLOWED` | 409 | O utilizador é a mesma pessoa que o profissional (mesmo e-mail): não pode marcar nem avaliar consigo próprio (BR-MKT-62; MK3). |
| `REVIEW_NOT_ALLOWED` | 409 | A avaliação não é permitida: marcação não concluída, falta, pagamento por satisfazer, fora dos 30 dias ou edição depois de 7 dias (BR-MKT-59; MK3). |
| `LAST_ADMIN` | 409 | Operação deixaria a família sem Family Admin. |
| `LAST_GUARDIAN` | 409 | Operação deixaria um dependente sem tutor. |
| `LIMIT_EXCEEDED` | 409 | Limite atingido (famílias, membros, convites, clínicas privadas) (B4). |
| `STORAGE_QUOTA_EXCEEDED` | 409 | Quota de 100 MB por família excedida (Q10). |
| `INVITATION_EXPIRED` | 410 | Convite expirado. |
| `FILE_TOO_LARGE` | 413 | Ficheiro acima de 10 MB. |
| `FILE_TYPE_NOT_ALLOWED` | 415 | Tipo de ficheiro não permitido (só PDF, JPG, PNG). |
| `AGE_REQUIREMENT_NOT_MET` | 422 | Registo autónomo exige 18 anos ou mais (BR-ACC-02). |
| `BIRTHDATE_MISMATCH` | 422 | Data de nascimento não coincide com a do perfil convidado (BR-MEM-17). |
| `DEPENDENT_ACCOUNT_AGE` | 422 | Conta de dependente menor exige 13 anos ou mais (B3). |
| `DEPENDENT_REQUIRES_GUARDIAN` | 422 | Dependente exige pelo menos um tutor e um principal. |
| `GUARDIAN_INVALID` | 422 | Tutor tem de ser adulto, com conta e da mesma família. |
| `INVALID_SCHEDULE` | 422 | Frequência/horários/duração do plano inválidos. |
| `MINOR_MUST_BE_DEPENDENT` | 422 | Menor de 18 anos tem de ser dependente. |
| `PASSWORD_WEAK` | 422 | Palavra-passe fora da política (mín. 12 caracteres, não comum). |
| `VALIDATION_ERROR` | 422 | Campos inválidos; lista `errors[]` por campo. |
| `MEMBER_BLOCKED` | 423 | Perfil bloqueado à espera de conta (BR-MEM-11). |
| `RATE_LIMITED` | 429 | Demasiados pedidos; ver cabeçalho `Retry-After`. |
| `INTERNAL_ERROR` | 500 | Erro inesperado (genérico). |
| `SERVICE_UNAVAILABLE` | 503 | Dependência indisponível (readiness falhou). |

## Processos (ADR-032)
Sem códigos novos. Reutilizam-se `NOT_FOUND` (processo inexistente, de outro membro/família, de categoria não legível pelo actor, de outra clínica ou sem clínica — **sempre 404, sem enumeração**, BR-PRC-05/06), `FORBIDDEN` (só no portal da clínica: `CLINIC_DOCTOR`), `MEMBER_BLOCKED` (423, membro bloqueado), `MALFORMED_REQUEST` (400: query inválida — `status`/`originType`/`limit` fora do contrato ou `cursor` inválido; convenção da plataforma para parâmetros, não `VALIDATION_ERROR`). Não há erros de escrita: não existem endpoints de escrita. `detail` nunca nomeia o ato nem a categoria negada.

## Arquivo do marco B (R6, ADR-037)
Nenhum código do catálogo era exclusivo da seguradora (todos os fluxos de seguradora reutilizavam códigos genéricos), pelo que **não se remove nenhum código**. `POST .../documents` com `resourceType=INSURANCE_POLICY` (valor retirado do contrato) devolve `422 VALIDATION_ERROR`. As secções de erros por fatia do marco B (seguradora, autorizações, vista da família) estão em `docs/_arquivo/marco-b/` e na tag `archive-marco-b-2026-11-16`.

## Mercado de profissionais — MK1 (ADR-037)
**Um código novo:** `PROFESSIONAL_LOCKED` (409): o profissional tenta alterar identidade/credenciais fora de `DRAFT`/`NEEDS_INFO`, ou qualquer escrita em `REJECTED`/`SUSPENDED` (matriz em `authorization.md` §10.2); `detail` genérico, sem revelar o motivo da decisão do admin (esse vai em `statusReason` do perfil). Reutilizam-se: `EMAIL_NOT_VERIFIED` (403, login com e-mail por verificar, só depois da palavra-passe certa), `AUTH_INVALID_CREDENTIALS`, `PASSWORD_WEAK`, `INVALID_STATE_TRANSITION` (submissão/decisão em estado errado ou já mudado), `VALIDATION_ERROR` com `errors[]` por requisito em falta (submissão, `APPROVE`/`REACTIVATE`), `CONFLICT` (nome de especialidade duplicado, oferta ativa duplicada, regra de horário sobreposta, `category` em uso, retirar especialidade com ofertas), `LIMIT_EXCEEDED` (5 especialidades, 10 credenciais, 20 ofertas ativas, 20 regras), `DOCUMENT_NOT_AVAILABLE` (credencial `PENDING`/`INFECTED`), `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, `RATE_LIMITED`. **`NOT_FOUND` sem enumeração:** recurso de outro profissional, inexistente ou (para famílias, via leitor `ProfessionalDirectory`) profissional que não está `APPROVED`. Um profissional `SUSPENDED`/`REJECTED` **não** recebe `ACCOUNT_SUSPENDED`: entra em só leitura (OP-59).

## Mercado de profissionais — MK2: descoberta, comparação e conversas (ADR-037)
**Um código novo:** `CONVERSATION_CLOSED` (409): enviar/continuar numa conversa fechada, ou cujo profissional já não está `APPROVED` (suspensão, caducidade, rejeição), ou reabrir uma conversa que o outro lado (ou o sistema) fechou; `detail` genérico, sem revelar quem fechou nem porquê. **No lado do profissional** a mesma situação por estado de validação é `PROFESSIONAL_LOCKED` (BR-MKT-47). Reutilizam-se, sem alterar o significado: `NOT_FOUND` (perfil de profissional não `APPROVED` ou inexistente; comparação com um id inválido — **o pedido inteiro**, sem revelar qual; conversa/mensagem/denúncia de outra família, de outro profissional ou inexistente), `FORBIDDEN` (só no lado da família: `DEPENDENT_SELF`/`OTHER` a abrir ou usar uma conversa; `User` não admin em `/admin/message-reports*`), `VALIDATION_ERROR` (`errors[]`: texto fora de 1–1000 ou com caracteres de controlo, `participantLabel` fora de 1–40, `min > max`, `sort=RANKING` sem `specialtyId`, comparação com 1 ou > 3 ids/repetidos/sem oferta na especialidade, denúncia da própria mensagem, `upToSeq` fora de 0..`lastSeq`), `MALFORMED_REQUEST` (parâmetro de consulta fora do contrato ou `cursor` inválido), `LIMIT_EXCEEDED` (≥ 20 conversas abertas no membro; 4.ª mensagem seguida da família sem resposta), `RATE_LIMITED` (mensagens por hora/dia, conversas novas por dia, denúncias por dia, pesquisa por minuto; com `Retry-After`; falha fechada), `INVALID_STATE_TRANSITION` (fechar fechada, reabrir aberta ou por quem não fechou, decidir denúncia já decidida), `MEMBER_BLOCKED` (423, escrever em nome de um membro bloqueado), `UNAUTHENTICATED` (rotas `/marketplace/*` e `/families/*` com token de profissional/clínica, ou `/professional-portal/*` com token de `User`). **Regra de privacidade:** `detail`, `errors[]` e `requestId` nunca contêm texto de mensagens, `participantLabel`, `q`, cidade nem nomes (BR-MKT-46); os *logs* de erro não incluem corpo nem *query string* destas rotas.

## Mercado de profissionais — MK3: marcação, comprovativo e avaliações (ADR-037)
**Três códigos novos (todos `409`):** `SLOT_UNAVAILABLE` (perder a corrida pelo horário ou escolher um que já não está livre; `detail` genérico, sem revelar quem o ocupou), `SELF_BOOKING_NOT_ALLOWED` (mesma pessoa que o profissional; `detail` genérico, sem e-mail) e `REVIEW_NOT_ALLOWED` (`detail` genérico: «Esta consulta não pode ser avaliada neste momento.»; não distingue a causa para não revelar o estado do pagamento do outro lado). Reutilizam-se, sem alterar o significado: `NOT_FOUND` (marcação/comprovativo/avaliação alheios, profissional ou oferta não `APPROVED`/inexistentes, horário inexistente — sem enumeração), `FORBIDDEN` (`DEPENDENT_SELF`/`OTHER`), `MEMBER_BLOCKED`, `VALIDATION_ERROR` (antecedência, horário que não é da oferta, `meetingInfo` em falta em vídeo/telefone, motivo em falta, comentário > 500), `CONFLICT` (sobreposição das marcações do membro, bloqueio sobre horários marcados, avaliação já respondida), `LIMIT_EXCEEDED` (10 ativas, 5 comprovativos), `INVALID_STATE_TRANSITION` (transição inválida, decisão concorrente, hora ainda não chegada para concluir), `PROFESSIONAL_LOCKED` (escrita do profissional não `APPROVED`), `DOCUMENT_NOT_AVAILABLE` (comprovativo em antivírus, infetado ou já apagado pela retenção), `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, `RATE_LIMITED`.
