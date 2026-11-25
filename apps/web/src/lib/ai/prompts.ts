import type { AiContext, AiGuardrails, AiKind } from '@/types/ai'

/** Pedido ao modelo: instruções do servidor + dados MINIMIZADOS + esquema fechado da resposta. Nada de nomes nem datas absolutas. */
export function buildPrompt(kind: AiKind, guardrails: AiGuardrails, context: AiContext, symptoms?: string): { system: string; user: string } {
  const specialties = guardrails.allowedSpecialties.map((s) => `- ${s.id}: ${s.name}`).join('\n')
  const schema = JSON.stringify(guardrails.responseSchema)
  const rules = [
    'Responde só com um objeto JSON que cumpra este esquema:',
    schema,
    'Especialidades permitidas para suggestedSpecialty (usa só o id; omite se não houver razão):',
    specialties || '(nenhuma)',
  ].join('\n')
  if (kind === 'SUMMARY') {
    return {
      system: guardrails.systemInstruction,
      user: [
        'Explica em linguagem simples o que estes dados mostram sobre o período (tendências, sem classificar valores nem dar conselhos de tratamento).',
        'Dados do período (pseudonimizados; os dias são relativos ao início do período):',
        JSON.stringify(context),
        rules,
      ].join('\n\n'),
    }
  }
  return {
    system: guardrails.systemInstruction,
    user: [
      'A pessoa descreveu estes sintomas (texto dela):',
      `«${(symptoms ?? '').trim()}»`,
      'Contexto (só faixa etária e, se a pessoa o autorizou, condições ativas):',
      JSON.stringify(context),
      'Dá orientação geral e educativa, sinais a vigiar e quando procurar cuidados. Se fizer sentido, indica a especialidade de uma consulta que os sintomas podem justificar.',
      rules,
    ].join('\n\n'),
  }
}
