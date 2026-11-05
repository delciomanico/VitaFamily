-- Exames de clínica parceira (D19/ADR-023, BR-EXM-05): novos estados `REQUESTED`/`REJECTED` de
-- `exam_status` (state-machines.md "Examination"). Mesmo critério de 0014/0015: `ALTER TYPE ... ADD
-- VALUE` fica numa migração própria, sem usar os valores novos, porque o runner aplica cada ficheiro
-- numa transação e um valor novo de enum só pode ser usado depois de committed (0021 usa-os).
ALTER TYPE exam_status ADD VALUE 'REQUESTED';
ALTER TYPE exam_status ADD VALUE 'REJECTED';
