# Vita Family — Segurança (Fase 14)

> **ATUALIZAÇÃO 2026-10-04 (ADR-012, decisão do proprietário):** a implementação é em **Go** (pgx+sqlc+goose, river, chi+oapi-codegen), **sem Redis**, em **VPS própria** com Caddy, domínio `vitafamily.cassfrei.com`. Onde este documento diz NestJS, Prisma, Redis, BullMQ ou Jest, ler o equivalente Go de ADR-012; a arquitetura lógica mantém-se.

> Estado: **v0.1 — decisões adotadas com a recomendação do assistente.** Autenticação em `05-api/authentication.md`; autorização em `authorization.md`; privacidade em `privacy.md`; auditoria em `audit.md`.
> Princípio: a segurança existe **no backend**; nunca assumir que "se o frontend não mostra, o utilizador não acede" (prompt §16).

## 1. Modelo de ameaças (resumido, STRIDE por ativo)

| Ativo | Ameaça principal | Controlos |
|---|---|---|
| Dados de saúde de uma família | Acesso por outra família (IDOR, falha de isolamento) | `AccessPolicy` central; repositórios exigem `familyId`; FKs compostas; 404 sem enumeração; testes de isolamento obrigatórios em CI. |
| Dados de adulto dentro da família | Admin/membro vê o que não foi partilhado | Matriz por categoria; Admin sem privilégio; testes gerados da matriz. |
| Contas | Credential stuffing, força bruta, phishing | argon2id, rate limiting, verificação de e-mail, mensagens neutras, sessões revogáveis, deteção de reutilização de refresh. |
| Documentos | Malware, acesso direto, fuga | Validação por conteúdo, ClamAV, quarentena, download mediado e auditado, storage privado, nomes de objeto aleatórios. |
| Tokens | Roubo e reutilização | Access 15 min em memória; refresh HttpOnly rotativo; revogação da cadeia. |
| Notificações | Fuga de dados em ecrã de bloqueio/e-mail | Texto genérico (N8); sem nomes nem horas. |
| Auditoria | Adulteração ou fuga | Append-only (papel BD), sem dados de saúde no `metadata`, acesso só por operações. |
| Infraestrutura | Segredos expostos, portas abertas | Segredos fora do repo, rede privada, TLS, dependências verificadas. |
| Platform Admin | Abuso de privilégio | Sem endpoints de saúde (módulo `admin` sem imports de registos de saúde), todas as ações auditadas. |

## 2. Controlos por área (requisitos de prompt §16)

| Área | Especificação |
|---|---|
| **Autenticação / sessão / tokens / hashing / recuperação** | `05-api/authentication.md`. |
| **Autorização / RBAC / isolamento** | `authorization.md`; ADR-008. |
| **Proteção de endpoints** | Guarda global de autenticação (lista de rotas públicas explícita); validação de DTOs com *whitelist* (campos desconhecidos rejeitados); limites de corpo; rate limiting. |
| **Isolamento entre clínicas** | Fora do MVP (clínicas sem login/acesso, D3); `Clinic` não tem acesso a dados de família por nenhum caminho. |
| **Uploads** | Máx. 10 MB; só PDF/JPG/PNG por *magic bytes* (ignora extensão e `Content-Type` do cliente); nome original sanitizado e guardado só como metadado; chave de objeto UUID; antivírus antes de disponibilizar; imagem/PDF servidos com `Content-Disposition: attachment` e `X-Content-Type-Options: nosniff`; sem processamento server-side de conteúdo (sem miniaturas no MVP). |
| **Downloads** | Mediados pela API, autorizados por categoria do recurso, auditados, `Cache-Control: private, no-store`. |
| **Rate limiting** | `authentication.md` §3 + limites gerais. |
| **Segredos** | Variáveis de ambiente / gestor de segredos; rotação de chave JWT (`kid`); nenhuma credencial em logs ou imagens Docker. |
| **Transporte** | TLS 1.2+ (preferir 1.3), HSTS, redireccionar HTTP→HTTPS. |
| **Cabeçalhos** | `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, CORS restrito. |
| **Encriptação em repouso** | Disco/volume e armazenamento de objetos (SSE); backups encriptados. **Sem encriptação a nível de campo** no MVP (ADR-008 consequências; reavaliar após DPIA). |
| **Dependências** | `npm audit`/SCA em CI; atualizações regulares; imagens base mínimas e fixadas por *digest*. |
| **Logs** | Sem palavras-passe, tokens, texto livre de saúde nem corpos de pedidos; redação automática de campos sensíveis. |
| **Validação** | Todas as entradas validadas no backend (NFR-API-04): tipos, tamanhos, enums, datas plausíveis (nascimento ≤ hoje e ≥ 120 anos). |
| **SQL injection / XSS** | Consultas parametrizadas (Prisma; SQL manual só com parâmetros); a API não renderiza HTML; texto livre é dado, escapado pelo cliente. |
| **SSRF** | O backend não faz pedidos a URLs fornecidas por utilizadores (Web Push endpoints validados contra lista de domínios dos serviços push conhecidos). |
| **Enumeração** | Respostas neutras em registo/recuperação/reenvio; 404 para recursos de outras famílias. |
| **Enforcement por estado** | Conta suspensa e termos por aceitar verificados em todos os pedidos. |

## 3. Segurança do ciclo de desenvolvimento
- Revisão de código obrigatória; CI com testes, *lint*, SCA e verificação de *secrets* no repositório.
- Ambientes não produtivos só com dados sintéticos (NFR-OPS-04).
- Cada release: checklist de segurança (testes de isolamento e permissões verdes; sem endpoints novos fora do OpenAPI).

## 4. Resposta a incidentes (mínimo)
1. Deteção (alertas, auditoria, relatos).
2. Contenção (revogar sessões/chaves, suspender contas, isolar serviço).
3. Avaliação do impacto em dados pessoais.
4. **Notificação à autoridade de controlo (CNPD) em ≤72 h** se houver risco, e aos titulares se risco elevado (RGPD arts. 33–34).
5. Análise de causa e correção; registo do incidente.
Responsável designado: **TBD (operacional, antes do lançamento)**.

## 5. Evoluções de segurança recomendadas (fora do MVP)
MFA (TOTP) · RLS no PostgreSQL como defesa em profundidade · encriptação a nível de campo para texto livre sensível · teste de intrusão externo antes do lançamento público · bug bounty.
