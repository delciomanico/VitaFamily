// Package admin: Contas (listar, suspender, reativar) e rotas /admin; nunca acede a dados de saúde.
//
// Raiz do módulo = API pública e ligação das camadas (handler -> service -> domain; repo -> domain).
// Outros módulos só podem importar este pacote (internal/ impede o resto).
// Dependências de módulos permitidas: users, clinics, audit (docs/06-architecture/modules.md).
package admin
