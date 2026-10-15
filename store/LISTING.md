# Chrome Web Store — guia de publicação do RafaBoy Virtual

Tudo o que o [Painel do desenvolvedor](https://chrome.google.com/webstore/devconsole) pede, pronto para copiar e colar.

## 0. Antes de enviar

- [ ] Conta de desenvolvedor criada (taxa única de US$ 5), com **verificação em duas etapas** ativa na conta Google.
- [ ] **E-mail de contato** do desenvolvedor verificado na aba *Conta* do painel.
- [ ] Política de privacidade **publicada em uma URL pública** (veja a seção 5) e o campo de contato preenchido em
      `PRIVACY.md` / `docs/privacy.html`.
- [ ] **Teste no Gmail de verdade**: abra um e-mail com anexos .zip, clique na extensão e confira o .zip gerado
      (carregue a pasta `extension/` em `chrome://extensions` → *Carregar sem compactação*).
- [ ] `npm test` e `npm run package` sem erros → enviar `dist/rafaboy-virtual-<versão>.zip`.

## 1. Pacote

Arquivo: `dist/rafaboy-virtual-1.1.0.zip` (gerado por `npm run package`).
Para cada nova versão, aumente `version` em `extension/manifest.json` **e** em `package.json`.

## 2. Ficha da loja (Store listing)

**Idioma:** Português (Brasil)

**Nome:** RafaBoy Virtual

**Resumo** (vem do manifest, 114/132 caracteres):
> Converte em PDF os .txt, .csv, Word e Excel dos anexos .zip de um e-mail do Gmail e entrega tudo em um único .zip.

**Descrição:**

```
Recebeu um e-mail cheio de anexos .zip e precisa de tudo em PDF? O RafaBoy Virtual faz isso com um clique.

COMO FUNCIONA
1. Abra o e-mail no Gmail.
2. Clique no ícone do RafaBoy Virtual: ele lista os anexos do e-mail.
3. Clique em "Converter e baixar .zip".
Pronto: você recebe um único .zip com todos os anexos, já convertidos.

O QUE É CONVERTIDO EM PDF
• Textos (.txt) — com quebra de linha automática e numeração de páginas
• Planilhas CSV (.csv) — em formato de tabela; o separador (; , tab) é detectado sozinho
• Word (.docx) — mantém títulos, negrito, itálico, listas, tabelas e imagens
• Word antigo (.doc) — texto do documento
• Excel (.xlsx e .xls) — uma tabela por aba, com datas e números no padrão brasileiro

ORGANIZAÇÃO DO RESULTADO
• Cada anexo .zip vira uma pasta dentro do .zip final
• .zip dentro de .zip e subpastas também são abertos
• Os demais arquivos (imagens, PDFs etc.) são mantidos como estão
• Acentos preservados, inclusive em arquivos e nomes criados no Windows

PRIVACIDADE EM PRIMEIRO LUGAR
• Toda a conversão acontece no seu navegador
• Nenhum arquivo é enviado para servidores — a extensão não tem servidor
• Sem cadastro, sem anúncios, sem rastreamento
• A extensão só lê o e-mail aberto, e apenas quando você clica no ícone

TAMBÉM FUNCIONA SEM O GMAIL
Use "Selecionar arquivos do computador" para converter anexos já baixados (ou qualquer .zip, .txt, .csv,
Word ou Excel) do mesmo jeito.

Limitações: arquivos protegidos por senha não são convertidos (o original é mantido no .zip); documentos
Word .docx não reproduzem fontes, cores, cabeçalho e rodapé; arquivos .doc antigos são convertidos apenas
como texto.
```

**Categoria:** Produtividade → Ferramentas (Tools)

**Imagens** (pasta `store/`, regeneráveis com `npm run store-assets`):

| Campo | Arquivo |
|---|---|
| Ícone da loja (128×128) | `store/icon-128.png` |
| Capturas de tela (1280×800) | `store/screenshot-1.png` … `screenshot-4.png` |
| Bloco promocional pequeno (440×280) | `store/promo-small-440x280.png` |
| Bloco promocional grande / marquee (1400×560) | `store/promo-marquee-1400x560.png` |

**Site oficial / URL de suporte:** opcional — pode usar a página do repositório ou a da política de privacidade.

## 3. Privacidade (aba *Privacy practices*)

**Finalidade única (Single purpose):**
> Converter em PDF os arquivos de texto, CSV, Word e Excel contidos nos anexos (inclusive dentro de .zip) do
> e-mail aberto no Gmail e entregá-los ao usuário em um único arquivo .zip.

**Justificativa das permissões:**

| Permissão | Justificativa (colar no painel) |
|---|---|
| `scripting` | Ao clicar no ícone, a extensão executa um script na aba do Gmail aberta para ler a lista de anexos do e-mail exibido (nome e link de download). Não é executado em nenhuma outra situação. |
| `storage` | Guarda temporariamente, em chrome.storage.session (memória, apagada ao fechar o navegador), a lista de anexos escolhidos para passar do popup para a aba de conversão. É apagada assim que a conversão começa. |
| Host `https://mail.google.com/*` | Necessário para ler a lista de anexos do e-mail aberto e baixá-los com a sessão do próprio usuário, como o botão "Baixar" do Gmail. |
| Host `https://mail-attachment.googleusercontent.com/*` | Endereço para onde o Gmail redireciona o download dos anexos; sem ele o download do arquivo é bloqueado. |

**Código remoto:** Não, não uso código remoto. (Todas as bibliotecas — JSZip, jsPDF, jsPDF-AutoTable, mammoth e
SheetJS — estão incluídas no pacote.)

**Uso de dados — marcar:**
- [x] **Comunicações pessoais** (o conteúdo dos anexos de e-mail é processado)
- [x] **Conteúdo do site** (a página do Gmail é lida para encontrar os anexos)
- Todo o resto: não marcar.

**Certificações — marcar as três:**
- [x] Não vendo nem transfiro dados do usuário a terceiros, fora dos casos de uso aprovados
- [x] Não uso nem transfiro dados do usuário para fins não relacionados à finalidade única do item
- [x] Não uso nem transfiro dados do usuário para determinar a capacidade de crédito ou para empréstimos

**URL da política de privacidade:** a URL pública onde você publicou `docs/privacy.html` (seção 5).

## 4. Distribuição

- **Visibilidade:** *Pública* (ou *Não listada*, para distribuir só por link enquanto testa com usuários).
- **Regiões:** todas (ou apenas Brasil).
- **Preço:** gratuito.

**Instruções de teste para o revisor** (campo *Test instructions*, se solicitado):

```
1. Open https://mail.google.com with any Google account and open an email that has .zip attachments
   containing .txt/.csv/.docx/.xlsx files.
2. Click the extension icon: it lists the attachments. Click "Converter e baixar .zip".
3. A tab shows the progress and downloads a .zip where each .zip attachment became a folder and the
   supported files became PDFs.
No Gmail account? Click "Selecionar arquivos do computador…" in the popup and choose any .zip/.docx/.xlsx
file: the same conversion runs locally. No login or account for the extension is required.
```

## 5. Publicar a política de privacidade

A loja exige uma URL pública. Opções:

- **GitHub Pages** (repositório público): *Settings → Pages → Branch `main`, pasta `/docs`*. A URL fica
  `https://<usuario>.github.io/<repositorio>/privacy.html`.
- **Google Sites** ou um **Google Docs publicado na Web** (*Arquivo → Compartilhar → Publicar na Web*), colando o
  texto de `PRIVACY.md`.

## 6. Depois do envio

- A revisão costuma levar de alguns dias a algumas semanas; extensões com acesso ao Gmail podem passar por
  revisão mais detalhada.
- Atualizações: aumente a versão, rode `npm run package` e envie o novo .zip em *Pacote → Enviar novo pacote*.
