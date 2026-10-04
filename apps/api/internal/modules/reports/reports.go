// Package reports: Vistas calculadas (individual, familiar, adesão) que omitem secções sem permissão.
//
// Raiz do módulo = API pública e ligação das camadas (handler -> service -> domain; repo -> domain).
// Outros módulos só podem importar este pacote (internal/ impede o resto).
// Dependências de módulos permitidas: access, healthrecords, prescriptions, medications, appointments, clinics, examinations, documents (docs/06-architecture/modules.md).
package reports
