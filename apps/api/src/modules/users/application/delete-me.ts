// UC-ACC-05/BR-ACC-06/07: eliminação definitiva da conta. **Fora do âmbito de M1** — exige dados
// de `families` (único tutor/único Admin, BR-ACC-06) que só existem a partir de M2, e a orquestração
// de ficheiros/exportação que é de `lifecycle` (M9). Fica um stub explícito, tal como a
// implementação Go anterior (ver CLAUDE.md M1 §3): devolve `SERVICE_UNAVAILABLE` em vez de fingir
// sucesso ou inventar a regra de bloqueio sem os dados de família.
import { ServiceUnavailableError } from "../../../platform/errors/index.js";

export function createDeleteMeUseCase() {
  return function deleteMe(_userId: string, _password: string): Promise<never> {
    return Promise.reject(
      new ServiceUnavailableError({
        detail: "Eliminação de conta ainda não disponível (ver plan.md M9).",
      }),
    );
  };
}
