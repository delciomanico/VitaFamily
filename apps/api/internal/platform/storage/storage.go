// Package storage define a interface de armazenamento de objetos (ADR-006/012); trocável por S3 UE.
package storage

import (
	"context"
	"errors"
	"io"
	"sync"
)

// ErrNotFound: objeto inexistente.
var ErrNotFound = errors.New("storage: objeto não encontrado")

// Storage guarda ficheiros por chave dentro de um bucket configurado na implementação.
type Storage interface {
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
	// Ping verifica a disponibilidade (readiness).
	Ping(ctx context.Context) error
}

// Memory é uma implementação em memória para testes e desenvolvimento.
type Memory struct {
	mu   sync.Mutex
	objs map[string][]byte
}

func NewMemory() *Memory { return &Memory{objs: map[string][]byte{}} }

func (m *Memory) Put(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	b, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.objs[key] = b
	return nil
}

func (m *Memory) Get(_ context.Context, key string) (io.ReadCloser, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	b, ok := m.objs[key]
	if !ok {
		return nil, ErrNotFound
	}
	return io.NopCloser(bytesReader(b)), nil
}

func (m *Memory) Delete(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.objs, key) // idempotente
	return nil
}

func (m *Memory) Ping(context.Context) error { return nil }
