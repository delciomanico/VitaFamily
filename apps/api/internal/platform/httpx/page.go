package httpx

const (
	DefaultPageLimit = 25
	MaxPageLimit     = 100
)

// Page são os parâmetros de paginação por cursor (`?limit=` 1–100, defeito 25; `?cursor=`).
type Page struct {
	Limit  int
	Cursor string
}

// ParsePage valida limit/cursor opcionais (ponteiros, como geram os tipos do oapi-codegen).
// Limit fora de 1–100 é VALIDATION_ERROR.
func ParsePage(limit *int, cursor *string) (Page, error) {
	p := Page{Limit: DefaultPageLimit}
	if limit != nil {
		if *limit < 1 || *limit > MaxPageLimit {
			return Page{}, Problem(ValidationError).WithDetail("Limite inválido.").
				WithFields(FieldError{Field: "limit", Message: "deve estar entre 1 e 100"})
		}
		p.Limit = *limit
	}
	if cursor != nil {
		p.Cursor = *cursor
	}
	return p, nil
}
