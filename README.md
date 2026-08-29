# Crash Auditor

Projeto composto por um painel de gerenciamento em Node.js e uma extensão Chrome para captura e sincronização de sessões.

## Estrutura

- `server/`: API, painel web e gerenciamento das contas.
- `extension/`: extensão Chrome Manifest V3.

## Rodar o painel

```bash
cd server
npm install
npm start
```

Os arquivos de configuração e dados locais não são versionados. Crie sua configuração local antes de iniciar.

## Carregar a extensão

No Chrome, abra `chrome://extensions`, ative o modo do desenvolvedor e selecione `Carregar sem compactação`. Escolha a pasta `extension/`.
