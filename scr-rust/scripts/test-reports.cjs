const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,{value:'',disabled:false,textContent:''});return elements.get(id);};
let months=[{value:'2026-11',checked:true},{value:'2026-10',checked:true},{value:'2026-09',checked:false}],calls=[];
el('#report-months').querySelectorAll=selector=>selector==='input:checked'?months.filter(m=>m.checked):months;
el('#report-kind').value='professor';el('#report-value').value='p';el('#report-reference').value='2026-10-20';
const context={$:el,data:{courses:[{id:'c',professorIds:['p']}],professors:[],calendars:[]},window:{__TAURI__:{core:{invoke:async(name,args)=>{calls.push({name,args});return true;}}}}};
vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../ui/reports.js'),'utf8'),context);
(async()=>{await el('#report-form').onsubmit({preventDefault(){}});assert.equal(calls[0].name,'export_report');assert.deepEqual(Array.from(calls[0].args.filter.months),['2026-10','2026-11']);assert.match(el('#report-feedback').textContent,/PDF salvo/);el('#report-clear-months').onclick();assert.equal(el('#report-submit').disabled,true);await el('#report-form').onsubmit({preventDefault(){}});assert.equal(calls.length,1);el('#report-all-months').onclick();await el('#report-form').onsubmit({preventDefault(){}});assert.equal(calls[1].args.filter.months.length,3);console.log('OK: envio de meses selecionados, seleção múltipla e bloqueio sem meses.');})().catch(e=>{console.error(e);process.exitCode=1;});
