import type { AiProviderId } from '@/types/ai'

/*
 * TEXTOS PROVISÓRIOS (OP-137): o consentimento, o aviso e a mensagem de urgência finais em pt-AO são do proprietário/jurista; a versão abaixo
 * regista-se no servidor com o consentimento. Mudar o texto ⇒ nova versão (o utilizador volta a consentir).
 */
export const CONSENT_VERSION = '2026-11-25.1'

export const providerOwner: Record<AiProviderId, string> = { GEMINI: 'a Google', CLAUDE: 'a Anthropic', OPENAI: 'a OpenAI' }

export const consentIntro = (provider: string, owner: string, who: string): string =>
  `Ao ligar ${provider}, os dados que escolher analisar com o assistente (${who}) saem da Vita Family e seguem diretamente deste aparelho para ${owner}. ` +
  `Passam a estar sujeitos aos termos e à política de privacidade de ${owner}, que pode usar os dados conforme o seu plano. A Vita Family não os vê nem os guarda.`

export const consentPoints = [
  'Só envia o necessário e sem nomes: sem nomes de pessoas, de médicos ou de medicamentos, sem datas de nascimento, sem documentos nem fotografias.',
  'Dá informação geral. Não faz diagnósticos, não receita nem indica medicamentos ou doses.',
  'Pode desligar quando quiser. Isso apaga a chave deste aparelho e retira o seu consentimento.',
  'Os custos, se existirem, são da sua conta no fornecedor.',
]

export const minorNotice = 'Para crianças e adultos dependentes, na dúvida procure sempre um profissional de saúde.'
