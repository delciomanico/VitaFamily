package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/cassfrei/vitafamily/apps/api/internal/api"
	"github.com/cassfrei/vitafamily/apps/api/internal/platform/config"
	"github.com/cassfrei/vitafamily/apps/api/internal/platform/db"
	"github.com/cassfrei/vitafamily/apps/api/internal/platform/httpx"
	"github.com/cassfrei/vitafamily/apps/api/internal/platform/logx"
	"github.com/cassfrei/vitafamily/apps/api/internal/platform/storage"
)

func runAPI(ctx context.Context) error {
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

	checks := []api.Check{{Name: "database", Ping: pool.Ping}}
	if cfg.S3Endpoint != "" { // armazenamento ligado no M5; até lá é opcional
		st, err := storage.NewS3(storage.S3Config{Endpoint: cfg.S3Endpoint, Region: cfg.S3Region, Bucket: cfg.S3BucketDocuments,
			AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey, UseSSL: cfg.S3UseSSL})
		if err != nil {
			return err
		}
		checks = append(checks, api.Check{Name: "storage", Ping: st.Ping})
	}

	handler, err := api.NewRouter(api.Deps{
		Log:     log,
		Health:  api.NewHealth(log, checks...),
		Limiter: httpx.NewLimiter(cfg.RateLimitRPS, cfg.RateLimitBurst),
	})
	if err != nil {
		return err
	}
	srv := &http.Server{
		Addr: net.JoinHostPort("", cfg.Port), Handler: handler,
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second,
		WriteTimeout: 60 * time.Second, IdleTimeout: 120 * time.Second,
		BaseContext: func(net.Listener) context.Context { return ctx },
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	log.Info("api a escutar", "addr", srv.Addr, "env", cfg.Env)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	log.Info("api terminada")
	return nil
}
