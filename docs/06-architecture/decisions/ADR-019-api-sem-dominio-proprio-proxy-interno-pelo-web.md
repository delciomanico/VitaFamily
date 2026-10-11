# ADR-019 — API sem domínio próprio; `/api` é um proxy interno feito pelo `web`

**Estado:** Aceite — decisão **do proprietário** (2026-10-10). Refina a linha "Domínio" de ADR-017.

## Contexto
ADR-017 previa que o Traefik do Dokploy encaminhasse `/` para o contentor `web` e `/api` para o
contentor `api`, ambos como apps com domínio configurado no Dokploy (mesma origem, duas rotas
Traefik). Isso expõe o backend diretamente à internet, com uma segunda superfície atrás do proxy.

## Decisão
| Tema | Escolha |
|---|---|
| Exposição externa | **Só o contentor `web` tem domínio/app no Dokploy** (`vitafamily.cassfrei.com`, caminho `/`). O contentor `api` não tem domínio nem app configurado no Dokploy. |
| Caminho `/api` | O **nginx do `web`** (`apps/web/nginx.conf`) reencaminha `location /api/` para `http://api:8080/api/`, dentro da `dokploy-network`. Para o browser continua a ser a mesma origem (ADR-012/ADR-017); o backend nunca é alcançado diretamente de fora. |
| Descoberta de serviço | `deploy/docker-compose.api.prod.yml` define `container_name: api`, para que o nome resolva por DNS do Docker dentro da rede partilhada, independentemente do projeto Compose. |
| `/metrics` | Pela mesma razão, fica só acessível dentro da rede interna (contentor `api`, porta 8080), nunca através do nginx do `web` nem do Dokploy — é para scraping interno (Prometheus na VPS), não para o público. |

## Consequências
- Menor superfície de ataque: um único ponto exposto ao Traefik/internet (`web`); `api`, `postgres`, `minio`, `clamav` ficam todos só na rede interna.
- O nginx do `web` passa a ser responsável por limites de corpo e timeouts do proxy para `/api/` (além dos cabeçalhos de segurança que já enviava); ADR-017 §Consequências sobre limites de corpo mantém-se, agora também aplicado aqui.
- Se o contentor `api` cair, o nginx devolve 502 em `/api/` — sem impacto nos ficheiros estáticos da PWA.
- `docs/06-architecture/infrastructure.md` (linha do `proxy`) e `docs/06-architecture/decisions/ADR-017-deploy-com-dokploy.md` (linha "Domínio") são atualizados para referir este ADR.
