// Package prescriptions: Receitas e orquestração com os planos de toma.
//
// Raiz do módulo = API pública e ligação das camadas (handler -> service -> domain; repo -> domain).
// Outros módulos só podem importar este pacote (internal/ impede o resto).
// Dependências de módulos permitidas: access, medications, documents, audit (docs/06-architecture/modules.md).
package prescriptions
