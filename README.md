# PCM — Central de manutenção

Aplicação individual para planejamento e controle de manutenção de uma fábrica de lavadoras, com células kanban, linha principal e três turnos. Interface em português. Python e SQLite, sem dependências externas ou conexão com internet.

Além da versão local abaixo, o projeto inclui uma versão para **Cloudflare Workers**, com banco SQLite persistente e acesso privado por Cloudflare Access. A preparação, os testes e as etapas pendentes de publicação estão em [CLOUDFLARE.md](CLOUDFLARE.md). A versão online ainda depende da conclusão das permissões e da configuração de hospedagem.

## Abrir

Dê dois cliques em **Iniciar PCM.cmd**. O iniciador encontra o Python local (ou o Python do Codex), inicia o servidor em segundo plano e abre `http://127.0.0.1:8765/` no navegador. Execute o mesmo arquivo para reabrir. O servidor aceita apenas conexões deste computador.

Alternativamente, execute `python server.py --open` com Python 3.10 ou superior. Mantenha esse terminal aberto durante o uso. Ao desligar o computador, execute o iniciador novamente.

Os registros ficam em `data/pcm.sqlite3`. A primeira abertura cria uma base demonstrativa com equipamentos, profissionais e ordens fictícias. Nada é publicado em serviço externo. Faça backup em **Dados e histórico** antes de começar uma base vazia ou restaurar um arquivo.

## Fluxo de trabalho

1. **Ativos e células:** cadastrar TAG, equipamento, área/célula e criticidade.
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
- Indicadores: conclusões, aderência, MTTR registrado, custo, composição, HH, backlog e capacidade.
- Falhas: histórico de corretivas concluídas, falha, causa, ação e tempo de parada.
- Ativos, equipe e materiais: cadastro e edição; exclusões bloqueadas quando existem vínculos.
- Dados e histórico: backup JSON, restauração transacional e últimas alterações.

## Critérios e limites

- **Backlog:** retrato atual das OS não concluídas e não canceladas. Soma HH estimados; não subtrai apontamentos parciais. Não é histórico por período.
- **Capacidade:** soma horas/dia × dias/semana dos profissionais ativos, filtrada por turno. Técnicos não têm lotação exclusiva por área, portanto filtrar área reduz o backlog, mas não a capacidade compartilhada do turno. Calendário não administra férias, feriados ou indisponibilidades.
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

Os testes usam bancos temporários e um servidor isolado. Não modificam os registros do usuário. Consulte `RELATORIO_TESTES.md` para os cenários e resultados da revisão independente.
