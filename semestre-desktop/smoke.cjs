module.exports=function(phase){
 const expect=(value,message)=>{if(!value)throw Error(message)},$=s=>document.querySelector(s),state=()=>JSON.parse(localStorage.getItem('scr-data-v4'));
 expect(document.title==='SCR — Sistema de Controle de Registro','Nome antigo na janela');
 expect(typeof require==='undefined','Node exposto à interface');
 expect(!$('[data-page="home"]').hidden,'Início não é a tela inicial');
 expect(!$('#form').elements.start&&!$('#form').elements.end,'Datas ainda estão no cadastro da disciplina');
 if(phase==='preview-write'){
  $('#nav-preview').click();expect(!$('#preview-no-groups').hidden,'Orientação para turma ausente');
  const open=name=>Array.from($('#courses').children).find(b=>b.textContent===name).click();
  open('Disciplina alternada');const f=$('#form');f.elements.groups.value='Turma A, Turma B';f.requestSubmit();
  open('Disciplina fixa');f.elements.groups.value='Turma A';f.elements.total.value='3';f.requestSubmit();
  const fixed=state().courses.find(c=>c.name==='Disciplina fixa');
  $('#nav-preview').click();$('#preview-group').value='turma a';$('#preview-month').value='2026-10';$('#preview-month').dispatchEvent(new Event('change'));
  expect($('#preview-count').textContent==='2','Aulas ministradas e previstas não foram incluídas');
  const taught=$('#preview-grid').querySelector('.is-completed');expect(taught&&taught.textContent.includes('Ministrada'),'Aula ministrada sem identificação');
  const planned=$('#preview-grid').querySelector('.preview-lesson:not(.is-completed)');expect(getComputedStyle(taught).backgroundColor!==getComputedStyle(planned).backgroundColor,'Cores das aulas são iguais');
  expect(!$('#preview-grid').querySelector('[data-date="2026-10-27"] .preview-lesson'),'Feriado aparece na prévia');
  expect($('#preview-grid').querySelectorAll('[data-date="2026-10-28"] .preview-lesson').length===1,'Aula não aparece no dia correto');
  $('#preview-next').click();expect($('#preview-month').value==='2026-11','Navegação mensal falhou');
  expect($('#preview-count').textContent==='4','Mês seguinte não respeita carga acumulada');
  const final=$('#preview-grid').querySelector('[data-date="2026-11-04"] .preview-lesson');expect(final.textContent.includes('1 h-aula')&&final.textContent.includes('parcial'),'Última aula não foi limitada à carga restante');
  expect(!$('#preview-grid').querySelector('[data-date="2026-11-11"] [data-course-id="'+fixed.id+'"]'),'Disciplina aparece após conclusão prevista');
  $('#preview-group').value='turma b';$('#preview-group').dispatchEvent(new Event('change'));expect($('#preview-count').textContent==='3','Seleção de turma não isolou disciplinas');
  $('#preview-group').value='turma a';$('#preview-group').dispatchEvent(new Event('change'));$('#preview-grid').querySelector('[data-course-id="'+fixed.id+'"]').click();expect($('#course-title').textContent==='Disciplina fixa','Clique não abriu disciplina');
  $('#rows input').click();Array.from($('#rows').querySelectorAll('input')).find(x=>!x.checked).click();
  $('#nav-preview').click();expect(!$('#preview-grid').querySelector('[data-course-id="'+fixed.id+'"]'),'Disciplina concluída permanece na prévia');expect($('#preview-completed').textContent.includes('1 disciplina'),'Resumo de concluídas ausente');
  $('#preview-prev').click();expect($('#preview-count').textContent==='1'&&$('#preview-empty').hidden,'Histórico da disciplina ativa desapareceu');
  open('Disciplina fixa');$('#rows input').click();$('#nav-preview').click();expect($('#preview-count').textContent==='2','Desfazer conclusão não restaurou previsão');
 }else if(phase==='preview-read'){
  expect(state().courses[0].groups.length===2,'Turmas não persistiram');$('#nav-preview').click();$('#preview-group').value='turma a';$('#preview-month').value='2026-11';$('#preview-month').dispatchEvent(new Event('change'));expect($('#preview-count').textContent==='4','Prévia mudou após reabrir');
 }else if(phase==='write'){
  expect(state().courses.length===0,'Primeira abertura contém disciplinas');$('#new').click();expect(!$('#calendar-required').hidden,'Calendário não solicitado');
  const cf=$('#create-calendar');cf.elements.name.value='Calendário de teste';cf.elements.start.value='2026-10-19';cf.elements.end.value='2026-11-13';cf.requestSubmit();
  const cal=state().calendars[0];expect(cal.start==='2026-10-19','Período não salvo');$('#continue-course').click();const f=$('#form');
  f.elements.calendarId.value=cal.id;f.elements.calendarId.dispatchEvent(new Event('change'));expect($('#course-period').textContent.includes('13/11/2026'),'Período herdado não exibido');
  f.elements.name.value='Disciplina alternada';f.elements.total.value='8';f.elements.unit.value='50';f.elements.done.value='0';f.elements.scheduleMode.value='alternating';f.elements.scheduleMode.dispatchEvent(new Event('change'));f.elements.weekAnchor.value='2026-10-21';f.elements.day2.value='2';f.elements.dayB3.value='2';f.requestSubmit();
  expect(state().courses.length===1,'Disciplina não salva');expect(!('start' in state().courses[0])&&!('end' in state().courses[0]),'Disciplina duplicou período');
  expect($('#rows').textContent.includes('20/10/2026')&&$('#rows').textContent.includes('28/10/2026'),'Alternância não aplicada');expect($('#metrics').textContent.includes('11/11/2026'),'Conclusão alternada incorreta');
  f.elements.overrideDate.value='2026-10-28';f.elements.overrideDay2.value='2';$('#save-week-override').click();f.requestSubmit();expect($('#rows').textContent.includes('27/10/2026')&&!$('#rows').textContent.includes('28/10/2026'),'Semana pontual não substituiu rotina');
  $('#nav-calendars').click();$('#calendar-list button').click();const ef=$('#calendar-form');ef.elements.name.value='Feriado';ef.elements.start.value='2026-10-27';ef.requestSubmit();
  $('#courses button').click();expect($('#metrics').textContent.includes('Sem previsão'),'Feriado não afetou semana pontual');
  $('#nav-calendars').click();const rf=$('#rename-form');rf.elements.end.value='2026-11-20';rf.requestSubmit();$('#courses button').click();expect($('#metrics').textContent.includes('17/11/2026'),'Fim do calendário não propagou');
  $('#rows input').click();expect($('#progress-text').textContent.includes('2 de 8'),'Aula ministrada não registrada');
  $('#nav-calendars').click();rf.elements.start.value='2026-10-26';rf.requestSubmit();expect($('#feedback').textContent.includes('aulas ministradas'),'Encurtamento apagou histórico');expect(state().calendars[0].start==='2026-10-19','Período inválido foi salvo');rf.elements.start.value='2026-10-19';rf.requestSubmit();
  $('#new').click();f.elements.calendarId.value=cal.id;f.elements.name.value='Disciplina fixa';f.elements.total.value='4';f.elements.unit.value='50';f.elements.day3.value='2';f.requestSubmit();expect(state().courses.length===2,'Segunda disciplina não cadastrada');expect($('#metrics').textContent.includes('28/10/2026'),'Rotina fixa incorreta');
  $('#nav-professors').click();$('#create-professor').elements.name.value='Professor de teste';$('#create-professor').requestSubmit();Array.from(document.querySelectorAll('#professor-courses input')).at(-1).checked=true;$('#professor-profile').requestSubmit();$('#professor-absence-form').elements.start.value='2026-10-21';$('#professor-absence-form').requestSubmit();
  Array.from($('#courses').children).find(b=>b.textContent==='Disciplina fixa').click();expect($('#metrics').textContent.includes('04/11/2026'),'Ausência não usou o período do calendário');
  if(document.documentElement.dataset.theme!=='dark')$('#theme-toggle').click();
  for(const selector of ['body','.sidebar','.panel','.primary','.welcome']){const color=getComputedStyle($(selector)).backgroundColor.match(/\d+/g).map(Number);expect(color[0]===color[1]&&color[1]===color[2],'Tom colorido no modo escuro: '+selector);}
  $('#nav-home').click();
 }else if(phase==='read'){
  expect(state().courses.length===2&&state().calendars[0].end==='2026-11-20','Período não persistiu');
  expect(state().courses[0].scheduleMode==='alternating'&&state().courses[0].weekOverrides.length===1,'Rotina não persistiu');expect(state().courses[0].completedLessons.length===1,'Histórico não persistiu');expect(document.documentElement.dataset.theme==='dark','Tema não persistiu');
  $('#courses button').click();expect($('#metrics').textContent.includes('17/11/2026'),'Previsão mudou ao reiniciar');
 }else if(phase==='migration'){
  expect(state().courses.length===2&&state().professors.length===3,'Migração perdeu cadastros');expect(state().courses.every(c=>!('start' in c)&&!('end' in c)),'Migração manteve datas por disciplina');expect(state().calendars.every(c=>c.start==='2026-10-19'&&c.end==='2026-10-30'),'Períodos não migrados para calendários');expect(state().courses[1].completedLessons.length===1,'Aulas antigas perdidas');expect(localStorage.getItem('semestre-data-v3'),'Cópia de migração perdida');
  Array.from($('#courses').children).find(b=>b.textContent==='Disciplina B').click();expect($('#metrics').textContent.includes('28/10/2026'),'Migração alterou cálculo anterior');
 }
 expect(document.documentElement.scrollWidth<=innerWidth,'Layout excede largura');return {ok:true,phase,title:document.title};
};

