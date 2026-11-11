(function(root){
const KEY='scr-data-v4';
function upgradePeriods(source){
 const calendars=source.calendars.map(cal=>{
  const pairs=new Map();for(const c of source.courses.filter(c=>c.calendarId===cal.id)){if(c.start&&c.end)pairs.set(c.start+'|'+c.end,{start:c.start,end:c.end});}
  const periods=[...pairs.values()];
  return {...cal,start:cal.start||(periods.length===1?periods[0].start:''),end:cal.end||(periods.length===1?periods[0].end:''),legacyPeriods:periods.length>1?periods:[]};
 });
 return {...source,version:4,calendars,courses:source.courses.map(c=>{const {start,end,...rest}=c;return {...rest,scheduleMode:c.scheduleMode||'fixed',weekAnchor:c.weekAnchor||start||'',scheduleB:c.scheduleB||{},weekOverrides:c.weekOverrides||[]};})};
}
function upgrade(source){
 const people=[],byName=new Map();
 const courses=source.courses.map(course=>{
  const professorIds=[];
  for(const raw of course.professors||[]){const name=raw.trim().replace(/\s+/g,' '),key=name.toLocaleLowerCase('pt-BR');if(!name)continue;
   if(!byName.has(key)){const person={id:'imported-professor-'+(people.length+1),name,absences:[],extras:[]};people.push(person);byName.set(key,person.id);}
   if(!professorIds.includes(byName.get(key)))professorIds.push(byName.get(key));
  }
  const {professors,...rest}=course;return {...rest,professorIds};
 });
 return {...source,version:3,professors:people,courses};
}
function isOriginalExample(c){return c.id==='exemplo'&&c.name==='Didática — exemplo'&&c.total===80&&c.done===40&&c.unit===50&&c.start==='2026-10-14'&&c.end==='2026-12-18'&&c.schedule?.[1]===2&&c.schedule?.[3]===2&&Object.keys(c.schedule).length===2&&c.excluded?.length===1&&c.excluded[0]==='2026-11-02'&&c.extras?.length===0;}
function migrate(courses=[],entries=[]){const calendars=entries.length?[{id:'legacy-calendar',name:'Calendário importado',entries}]:[];return {version:2,calendars,courses:courses.filter(c=>!isOriginalExample(c)).map(c=>({...c,calendarId:calendars[0]?.id||''}))};}
function load(storage){
 const raw=storage.getItem(KEY);
 if(raw){const d=JSON.parse(raw);if(d.version!==4||!Array.isArray(d.calendars)||!Array.isArray(d.courses)||!Array.isArray(d.professors))throw Error('Dados inválidos');return d;}
 const v3=storage.getItem('semestre-data-v3');if(v3){const source=JSON.parse(v3);if(source.version!==3||!Array.isArray(source.calendars)||!Array.isArray(source.courses)||!Array.isArray(source.professors))throw Error('Dados anteriores inválidos');const result=upgradePeriods(source);storage.setItem(KEY,JSON.stringify(result));return result;}
 const old=storage.getItem('semestre-data-v2');let previous;
 if(old){previous=JSON.parse(old);if(previous.version!==2||!Array.isArray(previous.calendars)||!Array.isArray(previous.courses))throw Error('Dados anteriores inválidos');}
 else{const courses=JSON.parse(storage.getItem('semestre-v1')||'[]'),entries=JSON.parse(storage.getItem('semestre-calendar-v1')||'[]');if(!Array.isArray(courses)||!Array.isArray(entries))throw Error('Dados antigos inválidos');previous=migrate(courses,entries);}
 const d=upgradePeriods(upgrade(previous));storage.setItem(KEY,JSON.stringify(d));return d;
}
const api={KEY,migrate,upgrade,upgradePeriods,load};root.SemestreStore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
