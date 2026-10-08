# Indicadores de manutenção

O painel atende ao planejador e à gestão: resumo de seis KPIs, tendência, diagnóstico e acesso às ordens de origem. Usa apenas OS e cadastro de máquinas já carregados. Não altera registros, esquema, backups ou configuração de acesso.

## Recortes e cálculos

Linha e turno filtram todos os conjuntos. Canceladas ficam fora. Resultados usam data de conclusão; entradas usam solicitação; carteira representa o estado atual, independentemente do período. A comparação usa o intervalo anterior de igual duração em dias corridos.

| Indicador | Cálculo e detalhe |
| --- | --- |
| Conclusões | Contagem de concluídas no intervalo; detalhe das mesmas OS |
| Aderência | Concluídas até a programação vigente / programadas devidas no intervalo até hoje; detalhe do denominador |
| Carteira atual | Não concluídas nem canceladas; HH soma estimativas e informa ausência de estimativa positiva |
| Custo realizado | HH real × tarifa da OS + materiais informados; detalhe das conclusões |
| Paradas | Soma de parada positiva nas corretivas emergenciais concluídas, incluindo tipo legado Corretiva |
| Cobertura de HH real | Conclusões com HH > 0 / conclusões; detalhe das pendências |

Sem denominador, percentuais mostram “Sem dados”. Zero em esforço e custo pode representar falta de preenchimento; não implica gratuidade ou execução sem trabalho. Não há metas presumidas.

## Gráficos e ação

- Linhas de entradas e conclusões em até 12 intervalos, com tabela de valores e acesso às OS.
- Barra de composição e legenda interativa por estratégia.
- Barras pareadas de HH estimado e realizado para as mesmas conclusões.
- Barras por prioridade da carteira atual.
- Pareto por máquina: horas decrescentes e marcador de percentual acumulado.
- Ações para P1, prazo vencido, material e apontamento incompleto; grupos podem se sobrepor.
- Carteira aberta por técnico: inclui todos os profissionais cadastrados, segmenta Corretiva, Preventiva, Preditiva, Inspeção e Melhoria, e permite filtrar tipo e granularidade diária, semanal ou mensal. O clique abre exatamente as OS abertas daquele técnico.

A metodologia também aparece na própria tela. Reprogramações modificam a referência de aderência. Paradas simultâneas não são consolidadas: soma de horas por OS não é indisponibilidade. MTBF, disponibilidade, OEE e cumprimento histórico de planos dependem de dados adicionais.

## Validação

`node --test tests/kpi-dashboard.test.mjs tests/capacity.test.mjs tests/excel-export.test.mjs tests/worker.test.mjs`

Casos independentes verificam cancelamentos, denominador vazio, programação futura, recortes de linha/turno, intervalo anterior, HH ausentes, conservação de paradas, tipo legado, intervalos longos e imutabilidade. Verificação local no navegador confirmou carregamento, layout de computador/celular e acesso da carteira vencida à OS original, sem salvar alterações.
