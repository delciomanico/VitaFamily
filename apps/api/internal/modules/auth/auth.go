// Package auth: Registo, verificação de e-mail, login, refresh rotativo, recuperação, rate limiting de autenticação.
//
// Raiz do módulo = API pública e ligação das camadas (handler -> service -> domain; repo -> domain).
// Outros módulos só podem importar este pacote (internal/ impede o resto).
// Dependências de módulos permitidas: users, notifications, audit (docs/06-architecture/modules.md).
package auth
