package httpx

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"regexp"
	"runtime/debug"
	"sync"
	"time"

	"golang.org/x/time/rate"

	"github.com/cassfrei/vitafamily/apps/api/internal/platform/ids"
)

// RequestIDHeader transporta o id do pedido.
const RequestIDHeader = "X-Request-Id"

var validRequestID = regexp.MustCompile(`^[A-Za-z0-9._-]{8,64}$`)

// RequestID atribui um id a cada pedido (aceita um id de entrada válido, senão gera UUID v4),
// coloca-o no contexto e na resposta.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(RequestIDHeader)
		if !validRequestID.MatchString(id) {
			id = ids.NewString()
		}
		w.Header().Set(RequestIDHeader, id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey, id)))
	})
}

// Recover converte pânicos em 500 INTERNAL_ERROR genérico; o detalhe fica no log.
func Recover(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					if rec == http.ErrAbortHandler {
						panic(rec)
					}
					log.Error("panic", "requestId", RequestIDFrom(r.Context()), "panic", rec, "stack", string(debug.Stack()))
					WriteError(w, r, Problem(InternalError))
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

type statusWriter struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (s *statusWriter) WriteHeader(code int) {
	if !s.wrote {
		s.status, s.wrote = code, true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusWriter) Write(b []byte) (int, error) {
	if !s.wrote {
		s.status, s.wrote = http.StatusOK, true
	}
	return s.ResponseWriter.Write(b)
}

func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// Logging regista um evento por pedido: método, caminho (SEM query string), estado, duração,
// requestId e ator. Nunca regista cabeçalhos nem corpos (dados de saúde/segredos).
func Logging(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(sw, r)
			attrs := []any{"method", r.Method, "path", r.URL.Path, "status", sw.status,
				"durationMs", time.Since(start).Milliseconds(), "requestId", RequestIDFrom(r.Context())}
			if a, ok := Actor(r.Context()); ok {
				attrs = append(attrs, "userId", a.UserID.String())
			}
			level := slog.LevelInfo
			if sw.status >= 500 {
				level = slog.LevelError
			}
			log.Log(r.Context(), level, "http", attrs...)
		})
	}
}

// Limiter é um rate limiter em memória por chave (uma única instância da API, ADR-012).
type Limiter struct {
	rps   rate.Limit
	burst int
	now   func() time.Time

	mu      sync.Mutex
	entries map[string]*limiterEntry
	sweepAt time.Time
}

type limiterEntry struct {
	l    *rate.Limiter
	seen time.Time
}

// NewLimiter: rps pedidos/segundo com rajada burst, por chave.
func NewLimiter(rps float64, burst int) *Limiter {
	return &Limiter{rps: rate.Limit(rps), burst: burst, now: time.Now, entries: map[string]*limiterEntry{}}
}

// Allow consome um token da chave; se não houver, devolve o tempo de espera sugerido.
func (l *Limiter) Allow(key string) (bool, time.Duration) {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if now.After(l.sweepAt) { // limpa chaves inativas para limitar a memória
		for k, e := range l.entries {
			if now.Sub(e.seen) > 10*time.Minute {
				delete(l.entries, k)
			}
		}
		l.sweepAt = now.Add(time.Minute)
	}
	e, ok := l.entries[key]
	if !ok {
		e = &limiterEntry{l: rate.NewLimiter(l.rps, l.burst)}
		l.entries[key] = e
	}
	e.seen = now
	res := e.l.ReserveN(now, 1)
	if d := res.DelayFrom(now); d > 0 {
		res.CancelAt(now)
		return false, d
	}
	return true, 0
}

// ClientIP devolve o IP remoto (RemoteAddr). Atrás do Caddy, a API deve ser configurada para
// confiar no proxy (middleware RealIP) — decisão de M10/devops; por defeito não confia em cabeçalhos.
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// RateLimit aplica o limiter por IP; ao exceder devolve 429 RATE_LIMITED com Retry-After.
// Endpoints de autenticação (M1) usam um Limiter mais restritivo e falham fechado.
func RateLimit(l *Limiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if ok, wait := l.Allow(ClientIP(r)); !ok {
				WriteError(w, r, Problem(RateLimited).WithDetail("Demasiados pedidos. Tente novamente mais tarde.").WithRetryAfter(wait))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
