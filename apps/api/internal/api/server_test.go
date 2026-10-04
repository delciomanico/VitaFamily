package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/cassfrei/vitafamily/apps/api/internal/platform/httpx"
	"github.com/cassfrei/vitafamily/apps/api/internal/platform/logx"
)

func router(t *testing.T, checks ...Check) http.Handler {
	t.Helper()
	log := logx.New(io.Discard, "error")
	h, err := NewRouter(Deps{Log: log, Health: NewHealth(log, checks...), Limiter: httpx.NewLimiter(1000, 1000)})
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func do(h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestHealth(t *testing.T) {
	h := router(t, Check{"ok", func(context.Context) error { return nil }})
	for _, p := range []string{"/health", "/health/ready", "/api/v1/health", "/api/v1/health/ready"} {
		w := do(h, "GET", p, "")
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"status"`) {
			t.Errorf("%s: %d %s", p, w.Code, w.Body)
		}
		if w.Header().Get("X-Request-Id") == "" {
			t.Errorf("%s: sem X-Request-Id", p)
		}
	}
}

func TestReadyFailsWith503WithoutLeakingCause(t *testing.T) {
	h := router(t, Check{"database", func(context.Context) error { return errors.New("dial tcp 10.1.2.3:5432: refused") }})
	if w := do(h, "GET", "/health", ""); w.Code != 200 {
		t.Fatalf("liveness não depende de dependências: %d", w.Code)
	}
	w := do(h, "GET", "/health/ready", "")
	if w.Code != 503 || !strings.Contains(w.Body.String(), "SERVICE_UNAVAILABLE") || strings.Contains(w.Body.String(), "10.1.2.3") {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if w.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatal("content-type")
	}
}

func TestProtectedRoutesFailClosed(t *testing.T) {
	w := do(router(t), "GET", "/api/v1/users/me", "")
	if w.Code != 401 || !strings.Contains(w.Body.String(), "UNAUTHENTICATED") {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func TestValidationAndUnimplemented(t *testing.T) {
	h := router(t)
	// corpo inválido: 422 sem ecoar o valor
	w := do(h, "POST", "/api/v1/auth/register", `{"email":"nao-e-email","password":"x"}`)
	if w.Code != 422 || !strings.Contains(w.Body.String(), "VALIDATION_ERROR") || strings.Contains(w.Body.String(), "nao-e-email") {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	// JSON inválido: 400
	if w := do(h, "POST", "/api/v1/auth/register", `{`); w.Code != 400 || !strings.Contains(w.Body.String(), "MALFORMED_REQUEST") {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	// pedido válido de operação pública ainda sem módulo: 501 problem+json
	ok := `{"email":"a@b.pt","password":"x","name":"n","birthDate":"1990-01-01","timezone":"Europe/Lisbon","termsVersion":"1"}`
	if w := do(h, "POST", "/api/v1/auth/register", ok); w.Code != 501 || w.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	// rota inexistente
	if w := do(h, "GET", "/api/v1/nao-existe", ""); w.Code != 404 || !strings.Contains(w.Body.String(), "NOT_FOUND") {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if w := do(h, "GET", "/nada", ""); w.Code != 404 || !strings.Contains(w.Body.String(), "NOT_FOUND") {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func TestRateLimited(t *testing.T) {
	log := logx.New(io.Discard, "error")
	h, _ := NewRouter(Deps{Log: log, Health: NewHealth(log), Limiter: httpx.NewLimiter(0.001, 1)})
	do(h, "GET", "/health", "")
	w := do(h, "GET", "/health", "")
	if w.Code != 429 || w.Header().Get("Retry-After") == "" {
		t.Fatalf("%d", w.Code)
	}
}
