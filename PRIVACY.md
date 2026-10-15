# Política de Privacidade — RafaBoy Virtual

_Última atualização: 15 de outubro de 2026_

A extensão **RafaBoy Virtual** para Google Chrome converte em PDF arquivos de texto (.txt), planilhas
(.csv, .xls, .xlsx) e documentos do Word (.doc, .docx) contidos nos anexos de um e-mail do Gmail, e entrega o
resultado em um único arquivo .zip.

## Resumo

**Nenhum dado sai do seu computador.** Todo o processamento acontece localmente, dentro do seu navegador.
A extensão não tem servidor próprio, não coleta, não armazena, não vende e não compartilha dados.

## Quais dados a extensão acessa

| Dado | Por quê | Para onde vai |
|---|---|---|
| Página do e-mail aberto no Gmail (assunto, nomes e links dos anexos) | Listar os anexos a converter, **somente quando você clica no ícone da extensão** | Lugar nenhum: fica na memória do navegador |
| Conteúdo dos anexos | Baixá-los do Gmail com a sua própria sessão e convertê-los em PDF | Lugar nenhum: o .zip gerado é salvo no seu computador |
| Arquivos que você seleciona manualmente | Convertê-los em PDF | Lugar nenhum |

- Os anexos são baixados diretamente dos servidores do Google (`mail.google.com` e
  `mail-attachment.googleusercontent.com`), exatamente como quando você clica em “Baixar” no Gmail.
- A lista de anexos fica temporariamente em `chrome.storage.session` (memória, apagada ao fechar o navegador)
  apenas para passar do popup para a aba de conversão, e é removida assim que a conversão começa.
- A extensão **não** lê outros e-mails, sua caixa de entrada, contatos ou qualquer outro site.
- A extensão **não** usa cookies próprios, análises (analytics), anúncios ou rastreamento.
- A extensão **não** carrega código remoto: todas as bibliotecas estão incluídas no pacote.

## Uso limitado

O uso das informações recebidas das APIs do Google segue a
[Política de Dados do Usuário dos Serviços de API do Google](https://developers.google.com/terms/api-services-user-data-policy),
incluindo os requisitos de Uso Limitado. Os dados são usados exclusivamente para a funcionalidade descrita acima.

## Permissões solicitadas

- **Acesso a `mail.google.com`**: ler a lista de anexos do e-mail aberto e baixá-los.
- **Acesso a `mail-attachment.googleusercontent.com`**: endereço para onde o Gmail redireciona o download dos anexos.
- **scripting**: executar, sob seu comando, o leitor de anexos na aba do Gmail.
- **storage**: guardar temporariamente (na memória da sessão) a lista de anexos escolhidos.

## Contato

Dúvidas sobre esta política: [PREENCHA: e-mail de contato do desenvolvedor]

Alterações nesta política serão publicadas nesta página com a nova data de atualização.
