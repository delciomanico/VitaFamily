// Package alerts: Regras puras, scanner idempotente e geração de alertas.
//
// Raiz do módulo = API pública e ligação das camadas (handler -> service -> domain; repo -> domain).
// Outros módulos só podem importar este pacote (internal/ impede o resto).
// Dependências de módulos permitidas: medications, appointments, examinations, families (docs/06-architecture/modules.md).
package alerts
