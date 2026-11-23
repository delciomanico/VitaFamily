# Casos de uso — Registo rápido por OCR (M16, change control 2026-11-21)

> Estado: **PROPOSTA v0.1** (decisão do proprietário de 2026-11-21; convenções comuns em `family.md`). Regras: `BR-OCR-01..12` (`business-rules.md` §18). **Só frontend**: não há endpoints nem tabelas novas; o registo usa UC-RX-01, UC-EXM-01/02 e UC-DOC-01. A leitura corre **no dispositivo**; nada sai dele até o utilizador guardar.
> Quem pode: o mesmo de UC-RX-01 / UC-EXM-01 (titular ou tutor; categorias C4/C6, `WRITE`).

### UC-OCR-01 Registar uma receita fotografando-a
- **Ator:** titular ou tutor · **FR:** OCR-01, RX-01 · **BR:** BR-OCR-01..12, BR-RX-01/02, BR-DOC-01..05
- **Fluxo:** «Nova receita» (ou atalho) → **«Fotografar»**, «Escolher da galeria» ou «Escolher PDF» → pré-processamento (BR-OCR-03) com **progresso visível e cancelável** (BR-OCR-04) → o formulário de receita abre **pré-preenchido** ao lado da imagem: data de emissão, médico, clínica, **medicamentos** (nome, dosagem, frequência, duração) e observações (BR-OCR-06) → os campos de **baixa confiança** vêm assinalados «Confirmar» (BR-OCR-07) → o utilizador corrige/confirma → **«Guardar»** só ativa depois de cada campo assinalado estar confirmado e de as regras de UC-RX-01 passarem (BR-OCR-08) → cria a receita ATIVA e os planos de toma (BR-RX-02) e **anexa o original** (BR-OCR-09).
- **Alternativos:** falha/tempo excedido/ilegível ⇒ mensagem simples e formulário manual com o original anexável (BR-OCR-10); PDF com texto embutido ⇒ sem OCR de imagem; mais de 3 páginas ⇒ aviso; utilizador escolhe «Preencher à mão» a qualquer momento; sair sem guardar descarta tudo (nada persiste, BR-OCR-12).
- **Pós-condição:** a leitura não criou nada sozinha (BR-OCR-11); o texto reconhecido não ficou em lado nenhum.

### UC-OCR-02 Registar um exame fotografando o resultado
- **Ator:** titular ou tutor · **FR:** OCR-01, EXM-01..03 · **BR:** BR-OCR-01..12, BR-EXM-01/02, BR-DOC-01..05
- **Fluxo:** como UC-OCR-01, a partir de «Novo exame»: o formulário abre com **tipo/nome**, **data**, **laboratório** e a lista de **parâmetros** (nome, valor, unidade, referência mín–máx ou texto) pré-preenchidos; baixa confiança assinalada; revisão obrigatória; guardar cria o exame (`COMPLETED` se a data é passada, UC-EXM-01) e os `ExamResult` (UC-EXM-02) e **anexa o original** (UC-EXM-03).
- **Regras:** o OCR **não interpreta**: nenhum valor é assinalado fora da referência nem gera alerta (BR-EXM-02); a referência é a que o documento indica, copiada tal como está e revista pelo utilizador.
- **Alternativos:** como UC-OCR-01. Linha de tabela mal lida ⇒ o utilizador apaga/edita a linha antes de guardar.

### UC-OCR-03 Falha graciosa e preparação offline do motor
- **Ator:** qualquer utilizador de UC-OCR-01/02 · **BR:** BR-OCR-02/05/10
- **Fluxo:** na primeira utilização o motor e o modelo `por` são descarregados **da própria origem** e ficam em cache (a UI mostra «A preparar a leitura (só na primeira vez)»); depois funciona offline. Se a preparação falhar ou o dispositivo não suportar WASM ⇒ a opção «Fotografar» continua a anexar a foto e abre o formulário **manual** (sem pré-preenchimento).

> Critérios: `AC-OCR-01..06`; testes: `TC-OCR-01..08` (`09-testing`). Alterações a UC-RX-01 e UC-EXM-01: ver as notas «M16» nesses ficheiros.
