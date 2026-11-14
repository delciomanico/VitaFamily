// Semeadura idempotente dos tipos de serviço por omissão (BR-SEG-39): uma seguradora nova recebe os 9 tipos na primeira utilização
// do módulo (as existentes, na migração `0037`). Sem auditoria. Os tipos nunca se apagam, logo «zero tipos» = ainda não semeada.
import type { OpsDeps } from "./ports.js";

export async function ensureDefaultServiceKinds<Trx>(deps: OpsDeps<Trx>, trx: Trx, insurerId: string): Promise<void> {
  if ((await deps.serviceKinds.count(trx, insurerId)) === 0) await deps.serviceKinds.seedDefaults(trx, insurerId);
}
