# ADR-017 — Deploy com Dokploy (proxy, domínio e TLS)

**Estado:** Aceite — decisão **do proprietário** (2026-10-05). Substitui a linha “Alojamento” de ADR-012 (Caddy).

## Contexto
ADR-012 previa Docker Compose na VPS com **Caddy** como proxy reverso. O proprietário usa **Dokploy** na VPS, que já
inclui proxy (Traefik), certificados Let's Encrypt, domínios e atribuição de portas.

## Decisão
| Tema | Escolha |
|---|---|
| Plataforma de deploy | **Dokploy** na VPS do proprietário (build a partir do repositório). |
| Proxy reverso e TLS | O **Traefik do Dokploy**: termina TLS (Let's Encrypt), redireciona HTTP→HTTPS. Sem Caddy. |
| Domínio | `vitafamily.cassfrei.com`, configurado no Dokploy. PWA (`apps/web`) no caminho `/`; API (`apps/api`) em `/api` quando existir (mesma origem, ADR-012 mantém-se). |
| Portas | **Nenhuma porta publicada no host** pelos ficheiros do repositório. Os contentores só declaram a porta interna (web: `8080`); o Dokploy liga o domínio a essa porta. |
| Ficheiros | `deploy/docker-compose.web.prod.yml` (frontend em produção). `deploy/docker-compose.web.yml` fica só para uso local (`make web-up`). |

## Consequências
- Cabeçalhos de segurança que o Caddy daria passam a ser responsabilidade de cada contentor (o nginx da PWA envia HSTS,
  `nosniff`, `X-Frame-Options`, `Referrer-Policy`) ou de *middlewares* do Traefik configurados no Dokploy.
- Limites de corpo (≤ 11 MB no upload, `deployment.md` §4) serão aplicados na API e/ou num *middleware* do Traefik quando a API existir.
- Postgres, MinIO e ClamAV continuam em rede interna, sem domínio nem portas públicas.
- O frontend publicado usa ainda **dados mock** em memória no navegador (sem backend) até à integração com a API.
