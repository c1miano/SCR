(async () => {
  document.body.inert = true;
  const diagnostic = (message) => window.__TAURI__.core.invoke('ui_diagnostic', { message: String(message) });
  window.addEventListener('error', (e) =>
    diagnostic('ERROR ' + e.message + ' ' + e.filename + ':' + e.lineno),
  );
  window.addEventListener('unhandledrejection', (e) => diagnostic('REJECTION ' + String(e.reason)));
  diagnostic('bootstrap');
  window.addEventListener('error', (event) => {
    if (window.scrInitial?.test)
      window.__TAURI__.core.invoke('test_report', { result: { ok: false, error: event.message } });
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (window.scrInitial?.test)
      window.__TAURI__.core.invoke('test_report', { result: { ok: false, error: String(event.reason) } });
  });
  try {
    window.scrInitial = await window.__TAURI__.core.invoke('load_data');
  } catch (error) {
    document.querySelector('#startup-status').hidden = true;
    document.body.inert = false;
    const box = document.querySelector('#storage-error');
    box.hidden = false;
    box.textContent =
      'Não foi possível carregar os dados: ' +
      error +
      '. Seus arquivos foram preservados. Feche o SCR e restaure um backup antes de continuar.';
    return;
  }
  diagnostic('data loaded: ' + window.scrInitial.data.courses.length);
  diagnostic('data path: ' + window.scrInitial.storagePath);
  document.querySelector('.sidebar-note p').textContent = 'Dados: ' + window.scrInitial.storagePath;
  document.querySelector('.sidebar-note p').style.overflowWrap = 'anywhere';
  for (const file of [
    'professor-model.js',
    'dashboard.js',
    'professors.js',
    'routine.js',
    'group-preview-model.js',
    'group-preview.js',
    'reports.js',
  ])
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = file;
      script.onload = () => {
        diagnostic('loaded ' + file);
        resolve();
      };
      script.onerror = () => {
        diagnostic('FAILED ' + file);
        reject(Error('Falha ao carregar ' + file));
      };
      document.body.append(script);
    });
  document.body.inert = false;
  document.querySelector('#startup-status').hidden = true;
  diagnostic('ready: ' + document.querySelector('#count-courses').textContent);
  if (window.scrInitial.test) {
    const script = document.createElement('script');
    script.src = 'test-ui.js';
    document.body.append(script);
  }
  document.querySelector('#backup-export').onclick = async () => {
    try {
      if (await window.__TAURI__.core.invoke('export_backup', { data: window.scrInitial.data }))
        announce('Backup exportado.');
    } catch (error) {
      announce('Falha ao exportar: ' + error);
    }
  };
  document.querySelector('#backup-import').onclick = async () => {
    try {
      const imported = await window.__TAURI__.core.invoke('import_backup');
      if (!imported) return;
      if (
        !confirm('Substituir os cadastros pelos dados deste backup? Uma cópia dos dados atuais será mantida.')
      )
        return;
      if (await commit(imported)) {
        show('home');
        announce('Backup importado.');
      }
    } catch (error) {
      announce('Falha ao importar: ' + error);
    }
  };
})().catch((error) => {
  document.body.inert = false;
  document.querySelector('#startup-status').hidden = true;
  const box = document.querySelector('#storage-error');
  box.hidden = false;
  box.textContent =
    'Não foi possível iniciar a interface. Feche e abra o SCR novamente. Seus cadastros não foram alterados.';
});
