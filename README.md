# Gmail ZIP → PDF (extensão do Chrome)

A partir de um e-mail aberto no Gmail com vários anexos, a extensão:

1. baixa os anexos do e-mail;
2. abre cada anexo **.zip** (inclusive .zip dentro de .zip e subpastas) e o transforma em uma **pasta**;
3. converte todo arquivo **.txt** e **.csv** encontrado em **.pdf**;
4. copia os demais arquivos sem alteração;
5. entrega um único **`<assunto do e-mail> - PDF.zip`**.

Exemplo:

```
Anexos do e-mail                 →   "Assunto - PDF.zip"
├── Lote 1.zip                        ├── Lote 1/
│   ├── leia-me.txt                   │   ├── leia-me.pdf
│   └── dados/                        │   └── dados/
│       ├── vendas.csv                │       ├── vendas.pdf
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
- Codificação: detecta UTF-8 (com/sem BOM), UTF-16 e cai para Windows-1252 (ANSI) — acentos preservados.
- Nomes de arquivo dentro de .zip criados no Windows (CP850) são decodificados corretamente.
- Arquivos de sistema (`__MACOSX/`, `.DS_Store`, `Thumbs.db`) são descartados.
- Conflitos de nome recebem sufixo, ex.: `relatorio (2).pdf`.
- .zip corrompidos ou falhas de conversão não interrompem o processo: o arquivo original é mantido e um aviso aparece no log.

## Estrutura

```
extension/
├── manifest.json          # Manifest V3
├── popup.html / popup.js  # lista anexos do e-mail aberto
├── processor.html / .js   # baixa, converte e gera o .zip (mostra o progresso)
├── src/core.js            # lógica de conversão (independente do Chrome)
├── src/gmail-scraper.js   # lê os anexos da página do Gmail
├── lib/                   # JSZip 3.10.1, jsPDF 4.2.1, jsPDF-AutoTable 5.0.8
└── icons/
test/core.test.js          # testes (Node)
```

## Desenvolvimento

```bash
npm install
npm test          # testes da lógica de conversão
npm run package   # gera gmail-zip-to-pdf.zip para publicar na Chrome Web Store
```

## Limitações conhecidas

- A leitura dos anexos depende da interface do Gmail; se o Google mudar o HTML, use o modo
  "Selecionar arquivos do computador" enquanto a extensão é atualizada.
- As fontes padrão de PDF cobrem o alfabeto latino (português incluso); caracteres fora dele
  (ex.: emojis, ideogramas) aparecem como `?`.
