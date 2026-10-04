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
