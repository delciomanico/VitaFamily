// Package notifications: Canais push e e-mail, preferências, subscrições e retry.
//
// Raiz do módulo = API pública e ligação das camadas (handler -> service -> domain; repo -> domain).
// Outros módulos só podem importar este pacote (internal/ impede o resto).
// Dependências de módulos permitidas: users (docs/06-architecture/modules.md).
package notifications
