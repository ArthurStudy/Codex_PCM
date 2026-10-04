# Publicação no Cloudflare

## Estado da preparação

A aplicação está adaptada e testada para Cloudflare Workers. A publicação ainda não foi concluída: o conector consegue consultar a conta, mas a tentativa de enviar `codex-pcm` foi recusada com `No access to the specified resource`. A criação do provedor de código por e-mail também foi recusada. É necessário concluir a autorização de escrita da conexão Cloudflare.

O Zero Trust já foi ativado. Ainda faltam a aplicação e a política do Access, o provedor de código por e-mail, o endereço workers.dev e a publicação do Worker. Até isso ser concluído, `workers_dev` e `preview_urls` permanecem desativados. O código bloqueia todas as requisições sem uma identidade verificada, mesmo se uma rota for ativada por engano.

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

## Concluir a publicação privada

1. Autorizar a conexão a editar Workers e os recursos necessários de Cloudflare Access na conta do proprietário, ou autenticar o Wrangler com `pnpm exec wrangler login` para publicar e concluir o Access pelo painel.
2. Abrir Workers & Pages para criar o subdomínio workers.dev da conta, se ainda não existir.
3. Configurar um provedor **One-time PIN** no Zero Trust.
4. Criar uma aplicação Access para o hostname exato de `codex-pcm`, com uma única política Allow para o e-mail indicado pelo proprietário. Selecionar apenas o provedor de código por e-mail.
5. Copiar o **Application Audience (AUD)** da aplicação para `ACCESS_AUD` em `wrangler.jsonc`. Confirmar que `ACCESS_TEAM_DOMAIN` corresponde ao domínio da organização Zero Trust.
6. Gravar o e-mail permitido como segredo, sem publicá-lo no GitHub:

   ```sh
   pnpm exec wrangler secret put ALLOWED_EMAIL
   ```

7. Publicar o Worker. Quando a política de acesso estiver configurada e os testes passarem, habilitar `workers_dev` no arquivo de configuração e publicar novamente. Manter `preview_urls: false`.
8. Validar o endereço sem autenticação (deve exigir login), com o proprietário autorizado e com um e-mail não autorizado. Conferir criação de OS, persistência, backup e restauração no ambiente apropriado, sem apagar dados existentes.

O segredo de e-mail também é conferido dentro do Worker. Uma política Access mais ampla, por engano, não libera outros usuários no aplicativo.

## Atualizações e GitHub

O repositório oficial é `ArthurStudy/Codex_PCM`, branch `main`. Conforme solicitado pelo proprietário, toda atualização deve ser validada e enviada ao GitHub. `AGENTS.md` registra essa orientação para os próximos trabalhos.

Após configurar o ambiente, publicar somente a versão já validada e sincronizada. A conexão entre GitHub e Cloudflare Builds ainda não foi criada; um commit no GitHub, por si só, **não dispara um deploy automático** nesta configuração.

Não enviar `data/`, `.dev.vars`, `.env`, credenciais, `node_modules/`, `.wrangler/` ou `dist/` ao GitHub. `pnpm build` gera o pacote a partir do código-fonte versionado.

## Referências oficiais

- [Cloudflare Access para Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [SQLite em Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
