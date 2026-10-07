# Orientações deste projeto

- Construir primeiro a menor versão confiável que resolva o problema principal. A evolução deve acontecer por incrementos pequenos, testáveis e reversíveis.
- Preservar todos os dados existentes em produção. Antes de publicar, identificar onde os dados são armazenados, revisar os comandos de implantação e as alterações no banco. Não apagar, recriar ou substituir dados de produção. Quando houver alteração no banco, fazer backup e usar uma migração que preserve os registros.
- O repositório oficial é https://github.com/ArthurStudy/Codex_PCM, branch `main`.
- O usuário pediu que todas as atualizações do projeto sejam também enviadas ao GitHub. Ao concluir alterações, valide-as e sincronize os arquivos relevantes com esse repositório. Informe qualquer bloqueio de envio; não diga que sincronizou sem conferir.
- A hospedagem de destino é Cloudflare. Preserve o funcionamento da versão local e a compatibilidade dos backups.
- O acesso à versão hospedada deve ser restrito ao e-mail autorizado pelo proprietário, com código de entrada por e-mail via Cloudflare Access. Mantenha esse e-mail na configuração privada do Cloudflare, não no repositório público.
- Nunca publique o banco local `data/`, caches, credenciais ou arquivos de configuração secreta.
- Não habilite um endereço de produção sem proteção de acesso. Valide autenticação, persistência e fluxos de OS antes de considerar a publicação concluída.
