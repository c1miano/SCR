// Versão web do SCR (GitHub Pages).
//
// A interface conversa com o núcleo apenas por window.__TAURI__.core.invoke().
// No aplicativo desktop o Tauri injeta esse objeto antes das páginas e este
// arquivo não faz nada. No navegador, ele oferece os mesmos comandos com o
// núcleo portado para JavaScript (ui/web/*.js):
//   - cadastros no armazenamento local do navegador (localStorage);
//   - histórico de cópias automáticas no IndexedDB, com a retenção do desktop;
//   - backups, CSV e PDFs entregues como downloads.
(function () {
  'use strict';
  if (window.__TAURI__) return;

  const KEY = 'scr-dados';
  const PREVIOUS = 'scr-dados.backup';
  const STORAGE_LABEL = 'neste navegador. Exporte backups com frequência.';
  const base = document.currentScript.src.replace(/[^/]*$/, '');
  let modules = null;
  function loadModules() {
    if (!modules)
      modules = ['engine.js', 'pdf.js', 'report.js', 'grade.js'].reduce(
        (chain, file) =>
          chain.then(
            () =>
              new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = base + file;
                s.onload = resolve;
                s.onerror = () => reject('Falha ao carregar ' + file);
                document.head.append(s);
              }),
          ),
        Promise.resolve(),
      );
    return modules;
  }

  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const empty = () => ({ version: 4, calendars: [], courses: [], professors: [] });
  const engine = () => window.SCRWeb.engine;
  function envelope(data) {
    const { forecasts, issues } = engine().projectionsWithIssues(data);
    return { data, forecasts, issues, test: false };
  }
  function today() {
    const d = new Date();
    return window.SCRWeb.dates.parseDay(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    );
  }
  function readStored() {
    return localStorage.getItem(KEY);
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      throw 'o navegador recusou a gravação (' + (e && e.name) + '). Libere espaço ou exporte um backup.';
    }
  }

  // ---- Histórico de cópias automáticas (IndexedDB) ----
  let dbPromise = null;
  function db() {
    if (!dbPromise)
      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject('IndexedDB indisponível');
        const req = indexedDB.open('scr', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('backups', { keyPath: 'name' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    return dbPromise;
  }
  function tx(mode, fn) {
    return db().then(
      (d) =>
        new Promise((resolve, reject) => {
          const t = d.transaction('backups', mode);
          const out = fn(t.objectStore('backups'));
          t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
          t.onerror = () => reject(t.error);
        }),
    );
  }
  const stamp = (d) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(
      d.getHours(),
    ).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  function isoWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const year = d.getUTCFullYear();
    return year + '-' + Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  }
  function parseStamp(name) {
    const m = /^scr-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-.*\.json$/.exec(name);
    return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  }
  /** Mesma retenção do desktop: 20 mais recentes, últimos 30 dias e uma por semana antes disso. */
  async function prune() {
    const all = (await tx('readonly', (s) => s.getAllKeys())) || [];
    const found = all
      .map((name) => [parseStamp(name), name])
      .filter(([when]) => when)
      .sort((a, b) => b[0] - a[0] || (b[1] > a[1] ? 1 : -1));
    const limit = Date.now() - 30 * 86400000;
    const weeks = new Set();
    const remove = [];
    found.forEach(([when, name], i) => {
      const week = isoWeek(when);
      const firstOfWeek = !weeks.has(week);
      weeks.add(week);
      if (i < 20 || when >= limit || firstOfWeek) return;
      remove.push(name);
    });
    if (remove.length) await tx('readwrite', (s) => remove.forEach((n) => s.delete(n)));
  }
  async function snapshot(raw) {
    if (!raw) return;
    try {
      engine().projections(JSON.parse(raw));
      const name = `scr-${stamp(new Date())}-${Math.random().toString(36).slice(2, 8)}.json`;
      await tx('readwrite', (s) => s.put({ name, raw, saved: Date.now() }));
      await prune();
    } catch (e) {
      console.warn('SCR: cópia automática não gravada', e);
    }
  }

  // ---- Arquivos ----
  function download(name, bytes, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  }
  function pickFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = () => resolve(input.files[0] || null);
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }

  // ---- Comandos (mesmos nomes e retornos do main.rs) ----
  let loadedRaw = null;
  const commands = {
    async load_data() {
      const raw = readStored();
      const data = raw ? JSON.parse(raw) : empty();
      const result = envelope(data);
      if (!raw) write(KEY, JSON.stringify(data));
      if (loadedRaw === null) {
        await snapshot(raw);
        navigator.storage?.persist?.().catch(() => {});
      }
      loadedRaw = readStored();
      result.storagePath = STORAGE_LABEL;
      return result;
    },
    async save_data({ data }) {
      if (loadedRaw === null) throw 'Os cadastros precisam ser carregados antes de salvar.';
      const current = readStored();
      if (current !== loadedRaw)
        throw 'Os dados foram alterados em outra aba ou janela desde a abertura do SCR. Recarregue a página antes de salvar. Nenhum cadastro foi sobrescrito.';
      const result = envelope(data);
      await snapshot(current);
      const next = JSON.stringify(data);
      if (current) write(PREVIOUS, current);
      write(KEY, next);
      loadedRaw = next;
      return result;
    },
    async export_backup({ data }) {
      engine().projections(data);
      return download('scr-backup.json', JSON.stringify(data, null, 2), 'application/json');
    },
    async import_backup() {
      const file = await pickFile();
      if (!file) return null;
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch (e) {
        throw 'arquivo JSON inválido';
      }
      engine().projections(data);
      return data;
    },
    async export_csv({ text }) {
      return download('calendario-disciplina.csv', text, 'text/csv;charset=utf-8');
    },
    async export_report({ filter }) {
      const data = JSON.parse(readStored());
      const bytes = window.SCRWeb.report.generate(data, filter);
      return download(window.SCRWeb.report.filename(data, filter, today()), bytes, 'application/pdf');
    },
    async export_grade({ turmaId, versionId }) {
      const data = JSON.parse(readStored());
      const bytes = window.SCRWeb.grade.generate(data, turmaId, versionId, today());
      return download(window.SCRWeb.grade.filename(data, turmaId, versionId, today()), bytes, 'application/pdf');
    },
    async test_report() {
      throw 'Indisponível';
    },
    async ui_diagnostic({ message }) {
      console.debug('SCR:', message);
    },
  };

  async function invoke(name, args) {
    await loadModules();
    const command = commands[name];
    if (!command) throw `Comando desconhecido: ${name}`;
    try {
      return clone(await command(clone(args || {})));
    } catch (e) {
      throw typeof e === 'string' ? e : e && e.message ? e.message : String(e);
    }
  }
  window.__TAURI__ = { core: { invoke }, web: true };
  document.documentElement.classList.add('is-web');

  // ---- Ajustes da interface para o navegador ----
  function listCopies() {
    return tx('readonly', (s) => s.getAll()).then((rows) =>
      (rows || []).filter((r) => parseStamp(r.name)).sort((a, b) => (a.name < b.name ? 1 : -1)),
    );
  }
  function copiesDialog() {
    const dialog = document.createElement('dialog');
    dialog.className = 'web-dialog';
    dialog.innerHTML =
      '<h2>Cópias automáticas</h2><p class="help">O SCR guarda neste navegador uma cópia dos dados antes de cada gravação (as 20 mais recentes, todas dos últimos 30 dias e uma por semana antes disso). Restaurar substitui os cadastros atuais, que também ficam guardados como cópia.</p><div class="web-copies"></div><div class="web-dialog-actions"><button type="button" class="secondary" data-close>Fechar</button></div>';
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    const box = dialog.querySelector('.web-copies');
    box.textContent = 'Carregando…';
    listCopies()
      .then((rows) => {
        box.replaceChildren();
        if (!rows.length) {
          box.textContent = 'Nenhuma cópia ainda. Elas aparecem depois da primeira alteração nos cadastros.';
          return;
        }
        for (const row of rows) {
          let summary = '';
          try {
            const d = JSON.parse(row.raw);
            summary = `${d.courses.length} disciplina(s), ${d.professors.length} professor(es)`;
          } catch {
            summary = 'arquivo inválido';
          }
          const item = document.createElement('div');
          item.className = 'web-copy';
          const label = document.createElement('div');
          const when = parseStamp(row.name);
          label.innerHTML = '<strong></strong><span class="help"></span>';
          label.firstChild.textContent = when.toLocaleString('pt-BR');
          label.lastChild.textContent = summary;
          const get = document.createElement('button');
          get.type = 'button';
          get.className = 'secondary';
          get.textContent = 'Baixar';
          get.onclick = () => download(row.name, row.raw, 'application/json');
          const restore = document.createElement('button');
          restore.type = 'button';
          restore.className = 'secondary';
          restore.textContent = 'Restaurar';
          restore.onclick = async () => {
            if (!confirm('Substituir os cadastros atuais por esta cópia de ' + when.toLocaleString('pt-BR') + '?')) return;
            let data;
            try {
              data = JSON.parse(row.raw);
              engine().projections(data);
            } catch (e) {
              alert('Esta cópia não pode ser restaurada: ' + e);
              return;
            }
            dialog.close();
            if (typeof commit === 'function' && (await commit(data))) {
              show('home');
              announce('Cópia restaurada.');
            }
          };
          item.append(label, get, restore);
          box.append(item);
        }
      })
      .catch((e) => (box.textContent = 'Não foi possível ler as cópias: ' + e));
    dialog.showModal();
  }
  function adjust() {
    const note = document.querySelector('.sidebar-note .local');
    if (note) note.lastChild.textContent = 'Salvo neste navegador';
    const tools = document.querySelector('.sidebar-tools');
    if (tools && !document.querySelector('#backup-history')) {
      const b = document.createElement('button');
      b.id = 'backup-history';
      b.type = 'button';
      b.className = 'tool-button';
      b.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-hard-drive" /></svg>Cópias automáticas';
      b.onclick = copiesDialog;
      tools.append(b);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', adjust);
  else adjust();
})();
