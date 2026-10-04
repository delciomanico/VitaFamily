package ids

import "testing"

func TestNewIsV4AndUnique(t *testing.T) {
	a, b := New(), New()
	if a == b {
		t.Fatal("ids repetidos")
	}
	if a.Version() != 4 {
		t.Fatalf("versão %d, esperado 4", a.Version())
	}
	if len(NewString()) != 36 {
		t.Fatal("formato inesperado")
	}
}
