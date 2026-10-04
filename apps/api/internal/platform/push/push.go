// Package push define o envio de Web Push atrás de interface. M0 traz só a interface e um
// duplo de teste; a implementação VAPID (webpush-go) entra no M8 (notifications).
package push

import (
	"context"
	"errors"
	"sync"
)

// ErrSubscriptionGone: a subscrição expirou/foi revogada (410); o chamador deve removê-la.
var ErrSubscriptionGone = errors.New("push: subscrição inválida")

// Subscription é o endpoint do browser (dados do PushSubscription).
type Subscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

// Payload não pode conter dados de saúde (NFR-PRV): texto neutro + ligação.
type Payload struct {
	Title string
	Body  string
	URL   string
}

// Sender envia uma notificação push.
type Sender interface {
	Send(ctx context.Context, sub Subscription, p Payload) error
}

// Memory guarda os envios (testes).
type Memory struct {
	mu   sync.Mutex
	sent []Payload
}

func (m *Memory) Send(_ context.Context, _ Subscription, p Payload) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, p)
	return nil
}

func (m *Memory) Sent() []Payload {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]Payload(nil), m.sent...)
}
