/* Cálculos em minutos e datas locais, sem conversões de fuso. */
(function(root){
function date(s){return new Date(s+'T12:00:00')}
function key(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function weekStart(s){const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}
function scheduleFor(c,day){
 const week=weekStart(day),override=(c.weekOverrides||[]).find(x=>x.weekStart===week);
 if(override)return override.schedule;
 if(c.scheduleMode==='alternating'&&c.weekAnchor){const offset=Math.round((Date.parse(week)-Date.parse(weekStart(c.weekAnchor)))/604800000);if(((offset%2)+2)%2===1)return c.scheduleB||{};}
 return c.schedule||{};
}
function forecast(c, calendar=[]){
 const blocked=new Set(c.excluded);
 for(const entry of calendar){
  const start=entry.start>c.start?entry.start:c.start;
  const end=entry.end<c.end?entry.end:c.end;
  for(let d=date(start);d<=date(end);d.setDate(d.getDate()+1))blocked.add(key(d));
 }
 // Guarda a duração real ao marcar a aula; mudanças no calendário não apagam o histórico.
 const completed=new Map((c.completedLessons||[]).map(x=>[x.day,x.minutes]));
 const target=c.total*c.unit, baseline=c.done*c.unit;
 const taught=[...completed.values()].reduce((a,b)=>a+b,0);
 const done=Math.min(target,baseline+taught),remaining=Math.max(0,target-done),rows=[];
 let sum=0,available=0,finish=null;
 for(let d=date(c.start);d<=date(c.end);d.setDate(d.getDate()+1)){
  const day=key(d), regular=(scheduleFor(c,day)[d.getDay()]||0)*c.unit;
  const excluded=blocked.has(day), extra=c.extras.filter(x=>x.date===day).reduce((s,x)=>s+x.hours*c.unit,0);
  const minutes=completed.has(day)?completed.get(day):(excluded?0:regular)+extra;
  if(!minutes)continue;
  rows.push({day,minutes,completed:completed.has(day),extra:extra>0});
 }
 for(const [day,minutes] of completed){if(!rows.some(x=>x.day===day))rows.push({day,minutes,completed:true,extra:false});}
 rows.sort((a,b)=>a.day.localeCompare(b.day));
 let accumulated=baseline;
 for(const row of rows){
  if(!row.completed){available+=row.minutes;row.credited=Math.min(row.minutes,Math.max(0,remaining-sum));sum+=row.credited;if(remaining>0&&sum>=remaining&&!finish)finish=row.day;}
  else row.credited=row.minutes;
  accumulated=Math.min(target,accumulated+row.credited);row.accumulated=accumulated;
 }
 if(finish&&completed.size)finish=[finish,...completed.keys()].sort().at(-1);
 return {remaining,available,deficit:Math.max(0,remaining-available),finish,complete:remaining===0,done,taught,rows};
}
root.Semestre={forecast,weekStart,scheduleFor};
if(typeof module!=='undefined')module.exports={forecast,weekStart,scheduleFor};
})(typeof window!=='undefined'?window:globalThis);
