package logx

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
)

func TestRedaction(t *testing.T) {
	var buf bytes.Buffer
	l := New(&buf, "info")
	l.Info("x",
		"password", "hunter2",
		"Authorization", "Bearer abc",
		slog.Group("req", slog.String("refresh_token", "r1"), slog.String("path", "/ok")),
		"diagnosis", "asma",
		"wrapped", Secret("s3cr3t"),
		Sensitive("custom"),
		"safe", "visible",
	)
	out := buf.String()
	for _, leak := range []string{"hunter2", "Bearer abc", "r1", "asma", "s3cr3t"} {
		if strings.Contains(out, leak) {
			t.Errorf("valor vazou nos logs: %q em %s", leak, out)
		}
	}
	var m map[string]any
	if err := json.Unmarshal(buf.Bytes(), &m); err != nil {
		t.Fatal(err)
	}
	if m["safe"] != "visible" || m["req"].(map[string]any)["path"] != "/ok" {
		t.Fatalf("campos normais devem manter-se: %s", out)
	}
}

func TestLevel(t *testing.T) {
	var buf bytes.Buffer
	l := New(&buf, "warn")
	l.Info("não deve aparecer")
	if buf.Len() != 0 {
		t.Fatal("nível warn deve filtrar info")
	}
	if New(&buf, "lixo") == nil {
		t.Fatal("nível inválido deve cair em info")
	}
}
