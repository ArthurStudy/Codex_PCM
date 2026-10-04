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
