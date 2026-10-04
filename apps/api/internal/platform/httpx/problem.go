// Package httpx: erros application/problem+json (RFC 9457), middlewares, Actor e paginação.
// Catálogo de códigos = docs/05-api/errors.md (verificado por teste contra o documento).
package httpx

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"
)

// Code é o código estável do erro (os clientes dependem dele, não da mensagem).
type Code string

const (
	MalformedRequest          Code = "MALFORMED_REQUEST"
	AuthInvalidCredentials    Code = "AUTH_INVALID_CREDENTIALS"
	TokenExpired              Code = "TOKEN_EXPIRED"
	Unauthenticated           Code = "UNAUTHENTICATED"
	AccountSuspended          Code = "ACCOUNT_SUSPENDED"
	EmailNotVerified          Code = "EMAIL_NOT_VERIFIED"
	Forbidden                 Code = "FORBIDDEN"
	InvitationEmailMismatch   Code = "INVITATION_EMAIL_MISMATCH"
	TermsReacceptanceReq      Code = "TERMS_REACCEPTANCE_REQUIRED"
	InvitationInvalid         Code = "INVITATION_INVALID"
	NotFound                  Code = "NOT_FOUND"
	AccountDeletionBlocked    Code = "ACCOUNT_DELETION_BLOCKED"
	Conflict                  Code = "CONFLICT"
	DocumentLimitExceeded     Code = "DOCUMENT_LIMIT_EXCEEDED"
	DocumentNotAvailable      Code = "DOCUMENT_NOT_AVAILABLE"
	DoseInFuture              Code = "DOSE_IN_FUTURE"
	DoseWindowExpired         Code = "DOSE_WINDOW_EXPIRED"
	ExportNotReady            Code = "EXPORT_NOT_READY"
	FamilyNotEmpty            Code = "FAMILY_NOT_EMPTY"
	InvalidStateTransition    Code = "INVALID_STATE_TRANSITION"
	LastAdmin                 Code = "LAST_ADMIN"
	LastGuardian              Code = "LAST_GUARDIAN"
	LimitExceeded             Code = "LIMIT_EXCEEDED"
	StorageQuotaExceeded      Code = "STORAGE_QUOTA_EXCEEDED"
	InvitationExpired         Code = "INVITATION_EXPIRED"
	FileTooLarge              Code = "FILE_TOO_LARGE"
	FileTypeNotAllowed        Code = "FILE_TYPE_NOT_ALLOWED"
	AgeRequirementNotMet      Code = "AGE_REQUIREMENT_NOT_MET"
	BirthdateMismatch         Code = "BIRTHDATE_MISMATCH"
	DependentAccountAge       Code = "DEPENDENT_ACCOUNT_AGE"
	DependentRequiresGuardian Code = "DEPENDENT_REQUIRES_GUARDIAN"
	GuardianInvalid           Code = "GUARDIAN_INVALID"
	InvalidSchedule           Code = "INVALID_SCHEDULE"
	MinorMustBeDependent      Code = "MINOR_MUST_BE_DEPENDENT"
	PasswordWeak              Code = "PASSWORD_WEAK"
	ValidationError           Code = "VALIDATION_ERROR"
	MemberBlocked             Code = "MEMBER_BLOCKED"
	RateLimited               Code = "RATE_LIMITED"
	InternalError             Code = "INTERNAL_ERROR"
	ServiceUnavailable        Code = "SERVICE_UNAVAILABLE"
)

type entry struct {
	status int
	title  string
}

// catalog: HTTP e título (pt-PT, sem dados de saúde) por código.
var catalog = map[Code]entry{
	MalformedRequest:          {400, "Pedido malformado"},
	AuthInvalidCredentials:    {401, "Credenciais inválidas"},
	TokenExpired:              {401, "Sessão expirada"},
	Unauthenticated:           {401, "Sem sessão válida"},
	AccountSuspended:          {403, "Conta suspensa"},
	EmailNotVerified:          {403, "E-mail por verificar"},
	Forbidden:                 {403, "Sem permissão"},
	InvitationEmailMismatch:   {403, "E-mail diferente do convite"},
	TermsReacceptanceReq:      {403, "Novos termos por aceitar"},
	InvitationInvalid:         {404, "Convite inválido"},
	NotFound:                  {404, "Não encontrado"},
	AccountDeletionBlocked:    {409, "Eliminação da conta bloqueada"},
	Conflict:                  {409, "Conflito"},
	DocumentLimitExceeded:     {409, "Limite de ficheiros excedido"},
	DocumentNotAvailable:      {409, "Documento indisponível"},
	DoseInFuture:              {409, "Toma futura"},
	DoseWindowExpired:         {409, "Janela da toma expirada"},
	ExportNotReady:            {409, "Exportação ainda não está pronta"},
	FamilyNotEmpty:            {409, "A família ainda tem membros"},
	InvalidStateTransition:    {409, "Transição de estado não permitida"},
	LastAdmin:                 {409, "Último administrador da família"},
	LastGuardian:              {409, "Último tutor do dependente"},
	LimitExceeded:             {409, "Limite atingido"},
	StorageQuotaExceeded:      {409, "Quota de armazenamento excedida"},
	InvitationExpired:         {410, "Convite expirado"},
	FileTooLarge:              {413, "Ficheiro demasiado grande"},
	FileTypeNotAllowed:        {415, "Tipo de ficheiro não permitido"},
	AgeRequirementNotMet:      {422, "Idade mínima não cumprida"},
	BirthdateMismatch:         {422, "Data de nascimento não coincide"},
	DependentAccountAge:       {422, "Idade mínima para conta de dependente"},
	DependentRequiresGuardian: {422, "Dependente exige tutor"},
	GuardianInvalid:           {422, "Tutor inválido"},
	InvalidSchedule:           {422, "Plano de toma inválido"},
	MinorMustBeDependent:      {422, "Menor tem de ser dependente"},
	PasswordWeak:              {422, "Palavra-passe fraca"},
	ValidationError:           {422, "Dados inválidos"},
	MemberBlocked:             {423, "Perfil bloqueado"},
	RateLimited:               {429, "Demasiados pedidos"},
	InternalError:             {500, "Erro interno"},
	ServiceUnavailable:        {503, "Serviço indisponível"},
}

