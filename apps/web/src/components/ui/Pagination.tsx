import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

interface PaginationProps {
  /** Página atual (a contar de 1). */
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  /** Opções de itens por página; sem isto o seletor não aparece. */
  pageSizeOptions?: number[]
  onPageSizeChange?: (size: number) => void
  className?: string
}

/** Páginas a mostrar: primeira, última e as vizinhas da atual, com reticências nos saltos. */
export function pageItems(page: number, pages: number): (number | 'gap')[] {
  const wanted = new Set([1, pages, page - 1, page, page + 1])
  const sorted = [...wanted].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)
  const items: (number | 'gap')[] = []
  sorted.forEach((n, index) => {
    const previous = sorted[index - 1]
    if (previous !== undefined && n - previous > 1) items.push('gap')
    items.push(n)
  })
  return items
}

const buttonClass =
  'flex size-11 items-center justify-center rounded-full border text-base font-medium transition-colors disabled:pointer-events-none disabled:opacity-40'

/** Paginação acessível: «A mostrar x–y de n», anterior/seguinte, números e itens por página. */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  pageSizeOptions,
  onPageSizeChange,
  className,
}: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(page, 1), pages)
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1
  const to = Math.min(current * pageSize, total)

  if (total <= (pageSizeOptions ? Math.min(...pageSizeOptions) : pageSize)) return null

  return (
    <div className={cn('flex flex-col items-center gap-4 md:flex-row md:justify-between', className)}>
      <div className="flex flex-wrap items-center gap-4">
        <p className="text-base text-muted" aria-live="polite">
          A mostrar {from}–{to} de {total}
        </p>
        {pageSizeOptions && onPageSizeChange && (
          <label className="flex items-center gap-2 text-base text-muted">
            Por página
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="h-11 rounded-full border border-border bg-surface px-4 text-base text-foreground"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {pages > 1 && (
        <nav aria-label="Paginação" className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Página anterior"
            disabled={current === 1}
            onClick={() => onPageChange(current - 1)}
            className={cn(buttonClass, 'border-border bg-surface hover:bg-surface-muted')}
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          {pageItems(current, pages).map((item, index) =>
            item === 'gap' ? (
              <span key={`gap-${index}`} aria-hidden className="px-1 text-muted">
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                aria-label={`Página ${item}`}
                aria-current={item === current ? 'page' : undefined}
                onClick={() => onPageChange(item)}
                className={cn(
                  buttonClass,
                  item === current
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-surface hover:bg-surface-muted',
                )}
              >
                {item}
              </button>
            ),
          )}
          <button
            type="button"
            aria-label="Página seguinte"
            disabled={current === pages}
            onClick={() => onPageChange(current + 1)}
            className={cn(buttonClass, 'border-border bg-surface hover:bg-surface-muted')}
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </nav>
      )}
    </div>
  )
}
