package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	vitadb "github.com/cassfrei/vitafamily/apps/api/db"
	"github.com/cassfrei/vitafamily/apps/api/internal/platform/config"
	"github.com/cassfrei/vitafamily/apps/api/internal/platform/db"
	"github.com/cassfrei/vitafamily/apps/api/internal/platform/jobs"
)

// runMigrate aplica as migrações goose embutidas e as do river. `vita migrate [up|down|status]`.
func runMigrate(ctx context.Context, args []string) error {
	action := "up"
	if len(args) > 0 {
		action = args[0]
	}
	cfg, err := config.Load(os.LookupEnv, "DATABASE_URL")
	if err != nil {
		return err
	}
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	sqlDB := stdlib.OpenDBFromPool(pool)
	defer func() { _ = sqlDB.Close() }()
	return migrateWith(ctx, sqlDB, action, func() error { return jobs.Migrate(ctx, pool) })
}

func migrateWith(ctx context.Context, sqlDB *sql.DB, action string, river func() error) error {
	goose.SetBaseFS(vitadb.Migrations)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	switch action {
	case "up":
		if err := goose.UpContext(ctx, sqlDB, "migrations"); err != nil {
			return err
		}
		return river()
	case "down":
		return goose.DownContext(ctx, sqlDB, "migrations")
	case "status":
		return goose.StatusContext(ctx, sqlDB, "migrations")
	default:
		return fmt.Errorf("ação desconhecida %q (up|down|status)", action)
	}
}
