# Simulação histórica local

Esta carga fictícia foi criada para testar como o PCM apresenta vários meses de OS sem misturar seus registros reais com uma restauração de backup. Os registros novos têm prefixo `SIM-` nas TAGs e `[SIM-AAAAMM-NN]` nas OS. Profissionais, materiais e planos usam `SIM •` ou `SIM-`. O banco hospedado no Cloudflare não recebe essa carga.

## Conteúdo

- 100 solicitações e ordens distribuídas pelos dez meses até a data de referência, com tipos Preventiva, Corretiva emergencial, Corretiva planejada, Corretiva legada, Preditiva, Inspeção e Melhoria.
- Ordens concluídas, canceladas e em diferentes etapas abertas, incluindo prioridade P1, material pendente, prazo vencido, três turnos, HH estimadas e reais, custos e paradas.
- 9 máquinas adicionais em células, linha principal e embalagem; 6 técnicos distribuídos pelos três turnos; 4 materiais e 4 planos fictícios.
- Cada OS é aberta via API local e percorre as transições válidas até o estado final. O histórico de auditoria registra **quando a simulação foi executada**, enquanto solicitação, programação e conclusão usam as datas históricas do cenário. Não interprete os eventos fictícios como fatos reais.

Os cartões de conclusões, custo e paradas podem ser filtrados por mês. **Carteira e backlog exibem o estado atual**, mesmo quando o período selecionado é antigo; não são reconstruções históricas. A aderência usa a última data programada salva, sem congelamento de reprogramações.

## Repetir com segurança

Na raiz do projeto, usando Python 3:

```sh
python scripts/simulate_history.py --as-of 2026-10-07
python scripts/simulate_history.py --as-of 2026-10-07 --apply
```

A primeira linha mostra a prévia e não altera dados. A segunda exige a instância local em `127.0.0.1:8765`, confere que ela corresponde ao SQLite indicado, cria uma cópia íntegra em `data/backups/` e cadastra os cenários. Cada OS tem marcador estável; executar a mesma data novamente retoma apenas itens pendentes e não duplica registros. `--limit 10` permite ensaiar uma carga parcial. A execução grava um manifesto em `data/simulacao-historica-AAAAMMDD.json` com contagens e caminho do backup.

O manifesto guarda `original_backup` da primeira execução e `last_run_backup` da tentativa mais recente. Mesmo se uma carga for interrompida e retomada, o primeiro backup continua indicado como ponto de retorno. Restaurá-lo substitui alterações feitas depois da carga; por isso, examine os registros mais recentes antes de qualquer restauração. O script não oferece limpeza automática nem modifica `data/` no GitHub. Se um cadastro SIM tiver sido alterado manualmente em campos de identidade, uma nova execução interrompe a carga e pede revisão, sem associar novas OS silenciosamente.

## Validação

`python -m unittest tests.test_simulate_history -v` inicia um servidor e SQLite temporários, exercita prévia, carga parcial, retomada, repetição sem duplicação, preservação dos IDs antigos, indicadores mensais e integridade do backup. A suíte principal `pnpm run test:100` também o executa.