// Codes devolve todos os códigos do catálogo (para testes e documentação).
func Codes() []Code {
	out := make([]Code, 0, len(catalog))
	for c := range catalog {
		out = append(out, c)
	}
	return out
}

// Status devolve o estado HTTP do código (500 se desconhecido).
func (c Code) Status() int {
	if e, ok := catalog[c]; ok {
		return e.status
	}
	return http.StatusInternalServerError
}

// FieldError descreve um campo inválido (só em VALIDATION_ERROR).
type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// ProblemError é um erro que se traduz diretamente em problem+json.
type ProblemError struct {
	Code       Code
	Detail     string
	Fields     []FieldError
	RetryAfter time.Duration
	// status substitui o do catálogo (uso interno: ErrNotImplemented).
	status int
}

// Problem cria o erro para o código; usar sempre em vez de http.Error.
func Problem(code Code) *ProblemError { return &ProblemError{Code: code} }

// WithDetail define a mensagem curta em pt-PT (sem dados de saúde nem nomes de membros).
func (p *ProblemError) WithDetail(d string) *ProblemError { c := *p; c.Detail = d; return &c }

// WithFields acrescenta erros por campo (só para VALIDATION_ERROR).
func (p *ProblemError) WithFields(f ...FieldError) *ProblemError { c := *p; c.Fields = f; return &c }

// WithRetryAfter define Retry-After (RATE_LIMITED).
func (p *ProblemError) WithRetryAfter(d time.Duration) *ProblemError {
	c := *p
	c.RetryAfter = d
	return &c
}

func (p *ProblemError) Error() string { return string(p.Code) }

// Is permite errors.Is(err, httpx.ErrNotFound): compara só o código.
func (p *ProblemError) Is(target error) bool {
	t, ok := target.(*ProblemError)
	return ok && t.Code == p.Code
}

// Erros de domínio mais comuns, para errors.Is (conventions §3.5). Os restantes códigos
// criam-se com Problem(code).
var (
	ErrNotFound        = Problem(NotFound)
	ErrForbidden       = Problem(Forbidden)
	ErrUnauthenticated = Problem(Unauthenticated)
	ErrConflict        = Problem(Conflict)
	ErrLastAdmin       = Problem(LastAdmin)
	ErrLastGuardian    = Problem(LastGuardian)
	ErrInvalidState    = Problem(InvalidStateTransition)
	// ErrNotImplemented: operação do contrato ainda sem módulo (andaime até M10); 501.
	ErrNotImplemented = &ProblemError{Code: InternalError, Detail: "Funcionalidade ainda não implementada.", status: http.StatusNotImplemented}
)

type problemBody struct {
	Type      string       `json:"type"`
	Title     string       `json:"title"`
	Status    int          `json:"status"`
	Code      Code         `json:"code"`
	Detail    string       `json:"detail,omitempty"`
	RequestID string       `json:"requestId"`
	Errors    []FieldError `json:"errors,omitempty"`
}

// ProblemTypeBase é o prefixo do campo `type` (URI estável; não precisa de resolver).
const ProblemTypeBase = "https://vitafamily.cassfrei.com/problems/"

// ToProblem é a ÚNICA função que traduz erros em Problem: ProblemError passa tal e qual;
// qualquer outro erro é INTERNAL_ERROR genérico (o detalhe fica nos logs).
func ToProblem(err error) *ProblemError {
	var p *ProblemError
	if errors.As(err, &p) {
		return p
	}
	return Problem(InternalError)
}

// WriteError escreve err como application/problem+json. Em 5xx nunca expõe o detalhe do erro.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	p := ToProblem(err)
	e, ok := catalog[p.Code]
	if !ok {
		p, e = Problem(InternalError), catalog[InternalError]
	}
	status := e.status
	if p.status != 0 {
		status = p.status
	}
	body := problemBody{
		Type: ProblemTypeBase + string(p.Code), Title: e.title, Status: status, Code: p.Code,
		RequestID: RequestIDFrom(r.Context()),
	}
	if status < 500 || status == http.StatusNotImplemented || status == http.StatusServiceUnavailable {
		body.Detail = p.Detail
	}
	if p.Code == ValidationError {
		body.Errors = p.Fields
	}
	if p.RetryAfter > 0 {
		secs := int(p.RetryAfter.Round(time.Second) / time.Second)
		if secs < 1 {
			secs = 1
		}
		w.Header().Set("Retry-After", strconv.Itoa(secs))
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
