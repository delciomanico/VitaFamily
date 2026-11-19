import type { ReactNode } from 'react'
import { Stars } from '@/components/consultations/Stars'
import { formatMonth } from '@/lib/consultations'
import { formatShortDate } from '@/lib/format'
import { offerMethodLabel } from '@/lib/professional'
import type { PublicReview } from '@/types/consultations'

/** Avaliação anónima: nota, comentário (ou aviso de moderação), mês, especialidade, método e resposta (BR-MKT-59/63). */
export function ReviewCard({ review, children }: { review: PublicReview; children?: ReactNode }) {
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Stars rating={review.rating} />
        <span className="text-xs text-muted">Avaliada em {formatShortDate(review.createdOn)}</span>
      </div>
      {review.commentHidden ? (
        <p className="text-sm italic text-muted">Comentário ocultado pela moderação.</p>
      ) : (
        review.comment && <p className="text-sm whitespace-pre-line">{review.comment}</p>
      )}
      <p className="text-xs text-muted">
        {review.specialty.name} · {offerMethodLabel[review.method]} · consulta em {formatMonth(review.consultedMonth)}
      </p>
      {review.reply && (
        <div className="rounded-md bg-surface-muted px-3 py-2 text-sm">
          <p className="font-medium">Resposta do profissional</p>
          <p className="whitespace-pre-line">{review.reply.text}</p>
        </div>
      )}
      {children}
    </li>
  )
}
