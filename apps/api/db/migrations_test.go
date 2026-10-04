package db

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// Os enums da migração 0001 têm de coincidir com docs/07-database/schema.md §6.
func TestEnumsMatchSchemaDoc(t *testing.T) {
	doc, err := os.ReadFile("../../../docs/07-database/schema.md")
	if err != nil {
		t.Fatal(err)
	}
	sec := strings.Split(strings.Split(string(doc), "## 6. Enums")[1], "## 7.")[0]
	want := map[string]string{}
	for _, m := range regexp.MustCompile("`(\\w+)`\\(([A-Z0-9_, ]+)\\)").FindAllStringSubmatch(sec, -1) {
		want[m[1]] = strings.ReplaceAll(m[2], " ", "")
	}
	sql, err := Migrations.ReadFile("migrations/0001_extensions_and_enums.sql")
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, m := range regexp.MustCompile(`CREATE TYPE (\w+) AS ENUM \(([^)]*)\)`).FindAllStringSubmatch(string(sql), -1) {
		got[m[1]] = strings.NewReplacer("'", "", " ", "").Replace(m[2])
	}
	if len(want) < 27 {
		t.Fatalf("enums do documento não lidos: %d", len(want))
	}
	for n, v := range want {
		if got[n] != v {
			t.Errorf("enum %s: migração=%q documento=%q", n, got[n], v)
		}
	}
	if len(got) != len(want) {
		t.Errorf("migração tem %d enums, documento %d", len(got), len(want))
	}
	for _, ext := range []string{"citext", "pgcrypto"} {
		if !strings.Contains(string(sql), "CREATE EXTENSION IF NOT EXISTS "+ext) {
			t.Errorf("extensão em falta: %s", ext)
		}
	}
}
