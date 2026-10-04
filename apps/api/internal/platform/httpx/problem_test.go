package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strconv"
	"testing"
	"time"
)

// O catálogo tem de coincidir exatamente (códigos e estados HTTP) com docs/05-api/errors.md.
func TestCatalogMatchesErrorsDoc(t *testing.T) {
	b, err := os.ReadFile("../../../../../docs/05-api/errors.md")
	if err != nil {
		t.Fatal(err)
	}
	re := regexp.MustCompile("(?m)^\\| `([A-Z_]+)` \\| (\\d{3}) \\|")
	m := re.FindAllStringSubmatch(string(b), -1)
	if len(m) < 40 {
		t.Fatalf("catálogo do documento não lido (%d linhas)", len(m))
	}
	seen := map[Code]bool{}
	for _, x := range m {
		code := Code(x[1])
		want, _ := strconv.Atoi(x[2])
		e, ok := catalog[code]
		if !ok {
			t.Errorf("código em falta no catálogo: %s", code)
			continue
		}
		if e.status != want {
			t.Errorf("%s: estado %d, documento diz %d", code, e.status, want)
		}
		seen[code] = true
	}
	for _, c := range Codes() {
		if !seen[c] {
			t.Errorf("código %s não está em errors.md", c)
		}
	}
}

func TestWriteError(t *testing.T) {
	r := httptest.NewRequest("GET", "/x", nil)
	w := httptest.NewRecorder()
	WriteError(w, r, fmt.Errorf("ctx: %w", ErrNotFound))
	if w.Code != 404 || w.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("%d %s", w.Code, w.Header())
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["code"] != "NOT_FOUND" || body["status"].(float64) != 404 || body["type"] != ProblemTypeBase+"NOT_FOUND" {
		t.Fatalf("%v", body)
	}
	if _, ok := body["requestId"]; !ok {
		t.Fatal("requestId obrigatório")
	}
}

func TestInternalErrorIsGeneric(t *testing.T) {
	w := httptest.NewRecorder()
	WriteError(w, httptest.NewRequest("GET", "/", nil), errors.New("pq: connection to 10.0.0.1 failed"))
	if w.Code != 500 || contains(w.Body.String(), "10.0.0.1") || contains(w.Body.String(), "detail") {
		t.Fatalf("5xx não pode expor detalhe: %d %s", w.Code, w.Body)
	}
	// Mesmo com Detail explícito, 5xx omite o detalhe.
	w = httptest.NewRecorder()
	WriteError(w, httptest.NewRequest("GET", "/", nil), Problem(InternalError).WithDetail("segredo"))
	if contains(w.Body.String(), "segredo") {
		t.Fatal("detalhe em 500")
	}
}

func TestValidationFieldsAndRetryAfter(t *testing.T) {
	w := httptest.NewRecorder()
	WriteError(w, httptest.NewRequest("GET", "/", nil),
		Problem(ValidationError).WithFields(FieldError{"email", "inválido"}))
	var b problemBody
	_ = json.Unmarshal(w.Body.Bytes(), &b)
	if w.Code != 422 || len(b.Errors) != 1 || b.Errors[0].Field != "email" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	w = httptest.NewRecorder()
	WriteError(w, httptest.NewRequest("GET", "/", nil), Problem(NotFound).WithFields(FieldError{"a", "b"}))
	if contains(w.Body.String(), "errors") {
		t.Fatal("errors[] só em VALIDATION_ERROR")
	}
	w = httptest.NewRecorder()
	WriteError(w, httptest.NewRequest("GET", "/", nil), Problem(RateLimited).WithRetryAfter(1500*time.Millisecond))
	if w.Code != http.StatusTooManyRequests || w.Header().Get("Retry-After") != "2" {
		t.Fatalf("Retry-After=%q", w.Header().Get("Retry-After"))
	}
}

func TestErrorsIsByCode(t *testing.T) {
	if !errors.Is(Problem(LastAdmin).WithDetail("x"), ErrLastAdmin) || errors.Is(ErrNotFound, ErrForbidden) {
		t.Fatal("errors.Is deve comparar pelo código")
	}
}

func TestNotImplemented(t *testing.T) {
	w := httptest.NewRecorder()
	WriteError(w, httptest.NewRequest("GET", "/", nil), ErrNotImplemented)
	if w.Code != 501 {
		t.Fatalf("%d", w.Code)
	}
}

func TestParsePage(t *testing.T) {
	p, err := ParsePage(nil, nil)
	if err != nil || p.Limit != 25 {
		t.Fatalf("%v %v", p, err)
	}
	for _, bad := range []int{0, 101, -1} {
		if _, err := ParsePage(&bad, nil); !errors.Is(err, Problem(ValidationError)) {
			t.Errorf("limit %d deveria falhar", bad)
		}
	}
	l, c := 100, "abc"
	if p, err := ParsePage(&l, &c); err != nil || p.Limit != 100 || p.Cursor != "abc" {
		t.Fatalf("%v %v", p, err)
	}
}

func contains(s, sub string) bool { return regexp.MustCompile(regexp.QuoteMeta(sub)).MatchString(s) }
