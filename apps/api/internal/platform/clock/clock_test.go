package clock

import (
	"testing"
	"time"
)

func TestSystemIsUTC(t *testing.T) {
	if (System{}).Now().Location() != time.UTC {
		t.Fatal("o relógio de sistema deve devolver UTC")
	}
}

func TestFake(t *testing.T) {
	start := time.Date(2026, 1, 2, 3, 4, 5, 0, time.FixedZone("X", 3600))
	f := NewFake(start)
	if !f.Now().Equal(start) || f.Now().Location() != time.UTC {
		t.Fatal("Fake deve manter o instante em UTC")
	}
	f.Advance(time.Hour)
	if got := f.Now(); !got.Equal(start.Add(time.Hour)) {
		t.Fatalf("Advance: %v", got)
	}
	f.Set(start)
	if !f.Now().Equal(start) {
		t.Fatal("Set")
	}
}
