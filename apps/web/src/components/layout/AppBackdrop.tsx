/**
 * Detalhes gráficos do fundo azul sólido: um sol laranja e anéis/pontos brancos nas bordas, atrás do conteúdo.
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
      <span className="absolute -right-8 bottom-32 size-24 rounded-full bg-sun" />
      <span className="absolute -right-16 bottom-24 size-40 rounded-full border-2 border-white/40" />
      <span className="absolute right-24 bottom-44 size-2.5 rounded-full bg-white" />
      {/* Anel branco no canto inferior esquerdo e dois pontos. */}
      <span className="absolute -bottom-12 -left-14 size-44 rounded-full border-2 border-white/35" />
      <span className="absolute bottom-36 left-5 size-2.5 rounded-full bg-sun" />
      <span className="absolute bottom-24 left-12 size-2 rounded-full bg-white" />
    </div>
  )
}
