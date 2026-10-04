package push

import (
	"context"
	"testing"
)

func TestMemory(t *testing.T) {
	m := &Memory{}
	var s Sender = m
	if err := s.Send(context.Background(), Subscription{Endpoint: "e"}, Payload{Title: "t"}); err != nil {
		t.Fatal(err)
	}
	if len(m.Sent()) != 1 {
		t.Fatal("esperado 1 envio")
	}
}
