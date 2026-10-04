// Package logx cria o logger JSON (slog) com redação de campos sensíveis (NFR-SEC, conventions §3.7).
// Regra: nunca registar dados de saúde, tokens, palavras-passe nem corpos de pedidos.
package logx

import (
	"io"
	"log/slog"
	"strings"
)

const redacted = "[REDACTED]"

// sensitiveKeys são nomes de atributos (em minúsculas) cujo valor é sempre redigido.
var sensitiveKeys = map[string]struct{}{
	"password": {}, "new_password": {}, "current_password": {}, "passwd": {},
	"token": {}, "access_token": {}, "refresh_token": {}, "id_token": {}, "refreshtoken": {}, "accesstoken": {},
	"authorization": {}, "cookie": {}, "set-cookie": {}, "secret": {}, "api_key": {}, "apikey": {},
	"smtp_url": {}, "database_url": {}, "s3_secret_key": {}, "jwt_signing_keys": {}, "vapid_private_key": {},
	"body": {}, "notes": {}, "note": {}, "diagnosis": {}, "allergy": {}, "condition": {},
	"medication": {}, "dosage": {}, "result": {}, "health": {},
}

// Secret marca um valor para ser sempre redigido, qualquer que seja a chave.
type Secret string

// LogValue implementa slog.LogValuer.
func (Secret) LogValue() slog.Value { return slog.StringValue(redacted) }

// Sensitive devolve um atributo cujo valor é redigido (campo "marcado").
func Sensitive(key string) slog.Attr { return slog.String(key, redacted) }

func replaceAttr(_ []string, a slog.Attr) slog.Attr {
	if _, ok := sensitiveKeys[strings.ToLower(a.Key)]; ok {
		return slog.String(a.Key, redacted)
	}
	return a
}

// New cria um logger JSON em w com o nível indicado (debug|info|warn|error; por defeito info).
func New(w io.Writer, level string) *slog.Logger {
	var lvl slog.Level
	if err := lvl.UnmarshalText([]byte(strings.ToUpper(level))); err != nil {
		lvl = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: lvl, ReplaceAttr: replaceAttr}))
}
