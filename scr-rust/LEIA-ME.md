# SCR 2.3.0 — Rust + Tauri

O executável, o cálculo de carga horária e a persistência foram convertidos para Rust. A interface é HTML/CSS/JavaScript, preservada e conectada aos comandos Rust pelo Tauri 2. Não há Electron nem Node.js em execução no aplicativo distribuído. O Windows usa o WebView2 para exibir as telas.

## Instalar

Instale o arquivo em `src-tauri/target/release/bundle/nsis/`. O aplicativo aparece como **SCR Rust**, permitindo manter a versão anterior durante a migração. O título das telas continua SCR — Sistema de Controle de Registro.

## Dados e migração

- Dados nativos: `%APPDATA%/SCR/dados.json`.
- Cópia da gravação anterior: `%APPDATA%/SCR/dados.backup.json`.
- Importação inicial: `%APPDATA%/SCR/importacao-electron.json`, utilizada quando o cadastro ainda não existe ou está vazio e não há registro de migração concluída.
- O perfil Electron `%APPDATA%/Semestre` não é alterado.
- **Exportar backup** salva todos os cadastros em JSON. **Importar backup** valida e solicita confirmação antes de substituir os cadastros atuais.

Para preparar a migração em outra execução deste projeto, feche o SCR antigo e execute `powershell -ExecutionPolicy Bypass -File scripts/migrar-electron.ps1` antes de abrir o SCR Rust. O exportador usa uma cópia temporária do perfil antigo. Ele recusa sobrescrever um arquivo de importação já existente. A pasta `semestre-desktop` deve continuar ao lado de `scr-rust`, com o runtime Electron instalado para esta operação única. Usuários que já abriram a versão Rust podem usar **Importar backup** e escolher o arquivo exportado.

A preferência de tema pode ser selecionada novamente na versão Rust. Cadastros, vínculos, ausências, aulas extras e marcações de aulas ministradas fazem parte da migração.

## Desenvolvimento

Requisitos: Rust estável, Visual Studio Build Tools com ferramentas C++ e Windows SDK, Node.js para o CLI Tauri e WebView2. Nesta máquina os compiladores foram instalados durante a conversão. Abra um novo terminal para atualizar o PATH.

```powershell
npm ci
cargo test --manifest-path src-tauri/Cargo.toml
npm run dev
npm run build
npm run format
```

Para abrir a interface com uma cópia de dados de teste, sem o roteiro automático que fecha a janela: `$env:SCR_TEST_DIR="<pasta>"; $env:SCR_MANUAL="1"; npm run dev` (só em build de desenvolvimento).

`npm test` executa os testes Rust e o teste do formulário de relatórios (`scripts/test-reports.cjs`). `npm run format` aplica `cargo fmt` e Prettier.

O `Cargo.lock` e o `package-lock.json` fixam as dependências. `src-tauri/src/engine.rs` contém as regras de cálculo; `main.rs` contém comandos e persistência; `ui/` contém as telas. Uma falha de leitura impede editar cadastros, evitando substituir um arquivo inválido por dados vazios. Gravações usam arquivo temporário na mesma pasta e substituição atômica.

## Validação

- Testes Rust de cálculo, alternância, datas inválidas e gravação com cópia de segurança.
- 120 cenários comparados com o cálculo Electron: mesmos resultados.
- Teste no executável com perfil isolado: migração de disciplinas/professores, formulário, persistência, marcar/desmarcar aulas, prévia mensal, cores e temas.

O instalador não é executado automaticamente. Os testes não alteram os cadastros pessoais.

Correção 2.0.1: um arquivo de dados vazio não impede a importação inicial. Cadastros existentes são preservados, arquivos inválidos não são sobrescritos, e uma migração concluída não se repete.

## Interface 2.1.0

