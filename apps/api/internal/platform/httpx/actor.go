package httpx

import (
	"context"

	"github.com/google/uuid"
)

// ActorInfo identifica quem faz o pedido; preenchido pelo middleware de autenticação +
// pertença à família (M1/M3). FamilyID/MemberID são Nil fora de rotas com contexto de família.
type ActorInfo struct {
	UserID        uuid.UUID
	FamilyID      uuid.UUID
	MemberID      uuid.UUID
	PlatformAdmin bool
}

type ctxKey int

const (
	actorKey ctxKey = iota
	requestIDKey
)

// WithActor devolve um contexto com o ator.
func WithActor(ctx context.Context, a ActorInfo) context.Context {
	return context.WithValue(ctx, actorKey, a)
}

// Actor devolve o ator do pedido; ok=false se o pedido não está autenticado.
func Actor(ctx context.Context) (ActorInfo, bool) {
	a, ok := ctx.Value(actorKey).(ActorInfo)
	return a, ok
}

// RequestIDFrom devolve o id do pedido ("" se ausente).
func RequestIDFrom(ctx context.Context) string {
	s, _ := ctx.Value(requestIDKey).(string)
	return s
}
