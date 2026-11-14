import { useMemo, useState } from 'react'
import { ChevronDown, CircleHelp, Search } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { HeroMedia } from '@/components/ui/HeroMedia'
import { Input } from '@/components/ui/Input'
import { Reveal } from '@/components/ui/Reveal'
import { EmptyState } from '@/components/ui/states'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn } from '@/lib/cn'
import { paths } from '@/routes/paths'

type Category = 'Famílias' | 'Clínicas' | 'Seguradoras' | 'Privacidade'
const categories: Category[] = ['Famílias', 'Clínicas', 'Seguradoras', 'Privacidade']

interface Faq {
  category: Category
  q: string
  a: string
}

const faqs: Faq[] = [
  {
    category: 'Famílias',
    q: 'O Vita Family faz diagnósticos ou substitui o médico?',
    a: 'Não. Ajuda a organizar e a lembrar a saúde da família. Não diagnostica, não recomenda tratamentos e não substitui uma consulta.',
  },
  {
    category: 'Famílias',
    q: 'Posso gerir a saúde dos meus filhos e de outros familiares?',
    a: 'Sim. Cria a família, adiciona filhos e dependentes e define quem os acompanha. Os tutores gerem os perfis dos menores.',
  },
  {
    category: 'Famílias',
    q: 'Funciona no telemóvel?',
    a: 'Sim, no browser e instalada como aplicação (PWA).',
  },
  {
    category: 'Famílias',
    q: 'Posso apagar a minha conta e os meus dados?',
    a: 'Sim. Pode exportar os dados e eliminar a conta, a família ou um membro, nas definições da app.',
  },
  {
    category: 'Clínicas',
    q: 'Como se criam as contas de clínicas e seguradoras?',
    a: 'São criadas pela equipa Vita Family depois de validar a entidade. Peça acesso na página própria e entraremos em contacto.',
  },
  {
    category: 'Clínicas',
    q: 'Tenho de usar o Vita Family em vez do meu sistema atual?',
    a: 'Não. O portal serve a agenda, os pacientes ligados e a troca com as famílias. Não substitui um sistema de gestão clínica completo.',
  },
  {
    category: 'Clínicas',
    q: 'O que acontece se o paciente retirar o consentimento?',
    a: 'A partilha futura pára de imediato. A clínica conserva o que ela própria registou.',
  },
  {
    category: 'Seguradoras',
    q: 'A seguradora vê o perfil de saúde dos segurados?',
    a: 'Não. A seguradora vê apenas os dados da sua apólice e os documentos que o titular escolher anexar a um pedido de reembolso.',
  },
  {
    category: 'Seguradoras',
    q: 'Tenho de migrar o meu sistema?',
    a: 'Não. O seu sistema central continua a ser a fonte de verdade; importa os beneficiários e apólices que quiser ligar.',
  },
  {
    category: 'Privacidade',
    q: 'Quem pode ver a informação de saúde de um membro?',
    a: 'Por defeito, só o próprio e os seus tutores. A família só vê o nome e a data de nascimento; o resto depende da partilha por categoria que o titular escolher.',
  },
  {
    category: 'Privacidade',
    q: 'A minha clínica tem acesso aos meus dados?',
    a: 'Só se ligar a clínica e der consentimento, por clínica e em dois níveis (marcações; partilha de histórico). Dura 12 meses, é renovável e pode ser retirado a qualquer momento.',
  },
  {
    category: 'Privacidade',
    q: 'Os meus dados são usados para publicidade ou para decidir o preço do seguro?',
    a: 'Não. Os dados da app não são usados para publicidade nem para decidir preço, subscrição ou cobertura de seguros.',
  },
]

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Perguntas frequentes, por categoria e com pesquisa. */
export function FaqPage() {
  usePageTitle('Perguntas frequentes')
  const [category, setCategory] = useState<Category | 'Todas'>('Todas')
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean)
    return faqs.filter(
      (faq) =>
        (category === 'Todas' || faq.category === category) &&
        words.every((word) => normalize(`${faq.q} ${faq.a}`).includes(word)),
    )
  }, [category, query])

  return (
    <>
      <section className="relative isolate flex min-h-[26rem] items-end overflow-hidden text-white">
        <HeroMedia images={[{ src: '/images/site/medicacao.webp' }, { src: '/images/site/familia.webp' }]} />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/80 via-black/45 to-black/25" />
        <div className="mx-auto w-full max-w-7xl animate-rise px-5 pt-24 pb-14 lg:px-10 lg:pb-20">
          <p className="text-base font-semibold tracking-wide uppercase">Perguntas frequentes</p>
          <h1 className="mt-4 max-w-3xl text-4xl leading-[1.08] font-bold tracking-tight text-balance md:text-6xl">
            Como podemos ajudar?
          </h1>
          <p className="mt-5 max-w-2xl text-xl md:text-2xl">As respostas às dúvidas mais comuns, por perfil.</p>
        </div>
      </section>

      <section className="bg-surface">
        <div className="mx-auto max-w-4xl px-5 py-16 lg:px-10 lg:py-24">
          <Reveal className="flex flex-col gap-6">
            <Input
              label="Pesquisar nas perguntas"
              type="search"
              icon={Search}
              placeholder="Ex.: consentimento, seguro, apagar conta…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-14 text-base"
            />
            <div role="group" aria-label="Categoria" className="flex flex-wrap gap-2">
              {(['Todas', ...categories] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={category === option}
                  onClick={() => setCategory(option)}
                  className={cn(
                    'h-11 rounded-full border px-5 text-base font-medium transition-colors',
                    category === option
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-surface hover:bg-surface-muted',
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </Reveal>

          <div className="mt-10 flex flex-col gap-4" aria-live="polite">
            {results.length === 0 ? (
              <EmptyState icon={CircleHelp} title="Nenhuma pergunta encontrada" description="Experimente outras palavras ou fale connosco." />
            ) : (
              results.map((faq, index) => (
                <Reveal key={faq.q} delay={(index % 4) * 60}>
                  <details className="group rounded-2xl border border-border bg-surface p-6 shadow-card transition-shadow open:shadow-overlay">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-xl font-semibold [&::-webkit-details-marker]:hidden">
                      <span>
                        <span className="mb-1 block text-sm font-semibold tracking-wide text-primary uppercase">{faq.category}</span>
                        {faq.q}
                      </span>
                      <ChevronDown className="size-6 shrink-0 text-muted transition-transform duration-300 group-open:rotate-180" aria-hidden />
                    </summary>
                    <p className="mt-4 text-lg text-muted">{faq.a}</p>
                  </details>
                </Reveal>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="px-5 pb-24 lg:px-10 lg:pb-32">
        <Reveal>
          <div className="relative mx-auto flex max-w-7xl flex-col items-start gap-8 overflow-hidden rounded-[2.5rem] bg-primary px-8 py-16 text-white md:px-16 md:py-20">
            <div aria-hidden className="absolute -right-24 -bottom-24 size-96 animate-drift rounded-full bg-white/10 blur-2xl" />
            <h2 className="relative max-w-3xl text-4xl leading-tight font-bold tracking-tight text-balance md:text-5xl">
              Não encontrou o que procurava?
            </h2>
            <ButtonLink to={paths.contact} variant="secondary" size="lg" className="relative h-14 px-8 text-base">
              Falar connosco
            </ButtonLink>
          </div>
        </Reveal>
      </section>
    </>
  )
}
