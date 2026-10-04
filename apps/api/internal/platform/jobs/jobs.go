// Package jobs envolve o river (fila em PostgreSQL, ADR-012). Handlers de jobs têm de ser idempotentes.
package jobs

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"
)

// Client é o cliente river sobre pgx.
type Client = river.Client[pgx.Tx]

// NewWorkers cria o registo de workers; cada módulo regista os seus com river.AddWorker.
func NewWorkers() *river.Workers { return river.NewWorkers() }

// NewClient cria o cliente. Com workers != nil processa a fila "default" (processo worker);
// com workers == nil só insere jobs (processo api).
func NewClient(pool *pgxpool.Pool, workers *river.Workers, log *slog.Logger) (*Client, error) {
	cfg := &river.Config{Logger: log}
	if workers != nil {
		cfg.Workers = workers
		cfg.Queues = map[string]river.QueueConfig{river.QueueDefault: {MaxWorkers: 10}}
	}
	c, err := river.NewClient(riverpgxv5.New(pool), cfg)
	if err != nil {
		return nil, fmt.Errorf("jobs: %w", err)
	}
	return c, nil
}

// Migrate aplica as migrações das tabelas do river (chamado por `vita migrate`).
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	m, err := rivermigrate.New(riverpgxv5.New(pool), nil)
	if err != nil {
		return fmt.Errorf("jobs: %w", err)
	}
	if _, err := m.Migrate(ctx, rivermigrate.DirectionUp, nil); err != nil {
		return fmt.Errorf("jobs: migrar: %w", err)
	}
	return nil
}
