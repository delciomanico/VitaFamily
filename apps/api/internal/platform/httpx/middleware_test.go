package httpx

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/cassfrei/vitafamily/apps/api/internal/platform/logx"
)

func TestRequestID(t *testing.T) {
	var seen string
	h := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { seen = RequestIDFrom(r.Context()) }))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if seen == "" || w.Header().Get(RequestIDHeader) != seen {
		t.Fatal("id gerado e devolvido")
	}
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set(RequestIDHeader, "client-id-12345")
	h.ServeHTTP(httptest.NewRecorder(), r)
	if seen != "client-id-12345" {
		t.Fatal("deve aceitar id válido")
	}
	r.Header.Set(RequestIDHeader, "bad id\nwith newline")
	h.ServeHTTP(httptest.NewRecorder(), r)
	if seen == "bad id\nwith newline" {
		t.Fatal("deve rejeitar id inválido")
	}
}

func TestRecover(t *testing.T) {
	var buf bytes.Buffer
	log := logx.New(&buf, "info")
	h := RequestID(Recover(log)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("segredo-interno") })))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 500 || strings.Contains(w.Body.String(), "segredo-interno") || !strings.Contains(w.Body.String(), "INTERNAL_ERROR") {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if !strings.Contains(buf.String(), "segredo-interno") {
		t.Fatal("o detalhe deve ir para os logs")
	}
}

func TestLoggingDoesNotLeakQueryHeadersBody(t *testing.T) {
	var buf bytes.Buffer
	log := logx.New(&buf, "info")
	h := RequestID(Logging(log)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })))
	r := httptest.NewRequest("POST", "/api/v1/x?token=SECRETQ", strings.NewReader(`{"password":"PWBODY"}`))
	r.Header.Set("Authorization", "Bearer AUTHHDR")
	h.ServeHTTP(httptest.NewRecorder(), r)
	out := buf.String()
	for _, leak := range []string{"SECRETQ", "PWBODY", "AUTHHDR"} {
		if strings.Contains(out, leak) {
			t.Errorf("vazou %s: %s", leak, out)
		}
	}
	if !strings.Contains(out, `"status":204`) || !strings.Contains(out, `"path":"/api/v1/x"`) || !strings.Contains(out, "requestId") {
		t.Fatalf("campos em falta: %s", out)
	}
}

func TestLimiter(t *testing.T) {
	now := time.Unix(1000, 0)
	l := NewLimiter(1, 2)
	l.now = func() time.Time { return now }
	for i := 0; i < 2; i++ {
		if ok, _ := l.Allow("a"); !ok {
			t.Fatalf("pedido %d deveria passar", i)
		}
	}
	if ok, wait := l.Allow("a"); ok || wait <= 0 {
		t.Fatal("terceiro pedido deve ser limitado")
	}
	if ok, _ := l.Allow("b"); !ok {
		t.Fatal("chaves independentes")
	}
	now = now.Add(2 * time.Second)
	if ok, _ := l.Allow("a"); !ok {
		t.Fatal("tokens repostos com o tempo")
	}
	now = now.Add(time.Hour)
	l.Allow("c")
	if len(l.entries) != 1 {
		t.Fatalf("entradas inativas devem ser removidas: %d", len(l.entries))
	}
}

func TestRateLimitMiddleware(t *testing.T) {
	h := RequestID(RateLimit(NewLimiter(0.001, 1))(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})))
	do := func() *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = "203.0.113.9:5555"
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if do().Code != 200 {
		t.Fatal("primeiro pedido")
	}
	w := do()
	if w.Code != 429 || w.Header().Get("Retry-After") == "" || !strings.Contains(w.Body.String(), "RATE_LIMITED") {
		t.Fatalf("%d %v %s", w.Code, w.Header(), w.Body)
	}
}

func TestActor(t *testing.T) {
	if _, ok := Actor(httptest.NewRequest("GET", "/", nil).Context()); ok {
		t.Fatal("sem ator")
	}
}
