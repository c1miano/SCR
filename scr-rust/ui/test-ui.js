(async()=>{const check=(v,m)=>{if(!v)throw Error(m)};const wait=()=>new Promise(r=>setTimeout(r,100));
try{
 check(document.title.startsWith('SCR'),'Título');check(data.courses.length===2,'Migração de disciplinas');check(data.professors.length===1,'Migração de professores');
 $('#nav-preview').click();$('#preview-group').value='turma a';$('#preview-month').value='2026-10';$('#preview-month').dispatchEvent(new Event('change'));
 check($('#preview-count').textContent==='2','Prévia outubro');const taught=$('.preview-lesson.is-completed'),planned=$('.preview-lesson:not(.is-completed)');check(taught&&planned,'Aulas ministradas e previstas');check(getComputedStyle(taught).backgroundColor!==getComputedStyle(planned).backgroundColor,'Cores');
 $('#theme-toggle').click();check(getComputedStyle(taught).backgroundColor!==getComputedStyle(planned).backgroundColor,'Cores no outro tema');
 const course=data.courses.find(c=>c.name==='Disciplina alternada');openCourse(course.id);$('#form').elements.name.value='Disciplina alternada Rust';$('#form').requestSubmit();for(let i=0;i<100&&window.scrBusy;i++)await wait();check(data.courses.some(c=>c.name==='Disciplina alternada Rust'),'Gravação via Rust');
 const saved=await window.__TAURI__.core.invoke('load_data');check(saved.data.courses.some(c=>c.name==='Disciplina alternada Rust'),'Persistência nativa');
 $('#form').elements.name.value='Disciplina alternada';$('#form').requestSubmit();for(let i=0;i<100&&window.scrBusy;i++)await wait();
 await setLessonCompleted(course.id,'2026-11-03',true);check(forecast(course).done===200,'Marcação de aula em Rust');await setLessonCompleted(course.id,'2026-11-03',false);
 check(document.documentElement.scrollWidth<=innerWidth,'Layout horizontal');await window.__TAURI__.core.invoke('test_report',{result:{ok:true,checks:['migração','prévia','cores','temas','salvar formulário','persistência','marcar e desmarcar aula','layout']}});
}catch(e){await window.__TAURI__.core.invoke('test_report',{result:{ok:false,error:String(e.stack||e)}});}})();
