// `SelfDealingGuard` (BR-MKT-62): compara o e-mail normalizado da conta do profissional com o do utilizador. Não lê tabelas de outros
// módulos: recebe duas funções de leitura (ligadas em `main/api.ts` à raiz `ProfessionalDirectory` e a `users`). O resultado é só um
// booleano: nunca revela o e-mail de ninguém.
import { normalizeEmailForComparison } from "../domain/text.js";
import type { SelfDealingGuard } from "./ports.js";

export function createSelfDealingGuard(readers: {
  professionalEmail: (professionalId: string) => Promise<string | null>;
  userEmail: (userId: string) => Promise<string | null>;
}): SelfDealingGuard {
  return {
    async isSamePerson(professionalId, userId) {
      const [professional, user] = await Promise.all([readers.professionalEmail(professionalId), readers.userEmail(userId)]);
      if (professional === null || user === null) return false;
      return normalizeEmailForComparison(professional) === normalizeEmailForComparison(user);
    },
  };
}
