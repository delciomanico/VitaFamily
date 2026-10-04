package internal

import (
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

const modulePath = "github.com/cassfrei/vitafamily/apps/api/internal/"

// Arquitetura: monólito modular em camadas (docs/06-architecture/modules.md, ADR-002/012).
//
//	internal/platform/         kit técnico partilhado (não conhece módulos)
//	internal/api/              montagem HTTP (router + contrato gerado)
//	internal/modules/<m>/      raiz = API pública do módulo
//	  internal/domain|service|repo|handler   camadas (o compilador impede o acesso de fora do módulo)

// allowed: módulo -> módulos que a sua raiz/service pode importar (modules.md §2).
var allowed = map[string][]string{
	"audit":         {},
	"users":         {"audit"},
	"auth":          {"users", "notifications", "audit"},
	"families":      {"users", "audit", "notifications"},
	"access":        {"families"},
	"healthrecords": {"access", "audit"},
	"prescriptions": {"access", "medications", "documents", "audit"},
	"medications":   {"access", "audit"},
	"appointments":  {"access", "clinics", "audit"},
	"clinics":       {"access"},
	"examinations":  {"access", "clinics", "documents", "audit"},
	"documents":     {"access", "audit"},
	"alerts":        {"medications", "appointments", "examinations", "families"},
	"notifications": {"users"},
	"reports":       {"access", "healthrecords", "prescriptions", "medications", "appointments", "clinics", "examinations", "documents"},
	"lifecycle":     {"families", "documents", "notifications", "audit"},
	"admin":         {"users", "clinics", "audit"},
}

// healthModules: módulos de registos de saúde (admin nunca os importa, NFR-SEC-10).
var healthModules = []string{"healthrecords", "prescriptions", "medications", "appointments", "examinations", "documents"}

// layerDeps: que camadas do MESMO módulo cada camada pode importar.
var layerDeps = map[string][]string{
	"domain":  {},
	"service": {"domain"},
	"repo":    {"domain"},
	"handler": {"service", "domain"},
	"root":    {"domain", "service", "repo", "handler"},
}

// Pacotes de platform que cada camada NÃO pode importar.
var (
	pureDomainPlatform = []string{"platform/ids", "platform/clock"} // única parte de platform que o domain pode usar
	httpOnly           = "platform/httpx"                           // só handler (e a raiz, na ligação)
)

type edge struct {
	file string // ficheiro relativo a internal/
	to   string // caminho importado relativo a internal/
}

// loc descreve onde um pacote vive na arquitetura.
type loc struct {
	kind   string // platform | api | apigen | sqlcgen | module | other
	module string
	layer  string // domain|service|repo|handler|root (só para módulos)
}

func locate(p string) loc {
	p = filepath.ToSlash(p)
	switch {
	case p == "platform" || strings.HasPrefix(p, "platform/"):
		return loc{kind: "platform"}
	case p == "api/gen" || strings.HasPrefix(p, "api/gen/"):
		return loc{kind: "apigen"}
	case p == "api" || strings.HasPrefix(p, "api/"):
		return loc{kind: "api"}
	case strings.HasPrefix(p, "db/sqlcgen"):
		return loc{kind: "sqlcgen"}
	case strings.HasPrefix(p, "modules/"):
		parts := strings.Split(p, "/")
		l := loc{kind: "module", module: parts[1], layer: "root"}
		if len(parts) >= 4 && parts[2] == "internal" {
			l.layer = parts[3]
		}
		return l
	}
	return loc{kind: "other"}
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// check devolve as violações das regras de arquitetura para o conjunto de arestas.
func check(edges []edge, modules map[string][]string) []string {
	var v []string
	bad := func(e edge, msg string) { v = append(v, e.file+": "+msg+" (importa internal/"+e.to+")") }
	graph := map[string]map[string]bool{}
	for _, e := range edges {
		from, to := locate(e.file), locate(e.to)
		switch from.kind {
		case "platform":
			if to.kind != "platform" {
				bad(e, "platform não pode depender de módulos, api ou sqlc")
			}
			continue
		case "api":
			if to.kind == "module" && to.layer != "root" {
				bad(e, "api só importa a raiz dos módulos")
			}
			continue
		case "module":
		default:
			continue
		}
		if _, ok := modules[from.module]; !ok {
			v = append(v, "módulo desconhecido modules/"+from.module+" (declarar em arch_test.go e modules.md)")
			continue
		}
		isTest := strings.HasSuffix(e.file, "_test.go")
		switch to.kind {
		case "platform":
			if from.layer == "domain" && !isTest && !pureDomainPlatform_ok(e.to) {
				bad(e, "domain só pode usar platform/ids e platform/clock")
			}
			if strings.HasPrefix(e.to, httpOnly) && from.layer != "handler" && from.layer != "root" && !isTest {
				bad(e, "platform/httpx só nos handlers (domain/service/repo devolvem erros de domínio)")
			}
		case "apigen":
			if from.layer != "handler" && from.layer != "root" {
				bad(e, "o contrato gerado só é usado pelos handlers")
			}
		case "sqlcgen":
			if from.layer != "repo" && !isTest {
				bad(e, "só a camada repo importa o código sqlc")
			}
		case "api":
			bad(e, "módulos não dependem da camada api")
		case "module":
			if to.module == from.module { // camadas do mesmo módulo
				if !contains(layerDeps[from.layer], to.layer) && !(to.layer == "root" && from.layer == "root") {
					bad(e, "camada "+from.layer+" não pode importar a camada "+to.layer)
				}
				continue
			}
			// Outro módulo: só pela raiz, só do service/raiz, só se declarado, nunca ciclos.
			if to.layer != "root" {
				bad(e, "outro módulo só se importa pela raiz")
			}
			if from.layer != "service" && from.layer != "root" {
				bad(e, "só service e a raiz chamam outros módulos")
			}
			if !contains(modules[from.module], to.module) {
				bad(e, "modules/"+from.module+" não pode depender de modules/"+to.module+" (modules.md §2)")
			}
			if from.module == "admin" && contains(healthModules, to.module) {
				bad(e, "admin nunca importa módulos de saúde")
			}
			if graph[from.module] == nil {
				graph[from.module] = map[string]bool{}
			}
			graph[from.module][to.module] = true
		}
	}
	return append(v, cycles(graph)...)
}

func pureDomainPlatform_ok(p string) bool {
	for _, ok := range pureDomainPlatform {
		if p == ok || strings.HasPrefix(p, ok+"/") {
			return true
		}
	}
	return false
}

func cycles(graph map[string]map[string]bool) []string {
	var v []string
	state := map[string]int{}
	var visit func(n string, path []string)
	visit = func(n string, path []string) {
		state[n] = 1
		var next []string
		for m := range graph[n] {
			next = append(next, m)
		}
		sort.Strings(next)
		for _, m := range next {
			switch state[m] {
			case 0:
				visit(m, append(path, m))
			case 1:
				v = append(v, "ciclo de dependências: "+strings.Join(append(path, m), " -> "))
			}
		}
		state[n] = 2
	}
	var names []string
	for n := range graph {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		if state[n] == 0 {
			visit(n, []string{n})
		}
	}
	return v
}

func collect(t *testing.T) []edge {
	t.Helper()
	var edges []edge
	fset := token.NewFileSet()
	err := filepath.WalkDir(".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, ".gen.go") || strings.HasPrefix(filepath.ToSlash(path), "api/gen") {
			return err
		}
		f, err := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		for _, imp := range f.Imports {
			p, _ := strconv.Unquote(imp.Path.Value)
			if strings.HasPrefix(p, modulePath) {
				edges = append(edges, edge{file: filepath.ToSlash(path), to: strings.TrimPrefix(p, modulePath)})
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return edges
}

func TestArchitectureRules(t *testing.T) {
	if _, err := os.Stat("platform"); err != nil {
		t.Fatal("deve correr em internal/")
	}
	for _, v := range check(collect(t), allowed) {
		t.Error(v)
	}
}

// Todo módulo declarado existe em disco e vice-versa (a árvore e as regras não divergem).
func TestModulesMatchDisk(t *testing.T) {
	entries, err := os.ReadDir("modules")
	if err != nil {
		t.Fatal(err)
	}
	onDisk := map[string]bool{}
	for _, e := range entries {
		if e.IsDir() {
			onDisk[e.Name()] = true
			if _, ok := allowed[e.Name()]; !ok {
				t.Errorf("modules/%s existe mas não está declarado em arch_test.go/modules.md", e.Name())
			}
		}
	}
	for m := range allowed {
		if !onDisk[m] {
			t.Errorf("módulo %s declarado mas sem pasta modules/%s", m, m)
		}
	}
}

// Garante que o verificador deteta violações (um teste de arquitetura que nunca falha é inútil).
func TestCheckerDetectsViolations(t *testing.T) {
	cases := []struct {
		name  string
		edges []edge
		want  string
	}{
		{"platform importa módulo", []edge{{"platform/x/a.go", "modules/users"}}, "platform não pode depender"},
		{"admin importa saúde", []edge{{"modules/admin/internal/service/s.go", "modules/medications"}}, "admin nunca importa"},
		{"dependência não declarada", []edge{{"modules/users/internal/service/s.go", "modules/families"}}, "não pode depender de modules/families"},
		{"sqlc fora de repo", []edge{{"modules/users/internal/service/s.go", "db/sqlcgen"}}, "só a camada repo"},
		{"handler fala com repo", []edge{{"modules/users/internal/handler/h.go", "modules/users/internal/repo"}}, "camada handler não pode importar a camada repo"},
		{"service importa httpx", []edge{{"modules/users/internal/service/s.go", "platform/httpx"}}, "platform/httpx só nos handlers"},
		{"domain importa db", []edge{{"modules/users/internal/domain/d.go", "platform/db"}}, "domain só pode usar"},
		{"outro módulo por camada interna", []edge{{"modules/auth/internal/service/s.go", "modules/users/internal/service"}}, "só se importa pela raiz"},
		{"handler chama outro módulo", []edge{{"modules/auth/internal/handler/h.go", "modules/users"}}, "só service e a raiz"},
		{"contrato gerado no service", []edge{{"modules/users/internal/service/s.go", "api/gen"}}, "contrato gerado"},
		{"módulo importa api", []edge{{"modules/users/users.go", "api"}}, "não dependem da camada api"},
		{"api importa camada interna", []edge{{"api/server.go", "modules/users/internal/handler"}}, "api só importa a raiz"},
		{"módulo desconhecido", []edge{{"modules/foo/foo.go", "platform/clock"}}, "desconhecido"},
	}
	for _, c := range cases {
		got := check(c.edges, allowed)
		if len(got) == 0 || !strings.Contains(strings.Join(got, "|"), c.want) {
			t.Errorf("%s: esperado %q, obtido %v", c.name, c.want, got)
		}
	}
	cyc := map[string][]string{"a": {"b"}, "b": {"a"}}
	got := check([]edge{{"modules/a/internal/service/x.go", "modules/b"}, {"modules/b/internal/service/x.go", "modules/a"}}, cyc)
	if len(got) == 0 || !strings.Contains(strings.Join(got, "|"), "ciclo") {
		t.Errorf("ciclo não detetado: %v", got)
	}
	ok := []edge{
		{"modules/users/internal/repo/r.go", "db/sqlcgen"},
		{"modules/users/internal/repo/r.go", "modules/users/internal/domain"},
		{"modules/users/internal/handler/h.go", "api/gen"},
		{"modules/users/internal/handler/h.go", "platform/httpx"},
		{"modules/users/internal/service/s.go", "modules/audit"},
		{"modules/users/internal/domain/d.go", "platform/ids"},
		{"modules/users/users.go", "modules/users/internal/handler"},
		{"api/server.go", "modules/users"},
		{"api/server.go", "platform/httpx"},
	}
	if v := check(ok, allowed); len(v) != 0 {
		t.Errorf("falso positivo: %v", v)
	}
}
