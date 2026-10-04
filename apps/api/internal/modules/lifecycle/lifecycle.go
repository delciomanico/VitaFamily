// Package lifecycle: Exportação, saída/remoção de membros, maioridade, bloqueio e apagamento a 90 dias.
//
// Raiz do módulo = API pública e ligação das camadas (handler -> service -> domain; repo -> domain).
// Outros módulos só podem importar este pacote (internal/ impede o resto).
// Dependências de módulos permitidas: families, documents, notifications, audit (docs/06-architecture/modules.md).
package lifecycle
