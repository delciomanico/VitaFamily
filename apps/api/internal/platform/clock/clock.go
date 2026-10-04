// Package clock fornece o relógio injetável (ADR-010): código de negócio nunca chama time.Now().
package clock

import (
	"sync"
	"time"
)

// Clock devolve o instante atual, sempre em UTC.
type Clock interface {
	Now() time.Time
}

// System é o relógio real.
type System struct{}

func (System) Now() time.Time { return time.Now().UTC() }

// Fake é um relógio controlável para testes.
type Fake struct {
	mu sync.Mutex
	t  time.Time
}

// NewFake cria um relógio fixo em t (convertido para UTC).
func NewFake(t time.Time) *Fake { return &Fake{t: t.UTC()} }

func (f *Fake) Now() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.t
}

// Advance avança o relógio por d.
func (f *Fake) Advance(d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.t = f.t.Add(d)
}

// Set fixa o relógio em t.
func (f *Fake) Set(t time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.t = t.UTC()
}
