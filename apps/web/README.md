# apps/web — Vita Family PWA

Frontend do MVP do **Vita Family**, uma plataforma para organizar, acompanhar e gerir a saúde individual e familiar.
É uma PWA (React) servida na raiz de `https://vitafamily.cassfrei.com`. A API real fica em `/api/v1` (backend Go,
`apps/api`).

Nesta versão **todos os dados são simulados** (`src/mocks/`). O contrato futuro é `docs/05-api/openapi.yaml`, e as
regras de negócio estão em `docs/`, que é a fonte da verdade do projeto.

Interface em português de Portugal.

## Stack

| Área | Escolha |
| --- | --- |
| UI | React 19, TypeScript (strict) |
| Build | Vite, vite-plugin-pwa (Workbox) |
| Rotas | React Router 7 (data router, páginas carregadas a pedido) |
| Estilos | Tailwind CSS 4, com tokens em `@theme` |
| Formulários | React Hook Form e Zod |
| Ícones | Lucide |
| Testes | Vitest, Testing Library e jsdom |

O estado da app vive em Context e hooks (`AuthContext`, `useAsync`); não há Redux.

## Instalação

Requisitos: Node 22 ou superior e npm.

```bash
cd apps/web
npm install
```

## Desenvolvimento

```bash
npm run dev          # http://localhost:5173, com recarregamento automático
npm test             # testes (Vitest)
npm run typecheck    # TypeScript sem gerar ficheiros
```

O service worker só é gerado no build: em `npm run dev` a app funciona, mas sem a parte offline nem a instalação.

## Build

```bash
npm run build        # verifica os tipos e gera dist/ (com manifest, service worker e ícones)
```

## Preview

```bash
npm run preview      # serve dist/ em http://localhost:4173, como em produção
```

Use o preview para testar a PWA: instalação, offline e atualização do service worker.

### Docker (só o frontend)

Na raiz do repositório:

```bash
make web-up      # build da imagem (corre os testes) + nginx em http://localhost:8088
make web-logs
make web-down
```

Para outra porta: `WEB_PORT=9000 make web-up`.

A imagem (`Dockerfile`, `nginx.conf`) serve a PWA estática com fallback de SPA. O `index.html` e o service worker não
ficam em cache; os ficheiros de `assets/` têm cache longa.

Não precisa dos serviços do backend: `deploy/docker-compose.web.yml` é independente de `docker-compose.dev.yml`.

## Estrutura

```
src/
├── main.tsx          arranque: service worker, pedido de instalação, App
├── app/              App e providers (Toast, Auth, Router)
├── routes/           paths.ts (todas as URLs), router.tsx, guards.tsx (sessão, família, clínica)
├── pages/            páginas por área
│   ├── public/         splash, onboarding, login, registo, recuperação, verificação
│   ├── setup/          criar ou entrar numa família, perfil inicial, membros
│   ├── home/ health/ prescriptions/ medications/ examinations/ appointments/
│   ├── family/ alerts/ reports/ settings/
│   └── clinic/         portal da clínica parceira (D17)
├── components/
│   ├── ui/             peças genéricas: Button, Input, Select, Card, Tabs, Modal, Switch, Toast, estados…
│   ├── layout/         Page (faixa e conteúdo), AppShell, Sidebar, NavDrawer, AuthScreen, ClinicShell
│   └── domain/         peças do domínio: listas, cartões de alerta, formulários de saúde, relatórios…
├── contexts/         AuthContext (utilizador, família e membro da sessão)
├── hooks/            useAsync (carregar, erro, recarregar), useFitCount
├── services/         a única porta da UI para os dados (*.service.ts)
├── mocks/            backend simulado (ver “Mock data”)
├── types/            tipos do domínio, alinhados com docs/04-domain e o OpenAPI
├── lib/              regras e utilitários sem React (datas, formatos, erros, etiquetas, instalação…)
└── styles/index.css  design tokens (@theme) e estilos base
```

O fluxo dos dados é sempre `UI → hooks/contexts → services → mocks/handlers → mocks/db`.

Os componentes não leem os mocks diretamente. A única exceção é `components/domain/DemoHint.tsx`, que mostra as
credenciais da demonstração e sai com a API real.

### Design system

Os tokens (cores, tipografia, raios, sombras e espaçamentos) estão em `src/styles/index.css`, no bloco `@theme`. Os
componentes usam só as classes geradas a partir deles (`bg-surface`, `text-muted`, `rounded-lg`, `shadow-card`…).

As cores cumprem o contraste WCAG AA. O foco do teclado é sempre visível; sobre a faixa de cor, o contorno passa a
branco.

O layout é pensado primeiro para o telemóvel e testado de 375 a 1440 px:
- **Telemóvel e tablet:** cada página tem uma faixa com voltar, título e menu (`NavDrawer`).
- **Desktop (≥ 1024 px, `lg`):** há uma sidebar fixa.

## PWA

| Peça | Onde |
| --- | --- |
| Manifest (nome, cores, ícones, `standalone`, `pt-PT`) | `vite.config.ts` → `VitePWA({ manifest })` |
| Service worker (Workbox, `autoUpdate`) | gerado no build; registado em `src/main.tsx` |
| Ícones | `public/`, gerados a partir de `public/favicon.svg` com `npx pwa-assets-generator` |
| Metas mobile (viewport com `viewport-fit=cover`, `theme-color`, iOS) | `index.html` |
| Instalar a partir da app | `src/lib/install.ts` e Configurações → “Instalar aplicação” |

### Offline

O service worker guarda a *app shell*: HTML, JS, CSS, fontes latinas e imagens. As navegações caem em `index.html`,
para que qualquer rota abra sem rede.

