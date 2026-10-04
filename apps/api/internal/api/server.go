// Package api liga o contrato gerado (internal/api/gen) ao router: validação OpenAPI, middlewares
// e o Server que compõe os handlers dos módulos. Operações sem módulo respondem 501 (Unimplemented).
package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/go-chi/chi/v5"
	nethttpmw "github.com/oapi-codegen/nethttp-middleware"

	"github.com/cassfrei/vitafamily/apps/api/internal/api/gen"
	"github.com/cassfrei/vitafamily/apps/api/internal/platform/httpx"
)

// BasePath é o prefixo da API (o spec declara /api/v1 como servidor).
const BasePath = "/api/v1"

// fallback responde 501 às operações sem módulo. Está embutido um nível mais fundo que os
// handlers, por isso qualquer método implementado por um módulo sombreia o 501.
type fallback struct{ Unimplemented }

// Server implementa gen.StrictServerInterface por composição: cada módulo contribui com o handler
// das suas operações (alias exportado na raiz do módulo, ex.: users.HTTP). Para ligar um módulo:
// 1 campo embutido aqui + 1 campo em Deps + a construção em NewRouter.
type Server struct {
	*Health // HealthLive, HealthReady
	fallback
}

var _ gen.StrictServerInterface = Server{}

// Deps são as dependências do router.
type Deps struct {
	Log     *slog.Logger
	Health  *Health
	Limiter *httpx.Limiter
}

// NewRouter monta o handler HTTP completo.
//
// /health e /health/ready são servidos na raiz (sondas do Caddy/uptime, monitoring.md) e também
// em /api/v1 (o contrato declara-os sob o servidor /api/v1).
func NewRouter(d Deps) (http.Handler, error) {
	spec, err := gen.GetSpec()
	if err != nil {
		return nil, err
	}
	spec.Servers = openapi3.Servers{{URL: BasePath}}

	strict := gen.NewStrictHandlerWithOptions(Server{Health: d.Health}, nil, gen.StrictHTTPServerOptions{
		RequestErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, _ error) {
			httpx.WriteError(w, r, httpx.Problem(httpx.MalformedRequest).WithDetail("Pedido malformado."))
		},
		ResponseErrorHandlerFunc: httpx.WriteError,
	})

	r := chi.NewRouter()
	r.Use(httpx.RequestID, httpx.Recover(d.Log), httpx.Logging(d.Log), httpx.RateLimit(d.Limiter))
	r.NotFound(func(w http.ResponseWriter, r *http.Request) { httpx.WriteError(w, r, httpx.ErrNotFound) })
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteError(w, r, httpx.Problem(httpx.MalformedRequest).WithDetail("Método não permitido."))
	})

	r.Get("/health", strict.HealthLive)
	r.Get("/health/ready", strict.HealthReady)

	validator := nethttpmw.OapiRequestValidatorWithOptions(spec, &nethttpmw.Options{
		Options:               openapi3filter.Options{AuthenticationFunc: denyAll},
		ErrorHandlerWithOpts:  validationError,
		SilenceServersWarning: true,
	})
	r.Route(BasePath, func(r chi.Router) {
		r.Use(validator)
		gen.HandlerWithOptions(strict, gen.ChiServerOptions{
			BaseRouter: r,
			ErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, _ error) {
				httpx.WriteError(w, r, httpx.Problem(httpx.MalformedRequest).WithDetail("Parâmetro inválido."))
			},
		})
	})
	return r, nil
}

// denyAll falha fechado: até o módulo de autenticação (M1) existir, nenhuma rota protegida
// do contrato aceita pedidos.
func denyAll(context.Context, *openapi3filter.AuthenticationInput) error {
	return errors.New("autenticação ainda não disponível")
}

// validationError traduz falhas do validador OpenAPI para problem+json sem eco de valores do
// pedido (poderiam conter dados de saúde): só o caminho do campo.
func validationError(_ context.Context, err error, w http.ResponseWriter, r *http.Request, opts nethttpmw.ErrorHandlerOpts) {
	var secErr *openapi3filter.SecurityRequirementsError
	var reqErr *openapi3filter.RequestError
	switch {
	case errors.As(err, &secErr):
		httpx.WriteError(w, r, httpx.Problem(httpx.Unauthenticated).WithDetail("Sem sessão válida."))
	case opts.StatusCode == http.StatusNotFound:
		httpx.WriteError(w, r, httpx.ErrNotFound)
	case opts.StatusCode == http.StatusMethodNotAllowed:
		httpx.WriteError(w, r, httpx.Problem(httpx.MalformedRequest).WithDetail("Método não permitido."))
	case errors.As(err, &reqErr) && reqErr.Parameter == nil && reqErr.RequestBody != nil:
		var schemaErr *openapi3.SchemaError
		if errors.As(err, &schemaErr) {
			field := ""
			if path := schemaErr.JSONPointer(); len(path) > 0 {
				field = path[len(path)-1]
			}
			p := httpx.Problem(httpx.ValidationError).WithDetail("Dados inválidos.")
			if field != "" {
				p = p.WithFields(httpx.FieldError{Field: field, Message: "valor inválido"})
			}
			httpx.WriteError(w, r, p)
			return
		}
		httpx.WriteError(w, r, httpx.Problem(httpx.MalformedRequest).WithDetail("Corpo do pedido malformado."))
	default:
		httpx.WriteError(w, r, httpx.Problem(httpx.MalformedRequest).WithDetail("Pedido malformado."))
	}
}
