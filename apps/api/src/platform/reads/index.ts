// Contratos de LEITURA partilhados entre módulos (modules.md §2: `reports` lê registos de saúde
// através da API pública de cada módulo dono, nunca das suas tabelas — conventions.md §3.5).
// Cada função devolve já a forma da API (components.schemas, openapi.yaml) e passa pela mesma
// `AccessPolicy` + auditoria do endpoint HTTP correspondente; sem permissão lança `ForbiddenError`/
// `NotFoundError`, que `reports` traduz em "secção omitida" (BR-RPT-01).

export interface ReadActor {
  userId: string;
  platformAdmin: boolean;
}

export interface ReadContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export interface ReadPage {
  items: Record<string, unknown>[];
  nextCursor: string | null;
}

/** Leitura de uma coleção de um membro (sem filtros). */
export type MemberRead<T> = (actor: ReadActor, familyId: string, memberId: string, context: ReadContext) => Promise<T>;

/** Leitura paginada de um membro, com filtros em query string (`limit`, `cursor`, `from`…). */
export type MemberPageRead = (
  actor: ReadActor,
  familyId: string,
  memberId: string,
  query: Record<string, string>,
  context: ReadContext,
) => Promise<ReadPage>;
