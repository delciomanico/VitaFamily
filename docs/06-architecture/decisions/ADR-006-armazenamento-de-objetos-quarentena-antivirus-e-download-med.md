# ADR-006 — Armazenamento de objetos, quarentena, antivírus e download mediado

**Estado:** Aceite (delegação do proprietário, 2026-10-04)

## Contexto
Documentos de saúde de terceiros: risco de malware, de fuga e de apagamento incompleto.

## Decisão
Ficheiros em **S3/MinIO** (UE) com prefixo de quarentena até o **ClamAV** os aprovar; **download mediado pela API** (autoriza, audita, faz stream); o armazenamento nunca é público; apagamento via `file_deletion` (outbox).

## Alternativas
Guardar em PostgreSQL (`bytea`); URLs pré-assinadas diretas ao cliente; sem antivírus.

## Justificação
BD cresce menos e backups ficam geríveis; mediar permite auditar cada acesso e aplicar a política de partilha; URLs pré-assinadas ignorariam a revogação imediata de partilha (BR-PRV-04).

## Consequências
A API carrega o tráfego de download (aceitável: ≤10 MB); ClamAV é um serviço extra a manter.
