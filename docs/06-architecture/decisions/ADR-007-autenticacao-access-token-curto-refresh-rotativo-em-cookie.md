# ADR-007 — Autenticação: access token curto + refresh rotativo em cookie

**Estado:** Aceite (delegação do proprietário, 2026-10-04)

## Contexto
Cliente é uma PWA (D12); dados de saúde exigem sessões revogáveis e proteção contra roubo de tokens.

## Decisão
**Access token JWT** (15 min, em memória do cliente) + **refresh token opaco** rotativo (30 dias) em cookie `HttpOnly; Secure; SameSite=Strict`, guardado hasheado na BD, com deteção de reutilização (revoga a cadeia). Palavras-passe com **argon2id**.

## Alternativas
Sessões só com cookie; JWT longo em localStorage; OAuth externo apenas.

## Justificação
Tokens curtos reduzem a janela de abuso; o refresh em cookie HttpOnly não é legível por JavaScript; a rotação com deteção de reutilização limita roubo. O estado de conta (suspensa) e os termos são verificados por pedido (cache ≤60 s).

## Consequências
Há estado de sessão na BD. CORS restrito e proteção CSRF no endpoint de refresh (cabeçalho custom + SameSite).
