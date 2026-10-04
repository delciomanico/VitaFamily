// Package config carrega a configuração por variáveis de ambiente (docs/10-operations/environment.md).
// Valida no arranque: falha rápida se faltar algo obrigatório. Valores nunca no repositório.
package config

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Config agrupa a configuração da aplicação. Os campos de segredos nunca são registados em logs.
type Config struct {
	Env         string // local | test | staging | production
	Port        string
	AppBaseURL  string
	PWAOrigin   string
	LogLevel    string
	DatabaseURL string

	S3Endpoint        string
	S3Region          string
	S3UseSSL          bool
	S3BucketDocuments string
	S3BucketExports   string
	S3AccessKey       string
	S3SecretKey       string

	SMTPURL  string
	MailFrom string

	RateLimitRPS   float64
	RateLimitBurst int

	ShutdownTimeout time.Duration
}

// Load lê a configuração de lookup (tipicamente os.LookupEnv). `required` controla quais
// variáveis são obrigatórias (api/worker/migrate exigem DATABASE_URL).
func Load(lookup func(string) (string, bool), required ...string) (Config, error) {
	get := func(k, def string) string {
		if v, ok := lookup(k); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
		return def
	}
	c := Config{
		Env:               get("APP_ENV", "local"),
		Port:              get("PORT", "8080"),
		AppBaseURL:        get("APP_BASE_URL", "http://localhost:8080"),
		PWAOrigin:         get("PWA_ORIGIN", ""),
		LogLevel:          get("LOG_LEVEL", "info"),
		DatabaseURL:       get("DATABASE_URL", ""),
		S3Endpoint:        get("S3_ENDPOINT", ""),
		S3Region:          get("S3_REGION", "eu-west-1"),
		S3BucketDocuments: get("S3_BUCKET_DOCUMENTS", "vita-documents"),
		S3BucketExports:   get("S3_BUCKET_EXPORTS", "vita-exports"),
		S3AccessKey:       get("S3_ACCESS_KEY", ""),
		S3SecretKey:       get("S3_SECRET_KEY", ""),
		SMTPURL:           get("SMTP_URL", ""),
		MailFrom:          get("MAIL_FROM", ""),
	}
	var errs []error
	var err error
	if c.S3UseSSL, err = parseBool(get("S3_USE_SSL", "false")); err != nil {
		errs = append(errs, fmt.Errorf("S3_USE_SSL: %w", err))
	}
	if c.RateLimitRPS, err = strconv.ParseFloat(get("RATE_LIMIT_RPS", "20"), 64); err != nil || c.RateLimitRPS <= 0 {
		errs = append(errs, errors.New("RATE_LIMIT_RPS: número positivo esperado"))
	}
	if c.RateLimitBurst, err = strconv.Atoi(get("RATE_LIMIT_BURST", "40")); err != nil || c.RateLimitBurst <= 0 {
		errs = append(errs, errors.New("RATE_LIMIT_BURST: inteiro positivo esperado"))
	}
	if c.ShutdownTimeout, err = time.ParseDuration(get("SHUTDOWN_TIMEOUT", "15s")); err != nil {
		errs = append(errs, fmt.Errorf("SHUTDOWN_TIMEOUT: %w", err))
	}
	switch c.Env {
	case "local", "test", "staging", "production":
	default:
		errs = append(errs, fmt.Errorf("APP_ENV inválido: %q", c.Env))
	}
	values := map[string]string{"DATABASE_URL": c.DatabaseURL, "S3_ENDPOINT": c.S3Endpoint,
		"S3_ACCESS_KEY": c.S3AccessKey, "S3_SECRET_KEY": c.S3SecretKey, "SMTP_URL": c.SMTPURL, "MAIL_FROM": c.MailFrom}
	for _, k := range required {
		if values[k] == "" {
			errs = append(errs, fmt.Errorf("variável obrigatória em falta: %s", k))
		}
	}
	return c, errors.Join(errs...)
}

func parseBool(s string) (bool, error) { return strconv.ParseBool(s) }
