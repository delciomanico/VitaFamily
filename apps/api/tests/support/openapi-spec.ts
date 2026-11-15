// Caminho do contrato usado pelos testes com `validateResponses`. Por omissão é `docs/05-api/openapi.yaml` (fonte única); a variável
// `VITA_OPENAPI_SPEC` permite validar contra uma cópia corrigida enquanto o contrato commitado tiver erros de sintaxe para o validador.
import { join } from "node:path";

export function openApiSpecPath(repoRoot: string): string {
  return process.env.VITA_OPENAPI_SPEC ?? join(repoRoot, "docs/05-api/openapi.yaml");
}
