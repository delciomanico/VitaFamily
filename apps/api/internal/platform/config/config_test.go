package config

import (
	"strings"
	"testing"
	"time"
)

func env(m map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) { v, ok := m[k]; return v, ok }
}

func TestDefaults(t *testing.T) {
	c, err := Load(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.Env != "local" || c.Port != "8080" || c.RateLimitBurst != 40 || c.ShutdownTimeout != 15*time.Second {
		t.Fatalf("defaults inesperados: %+v", c)
	}
}

func TestRequiredMissing(t *testing.T) {
	_, err := Load(env(nil), "DATABASE_URL")
	if err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("esperado erro sobre DATABASE_URL, obtido %v", err)
	}
	if _, err := Load(env(map[string]string{"DATABASE_URL": "postgres://x"}), "DATABASE_URL"); err != nil {
		t.Fatal(err)
	}
}

func TestInvalidValues(t *testing.T) {
	_, err := Load(env(map[string]string{"APP_ENV": "dev", "RATE_LIMIT_RPS": "-1", "SHUTDOWN_TIMEOUT": "x", "S3_USE_SSL": "maybe"}))
	if err == nil {
		t.Fatal("esperado erro")
	}
	for _, k := range []string{"APP_ENV", "RATE_LIMIT_RPS", "SHUTDOWN_TIMEOUT", "S3_USE_SSL"} {
		if !strings.Contains(err.Error(), k) {
			t.Errorf("erro deveria mencionar %s: %v", k, err)
		}
	}
}
