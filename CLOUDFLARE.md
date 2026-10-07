# Publicação no Cloudflare

## Estado da implantação

O Worker `codex-pcm` usa [codex-pcm.arthur-study95.workers.dev](https://codex-pcm.arthur-study95.workers.dev/) com Cloudflare Access por código de e-mail. O endereço `workers.dev` está habilitado e os links de preview estão desativados. Antes de cada atualização, confirme a política privada do Access, o segredo `ALLOWED_EMAIL` e o redirecionamento de uma sessão sem autenticação. O Worker também verifica a identidade e bloqueia requisições sem e-mail autorizado.

## Arquitetura

- `server.py`: versão local existente, sem dependências externas.
- `cloudflare/worker.mjs`: interface web e API no mesmo Worker.
- `cloudflare/core.mjs`: regras de negócio e persistência SQLite.
- `PCMWorkspace`: Durable Object SQLite por espaço de trabalho, com transações síncronas para preservar geração única de ocorrências e restauração atômica.
- `cloudflare/auth.mjs`: verificação criptográfica do JWT do Cloudflare Access (assinatura RS256, emissor, audiência, validade e e-mail permitido).
- `public/`: a mesma interface nas duas versões; as mensagens indicam armazenamento local ou online conforme a resposta da API.

O banco online é independente do banco do computador. Ele inicia com exemplos fictícios extraídos do código, nunca com `data/pcm.sqlite3`. Para levar registros locais ao ambiente online, use o backup JSON da versão local e restaure dentro da sessão autenticada online. Essa transferência deve ser solicitada pelo proprietário.

O identificador `WORKSPACE_ID` é estável e seleciona a base persistente. Não o altere em atualizações normais. A migração `v1` cria o armazenamento; não recrie nem remova a classe `PCMWorkspace` em uma atualização de interface.

## Instalar e validar

Use Node.js 24 e pnpm. As versões resolvidas estão em `pnpm-lock.yaml`.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm test:runtime
pnpm types
python -m unittest discover -s tests -v
```

`pnpm test:runtime` executa o pacote compilado com o runtime oficial do Cloudflare, banco temporário e chaves de login geradas apenas para o teste. Não usa registros reais nem altera recursos remotos. A versão do Miniflare acompanha a versão fixada do Wrangler no lockfile.

O Worker exige autenticação também durante `pnpm dev`; não há atalho de desenvolvimento que possa ser publicado e liberar o acesso. Use os testes de runtime para validar a integração localmente.

## Atualizar a publicação privada

1. Validar testes e build local. Conferir que `WORKSPACE_ID`, a classe `PCMWorkspace` e a migração `v1` não mudaram; essas identidades selecionam os dados persistentes.
2. Conferir no Cloudflare Access a aplicação para o hostname exato, a política Allow limitada ao e-mail do proprietário e o provedor **One-time PIN**. O e-mail permitido permanece somente na configuração privada.
3. Conferir que o segredo `ALLOWED_EMAIL` existe e que `ACCESS_AUD` e `ACCESS_TEAM_DOMAIN` correspondem à aplicação. Não incluir segredos em logs ou Git.
4. Publicar com `pnpm exec wrangler deploy` a partir da revisão sincronizada e validada. Manter `workers_dev: true` e `preview_urls: false`.
5. Conferir a versão implantada, redirecionamento sem autenticação, leitura autenticada e persistência. Testar escritas apenas em ambiente isolado ou com registros descartáveis autorizados, sem alterar registros de negócio.

O segredo de e-mail também é conferido dentro do Worker. Uma política Access mais ampla, por engano, não libera outros usuários no aplicativo.

## Atualizações e GitHub

O repositório oficial é `ArthurStudy/Codex_PCM`, branch `main`. Conforme solicitado pelo proprietário, toda atualização deve ser validada e enviada ao GitHub. `AGENTS.md` registra essa orientação para os próximos trabalhos.

Após configurar o ambiente, publicar somente a versão já validada e sincronizada. A conexão entre GitHub e Cloudflare Builds ainda não foi criada; um commit no GitHub, por si só, **não dispara um deploy automático** nesta configuração.

Não enviar `data/`, `.dev.vars`, `.env`, credenciais, `node_modules/`, `.wrangler/` ou `dist/` ao GitHub. `pnpm build` gera o pacote a partir do código-fonte versionado.

## Referências oficiais

- [Cloudflare Access para Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [SQLite em Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
