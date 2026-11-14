import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { TERMS_VERSION } from '@/services/auth.service'
import { site } from '@/lib/site'
import { paths } from '@/routes/paths'

/**
 * Resumos informativos, sem valor de texto legal. Os textos jurídicos definitivos dependem de validação
 * por jurista/DPO e da AIPD (docs/08-security/privacy.md): até lá, só se afirma o que a documentação já fixa.
 */
function Notice() {
  return (
    <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning">
      Resumo informativo (versão {TERMS_VERSION}). O texto legal definitivo está em revisão jurídica e será publicado
      antes do lançamento.
    </p>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  )
}

export function TermsContent() {
  return (
    <div className="flex flex-col gap-6">
      <Notice />
      <Block title="O que é o Vita Family">
        <p className="text-muted">
          Uma ferramenta para organizar e acompanhar a saúde individual e familiar (receitas, medicação, consultas,
          exames e documentos). Não presta cuidados de saúde, não faz diagnósticos e não substitui o aconselhamento
          médico.
        </p>
      </Block>
      <Block title="A sua conta">
        <p className="text-muted">
          É responsável pela confidencialidade da sua palavra-passe e pelos dados que regista. Os tutores respondem
          pelos perfis de menores e dependentes que gerem.
        </p>
      </Block>
      <Block title="Clínicas e seguradoras">
        <p className="text-muted">
          As clínicas e seguradoras ligadas ao Vita Family usam portais próprios. Só acedem aos seus dados com o seu
          consentimento, que pode retirar a qualquer momento.
        </p>
      </Block>
      <Block title="Operador">
        <p className="text-muted">
          O serviço é operado por {site.operator}. Para questões, use a página de{' '}
          <Link to={paths.contact} className="font-semibold text-primary hover:underline">
            contacto
          </Link>
          .
        </p>
      </Block>
    </div>
  )
}

export function PrivacyContent() {
  return (
    <div className="flex flex-col gap-6">
      <Notice />
      <Block title="Quem trata os seus dados">
        <p className="text-muted">
          O responsável pelo tratamento é {site.operator}. Os dados de saúde que as clínicas registam nos seus próprios
          sistemas são tratados pela clínica, que é a responsável por esse registo.
        </p>
      </Block>
      <Block title="Que dados tratamos">
        <p className="text-muted">
          Dados da conta, da estrutura familiar e de saúde (alergias, condições, receitas, medicação, consultas,
          exames e documentos). Os dados de saúde são tratados com o seu consentimento explícito.
        </p>
      </Block>
      <Block title="Com quem partilhamos">
        <ul className="list-disc pl-5 text-muted">
          <li>Por defeito, ninguém: o perfil de saúde é privado.</li>
          <li>Com a família, por categoria, conforme a partilha que escolher.</li>
          <li>Com uma clínica, só se a ligar e consentir, por clínica e revogável.</li>
          <li>Com uma seguradora, nunca o perfil de saúde: apenas os documentos que escolher anexar a um reembolso.</li>
        </ul>
      </Block>
      <Block title="Os seus direitos">
        <p className="text-muted">
          Pode aceder, exportar, corrigir e apagar os seus dados, retirar consentimentos e eliminar a conta, nas
          definições da app. Para outros pedidos, use o{' '}
          <Link to={paths.contact} className="font-semibold text-primary hover:underline">
            contacto
          </Link>
          .
        </p>
      </Block>
      <Block title="Uso dos dados">
        <p className="text-muted">
          Os dados da app não são usados para publicidade nem para decidir preço, subscrição ou cobertura de seguros.
        </p>
      </Block>
    </div>
  )
}
