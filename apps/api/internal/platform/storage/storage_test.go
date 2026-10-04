package storage

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestMemory(t *testing.T) {
	ctx := context.Background()
	var s Storage = NewMemory()
	if _, err := s.Get(ctx, "k"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("esperado ErrNotFound: %v", err)
	}
	if err := s.Put(ctx, "k", strings.NewReader("abc"), 3, "text/plain"); err != nil {
		t.Fatal(err)
	}
	r, err := s.Get(ctx, "k")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(r)
	if string(b) != "abc" {
		t.Fatalf("got %q", b)
	}
	if err := s.Delete(ctx, "k"); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, "k"); err != nil {
		t.Fatal("Delete deve ser idempotente")
	}
	if err := s.Ping(ctx); err != nil {
		t.Fatal(err)
	}
}
