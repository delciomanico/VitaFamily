// Guardrails do assistente (BR-AI-07/09, ADR-039, `GET /ai/guardrails`): configuração versionada NO CÓDIGO (não na BD, schema.md §15). O servidor
// não vê a resposta do fornecedor: estas listas são aplicadas no DISPOSITIVO (detetor de alarme e filtro de saída), por isso vão no contrato
// com os MESMOS fixtures nos testes. TEXTOS PROVISÓRIOS pt-PT/pt-AO — a rever pelo proprietário/jurista (OP-137) e clinicamente (OP-141) antes
// de qualquer lançamento (gate BR-AI-14). Os padrões correm sobre texto NORMALIZADO (`normalizeForMatch`: minúsculas, sem acentos); `\p{L}` com
// a flag `u` (sintaxe comum a JavaScript e ao servidor). Preferem-se falsos positivos a falsos negativos (falha fechada).

/** Mudar qualquer lista, texto ou esquema ⇒ nova versão (a sessão recusa uma versão desatualizada com 409). */
export const GUARDRAILS_VERSION = "2026-11-25.1";

export interface GuardrailPattern {
  id: string;
  pattern: string;
  flags: string;
}

export interface AllowedSpecialty {
  id: string;
  name: string;
}

export interface Guardrails {
  version: string;
  systemInstruction: string;
  blockPatterns: GuardrailPattern[];
  alarmPatterns: GuardrailPattern[];
  allowedSpecialties: AllowedSpecialty[];
  urgencyMessage: string;
  disclaimer: string;
  responseSchema: Record<string, unknown>;
}

/** Texto normalizado para comparação: minúsculas, sem diacríticos. O cliente tem de aplicar exatamente o mesmo antes de testar os padrões. */
export function normalizeForMatch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Palavra inteira (sem letras coladas), compatível com texto sem acentos. */
const word = (body: string): string => `(?<!\\p{L})(?:${body})(?!\\p{L})`;

export const URGENCY_MESSAGE =
  "O que descreveu pode ser um sinal de urgência. Procure ajuda médica imediata: ligue para o número de emergência ou dirija-se já à urgência mais próxima. Se estiver sozinho(a), peça a alguém que o(a) acompanhe.";

export const DISCLAIMER =
  "Informação geral gerada por IA; não é um diagnóstico nem substitui um profissional de saúde. Em emergência, procure ajuda imediata.";

const SYSTEM_INSTRUCTION = [
  "És o Assistente Vita, um apoio de informação geral para famílias em Angola. Escreves em português de Portugal, em linguagem simples e curta.",
  "Responde SEMPRE e APENAS com um objeto JSON que cumpra o esquema indicado (campos: summary, observations, generalGuidance, suggestedSpecialty, urgency). Sem texto fora do JSON.",
  "PODES: descrever tendências nos dados fornecidos; dar orientação geral e educativa sobre sintomas; indicar sinais a vigiar e quando procurar cuidados, em termos gerais; dizer que os sintomas podem justificar uma consulta de UMA especialidade da lista permitida (campo suggestedSpecialty, só o id da lista; omite se não houver razão).",
  "NUNCA: dês um diagnóstico nem digas que a pessoa «tem» uma doença; receites; indiques medicamentos, suplementos, doses, nem alteres ou suspendas tratamentos; classifiques valores como normais, anormais ou perigosos (descreve apenas a variação); previsões de doenças; digas que dispensa um profissional de saúde.",
  "Se os dados ou sintomas sugerirem urgência, define urgency como EMERGENCY e não analises mais. Caso contrário usa NONE ou ROUTINE (consulta recomendada sem urgência).",
  "Os números e etiquetas («Medicamento A») são pseudónimos: não tentes adivinhar nomes. Não peças dados pessoais.",
].join("\n");

export const BLOCK_PATTERNS: GuardrailPattern[] = [
  { id: "diagnostico-afirmativo", pattern: word("(?:voce|o utilizador|a pessoa|o paciente|o doente)\\s+(?:tem|sofre de|padece de|esta com)"), flags: "iu" },
  { id: "diagnostico-certeza", pattern: word("diagnostic[oa]\\s+(?:definitiv[oa]|confirmad[oa]|e)|(?:tem|sofre de|padece de)\\s+(?:certamente|com certeza|de certeza)"), flags: "iu" },
  { id: "imperativo-medicacao", pattern: word("tome|tomar|tomes|tomem|ingira|ingerir|administre|aplique"), flags: "iu" },
  { id: "dose", pattern: "(?<![\\p{L}\\d])\\d+(?:[.,]\\d+)?\\s*(?:mg|mcg|ug|ml|g|ui|comprimidos?|capsulas?|gotas?|ampolas?)(?![\\p{L}])", flags: "iu" },
  { id: "alterar-tratamento", pattern: word("(?:aument\\w+|reduz\\w+|diminu\\w+|par(?:e|ar)|suspend\\w+|interromp\\w+|interromper|deix(?:e|ar) de)\\s+(?:\\S+\\s+){0,4}(?:dose|doses|medicacao|medicamento|tratamento|remedio|comprimido)"), flags: "iu" },
  { id: "receitar", pattern: word("receito|prescrevo|recomendo\\s+(?:o\\s+)?(?:medicamento|farmaco|suplemento|remedio)"), flags: "iu" },
  {
    id: "farmacos",
    pattern: word("paracetamol|ibuprofeno|aspirina|diclofenac|amoxicilina|azitromicina|metformina|insulina|omeprazol|prednisolona|antibiotic\\w*|anti-?inflamatori\\w*|analgesic\\w*|antidepressiv\\w*|ansiolitic\\w*|antipiretic\\w*|corticoid\\w*|suplement\\w*|vitamina\\s+\\w+|xarope|pomada"),
    flags: "iu",
  },
  { id: "classificar-valores", pattern: word("(?:valor|valores|resultado|resultados)\\s+(?:\\S+\\s+){0,3}(?:normal|normais|anormal|anormais|perigos\\w+|preocupante\\w*)"), flags: "iu" },
  { id: "dispensa-profissional", pattern: word("nao\\s+(?:precisa|necessita|tem de|tem que)\\s+(?:de\\s+)?(?:ir\\s+ao\\s+)?(?:medico|consulta|profissional)"), flags: "iu" },
];

