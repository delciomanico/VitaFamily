import { AlertTriangle, ShieldAlert, Stethoscope } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { paths } from '@/routes/paths'
import type { AiResult } from '@/types/ai'

/**
 * Resultado de uma análise (BR-AI-05/08): o AVISO é permanente e não dispensável, no mesmo ecrã de cada resposta; sinais de alarme e respostas
 * bloqueadas mostram só mensagens fixas (nunca texto do modelo). A especialidade sugerida abre a pesquisa do mercado pré-filtrada, sem dados.
 */
export function AiAnswerView({ result, disclaimer }: { result: AiResult; disclaimer: string }) {
  if (result.kind === 'ALARM') {
    return (
      <section role="alert" className="flex flex-col gap-3 rounded-2xl bg-danger-soft p-4 text-danger">
        <p className="flex items-center gap-2 text-lg font-bold">
          <ShieldAlert className="size-6 shrink-0" aria-hidden /> Procure ajuda agora
        </p>
        <p className="text-base">{result.message}</p>
      </section>
    )
  }
  if (result.kind === 'BLOCKED' || result.kind === 'ERROR') {
    return (
      <section role={result.kind === 'ERROR' ? 'alert' : 'status'} className="flex flex-col gap-2 border-b border-border pb-4">
        <p className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="size-5 shrink-0 text-muted" aria-hidden /> {result.kind === 'BLOCKED' ? 'Sem resposta' : 'Não foi possível'}
        </p>
        <p className="text-base text-muted">{result.message}</p>
      </section>
    )
  }
  const { answer } = result
  return (
    <section aria-label="Resposta do assistente" className="flex flex-col gap-4">
      <p className="text-base leading-relaxed">{answer.summary}</p>
      {answer.observations.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">O que se vê</h3>
          <ul className="flex list-disc flex-col gap-1.5 ps-5 text-base">
            {answer.observations.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </div>
      )}
      {answer.generalGuidance.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">Informação geral</h3>
          <ul className="flex list-disc flex-col gap-1.5 ps-5 text-base">
            {answer.generalGuidance.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      )}
      {answer.suggestedSpecialty && (
        <div className="flex flex-col gap-3 rounded-2xl bg-primary-soft p-4">
          <p className="flex items-center gap-2 text-base">
            <Stethoscope className="size-5 shrink-0 text-primary" aria-hidden />
            <span>
              Isto pode justificar uma consulta de <strong>{answer.suggestedSpecialty.name}</strong>.
            </span>
          </p>
          <ButtonLink to={`${paths.marketplace}?especialidade=${answer.suggestedSpecialty.id}`} size="lg" fullWidth>
            Ver profissionais
          </ButtonLink>
        </div>
      )}
      <p role="note" className="border-t border-border pt-3 text-sm text-muted">
        {disclaimer}
      </p>
    </section>
  )
}
