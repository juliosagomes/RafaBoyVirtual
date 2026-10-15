# RafaBoy Virtual (extensão do Chrome)

A partir de um e-mail aberto no Gmail com vários anexos, a extensão:

1. baixa os anexos do e-mail;
2. abre cada anexo **.zip** (inclusive .zip dentro de .zip e subpastas) e o transforma em uma **pasta**;
3. converte em **.pdf** todo arquivo **.txt**, **.csv**, **.doc**, **.docx**, **.xls** e **.xlsx** encontrado;
4. copia os demais arquivos sem alteração;
5. entrega um único **`<assunto do e-mail> - PDF.zip`**.

Exemplo:

```
Anexos do e-mail                 →   "Assunto - PDF.zip"
├── Lote 1.zip                        ├── Lote 1/
│   ├── leia-me.txt                   │   ├── leia-me.pdf
│   └── dados/                        │   └── dados/
│       ├── vendas.csv                │       ├── vendas.pdf
│       ├── contrato.docx             │       ├── contrato.pdf
│       ├── balanço.xlsx              │       ├── balanço.pdf
│       ├── foto.png                  │       ├── foto.png
│       └── interno.zip               │       └── interno/
│           └── nota.txt              │           └── nota.pdf
├── Lote 2.zip                        ├── Lote 2/ ...
└── planilha.csv                      └── planilha.pdf
```

Tudo é processado **localmente no navegador**; nenhum arquivo é enviado a servidores externos.

## Instalação (modo desenvolvedor)

1. Baixe/clone este repositório.
2. No Chrome, abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e selecione a pasta **`extension/`**.

## Uso

1. Abra o e-mail no Gmail (a mensagem em si, não a lista da caixa de entrada).
2. Clique no ícone da extensão: ela lista os anexos encontrados (todos marcados).
3. Clique em **Converter e baixar .zip**. Uma aba mostra o progresso e o download começa automaticamente.

**Plano B:** se o download direto do Gmail falhar, use **Selecionar arquivos do computador…** no popup
e escolha (ou arraste) os anexos baixados manualmente — o resultado é o mesmo.

## Detalhes da conversão

- **TXT** → PDF A4 em fonte monoespaçada (Courier 9pt), com quebra de linhas longas, nome do arquivo no topo e
  numeração de páginas. Arquivos com linhas acima de 100 caracteres saem em paisagem.
- **CSV** → PDF A4 paisagem em formato de tabela (1ª linha como cabeçalho). O separador (`;`, `,`, tab ou `|`)
  é detectado automaticamente; tabelas largas continuam em páginas seguintes.
- **Word .docx** → PDF A4 mantendo títulos, negrito/itálico/sublinhado, links, listas (com marcadores ou
  numeradas), tabelas (inclusive células mescladas) e imagens PNG/JPEG. Não reproduz fontes, cores, cabeçalho/rodapé
  nem layout exato da página.
- **Word .doc** (97–2003) → PDF com o **texto** do documento (sem formatação); tabelas aparecem como
  `célula | célula`. Um ".doc" que na verdade é .docx, RTF ou HTML (comum em sistemas) também é convertido.
- **Excel .xlsx/.xls** → PDF A4 paisagem com **uma tabela por planilha** (abas vazias são ignoradas), usando os
  valores como aparecem no Excel (datas e formatos) e números no padrão brasileiro (`1.234,57`).
  Fórmulas aparecem com o último valor calculado salvo no arquivo.
- `.docs` não é um formato real; se um arquivo vier com essa extensão, ele é tratado como documento do Word.
- Se já existir um .pdf com o mesmo nome, o convertido indica a origem: `relatorio (docx).pdf`.
- Codificação: detecta UTF-8 (com/sem BOM), UTF-16 e cai para Windows-1252 (ANSI) — acentos preservados.
- Nomes de arquivo dentro de .zip criados no Windows (CP850) são decodificados corretamente.
- Arquivos de sistema (`__MACOSX/`, `.DS_Store`, `Thumbs.db`) são descartados.
- Outros conflitos de nome recebem sufixo, ex.: `relatorio (2).pdf`.
- .zip corrompidos ou falhas de conversão não interrompem o processo: o arquivo original é mantido e um aviso aparece no log.

## Estrutura

```
extension/
├── manifest.json          # Manifest V3
├── popup.html / popup.js  # lista anexos do e-mail aberto
├── processor.html / .js   # baixa, converte e gera o .zip (mostra o progresso)
├── src/core.js            # .zip → pastas, .txt/.csv → PDF (independente do Chrome)
├── src/office.js          # Word (.doc/.docx) e Excel (.xls/.xlsx) → PDF
├── src/gmail-scraper.js   # lê os anexos da página do Gmail
├── lib/                   # JSZip 3.10.1, jsPDF 4.2.1, jsPDF-AutoTable 5.0.8, mammoth 1.13.0, SheetJS 0.20.3
└── icons/
scripts/package.js         # valida e gera dist/rafaboy-virtual-<versão>.zip
scripts/store-assets.js    # gera as imagens da Chrome Web Store
store/                     # ícone, capturas, blocos promocionais e LISTING.md (textos da loja)
PRIVACY.md, docs/          # política de privacidade (docs/privacy.html para publicar na web)
test/core.test.js          # testes (Node)
test/fixtures/             # arquivos Word/Excel de exemplo usados nos testes
```

## Desenvolvimento

```bash
npm install
npm test          # testes da lógica de conversão
npm run package   # valida e gera dist/rafaboy-virtual-<versão>.zip para a Chrome Web Store
npm run store-assets  # regenera as imagens da loja (requer Playwright/Chromium, poppler e Pillow)
```

## Publicação na Chrome Web Store

**Pacote automático (GitHub Actions):** a cada push, o workflow `.github/workflows/package.yml` roda os testes e
`npm run package`; o .zip fica em *Actions → execução → Artifacts → rafaboy-virtual*. Para gerar um Release com o
.zip anexado, crie uma tag igual à versão do manifest: `git tag v1.1.0 && git push origin v1.1.0`.

O passo a passo completo, com todos os textos para colar no painel (descrição, justificativa de permissões,
práticas de privacidade e instruções para o revisor), está em [`store/LISTING.md`](store/LISTING.md).
A política de privacidade está em [`PRIVACY.md`](PRIVACY.md).

## Limitações conhecidas

- Documentos/planilhas **protegidos por senha** não podem ser convertidos: o original é mantido no .zip e um aviso aparece.
- SheetJS vem do pacote npm `@e965/xlsx` (republicação da versão oficial 0.20.3, já que o pacote `xlsx` do npm
  está desatualizado).

- A leitura dos anexos depende da interface do Gmail; se o Google mudar o HTML, use o modo
  "Selecionar arquivos do computador" enquanto a extensão é atualizada.
- As fontes padrão de PDF cobrem o alfabeto latino (português incluso); caracteres fora dele
  (ex.: emojis, ideogramas) aparecem como `?`.
