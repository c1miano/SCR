function reportCourses(){const kind=$('#report-kind').value,value=$('#report-value').value;return data.courses.filter(c=>kind==='disciplina'?c.id===value:kind==='professor'?(c.professorIds||[]).includes(value):(c.groups||[]).some(g=>normalizeTag(g)===value));}
function selectedReportMonths(){return [...$('#report-months').querySelectorAll('input:checked')].map(input=>input.value).sort();}
function refreshReportMonths(preferred){
 const previous=preferred||selectedReportMonths(),available=new Set();
 for(const course of reportCourses()){const cal=data.calendars.find(c=>c.id===course.calendarId);if(!cal?.start||!cal?.end)continue;const first=cal.start.slice(0,7),last=cal.end.slice(0,7);let current=first;for(let i=0;i<37&&current<=last;i++){available.add(current);const [year,month]=current.split('-').map(Number);current=month===12?`${year+1}-01`:`${year}-${String(month+1).padStart(2,'0')}`;}}
 if(!available.size&&reportCourses().length)available.add(localMonth());
 const months=[...available].sort(),selection=previous.filter(m=>available.has(m));
 if(!selection.length&&months.length)selection.push(available.has(localMonth())?localMonth():months[0]);
 const container=$('#report-months');container.replaceChildren();for(const month of months){const label=document.createElement('label'),input=document.createElement('input');label.className='lesson-check';input.type='checkbox';input.value=month;input.checked=selection.includes(month);input.onchange=reportSelection;label.append(input,document.createTextNode(new Date(month+'-01T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'})));container.append(label);}
 reportSelection();
}
function reportOptions(){
 const kind=$('#report-kind').value,select=$('#report-value');select.replaceChildren();
 const options=kind==='professor'?data.professors.map(p=>[p.id,p.name]):kind==='disciplina'?data.courses.map(c=>[c.id,c.name]):tagValues('groups');
 for(const [id,name] of options)select.add(new Option(name,id));select.disabled=!options.length;
 $('#report-selection-label').textContent={professor:'Professor',disciplina:'Disciplina',turma:'Turma'}[kind];refreshReportMonths();
}
function reportSelection(){const count=reportCourses().length,months=selectedReportMonths().length;$('#report-selection-summary').textContent=count?`${count} disciplina(s) · ${months} mês(es) selecionado(s). Calendários em ordem cronológica, reunidos em um único PDF.`:'Nenhuma disciplina vinculada a esta seleção.';$('#report-submit').disabled=!count||!months;}
function reportFilter(){return {kind:$('#report-kind').value,value:$('#report-value').value,reference:$('#report-reference').value,notes:$('#report-notes').value,months:selectedReportMonths()};}
$('#nav-reports').onclick=()=>{show('reports');reportOptions();if(!$('#report-reference').value)$('#report-reference').value=localToday();};
$('#report-kind').onchange=reportOptions;$('#report-value').onchange=()=>refreshReportMonths();
$('#report-all-months').onclick=()=>{for(const input of $('#report-months').querySelectorAll('input'))input.checked=true;reportSelection();};
$('#report-clear-months').onclick=()=>{for(const input of $('#report-months').querySelectorAll('input'))input.checked=false;reportSelection();};
$('#report-form').onsubmit=async e=>{e.preventDefault();const filter=reportFilter();if(!filter.months.length){$('#report-feedback').textContent='Selecione pelo menos um mês.';return;}const submit=$('#report-submit');submit.disabled=true;$('#report-feedback').textContent='Preparando os calendários...';try{const saved=await window.__TAURI__.core.invoke('export_report',{filter});$('#report-feedback').textContent=saved?'Calendário PDF salvo. O documento está pronto para enviar ao professor.':'Exportação cancelada.';}catch(error){$('#report-feedback').textContent='Não foi possível gerar o PDF: '+error;}finally{reportSelection();}};
$('#preview-pdf').onclick=()=>{const group=$('#preview-group').value,month=$('#preview-month').value;$('#nav-reports').click();$('#report-kind').value='turma';reportOptions();$('#report-value').value=group;refreshReportMonths([month]);};