const { app, BrowserWindow, Menu, dialog, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const smokeDir = process.env.SEMESTRE_TEST_DIR;
const smokePhase = process.env.SEMESTRE_TEST_PHASE;
if (smokeDir) app.setPath('userData', path.resolve(smokeDir));
else app.setPath('userData', path.join(app.getPath('appData'), 'Semestre'));
app.setName('SCR');
let window;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if(window) { if(window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(createWindow).catch(error => {
    if(smokeDir) fs.writeFileSync(path.join(smokeDir,'result-'+smokePhase+'.json'),JSON.stringify({ok:false,error:error.stack}));
    else dialog.showErrorBox('Não foi possível abrir o SCR', error.message);
    app.exit(1);
  });
}
app.on('window-all-closed', () => app.quit());

async function createWindow() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({cancel: !/^(file:|blob:|devtools:)/.test(details.url)}));
  window = new BrowserWindow({width:1280,height:900,minWidth:760,minHeight:600,show:false,backgroundColor:'#f5f7f2',title:'SCR — Sistema de Controle de Registro',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'Arquivo',submenu:[{label:'Sair',accelerator:'Alt+F4',click:()=>app.quit()}]},
    {label:'Editar',submenu:[{role:'undo',label:'Desfazer'},{role:'redo',label:'Refazer'},{type:'separator'},{role:'cut',label:'Recortar'},{role:'copy',label:'Copiar'},{role:'paste',label:'Colar'},{role:'selectAll',label:'Selecionar tudo'}]},
    {label:'Exibir',submenu:[{role:'resetZoom',label:'Tamanho original'},{role:'zoomIn',label:'Aumentar'},{role:'zoomOut',label:'Diminuir'},{role:'togglefullscreen',label:'Tela cheia'}]},
    {label:'Ajuda',submenu:[{label:'Sobre o SCR',click:()=>dialog.showMessageBox(window,{type:'info',title:'SCR — Sistema de Controle de Registro',message:'SCR '+app.getVersion(),detail:'Planejamento de carga horária. Funciona sem internet.\n\nOs dados são salvos neste computador, no perfil do usuário Windows. A versão web possui dados separados.\n\nPasta dos dados: '+app.getPath('userData')})}]}
  ]));
  const index=path.join(__dirname,'ui','index.html');
  const entry=pathToFileURL(index).href;
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(url!==entry)event.preventDefault()});
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  await window.loadFile(index);
  if(smokeDir) await smokeTest();
  else window.show();
}

async function smokeTest(){
  const run=require('./smoke.cjs');
  const result=await window.webContents.executeJavaScript('(()=>{try{return ('+run.toString()+')('+JSON.stringify(smokePhase)+');}catch(error){return {ok:false,error:error.stack};}})()');
  await session.defaultSession.flushStorageData();
  fs.writeFileSync(path.join(smokeDir,'result-'+smokePhase+'.json'),JSON.stringify(result,null,2));
  app.exit(result.ok?0:1);
}
