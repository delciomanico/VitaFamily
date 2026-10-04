import { Lock } from 'lucide-react'
import { firstName } from '@/lib/date'
import { sharingCategoryLabels } from '@/lib/labels'
import type { SharingCategory } from '@/types/sharing'

/**
 * Secção sem permissão (BR-PRV-01): só se diz que existe uma categoria não partilhada,
 * nunca se há dados nela.
 */
export function Locked({ category, ownerName }: { category: SharingCategory; ownerName: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-border-strong px-4 py-3">
      <Lock className="size-4 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium">Sem permissão para ver</p>
        <p className="text-sm text-muted">
          {firstName(ownerName)} não partilha “{sharingCategoryLabels[category]}” consigo.
        </p>
      </div>
    </div>
  )
}
