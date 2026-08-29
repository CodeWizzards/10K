# Minha Extensão

Modelo inicial de extensão para Chrome, Edge e outros navegadores baseados em Chromium, usando Manifest V3.

## Estrutura

- `manifest.json`: configuração, permissões e pontos de entrada.
- `popup.*`: interface glassmorphism ao clicar no ícone da extensão.
- `background.js`: fluxo de funções e requisição em segundo plano.
- `content.js`: painel glassmorphism fixo, injetado no DOM das páginas.

## Testar localmente

1. Abra `chrome://extensions` no Chrome ou `edge://extensions` no Edge.
2. Ative o **Modo do desenvolvedor**.
3. Selecione **Carregar sem compactação** e escolha esta pasta.

Antes de adicionar código que atue diretamente em páginas, inclua o domínio e uma entrada em `content_scripts` no `manifest.json`.

## Fluxo de requisição

O painel inserido na página usa as variáveis `url` (a URL da página atual) e `delayMs` (1.000 ms). Ao clicar em **Executar fluxo**, o serviço em segundo plano executa, em ordem: função 1 (espera), função 2 (espera) e uma requisição `GET`. Novas etapas podem ser acrescentadas no array `requestFlow`, em `background.js`.

Por enquanto, `host_permissions` permite URLs HTTPS para que a URL seja configurável. Quando o site-alvo estiver definido, troque essa permissão pelo domínio específico.
