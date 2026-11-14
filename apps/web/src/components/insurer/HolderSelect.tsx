import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { useAsync } from '@/hooks/useAsync'
import { insurerOpsService } from '@/services/insurerOps.service'

interface HolderSelectProps {
  value: string
  onChange: (id: string) => void
}

/**
 * Titular (`relationship=HOLDER`) escolhido por pesquisa no servidor (`q`: nome ou nº de cartão), em vez de
 * carregar uma página grande e filtrar no cliente. O titular já escolhido mantém-se na lista ao pesquisar.
 */
export function HolderSelect({ value, onChange }: HolderSelectProps) {
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [chosen, setChosen] = useState<SelectOption | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250)
    return () => clearTimeout(timer)
  }, [text])

  const { state } = useAsync(
    () => insurerOpsService.listBeneficiaries({ relationship: 'HOLDER', limit: 20, ...(q ? { q } : {}) }),
    [q],
  )
  const found: SelectOption[] =
    state.status === 'success' ? state.data.items.map((b) => ({ value: b.id, label: `${b.name} · ${b.cardNumber}` })) : []
  const options = chosen && !found.some((o) => o.value === chosen.value) ? [chosen, ...found] : found

  return (
    <div className="flex flex-col gap-2">
      <Input label="Procurar titular" hint="Nome ou número de cartão" value={text} onChange={(e) => setText(e.target.value)} />
      <Select
        label="Titular"
        value={value}
        placeholder={state.status === 'loading' ? 'A procurar…' : found.length === 0 && q ? 'Nenhum titular encontrado' : 'Escolher titular'}
        options={options}
        onChange={(e) => {
          onChange(e.target.value)
          setChosen(options.find((o) => o.value === e.target.value) ?? null)
        }}
      />
    </div>
  )
}
