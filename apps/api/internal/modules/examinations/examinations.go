// Package examinations: Exames e resultados estruturados (sem interpretação).
//
// Raiz do módulo = API pública e ligação das camadas (handler -> service -> domain; repo -> domain).
// Outros módulos só podem importar este pacote (internal/ impede o resto).
// Dependências de módulos permitidas: access, clinics, documents, audit (docs/06-architecture/modules.md).
package examinations
