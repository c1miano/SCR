# Direção da interface SCR

Pessoa: professor que confere o andamento do semestre e registra aulas entre atividades.
Tarefa: localizar disciplina, conferir carga cumprida e previsão, registrar a aula e planejar reposições.
Sensação: diário de classe legível, sóbrio e organizado.

Domínio: diário de classe, calendário letivo, chamada, carga horária, turma, reposição, semana A/B.
Cores do contexto: branco do papel, grafite do registro, cinza das linhas, azul da caneta, âmbar da pendência, preto do quadro.
Assinatura: linha de disciplina com régua de carga cumprida e data de conclusão. Repete-se no resumo do semestre, linha da disciplina, progresso individual, seleção de navegação e calendário.
Defaults rejeitados: banner com cartão inclinado -> cabeçalho editorial compacto; três cartões métricos decorativos -> faixa de indicadores; backups antes da navegação -> ferramentas ao fim do menu.

Checkpoint dos componentes (cabeçalho, navegação, tabela, formulários, calendário):
- Intent: identificar e registrar o andamento das disciplinas com pouco esforço.
- Hierarchy: tabela e progresso lideram; títulos 28/600, valores 24/600, corpo 14, metadados 12.
- Palette: papel, tinta e grafite, azul para ação/registro; âmbar para pendência.
- Depth: superfícies de luminosidade próxima e divisórias discretas, sem sombras decorativas.
- Surfaces: papel #f6f7f9, folha #fff, controle #f1f3f6; escuro #151515, #1c1c1c, #242424.
- Typography: Bahnschrift nos títulos/valores para hierarquia compacta; Segoe UI no corpo, nativa no Windows, números tabulares.
- Spacing: base de 4px, campos/ações 40px, painéis 24px, navegação 232px.

Reutilizar botões, inputs, selects e tabelas nativos existentes. Não alterar armazenamento, migração ou regras de cálculo. Conferir nos temas claro/escuro e larguras 1280 e 800.
