// CLI "create-platform-admin <email>" (environment.md §4): promove uma conta já registada,
// verificada e ativa a Platform Admin; comando explícito e auditado (ação SYSTEM).
// Uso (produção): docker exec api node apps/api/dist/src/main/create-platform-admin.js <email>
import { loadConfig } from "../platform/config/index.js";
import { SystemClock } from "../platform/clock/index.js";
import { createDb, createPool, withTransaction } from "../platform/db/index.js";
import { createCreatePlatformAdminUseCase, type CreatePlatformAdminResult } from "../modules/admin/index.js";
import { createAuditModule } from "../modules/audit/index.js";
import { createUsersModule } from "../modules/users/index.js";

const MESSAGES: Record<CreatePlatformAdminResult, [code: number, message: (email: string) => string]> = {
  CREATED: [0, (email) => `"${email}" é agora Platform Admin. Termine sessão e entre de novo para o token refletir o papel.`],
  ALREADY_ADMIN: [0, (email) => `"${email}" já é Platform Admin (nada a fazer).`],
  NOT_FOUND: [1, (email) => `Não existe conta com o e-mail "${email}". Registe-a primeiro na aplicação.`],
  NOT_ACTIVE: [1, (email) => `A conta "${email}" não está ativa (e-mail por verificar ou suspensa).`],
};

export async function main(argv: string[]): Promise<number> {
  const email = argv[2]?.trim();
  if (!email) {
    console.error("Uso: create-platform-admin <email>");
    return 1;
  }

  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);
  const clock = new SystemClock();
  try {
    const audit = createAuditModule({ db });
    const users = createUsersModule({ db, audit, clock, currentTermsVersion: config.TERMS_VERSION });
    const run = createCreatePlatformAdminUseCase({
      users,
      audit,
      clock,
      withTransaction: (fn) => withTransaction(db, fn),
    });
    const result = await run(email.toLowerCase());
    const [code, message] = MESSAGES[result];
    (code === 0 ? console.log : console.error)(message(email));
    return code;
  } finally {
    await pool.end();
  }
}

main(process.argv).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
