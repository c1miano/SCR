(function(root){
 function effects(course,people=[]){
  const assigned=people.filter(p=>(course.professorIds||[]).includes(p.id));
  const absences=[],extras=[];
  for(const person of assigned){
   for(const absence of person.absences||[]){
    absences.push({start:absence.start,end:absence.end,name:person.name});
   }
   for(const extra of person.extras||[]){
    if(extra.courseId!==course.id)continue;
    extras.push({date:extra.date,hours:extra.hours*extra.unit/course.unit,professorName:person.name});
   }
  }
  return {absences,extras};
 }
 const api={effects};root.ProfessorModel=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