export const ALARM_PATTERNS: GuardrailPattern[] = [
  { id: "dor-no-peito", pattern: word("dor(?:es)?\\s+(?:forte\\s+|intensa\\s+)?(?:no|do|nos)\\s+(?:peito|coracao)|aperto\\s+no\\s+peito|pressao\\s+no\\s+peito"), flags: "iu" },
  { id: "falta-de-ar", pattern: word("falta\\s+de\\s+ar|dificuldade\\s+(?:em|para|a)\\s+respirar|nao\\s+consigo\\s+respirar|sufoc\\w+"), flags: "iu" },
  { id: "avc", pattern: word("boca\\s+torta|cara\\s+(?:descaida|torta)|fala\\s+(?:arrastada|enrolada)|nao\\s+consigo\\s+falar|perda\\s+de\\s+(?:forca|movimentos?)\\s+(?:num|no|de um)\\s+(?:braco|lado|perna)|formigueiro\\s+(?:de um lado|no braco)|derrame|avc"), flags: "iu" },
  { id: "hemorragia", pattern: word("hemorragia|sangramento\\s+(?:forte|intenso|abundante|que nao para)|muito\\s+sangue|vomit\\w*\\s+(?:de\\s+)?sangue|sangue\\s+no\\s+vomito|tossir\\s+sangue|fezes\\s+com\\s+sangue"), flags: "iu" },
  { id: "perda-de-consciencia", pattern: word("desmai\\w+|perda\\s+de\\s+consciencia|perdeu\\s+os\\s+sentidos|inconsciente|nao\\s+responde|nao\\s+acorda"), flags: "iu" },
  { id: "convulsao", pattern: word("convuls\\w+|ataque\\s+epileptico|crise\\s+epileptica"), flags: "iu" },
  { id: "suicidio-autolesao", pattern: word("suicid\\w*|quero\\s+morrer|queria\\s+morrer|tirar\\s+a\\s+(?:minha\\s+)?vida|acabar\\s+com\\s+a\\s+(?:minha\\s+)?vida|autolesao|me\\s+(?:magoar|cortar|ferir)|fazer\\s+mal\\s+a\\s+mim"), flags: "iu" },
  { id: "alergia-grave", pattern: word("anafila\\w+|choque\\s+anafilatico|inchaco\\s+(?:da|na)\\s+(?:lingua|garganta|cara|boca)|garganta\\s+a\\s+fechar|lingua\\s+inchada"), flags: "iu" },
  { id: "intoxicacao", pattern: word("intoxica\\w+|envenen\\w+|overdose|veneno|lixivia|(?:engoli|engoliu|ingeriu|bebeu|bebi)\\s+(?:\\S+\\s+){0,2}(?:produto|medicamentos?\\s+a\\s+mais|comprimidos\\s+a\\s+mais)|muitos\\s+comprimidos"), flags: "iu" },
  { id: "engasgamento", pattern: word("engasg\\w+|a\\s+sufocar|asfixi\\w+"), flags: "iu" },
  { id: "bebe-febre", pattern: word("bebe\\s+(?:com|de)\\s+febre|recem-?nascido\\s+(?:com|de)\\s+febre|febre\\s+(?:muito\\s+)?alta\\s+(?:no|do|em)\\s+bebe"), flags: "iu" },
];

export const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "observations", "generalGuidance", "urgency"],
  properties: {
    summary: { type: "string", maxLength: 1200 },
    observations: { type: "array", maxItems: 8, items: { type: "string", maxLength: 400 } },
    generalGuidance: { type: "array", maxItems: 8, items: { type: "string", maxLength: 400 } },
    suggestedSpecialty: { type: "string", description: "Id (uuid) de uma especialidade da lista permitida; omitir se não houver razão." },
    urgency: { type: "string", enum: ["NONE", "ROUTINE", "EMERGENCY"] },
  },
};

export function buildGuardrails(allowedSpecialties: AllowedSpecialty[]): Guardrails {
  return {
    version: GUARDRAILS_VERSION,
    systemInstruction: SYSTEM_INSTRUCTION,
    blockPatterns: BLOCK_PATTERNS,
    alarmPatterns: ALARM_PATTERNS,
    allowedSpecialties,
    urgencyMessage: URGENCY_MESSAGE,
    disclaimer: DISCLAIMER,
    responseSchema: RESPONSE_SCHEMA,
  };
}
