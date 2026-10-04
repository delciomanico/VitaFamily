# apps/web — Vita Family PWA

Frontend MVP do Vita Family (React + PWA), servido na raiz de `https://vitafamily.cassfrei.com`.
Nesta fase todos os dados são mock; o contrato futuro é `docs/05-api/openapi.yaml` (API em `/api/v1`).

> README completo (mocks, substituição por API) na fase 13.

## Stack

React 19 · TypeScript (strict) · Vite · React Router · Tailwind CSS 4 · vite-plugin-pwa · Lucide · React Hook Form + Zod · Vitest.

## Comandos

```bash
npm install
npm run dev        # desenvolvimento
npm run build      # typecheck + build de produção (gera o service worker)
npm run preview    # serve o build (testar PWA/instalação)
npm test           # testes
npx pwa-assets-generator   # regenera os ícones a partir de public/favicon.svg
```

## Docker (só o frontend)

Na raiz do repositório:

```bash
make web-up      # build (corre os testes) + nginx em http://localhost:8088
make web-logs
make web-down
```

Outra porta: `WEB_PORT=9000 make web-up`. A imagem (`Dockerfile`, `nginx.conf`) serve a PWA estática com fallback
de SPA, sem cache para `index.html`/service worker e cache longa para `assets/`. Não precisa dos serviços do backend
(`deploy/docker-compose.web.yml` é independente de `docker-compose.dev.yml`).

## Estrutura

```
src/
├── app/            App e providers
├── routes/         paths.ts (todas as URLs) e router
├── components/
│   ├── ui/         Button, Input, Select, Textarea, Card, Badge, Avatar, Tabs, Modal, ConfirmDialog, Toast, estados
│   ├── layout/     AppShell, Sidebar, BottomNavigation, Header, PageHeader, PublicLayout, Logo
│   └── domain/     cartões de domínio (a partir da fase 4)
├── pages/          telas por área
├── services/ mocks/ types/ hooks/ contexts/   (a partir da fase 2)
├── lib/            utilitários
└── styles/         index.css — design tokens (@theme)
```

## Modo demonstração

Os dados vivem em memória (`src/mocks/`) e voltam ao estado inicial ao recarregar a página.

| O quê | Valor |
| --- | --- |
| Login (família) | `demo@vitafamily.app` · `password` |
| Login (portal da Clínica Horizonte, D17) | `clinica@vitafamily.app` · `password` |
| Código de verificação (após registo) | `123456` |
| Código de convite (entrar numa família) | `MONARCA26` |

Fluxo de dados: `UI → hooks/contexts → services → mocks/handlers (backend simulado) → mocks/db`.
Só `components/domain/DemoHint.tsx` lê dados mock diretamente (a remover com a API real).

## Design system

Os tokens (cores, tipografia, raios, sombras, espaçamentos de layout) estão em `src/styles/index.css`, no bloco `@theme`.
Os componentes usam apenas as classes geradas a partir deles (`bg-surface`, `text-muted`, `rounded-lg`, `shadow-card`…).
Breakpoints: padrões do Tailwind — mobile < 768, `md` tablet, `lg` (≥ 1024) desktop com sidebar.
