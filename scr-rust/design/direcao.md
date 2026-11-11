# Direção da interface SCR

Pessoa: professor que confere o andamento do semestre e registra aulas entre atividades.
Tarefa: localizar disciplina, conferir carga cumprida e previsão, registrar a aula e planejar reposições.
Sensação: ferramenta de trabalho limpa, legível e confiável.

## Sistema de design (2026-11, gerado com a skill ui-ux-pro-max)

Consulta usada: `education academic scheduling productivity dashboard` com `--design-system --variance 3 --motion 2 --density 7`.

- **Estilo:** Minimalismo / Swiss Style — grade clara, superfícies planas com borda de 1px, hierarquia tipográfica forte, sem sombras decorativas (sombra só no hover dos cartões da prévia).
- **Cores (tokens em `ui/app.css`):** primária teal, laranja para atenção/pendência, verde para concluído. A sugestão da skill era primária `#0D9488`; os botões usam `#0F766E` para atingir contraste 4,5:1 com texto branco. Tema escuro com os mesmos papéis semânticos.
- **Aulas:** ministrada em azul, prevista em cinza, conclusão com borda tracejada verde — mesma semântica da legenda do PDF.
- **Tipografia:** a skill sugeriu Plus Jakarta Sans, mas a CSP só permite recursos locais e o SCR funciona offline; usa-se Segoe UI Variable (Display nos títulos, Text no corpo), números tabulares, corpo 15px, mínimo 12px.
- **Ícones:** SVG em traço (estilo Lucide) definidos uma vez como `<symbol>` no `index.html`; sem emojis ou símbolos de texto como ícone.
- **Interação:** foco visível em todos os controles, transições de 160ms, `prefers-reduced-motion` respeitado, controles com 40px de altura.
- **Layout:** barra lateral de 256px (216px abaixo de 960px) com a lista de disciplinas rolando de forma independente; conteúdo até 1240px; ação "Salvar e recalcular" fixa no rodapé do formulário da disciplina.

## Regras

- Não alterar armazenamento, migração ou regras de cálculo ao mexer na interface.
- O JavaScript depende dos IDs, `name`s e atributos `data-nav`/`data-page` do `index.html`; preserve-os.
- Conferir nos temas claro e escuro e nas larguras 1280 e 760 (mínimo da janela).
- `npm run dev` com `SCR_TEST_DIR` (sem `SCR_MANUAL`) executa `ui/test-ui.js` e grava `result.json` na pasta de teste.
