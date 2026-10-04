// Comando vita: binário único com subcomandos api | worker | migrate | create-platform-admin.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
)

const usage = `uso: vita <comando>

comandos:
  api                    servidor HTTP (/api/v1)
  worker                 processador de jobs (river)
  migrate                aplica migrações (goose + river)
  create-platform-admin  cria o primeiro Platform Admin (M1)
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var err error
	switch os.Args[1] {
	case "api":
		err = runAPI(ctx)
	case "worker":
		err = runWorker(ctx)
	case "migrate":
		err = runMigrate(ctx, os.Args[2:])
	case "create-platform-admin":
		err = runCreatePlatformAdmin(ctx, os.Args[2:])
	case "-h", "--help", "help":
		fmt.Print(usage)
	default:
		fmt.Fprintf(os.Stderr, "comando desconhecido: %q\n\n%s", os.Args[1], usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "erro:", err)
		os.Exit(1)
	}
}
