import { useRouteError } from 'react-router-dom'
import { ErrorFallback } from './ErrorBoundary'

/** `errorElement` das rotas: erros de renderização/loader em vez do ecrã de erro por omissão do router. */
export function RouteError() {
  const error = useRouteError()
  console.error('Route error', error)
  return <ErrorFallback variant="page" />
}