Os pedidos a `/api/` nunca são guardados em cache, porque são dados de saúde. Sem rede, a API real falha e as páginas
mostram o estado de erro, com “Tentar novamente”.

### Atualizações

Quando há um build novo, o service worker atualiza-se sozinho (`registerType: 'autoUpdate'`). A versão nova é usada
na próxima abertura da app.

### Instalação

| Plataforma | Como instalar |
| --- | --- |
| Android, Chrome ou Edge no desktop | Pelo botão do navegador, ou em Configurações → “Instalar aplicação”, que usa `beforeinstallprompt`. |
| iOS e iPadOS | Safari → Partilhar → “Adicionar ao ecrã principal”. A app mostra estes passos nas Configurações. |

A linha “Instalar aplicação” não aparece se a app já estiver instalada ou se o navegador não permitir instalar.

## Mock data

`src/mocks/` simula o backend:

| Ficheiro | Papel |
| --- | --- |
| `data/*.ts` | dados iniciais da Família Monarca, todos fictícios, com datas relativas a hoje para a demo parecer sempre atual |
| `db.ts` | “base de dados” em memória; `resetDb(now)` repõe o estado inicial (usado nos testes) |
| `handlers/*.ts` | um handler por endpoint: valida, aplica as regras e as permissões, e devolve erros com `AppError(code)` |
| `respond.ts` | simula a rede: latência (450 ms, 0 nos testes) e cópia profunda da resposta |
| `access.ts` | visibilidade por tutela e por partilha de categoria (FR-PRV) |
| `alertRules.ts` | scanner de alertas: eventos → regras → alertas, idempotente |
| `bookings.ts` | pedidos às clínicas parceiras, com respostas e expiração |

Os dados vivem em memória e voltam ao estado inicial quando a página é recarregada. No navegador guarda-se só:
- **`sessionStorage`:** o id do utilizador mock, que termina ao fechar o separador;
- **`localStorage`:** a flag “onboarding visto”.

Não se guardam tokens, palavras-passe nem dados de saúde.

### Contas da demonstração

| O quê | Valor |
| --- | --- |
| Família Monarca (tutor e administrador) | `demo@vitafamily.app` · `password` |
| Portal da Clínica Horizonte (D17) | `clinica@vitafamily.app` · `password` |
| Código de verificação, após o registo | `123456` |
| Código de convite, para entrar numa família | `MONARCA26` |

No ecrã de login, os botões “Família” e “Clínica” preenchem estas contas.

A família tem:
- **Monarca:** tutor e administrador.
- **Maria, João e Pedro:** dependentes, sem conta.
- **Ana:** adulta com conta própria, que partilha só algumas categorias, para mostrar as permissões.

## Como substituir mocks por API

Os serviços são a fronteira. Hoje cada método aponta para o handler mock com o mesmo nome:

```ts
// src/services/alert.service.ts
import * as api from '@/mocks/handlers/alerts'

export const alertService = {
  listAlerts: api.listAlerts,
  markAlertRead: api.markAlertRead,
  // …
}
```

Para ligar à API real:

1. **Criar o cliente HTTP** (ex.: `src/lib/http.ts`), um `fetch` para `/api/v1` que:
   - envia `Authorization: Bearer <accessToken>`, com o access token guardado **só em memória** (security.md);
   - em `401 TOKEN_EXPIRED`, chama `POST /auth/refresh` uma vez e repete o pedido. O refresh token é um cookie
     HttpOnly que o navegador envia sozinho;
   - converte as respostas `application/problem+json` em `AppError(code)`, com o `code` de
     `docs/05-api/errors.md`. As mensagens para o utilizador já existem em `src/lib/errors.ts`;
   - com uma falha de rede, lança um erro que as páginas mostram como “Não foi possível carregar os dados”.
2. **Trocar o corpo dos serviços, um a um**, mantendo a assinatura:

   ```ts
   export const alertService = {
     listAlerts: () => http.get<AlertItem[]>('/alerts'),
     // …
   }
   ```

   Os handlers mock recebem o `familyId` e o `userId` explicitamente. Com a API, o utilizador vem do token e os
   caminhos seguem o OpenAPI: os alertas, por exemplo, são sempre os do utilizador e não levam a família. Os argumentos
   que deixam de ser precisos saem da assinatura, e o TypeScript aponta as chamadas a ajustar na UI.
3. **Autenticação:** `AuthContext` passa a guardar o access token em memória e deixa de usar `sessionStore`. Ao
   recarregar, a sessão é recuperada com `/auth/refresh`.
4. **Ficheiros:** o upload e o download de documentos passam pelos endpoints mediados (UC-DOC). Hoje os mocks guardam
   só metadados.
5. **Remover os mocks:** apagar `src/mocks/` e `DemoHint.tsx`. Os testes de handlers (`mocks/handlers/*.test.ts`)
   documentam as regras que o backend tem de cumprir.

As permissões continuam a ser decididas no servidor. A UI só esconde o que o servidor não devolve.

## Fora desta versão

Estes pontos estão nos documentos mas não nos ecrãs do MVP, ou dependem do backend:
- sair da família, eliminar a família, transferir o papel de administrador, convidar adultos e gerir tutores;
- recalcular as tomas quando se muda o fuso horário (BR-MED-08);
- notificações push e e-mail reais (as preferências já são guardadas);
- textos de Ajuda, Termos e Política de privacidade (os documentos só fixam a versão dos termos).

## Testes

Correr `npm test`. Os testes cobrem:
- **Regras dos handlers:** permissões, alertas, marcações, relatórios e configurações.
- **Fluxos de rotas:** login, guards e Home.
- **Componentes base.**

As datas são fixadas com `resetDb(NOW)`.
