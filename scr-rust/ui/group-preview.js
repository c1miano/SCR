function localMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function refreshPreviewGroups() {
  const select = $('#preview-group'),
    value = select.value;
  const groups = tagValues('groups');
  select.replaceChildren();
  if (!groups.length) select.add(new Option('Nenhuma turma cadastrada', ''));
  else for (const [key, name] of groups) select.add(new Option(name, key));
  if (groups.some(([key]) => key === value)) select.value = value;
  $('#preview-no-groups').hidden = !!groups.length;
  select.disabled = !groups.length;
}
function openGroupPreview() {
  show('preview');
  refreshPreviewGroups();
  if (!$('#preview-month').value) $('#preview-month').value = localMonth();
  renderGroupPreview();
}
function renderGroupPreview() {
  const month = $('#preview-month').value,
    group = $('#preview-group').value;
  const result = GroupPreview.collect(data.courses, group, month, forecast),
    grid = $('#preview-grid');
  grid.replaceChildren();
  const cells = GroupPreview.monthCells(month);
  const title = cells.length
    ? new Date(month + '-01T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    : 'Selecione um mês';
  $('#preview-title').textContent = title;
  $('#preview-count').textContent = String(result.entries.length);
  $('#preview-subjects').textContent = String(new Set(result.entries.map((x) => x.courseId)).size);
  $('#preview-days').textContent = String(new Set(result.entries.map((x) => x.day)).size);
  $('#preview-warning').hidden = !result.missingCalendar.length;
  $('#preview-warning').textContent =
    'Defina o calendário e seu período para incluir: ' + result.missingCalendar.join(', ') + '.';
  $('#preview-empty').hidden = !group || result.entries.length > 0;
  $('#preview-empty').textContent = 'Nenhuma aula registrada ou prevista para esta turma neste mês.';
  $('#preview-completed').textContent = result.completed
    ? `${result.completed} disciplina(s) com carga cumprida foram retiradas desta prévia.`
    : '';
  const byDate = new Map();
  for (const item of result.entries) {
    if (!byDate.has(item.day)) byDate.set(item.day, []);
    byDate.get(item.day).push(item);
  }
  for (const day of cells) {
    if (!day) {
      const blank = document.createElement('div');
      blank.className = 'month-blank';
      blank.setAttribute('aria-hidden', 'true');
      grid.append(blank);
      continue;
    }
    const cell = document.createElement('section');
    cell.className = 'month-day' + (day === localToday() ? ' is-today' : '');
    cell.dataset.date = day;
    cell.setAttribute('aria-label', pretty(day));
    const number = document.createElement('h3');
    number.textContent = String(Number(day.slice(-2)));
    cell.append(number);
    const entries = byDate.get(day) || [];
    for (const entry of entries) {
      const card = button(
        '',
        () => openCourse(entry.courseId),
        'preview-lesson' + (entry.final ? ' is-final' : '') + (entry.completed ? ' is-completed' : ''),
      );
      card.dataset.courseId = entry.courseId;
      card.setAttribute(
        'aria-label',
        entry.name +
          ', ' +
          pretty(day) +
          ', ' +
          fmt(entry.minutes / entry.unit) +
          (entry.unit === 60 ? ' horas' : ' horas-aula') +
          (entry.completed ? ', aula ministrada' : ', aula prevista') +
          (entry.final ? ', conclusão prevista' : ''),
      );
      const name = document.createElement('strong');
      name.textContent = entry.name;
      const amount = document.createElement('span');
      amount.textContent = `${fmt(entry.minutes / entry.unit)} ${entry.unit === 60 ? 'h' : 'h-aula'}${entry.extra ? ' · Extra' : ''}`;
      const people = data.professors.filter((p) =>
        (data.courses.find((c) => c.id === entry.courseId)?.professorIds || []).includes(p.id),
      );
      card.append(name, amount);
      const status = document.createElement('small');
      status.className = 'preview-status';
      status.textContent = entry.completed ? '✓ Ministrada' : 'Prevista';
      card.append(status);
      if (people.length) {
        const teachers = document.createElement('small');
        teachers.textContent = people.map((p) => p.name).join(', ');
        card.append(teachers);
      }
      if (entry.final) {
        const end = document.createElement('small');
        end.className = 'preview-final';
        end.textContent =
          entry.minutes < entry.plannedMinutes - 1e-7 ? 'Conclusão · encontro parcial' : 'Conclusão prevista';
        card.append(end);
      }
      cell.append(card);
    }
    if (!entries.length) {
      const empty = document.createElement('span');
      empty.className = 'day-empty';
      empty.textContent = '—';
      cell.append(empty);
    }
    grid.append(cell);
  }
}
function movePreviewMonth(delta) {
  const field = $('#preview-month');
  const current = field.value || localMonth();
  const date = new Date(current + '-01T12:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + delta);
  const year = date.getUTCFullYear();
  if (year < 1 || year > 9999) return;
  field.value = `${String(year).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  renderGroupPreview();
}
$('#nav-preview').onclick = openGroupPreview;
$('#preview-group').onchange = renderGroupPreview;
$('#preview-month').onchange = renderGroupPreview;
$('#preview-prev').onclick = () => movePreviewMonth(-1);
$('#preview-next').onclick = () => movePreviewMonth(1);
$('#preview-today').onclick = () => {
  $('#preview-month').value = localMonth();
  renderGroupPreview();
};
$('#preview-create-course').onclick = newCourse;