Navegação reorganizada, busca por nome na lista de disciplinas, progresso individual e consolidado em minutos convertidos para horas de 60 minutos, além de temas claro e escuro padronizados. O calendário mantém a distinção entre aulas previstas e ministradas. Nenhum campo de cadastro ou regra de cálculo foi removido. A nova coluna de carga cumprida substitui a coluna de calendário na visão geral; o calendário vinculado continua disponível no cadastro da disciplina.

As verificações visuais usam uma cópia isolada dos dados e uma identidade de aplicativo de prévia. O instalador final mantém a identidade `br.com.scr.rust` e a pasta de dados original.

## Preservação de cadastros — 2.1.1

- A pasta de produção é sempre a pasta de configuração do usuário do Windows acrescida de `SCR`, independente da versão e da identidade do pacote. `SCR_TEST_DIR` só tem efeito em builds de desenvolvimento (debug); não use o executável release para prévias com dados de teste.
- O instalador cria uma cópia exclusiva em `%APPDATA%/SCR/backups-atualizacao/` antes de copiar o aplicativo. Se essa cópia falhar, a atualização é cancelada.
- A abertura e cada gravação preservam um histórico em `%APPDATA%/SCR/backups/`, sem sobrescrever os backups anteriores.
- Se o arquivo desaparecer e houver marcador de migração, backup anterior ou histórico, a abertura interrompe o carregamento em vez de criar dados vazios.
- Uma janela com dados desatualizados não pode sobrescrever um arquivo alterado externamente: o usuário deve reabrir o aplicativo.
- O log `interface.log` registra versão, executável e caminho de dados para distinguir problemas de abertura de exclusão de registros.

Validação da 2.1.1: 13 testes Rust aprovados, incluindo arquivo ausente após migração, janela desatualizada, histórico de gravações e leitura repetida de 12 disciplinas com aulas registradas. Atualização real da versão instalada 2.1.0 para 2.1.1: arquivo de cadastros idêntico byte a byte, backup do instalador confirmado e 12 disciplinas visíveis. Não foi necessário restaurar nem substituir os registros existentes.
## Relatórios PDF — 2.2.0

No menu **Relatórios em PDF**, escolha professor, disciplina ou turma, defina a data de referência e, opcionalmente, acrescente orientações ao professor. **Gerar PDF** abre a janela para salvar o documento A4. A geração acontece em Rust, sem internet, impressora virtual ou instalação de Python.

O documento separa aulas registradas, aulas a conferir até a referência, impedimentos cadastrados e aulas futuras. Os impedimentos incluem feriados, dias não letivos, ausências (com a observação do professor) e cancelamentos da disciplina. Sem justificativa no cadastro, não se presume ausência: informa “Motivo não informado”. A previsão de término é condicionada à confirmação das pendências e à realização das aulas futuras; falta de carga prevista indica necessidade de reposição. Não inclui aulas futuras além da carga necessária. O documento identifica o calendário, os professores, as turmas e a unidade da carga. A marcação no SCR não comprova registro no sistema externo da instituição.

A exportação é somente leitura e mantém as proteções de armazenamento e backup da versão 2.1.1. Os testes cobrem os três filtros, justificativas, aulas extras em datas de ausência, mudanças semanais, disciplinas concluídas e datas de referência.
## Correção da virtualização e calendário PDF — 2.2.1

A base de produção passa a ficar na pasta Documentos do usuário, em `SCR/dados.json`. O AppData do Windows pode ser virtualizado ao executar o aplicativo a partir de um processo empacotado, criando uma cópia em `Packages/<pacote>/LocalCache/Roaming/SCR`. Isso explicava os registros visíveis em uma forma de abertura e ausentes em outra.

Na primeira abertura, sem base no destino, o SCR procura a base antiga e as cópias virtualizadas específicas do SCR. Prioriza bases com cadastros e, entre elas, a mais recentemente modificada. Copia o arquivo sem alterar seu conteúdo e preserva todas as fontes encontradas em `originais-migracao`. Uma base já existente em Documentos nunca é substituída por essa migração. O instalador mantém o backup de atualização em Documentos/SCR/backups-atualizacao. Não excluir as bases antigas durante a migração.

