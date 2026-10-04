package main

import (
	"context"
	"os"

	"github.com/cassfrei/vitafamily/apps/api/internal/platform/config"
	"github.com/cassfrei/vitafamily/apps/api/internal/platform/db"
	"github.com/cassfrei/vitafamily/apps/api/internal/platform/jobs"
	"github.com/cassfrei/vitafamily/apps/api/internal/platform/logx"
)

// runWorker arranca o river. Os módulos registam os seus workers em `workers` (M1+).
func runWorker(ctx context.Context) error {
	cfg, err := config.Load(os.LookupEnv, "DATABASE_URL")
	if err != nil {
		return err
	}
	log := logx.New(os.Stdout, cfg.LogLevel)
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	workers := jobs.NewWorkers() // sem workers registados no M0
	client, err := jobs.NewClient(pool, workers, log)
	if err != nil {
		return err
	}
	if err := client.Start(ctx); err != nil {
		return err
	}
	log.Info("worker a correr")
	<-ctx.Done()
	stopCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	return client.Stop(stopCtx)
}
