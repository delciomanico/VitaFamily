package jobs

import (
	"testing"

	"github.com/cassfrei/vitafamily/apps/api/internal/platform/logx"
)

func TestNewClient(t *testing.T) {
	log := logx.New(discard{}, "error")
	if c, err := NewClient(nil, nil, log); err != nil || c == nil {
		t.Fatalf("modo só-inserção: %v", err)
	}
	// O modo worker exige pool real (testado com testcontainers a partir do M1).
	_ = NewWorkers()
}

type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }
