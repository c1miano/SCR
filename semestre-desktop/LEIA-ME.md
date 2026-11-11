# SCR — Sistema de Controle de Registro

Versão 1.6.1 para Windows de 64 bits. Funciona sem internet.

## Instalação e atualização

Feche o aplicativo anterior e execute `release/SCR-Instalador-1.6.1.exe`. O nome da janela, do executável e dos novos atalhos é SCR. O identificador de atualização e a pasta de dados permanecem compatíveis com o antigo Semestre. O instalador não possui assinatura digital de editor.

É possível executar `release/win-unpacked/SCR.exe` diretamente, mantendo todos os arquivos dessa pasta juntos. Não é preciso instalar Node.js no computador de destino.

## Período definido pelo calendário

Em **Calendários**, informe o nome, o início e o fim. Todas as disciplinas vinculadas herdam essas datas; elas não são mais editáveis dentro da disciplina. Alterar o período recalcula as disciplinas vinculadas. O período deve incluir as aulas já registradas como ministradas.

Na migração, períodos iguais das disciplinas são transferidos automaticamente para o calendário. Se havia períodos diferentes no mesmo calendário, o aplicativo mantém uma indicação dos períodos anteriores e pede a definição de um período único. Até essa definição, a previsão fica pendente. Calendários antigos sem disciplinas também precisam ter o período preenchido. Os dados anteriores permanecem como cópia de migração.

## Rotinas semanais

No cadastro da disciplina, escolha:

- **Mesma rotina toda semana**: preencha a carga em cada dia da semana.
- **Alternar semanas A e B**: preencha cada semana e informe uma data pertencente à semana A de referência. Uma semana vai de segunda a domingo. A seguinte é B, depois A novamente; feriados não deslocam a alternância. Exemplo: terça na A e quarta na B.
- **Alterar uma semana específica**: escolha uma data daquela semana e informe a rotina completa de seus sete dias. Essa configuração substitui a rotina fixa ou A/B apenas naquela semana. Todos os dias com zero significam uma semana sem aulas regulares. Clique em **Aplicar à semana** e depois em **Salvar e recalcular**. Use Editar ou Remover na lista para corrigir.

As horas são informadas na unidade da disciplina (45, 50 ou 60 minutos). Feriados e ausências de professores continuam valendo. Aulas já ministradas preservam a duração registrada. As rotinas antigas são migradas como fixas.

## Professores e turma

Professores têm cadastro próprio e podem ter nenhuma, uma ou várias disciplinas. Atribuir professores à disciplina é opcional. Ausências afetam todas as disciplinas vinculadas nas datas informadas, mesmo se houver outros professores na disciplina. Aulas ministradas são preservadas; extras explícitas continuam contadas.

Aulas extras podem ser associadas a uma disciplina vinculada ou ficar somente no registro do professor. Elas só afetam a previsão com vínculo ativo e dentro do período do calendário. Não repita o mesmo registro na disciplina. As tags de turma e os filtros por professor/turma continuam disponíveis.

## Progresso, aparência e dados

Marque **Ministrada** em cada encontro para somar sua carga ao progresso. Desmarcar desfaz. Não repita essa carga no saldo cumprido antes do período do calendário.

O botão **Modo escuro / Modo claro** mantém a preferência ao reabrir. O modo escuro usa tons de cinza e preto.

Os dados permanecem em `%APPDATA%/Semestre` para compatibilidade. Para uma cópia de segurança, feche o aplicativo e copie a pasta inteira. O CSV exporta os encontros, não substitui uma cópia dos dados. Os dados da versão web são separados.

## Desenvolvimento e verificação

Requer Node.js e npm. Execute `npm ci`, `npm test` e `npm run build`. Os testes cobrem cálculos, períodos compartilhados, migração, alternância A/B, semanas específicas, professores, aulas ministradas, persistência e aparência neutra do tema. O assistente de instalação não é executado automaticamente nos testes.

## Prévia mensal por turma (versão 1.6.1)

Abra **Prévia por turma**, escolha uma turma e o mês. As turmas são obtidas das tags cadastradas nas disciplinas. Uma disciplina com várias turmas aparece na prévia de cada turma correspondente. Cada cartão mostra a disciplina, a carga prevista e os professores vinculados. Clique no cartão para abrir o cadastro.

A prévia considera o período do calendário, feriados, semanas A/B, alterações pontuais de rotina, ausências, reposições e aulas extras. O cálculo considera todo o período antes de filtrar o mês: a carga não recomeça ao trocar de mês.

São exibidas as aulas previstas e as já ministradas das disciplinas em andamento. As ministradas aparecem em azul, com identificação própria e legenda. O último encontro é limitado à carga restante e identificado como conclusão prevista. Não são projetados novos encontros após atingir essa carga. Quando a disciplina já estiver concluída pelo progresso registrado, ela sai da prévia em todos os meses; os registros permanecem no cadastro da disciplina. Desfazer uma marcação pode fazer a disciplina voltar a aparecer.

Disciplinas sem calendário válido ficam indicadas como pendência e não geram cartões. Se não houver turma, preencha a tag no cadastro da disciplina. A prévia mostra a carga do dia; não há horários de início e fim de cada aula cadastrados.

A prévia por turma inclui aulas ministradas em azul, identificadas pelo texto Ministrada. Disciplinas com carga total cumprida continuam ocultas.
