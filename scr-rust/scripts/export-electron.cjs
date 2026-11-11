// Executado uma vez com o Electron antigo. Lê somente uma cópia do perfil.
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),os=require('os'),path=require('path');
const original=process.env.SCR_LEGACY_PROFILE||path.join(process.env.APPDATA,'Semestre');
const target=process.env.SCR_IMPORT_TARGET||path.join(process.env.APPDATA,'SCR','importacao-electron.json');
if(!fs.existsSync(original)){console.log('Nenhum perfil Electron encontrado.');app.exit(0);}else{
 const copy=fs.mkdtempSync(path.join(os.tmpdir(),'scr-migracao-'));
 fs.cpSync(original,copy,{recursive:true,filter:p=>!['SingletonLock','SingletonCookie','SingletonSocket'].includes(path.basename(p))});
 app.setPath('userData',copy);app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});await w.loadFile(path.resolve(__dirname,'../../semestre-desktop/ui/index.html'));const raw=await w.webContents.executeJavaScript('JSON.stringify(SemestreStore.load(localStorage))');const d=JSON.parse(raw);if(d.version!==4)throw Error('Formato de dados desconhecido');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,raw,{flag:'wx'});console.log('Backup de migração criado; perfil original preservado.');app.exit(0);}).catch(e=>{console.error(e.message);app.exit(1)});
}
