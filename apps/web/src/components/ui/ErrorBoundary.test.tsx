import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error('resposta inesperada')
  return <p>tudo bem</p>
}

describe('ErrorBoundary', () => {
  it('mostra um aviso no lugar do bloco que falhou e mantém os irmãos', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <div>
        <p>vizinho</p>
        <ErrorBoundary>
          <Boom explode />
        </ErrorBoundary>
      </div>,
    )
    expect(screen.getByText('vizinho')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível mostrar este item.')
  })

  it('“Tentar novamente” volta a renderizar quando o problema desaparece', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let explode = true
    function Flaky() {
      return <Boom explode={explode} />
    }
    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    )
    explode = false
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(screen.getByText('tudo bem')).toBeInTheDocument()
  })

  it('variante de página oferece recarregar e voltar ao início', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary variant="page">
        <Boom explode />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('heading', { name: 'Algo correu mal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recarregar' })).toBeInTheDocument()
  })
})
