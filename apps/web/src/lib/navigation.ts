/**
 * O router (`createBrowserRouter`) grava `{ idx, ... }` em `history.state` a cada navegação.
 * `idx > 0` significa que há uma entrada anterior criada pela própria SPA — só nesse caso é
 * seguro "voltar" de verdade; senão a origem foi um link direto/recarregar e há de usar o
 * destino de recurso (`backTo`).
 */
export function canNavigateBack(): boolean {
  const idx = (window.history.state as { idx?: number } | null)?.idx
  return typeof idx === 'number' && idx > 0
}
