// Package audit: Escreve e anonimiza AuditLog (append-only, na mesma transação da ação); purga a 24 meses.
//
// Raiz do módulo = API pública e ligação das camadas (handler -> service -> domain; repo -> domain).
// Outros módulos só podem importar este pacote (internal/ impede o resto).
// Dependências de módulos permitidas: nenhum (docs/06-architecture/modules.md).
package audit
