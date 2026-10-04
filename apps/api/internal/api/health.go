package api

import (
	"context"
	"log/slog"
	"time"

	"github.com/cassfrei/vitafamily/apps/api/internal/api/gen"
	"github.com/cassfrei/vitafamily/apps/api/internal/platform/httpx"
)

// Check é uma dependência verificada na readiness (BD, armazenamento...).
type Check struct {
	Name string
	Ping func(ctx context.Context) error
}

// Health implementa as operações `healthLive` e `healthReady`.
type Health struct {
	checks []Check
	log    *slog.Logger
}

func NewHealth(log *slog.Logger, checks ...Check) *Health { return &Health{checks: checks, log: log} }

func (h *Health) HealthLive(context.Context, gen.HealthLiveRequestObject) (gen.HealthLiveResponseObject, error) {
	return gen.HealthLive200JSONResponse{Status: "ok"}, nil
}

// HealthReady falha com 503 SERVICE_UNAVAILABLE se alguma dependência não responder; o motivo
// só vai para o log (a resposta pública não revela a infraestrutura).
func (h *Health) HealthReady(ctx context.Context, _ gen.HealthReadyRequestObject) (gen.HealthReadyResponseObject, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	for _, c := range h.checks {
		if err := c.Ping(ctx); err != nil {
			h.log.Error("readiness falhou", "check", c.Name, "err", err.Error(), "requestId", httpx.RequestIDFrom(ctx))
			return nil, httpx.Problem(httpx.ServiceUnavailable).WithDetail("Serviço temporariamente indisponível.")
		}
	}
	return gen.HealthReady200JSONResponse{Status: "ready"}, nil
}
