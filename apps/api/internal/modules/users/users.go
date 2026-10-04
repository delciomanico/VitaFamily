// Package users: Conta, perfil, fuso horário, termos e eliminação de conta.
//
// Raiz do módulo = API pública e ligação das camadas (handler -> service -> domain; repo -> domain).
// Outros módulos só podem importar este pacote (internal/ impede o resto).
// Dependências de módulos permitidas: audit (docs/06-architecture/modules.md).
package users
