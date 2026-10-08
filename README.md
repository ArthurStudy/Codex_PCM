# PCM — Central de manutenção

Aplicação individual para planejamento e controle de manutenção de uma fábrica de lavadoras, organizada por linhas de produção, máquinas e três turnos. Interface em português. Python e SQLite, sem dependências externas ou conexão com internet.

Além da versão local abaixo, o projeto inclui uma versão para **Cloudflare Workers**, com banco SQLite persistente e acesso privado por Cloudflare Access. O endereço é [codex-pcm.arthur-study95.workers.dev](https://codex-pcm.arthur-study95.workers.dev/). A arquitetura e os cuidados de atualização estão em [CLOUDFLARE.md](CLOUDFLARE.md).

## Abrir

Dê dois cliques em **Iniciar PCM.cmd**. O iniciador encontra o Python local (ou o Python do Codex), inicia o servidor em segundo plano e abre `http://127.0.0.1:8765/` no navegador. Execute o mesmo arquivo para reabrir. O servidor aceita apenas conexões deste computador.

Alternativamente, execute `python server.py --open` com Python 3.10 ou superior. Mantenha esse terminal aberto durante o uso. Ao desligar o computador, execute o iniciador novamente.

Os registros ficam em `data/pcm.sqlite3`. A primeira abertura cria uma base demonstrativa com equipamentos, profissionais e ordens fictícias. Nada é publicado em serviço externo. Faça backup em **Dados e histórico** antes de começar uma base vazia ou restaurar um arquivo.

## Fluxo de trabalho

1. **Linhas de produção e máquinas:** cadastrar cada máquina com TAG e linha. OS, planos, programação, indicadores e exportações apontam para a máquina e exibem sua linha. Utilidades e classificações legadas podem permanecer sem linha.
2. **Equipe e capacidade:** cadastrar especialidade, turno, horas disponíveis por dia e dias por semana.
3. **Ordens de serviço:** abrir a solicitação com ativo, tipo, prioridade, prazo e HH estimados. A OS entra imediatamente no backlog.
4. Abrir a OS e usar **Planejar**, **Aguardar material** ou **Programar**. A programação exige data e responsável no turno correspondente. Os botões de avanço abrem um formulário de revisão; a etapa muda somente quando salva.
5. Usar **Iniciar execução** em uma OS programada.
6. Usar **Concluir OS**. Informar HH reais maiores que zero, data da conclusão e serviço realizado. Corretivas exigem falha e causa (ou “Em análise”). Custos e tempo de parada são campos distintos e não obrigatórios; preencha-os para ter indicadores completos.
7. A conclusão remove a OS do backlog e alimenta indicadores no período da data de conclusão. Cancelamento exige justificativa e exclui a OS dos cálculos de produção da manutenção. Ordens não são apagadas; o histórico registra alterações e transições.

Salve alterações antes de avançar a etapa. Datas futuras de solicitação e conclusão são bloqueadas. Uma OS encerrada não volta a uma etapa aberta; os apontamentos podem ser corrigidos e essas alterações ficam registradas no histórico.

## Módulos disponíveis

- Visão geral: prioridades, composição do backlog, fluxo de seis semanas e alertas.
- OS: criação, consulta, edição, transições e exportação CSV com filtros.
- Programação: diária, semanal, mensal e anual, filtros de área/turno e alerta de sobrecarga diária por técnico.
- Backlog: colunas por etapa, prioridade, carga HH e idade da carteira.
- Planos: periodicidade em dias, roteiros e geração manual de OS por ocorrência, com prevenção de geração duplicada. O prazo da ocorrência é preservado mesmo quando vencido.
- Cronogramas: janelas de parada, OS vinculadas e gráfico por data programada.
- Indicadores: seis cartões de entrega, aderência, carteira, custo, paradas e cobertura de HH; tendência, composição, esforço, prioridades, Pareto e acesso às OS de origem. Consulte [INDICADORES.md](INDICADORES.md) para fórmulas e limites.
- Falhas: histórico de corretivas concluídas, falha, causa, ação e tempo de parada.
- Ativos, equipe e materiais: cadastro e edição; exclusões bloqueadas quando existem vínculos.
- Dados e histórico: backup JSON, restauração transacional e últimas alterações.

Para avaliar meses de OS fictícias na base local, consulte [SIMULACAO_HISTORICA.md](SIMULACAO_HISTORICA.md). A carga é identificada, repetível e cria backup antes da gravação; não é enviada ao Cloudflare.

## Critérios e limites

- **Backlog:** retrato atual das OS não concluídas e não canceladas. Soma HH estimados; não subtrai apontamentos parciais. Não é histórico por período.
- **Capacidade:** soma horas/dia × dias/semana × taxa de produtividade ÷ 100 dos profissionais ativos, filtrada por turno. Técnicos não têm lotação exclusiva por área, portanto filtrar área reduz o backlog, mas não a capacidade compartilhada do turno. Calendário não administra férias, feriados ou indisponibilidades.
- **Aderência:** OS concluídas até a programação atual ÷ OS programadas devidas no período até hoje, excluindo canceladas. Reprogramação altera a referência; não existe uma programação congelada.
- **MTTR registrado:** parada total das corretivas concluídas com parada > 0 ÷ quantidade dessas OS. Uma OS representa um evento. Eventos sobrepostos não são consolidados.
- **Custo:** HH reais × custo/HH + custo de materiais das OS concluídas no período. Valores não informados permanecem zero; não há integração contábil.
- **Manutenção proativa:** preventivas + preditivas + inspeções ÷ todas as OS concluídas no período.
- Indicadores sem denominador exibem “—”. MTBF, disponibilidade e OEE não são calculados sem dados confiáveis de operação/produção/qualidade.
- Programação usa dia e turno, com um executante por OS. Não controla hora inicial/final, equipes múltiplas, dependências ou caminho crítico. Cada barra do cronograma representa o dia programado.
- Planos geram OS mediante ação do usuário; não há execução automática em segundo plano.
- Materiais possuem saldo manual; consumo e custo da OS não movimentam estoque automaticamente.
- Roteiro/procedimento é texto; não há upload de anexos ou checklist assinado.
- A versão Python é de uso local individual, sem login. Não exponha a porta à rede. A versão Cloudflare exige login do proprietário via Access; não implementa equipes com diferentes permissões nem integrações ERP/MES.
- Backup JSON inclui os registros e uma cópia do histórico. Na restauração os registros são substituídos; o histórico do computador mantém a trilha da restauração. Não é um sistema de auditoria imutável.

## Testes

`python -m unittest discover -s tests -v`

Para uma validação integrada, execute `pnpm run test:100`. O comando recompila a versão Cloudflare em modo dry-run e roda pelo menos 100 testes locais, inclusive o dashboard, aceitação, integração Miniflare e testes Python via HTTP com SQLite temporário. O relatório mostra o total real. Não publica no GitHub ou Cloudflare e não usa o banco local em `data/`. Requer dependências instaladas, Node.js e Python 3.

Os testes usam bancos em memória/temporários e um servidor isolado. Não modificam os registros do usuário. Consulte `RELATORIO_TESTES.md` para os cenários e resultados da revisão independente.

### Planejamento × capacidade na visão geral

O painel compara HH estimados de OS abertas com data programada à capacidade útil dos técnicos ativos. Permite filtrar técnico e intervalo (até 366 dias), agrupar por dia ou semana e clicar nas colunas para consultar/editar OS. O gráfico usa barras verticais lado a lado, eixo vertical em HH e períodos no eixo horizontal, com rolagem para intervalos longos. A sobrecarga soma excessos por técnico/dia, sem compensar conflitos com folgas de outros recursos.

A escala nominal conta os dias/semana a partir de segunda-feira; frações usam horas proporcionais. Feriados, férias e ausências não são descontados. OS sem responsável entram na demanda com alerta; técnicos inativos têm capacidade zero. Concluídas, canceladas e OS sem data ficam fora. O formato de backup permanece pcm-backup-v1.

Teste dos cálculos: `node --test tests/capacity.test.mjs` (também incluído em `npm test`).

### Taxa de produtividade por profissional

O cadastro de equipe aceita uma taxa de 0 a 100%. A meta produtiva diária é horas totais × taxa ÷ 100: 8 h a 50% equivalem a 4 h/dia e, em 5 dias, 20 HH/semana. O formulário mostra a meta antes de salvar. Painel, ocupação, saldo, sobrecarga da programação, capacidade por turno e semanas de backlog usam essa capacidade ajustada. Horas realizadas, custos, MTTR e aderência continuam baseados nos registros das OS.

Cadastros e backups antigos sem `productivity_rate` assumem 100%. O campo é persistido nos servidores local e Cloudflare e incluído no backup JSON. Taxa zero representa capacidade produtiva zero; razões sem capacidade são exibidas sem divisão por zero. Alterar a taxa recalcula a capacidade atual; não há histórico de taxas por período.

### Exportação Excel de ordens de serviço

Na aba Ordens de serviço, Exportar Excel baixa um arquivo .xlsx com os mesmos filtros e campos da exportação CSV. A planilha contém cabeçalho destacado, linhas alternadas, filtros por coluna, cabeçalho e duas primeiras colunas fixos, datas dd/mm/aaaa e custos em reais. A geração ocorre no navegador, sem serviços externos.

Validação independente: quatro testes de exportação e leitura com openpyxl sem avisos. O Excel não estava instalado no ambiente de teste; a aparência no aplicativo real não foi confirmada.
