// CLI "create-platform-admin <email>" (environment.md §4): cria o primeiro Platform Admin.
// Depende do módulo `users` (M1, ainda não existe nesta milestone — M0 é só fundações). Devolve
// explicitamente "não implementado" (saída não-zero); nunca finge sucesso.
export function main(argv: string[]): number {
  const email = argv[2];
  if (!email) {
    console.error("Uso: create-platform-admin <email>");
    return 1;
  }
  console.error(
    `create-platform-admin: ainda não implementado (depende do módulo "users", M1). ` +
      `Nenhum Platform Admin foi criado para "${email}".`,
  );
  return 1;
}

process.exit(main(process.argv));
