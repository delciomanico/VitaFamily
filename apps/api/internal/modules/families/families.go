// Package families: Family, FamilyMember, Guardianship e Invitation e as suas invariantes.
//
// Raiz do módulo = API pública e ligação das camadas (handler -> service -> domain; repo -> domain).
// Outros módulos só podem importar este pacote (internal/ impede o resto).
// Dependências de módulos permitidas: users, audit, notifications (docs/06-architecture/modules.md).
package families
