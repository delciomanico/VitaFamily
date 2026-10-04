// Package ids gera identificadores (UUID v4) para entidades e pedidos.
package ids

import "github.com/google/uuid"

// New devolve um novo UUID v4.
func New() uuid.UUID { return uuid.New() }

// NewString devolve um novo UUID v4 em texto (ex.: request id).
func NewString() string { return uuid.NewString() }
