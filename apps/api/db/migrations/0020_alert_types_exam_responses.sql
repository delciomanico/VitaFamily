-- Alertas de resposta/resultado de exames de clínica parceira (D19/ADR-023, BR-ALR-08): tipos
-- novos de `alert_type` (schema.md §7). Só acrescenta valores (ver 0019 sobre a separação).
-- `alert_source` já tem `EXAMINATION`; `RECOMMENDATION_ADDED`/`RECOMMENDATION` ficam para a fase das
-- recomendações.
ALTER TYPE alert_type ADD VALUE 'EXAM_CONFIRMED';
ALTER TYPE alert_type ADD VALUE 'EXAM_REJECTED';
ALTER TYPE alert_type ADD VALUE 'EXAM_CANCELLED';
ALTER TYPE alert_type ADD VALUE 'EXAM_RESULTS_AVAILABLE';