O relatório padrão agora é um calendário mensal em A4 paisagem, com cartões por disciplina, carga e professor. Ministradas aparecem em azul, pendências em âmbar e futuras em cinza. Disciplinas concluídas saem da grade como na prévia; as justificativas e previsões aparecem no complemento. O botão Exportar PDF na prévia transfere turma e mês para o formulário de relatório. Semanas muito cheias continuam na página seguinte, sem descartar aulas.
## Seleção de vários meses — 2.2.2

O formulário de relatórios oferece caixas de seleção para os meses dos calendários vinculados à seleção de professor, disciplina ou turma. É possível escolher meses consecutivos ou separados, selecionar todos e limpar a seleção. O documento reúne os calendários e complementos em ordem cronológica em um único PDF.

Correção: a versão 2.2.1 exibia o campo de mês, mas não o incluía na chamada `export_report`; o gerador retornava o relatório textual anterior. O formulário agora envia `months`, e o gerador recusa pedidos sem mês em vez de gerar silenciosamente o formato antigo. O campo legado `month` continua aceito para compatibilidade. O teste `node scripts/test-reports.cjs` verifica o envio pelo manipulador real do formulário e o bloqueio sem seleção; os testes Rust verificam ordenação, duplicatas, múltiplos meses no mesmo PDF e ausência do retorno ao relatório antigo.
## Calendário sem textos automáticos — 2.2.3

O PDF contém a grade mensal com identificação, datas, cartões e paginação. Não gera mais a seção explicativa de conferência/previsões nem a legenda textual extensa. Uma observação adicional aparece apenas quando preenchida no formulário, uma única vez após os calendários selecionados.

Ausências e cancelamentos aparecem em laranja, com a observação cadastrada; feriados e dias não letivos aparecem em amarelo, com seu nome/motivo. Aulas ministradas continuam azuis, previstas cinza e pendências de conferência lilás. Impedimentos e aulas extras/registradas no mesmo dia têm cartões separados. Observações longas continuam em cartões adicionais, sem truncamento. A exportação não altera os cadastros.
## Legenda e avisos — 2.2.4

Cartões de ausência/cancelamento e feriado/dia não letivo exibem **Não registrar**, inclusive quando a observação continua em outro cartão. O aviso não é aplicado à aula extra que exista na mesma data. A indicação de conclusão prevista aparece em verde e negrito. Todas as páginas incluem legenda com amostras das seis cores, incluindo páginas de continuação e de observações. A paginação reserva espaço para a legenda e mantém os motivos completos.

## Manutenção — 2.3.0

- **Disciplina inválida não bloqueia a abertura.** Um erro de cálculo em uma disciplina (carga ou datas inválidas) deixa só ela sem previsão, com o motivo no status (“Revisar cadastro: …”). Erros estruturais do arquivo continuam impedindo o carregamento.
- **Arredondamento.** Resíduos de ponto flutuante abaixo de 0,000001 minuto são desconsiderados, evitando “Reposição necessária” indevida em cargas com frações de hora.
- **Histórico de backups com retenção.** Em `Documents/SCR/backups/` ficam sempre as 20 cópias mais recentes, todas as dos últimos 30 dias e, antes disso, a mais recente de cada semana. Apenas arquivos `scr-AAAAMMDD-HHMMSS-*.json` criados pelo SCR são considerados; `dados.backup.json`, `backups-atualizacao/` e outros arquivos não são tocados. Os nomes passam a usar o horário local.
- O marcador `migracao-concluida.json` só é gravado se ainda não existir.
- Removidos `ui/engine.js` e `ui/store.js`, que não eram carregados pela interface. A referência de cálculo da versão Electron continua em `semestre-desktop/ui/engine.js`.


## Turmas e grade semanal — 2.3.0

