# Validação da adaptação Cloudflare — 04/10/2026

## Cobertura

- A suíte Python original cobre nove cenários por HTTP real, usando SQLite temporário.
- `tests/worker.test.mjs` cobre oito cenários de negócio/persistência e um cenário de autenticação com várias tentativas inválidas.
- `tests/cloudflare-runtime.test.mjs` exercita o Worker compilado e o Durable Object no runtime oficial local: autenticação, HTML, cabeçalhos de proteção, rejeição de origem externa, geração simultânea de uma ocorrência, restauração com rollback, JSON inválido e limite de upload.

Os testes não usam o banco local do usuário. A simulação de login usa chaves descartáveis e e-mail fictício; o código de produção exige o JWT real do Cloudflare Access.

## Limites da validação

Resultado desta revisão: **19 testes aprovados** (9 Python, 9 Node.js, 1 integração no runtime Cloudflare). A checagem de sintaxe da interface e a compilação `wrangler deploy --dry-run` também passaram.

A compilação de publicação e os testes locais foram concluídos. Ainda não há validação de login por e-mail nem de acesso à aplicação na infraestrutura remota: o envio foi bloqueado pelas permissões da conexão Cloudflare. Não considerar o sistema publicado até verificar o endereço e a política de acesso em produção.

Para repetir os comandos, consulte [CLOUDFLARE.md](CLOUDFLARE.md).

## Taxa de produtividade — validação de 04/10/2026

Revisão independente por agente: 30 testes aprovados (18 JavaScript de capacidade/núcleo/autenticação, 11 Python por HTTP com SQLite temporário e 1 runtime Cloudflare local). Build dry-run concluído, sem publicação.

Cenários: 8 h × 50% = 4 h/dia e 20 HH/semana, taxas zero e 100%, frações, turnos, inativos, sobrecarga, persistência, rejeição de entradas inválidas sem alteração de dados, backup/restauração e legado com padrão 100%. Nenhum defeito bloqueante encontrado.

Verificação adicional com Playwright/Chrome em base descartável: prévia do formulário, salvamento em 50%, recarga preservando a taxa, captura e inspeção visual desktop (1280×900) e celular (390×844). Evidências locais: productivity-form.png e productivity-mobile.png.

Aguardando validação do proprietário. Nenhuma alteração enviada ao GitHub ou publicada no Cloudflare nesta etapa. A instância local já aberta antes das alterações precisa ser reiniciada para carregar o servidor atualizado.

## Validação para sincronização com o GitHub — 05/10/2026

O proprietário solicitou o envio da versão atual para `ArthurStudy/Codex_PCM`, branch `main`.

- 11 testes Python aprovados, com fluxo de OS, indicadores, produtividade, backup e persistência em SQLite temporário.
- 22 testes JavaScript aprovados, abrangendo capacidade, produtividade, exportação XLSX, regras de negócio e autenticação.
- 1 teste de integração aprovado no runtime local Cloudflare, incluindo acesso obrigatório, interface, SQLite, concorrência e rollback.
- Sintaxe de `public/app.js` e `public/excel-export.js` validada.
- Compilação `wrangler deploy --dry-run --outdir dist` concluída, sem publicação remota.

Total: **34 testes aprovados**. O pacote para versionamento inclui código, testes, configuração sem segredos e documentação. Banco local, dependências, caches, credenciais e arquivos gerados ficam fora do envio. Esta validação não representa publicação nem validação de login na infraestrutura Cloudflare de produção.

## Validação independente de aceitação — 05/10/2026

O inventário executável deste checkout foi de 26 testes Node existentes, 11 testes Python via HTTP/SQLite temporário e 1 integração Miniflare. O registro histórico acima de 34 testes corresponde a uma versão anterior da suíte.

Foram acrescentados 62 testes sem alterar código de produção ou a suíte preexistente. Eles cobrem datas civis, rotas e estado, auditoria, schemas de ativos/equipe/materiais/projetos/planos, regras e transições de OS, datas e referências, validação de capacidade/produtividade, limites de importação e integridade de backup, compatibilidade de cadastro legado, e leitura/validação de XLSX produzido pelo exportador.

Comando reproduzível: `pnpm run test:100`. Resultado nesta revisão: compilação Cloudflare em dry-run aprovada; **89/89 testes Node aprovados** (26 existentes + 62 adicionais + 1 runtime); **11/11 testes Python aprovados**; total **100/100**. O runner falha se não detectar exatamente 100 testes ou se qualquer etapa falhar. A suíte usa SQLite em memória/temporário. Não acessa `data/pcm.sqlite3`, o servidor local da porta 8765, GitHub ou Cloudflare remoto.

Achado da revisão independente, já corrigido: a API local agora rejeita booleanos em campos numéricos, alinhando as validações local e Cloudflare. O teste Python existente foi ampliado para cobrir horas, produtividade e rollback de backup; o número de casos permanece em **100/100 aprovados**.

Limites: os 6 cenários de XLSX usam o importador e exportador reais em um contexto de navegador simulado; não foi feita uma inspeção visual do painel em navegador real com resoluções desktop/celular, nem foi testado um login por e-mail no Cloudflare Access de produção. O login do Worker foi simulado localmente com chaves e JWT descartáveis. O servidor local está disponível em `http://127.0.0.1:8765/` para a validação manual do proprietário. GitHub e Cloudflare remoto aguardam essa validação manual.

## Consolidação e indicadores — 07/10/2026

O checkout do GitHub recebeu as correções locais de tipos de manutenção, importação e exportação Excel, além dos filtros de planos e do painel de indicadores. O painel tem fórmulas documentadas em [INDICADORES.md](INDICADORES.md) e seis testes de cálculo com casos sem dados, cancelamento, filtros, comparação de períodos, paradas e imutabilidade.

`pnpm run test:100` concluiu o build Cloudflare em dry-run e aprovou **96/96 testes Node**, incluindo runtime local Cloudflare e painel, e **11/11 testes Python** com SQLite temporário: **107/107 aprovados (100%)**. O runner exige pelo menos 100 cenários e falha em qualquer erro de build ou teste. Nenhum teste usa a base em `data/` ou grava na produção.

Antes da implantação, a API Cloudflare confirmou a aplicação Access, política Allow restrita ao proprietário, provedor One-time PIN e segredo `ALLOWED_EMAIL`. Uma requisição sem sessão ao endereço do Worker retornou HTTP 302 para o login Access. A verificação de leitura autenticada e persistência em produção deve ser registrada após a implantação.

O código do commit `4d177ba` foi implantado via Wrangler no Worker `codex-pcm` em 07/10/2026. A API confirmou o deployment `08091cf0-420d-4576-a3d1-b2ddcbed04ad` com 100% do tráfego na versão `75e8b70b-336c-4b5e-be20-6d6f903d17d1`. O segredo `ALLOWED_EMAIL` e a aplicação Access permaneceram presentes. Uma nova requisição sem sessão retornou HTTP 302 para o login Access. Não houve mudança de `WORKSPACE_ID`, classe Durable Object ou migração; nenhuma escrita de teste foi feita no armazenamento remoto. A leitura autenticada com OTP e a conferência visual dos registros existentes dependem da sessão do proprietário.
