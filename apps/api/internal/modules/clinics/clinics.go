// Package clinics: Clínicas PARTNER/PRIVATE; a gestão de parceiras é exposta ao módulo admin.
//
// Raiz do módulo = API pública e ligação das camadas (handler -> service -> domain; repo -> domain).
// Outros módulos só podem importar este pacote (internal/ impede o resto).
// Dependências de módulos permitidas: access (docs/06-architecture/modules.md).
package clinics
