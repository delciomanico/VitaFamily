/**
 * Detalhes gráficos do fundo: um sol laranja e anéis/pontos azuis nas bordas, atrás do conteúdo.
 * Só decoração (aria-hidden, sem eventos), formas nítidas e estáticas: sem gradientes, sem animação, sem custo.
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
    >
      {/* Sol a espreitar pelo canto inferior direito (acima da barra inferior), com um anel fino. */}
      <span className="absolute -right-10 bottom-14 size-24 rounded-full bg-sun/80" />
      <span className="absolute -right-16 bottom-6 size-40 rounded-full border-2 border-primary/25" />
      <span className="absolute right-28 bottom-24 size-2.5 rounded-full bg-primary/35" />
      {/* Anel branco no canto inferior esquerdo e dois pontos. */}
      <span className="absolute -bottom-20 -left-16 size-44 rounded-full border-2 border-primary/20" />
      <span className="absolute bottom-20 left-3 size-2.5 rounded-full bg-sun" />
      <span className="absolute bottom-28 left-8 size-2 rounded-full bg-primary/35" />
    </div>
  )
}
