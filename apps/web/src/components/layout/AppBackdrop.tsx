/**
 * Fundo da app: liso e branco (sem formas decorativas, para as linhas planas assentarem como no WhatsApp).
 * `column` desenha a coluna central no portal do profissional.
 */
export function AppBackdrop({ column = false }: { column?: boolean }) {
  return (
    <div
      aria-hidden
      className={
        column
          ? 'pointer-events-none fixed inset-y-0 left-1/2 z-0 w-full max-w-[34rem] -translate-x-1/2 overflow-hidden bg-background sm:shadow-overlay'
          : 'pointer-events-none fixed inset-0 z-0 overflow-hidden'
      }
    />
  )
}