Menu **Turmas e grades**: cada turma tem uma grade semanal (aulas por dia × segunda a sábado), em que cada célula é uma aula de uma disciplina, na unidade da disciplina. A grade define os dias e a carga de cada disciplina nas previsões, na prévia e nos relatórios PDF.

- **Vigências:** a grade pode mudar a qualquer momento. *Salvar como nova vigência* cria uma grade válida a partir da data escolhida; as semanas anteriores continuam com a grade antiga. *Corrigir esta vigência* edita a grade exibida quando ela foi cadastrada errada. Aulas marcadas como ministradas nunca mudam.
- **Prioridade no cálculo:** alteração pontual de uma semana na disciplina > grade da turma vigente na data > rotina semanal do próprio cadastro (fixa ou A/B). Antes da primeira vigência, e para disciplinas fora de qualquer grade, vale a rotina da disciplina. Se a disciplina está em mais de uma turma, as aulas das grades são somadas.
- Ao salvar uma grade, as disciplinas dela recebem a tag da turma (usada na prévia e nos relatórios).
- Os dados ficam em `turmas` no `dados.json`; versões anteriores do SCR ignoram esse campo.
- **PDF da grade:** o botão *Gerar PDF da grade* exporta a vigência exibida (A4 paisagem): quadro semanal com uma cor por disciplina, aulas seguidas agrupadas, horários, professores e resumo de aulas por semana. Usa a grade salva; com alterações pendentes no editor, o SCR pede para salvar antes.

## Visual dos PDFs

O calendário de registros e a grade da turma usam as cores e a tipografia da interface (`src-tauri/src/pdf.rs` repete os tokens de `ui/app.css`): marca SCR em teal, cartões de aula com faixa lateral colorida (azul ministrada, cinza prevista, roxo conferir, laranja ausência, amarelo feriado), sábado e domingo só aparecem quando há aula nesses dias (pela grade, rotina ou aula extra), data de referência destacada e legenda em uma linha.

## Prévia por turma: carga diária e ocorrências

- **Mínimo de 4 horas por dia.** Dias letivos (segunda a sexta, dentro do período do calendário e fora de feriados e dias não letivos) com menos de 4 horas de relógio (240 minutos) de aula ficam com contorno vermelho. Cada dia mostra o total, e o resumo conta os dias abaixo do mínimo. O valor está em `MIN_DAILY_MINUTES` (`ui/group-preview-model.js`).
- **Ocorrências na grade.** Feriados e dias não letivos (amarelo), ausências de professores e cancelamentos da disciplina (laranja) e aulas extras (verde) aparecem nos dias correspondentes. A aula extra que já aparece no cartão da disciplina (marcada “Extra”) não se repete.
- **Disciplinas concluídas.** Não saem mais da prévia: aparecem apenas as aulas marcadas como ministradas, inclusive as dadas depois de 100%, e essas aulas contam no total do dia.
- `node scripts/test-preview.cjs` testa essas regras com o núcleo JS. O calendário em PDF ainda não foi alterado.

## Interface: celular e acessibilidade

Revisão guiada pelo checklist da skill UI/UX Pro Max (estilo Minimalismo/Swiss com paleta teal, que confirmou a direção visual atual):

- **Celular (até 760px):** o menu lateral vira uma gaveta aberta pelo botão ☰ (fecha com Esc, com o fundo escurecido ou ao escolher uma tela; fechada, sai da ordem de foco). O botão de tema mostra só o ícone. Formulários ficam em uma coluna.
- **Até 640px:** tabelas viram cartões, um por linha, com o título de cada coluna, e a prévia mensal vira uma lista de dias (sem fins de semana vazios). Nenhuma tela tem rolagem horizontal em 375px.
- **Contraste:** o texto secundário do tema claro passou a `#5a6d6a` (≥ 4,5:1 em todas as superfícies).
- **Tamanho mínimo de texto:** 12px.
- **Teclado:** link “Pular para o conteúdo” no primeiro Tab.
