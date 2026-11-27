# SCR — Sistema de Controle de Registro

Acompanhamento de carga horária, aulas realizadas, grades semanais por turma e relatórios em PDF.

## Versão web (GitHub Pages)

A mesma interface do aplicativo desktop roda direto no navegador, sem instalação.

- **Onde ficam os dados:** no próprio navegador (armazenamento local do site). Nada é enviado a servidores. Cada navegador/computador tem seus próprios dados.
- **Backups:** use *Exportar backup* com frequência. O arquivo sai com a data e a hora no nome (ex.: `scr-backup-2026-11-27_14h35.json`). Limpar os dados de navegação apaga os cadastros.
- **Cópias automáticas:** antes de cada gravação o SCR guarda uma cópia no navegador (20 mais recentes, todas dos últimos 30 dias e uma por semana antes disso), disponível no botão *Cópias automáticas*.
- **Vindo do desktop:** no SCR desktop, *Exportar backup*; na versão web, *Importar backup* com esse arquivo.
- **PDFs e CSV** são baixados pelo navegador.

### Como funciona

A interface (`scr-rust/ui`) conversa com o núcleo apenas por `window.__TAURI__.core.invoke`. No navegador, `scr-rust/ui/web/api.js` oferece os mesmos comandos usando o núcleo portado para JavaScript:

| Rust (`src-tauri/src`) | JavaScript (`ui/web`) |
| --- | --- |
| `engine.rs` | `engine.js` |
| `pdf.rs` | `pdf.js` |
| `report.rs` | `report.js` |
| `grade.rs` | `grade.js` |
| `main.rs` (gravação, backups, diálogos) | `api.js` (localStorage, IndexedDB, downloads) |

No aplicativo desktop o Tauri já define `window.__TAURI__` e `api.js` não faz nada. Alterações nas regras de cálculo ou nos PDFs devem ser feitas nos dois lados. Os PDFs gerados em JS são idênticos byte a byte aos do executável Rust nos cenários testados.

Para testar localmente: `python -m http.server 8766 --directory scr-rust/ui` e abrir `http://localhost:8766`.

O workflow `.github/workflows/pages.yml` publica `scr-rust/ui` a cada push na branch `main`.

## Aplicativo desktop

Ver [scr-rust/LEIA-ME.md](scr-rust/LEIA-ME.md).
