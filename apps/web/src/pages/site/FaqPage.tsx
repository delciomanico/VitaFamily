import { ChevronDown } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { usePageTitle } from '@/hooks/usePageTitle'
import { paths } from '@/routes/paths'

const faqs: { q: string; a: string }[] = [
  {
    q: 'O Vita Family faz diagnósticos ou substitui o médico?',
    a: 'Não. Ajuda a organizar e a lembrar a saúde da família. Não diagnostica, não recomenda tratamentos e não substitui uma consulta.',
  },
  {
    q: 'Quem pode ver a informação de saúde de um membro?',
    a: 'Por defeito, só o próprio e os seus tutores. A família só vê o nome e a data de nascimento; o resto depende da partilha por categoria que o titular escolher.',
  },
  {
    q: 'A minha clínica tem acesso aos meus dados?',
    a: 'Só se ligar a clínica e der consentimento, por clínica e em dois níveis (marcações; partilha de histórico). Dura 12 meses, é renovável e pode ser revogado a qualquer momento.',
  },
  {
    q: 'A seguradora vê o meu perfil de saúde?',
    a: 'Não. A seguradora vê apenas os dados da sua apólice e os documentos que escolher anexar a um pedido de reembolso. Os dados da app não são usados para preço, subscrição ou decisões de cobertura.',
  },
  {
    q: 'Como se criam as contas de clínicas e seguradoras?',
    a: 'São criadas pela equipa Vita Family depois de validar a entidade. Peça acesso na página própria e entraremos em contacto.',
  },
  {
    q: 'Posso apagar a minha conta e os meus dados?',
    a: 'Sim. Pode exportar os dados e eliminar a conta, a família ou um membro, nas definições da app.',
  },
  {
    q: 'Funciona no telemóvel?',
    a: 'Sim, no browser e instalada como aplicação (PWA).',
  },
]

export function FaqPage() {
  usePageTitle('Perguntas frequentes')
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 lg:py-16">
      <h1 className="text-[1.75rem] leading-tight font-bold tracking-tight">Perguntas frequentes</h1>
      <div className="mt-8 flex flex-col gap-3">
        {faqs.map(({ q, a }) => (
          <details key={q} className="group rounded-2xl border border-border bg-surface p-4 shadow-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold [&::-webkit-details-marker]:hidden">
              {q}
              <ChevronDown className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <p className="mt-3 text-muted">{a}</p>
          </details>
        ))}
      </div>
      <div className="mt-8">
        <ButtonLink to={paths.contact} variant="secondary">
          Outra questão? Fale connosco
        </ButtonLink>
      </div>
    </div>
  )
}
