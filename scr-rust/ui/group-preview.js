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
  const result = GroupPreview.preview(data, group, month, forecast),
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
  const shortDays = Object.values(result.days).filter((x) => x.short).length;
  $('#preview-short').textContent = String(shortDays);
  $('#preview-short-label').textContent =
    `dia(s) letivo(s) com menos de ${GroupPreview.hoursLabel(GroupPreview.MIN_DAILY_MINUTES)}`;
  $('#preview-warning').hidden = !result.missingCalendar.length;
  $('#preview-warning').textContent =
    'Defina o calendário e seu período para incluir: ' + result.missingCalendar.join(', ') + '.';
  $('#preview-empty').hidden = !group || result.entries.length > 0 || result.events.length > 0;
  $('#preview-empty').textContent = 'Nenhuma aula registrada ou prevista para esta turma neste mês.';
  $('#preview-completed').textContent = result.completed
    ? `${result.completed} disciplina(s) com carga cumprida: aulas além da carga só aparecem marcadas como “Aula a mais”.`
    : '';
  const byDate = new Map();
  for (const item of result.entries) {
    if (!byDate.has(item.day)) byDate.set(item.day, []);
    byDate.get(item.day).push(item);
  }
  const eventsByDate = new Map();
  for (const item of result.events) {
    if (!eventsByDate.has(item.day)) eventsByDate.set(item.day, []);
    eventsByDate.get(item.day).push(item);
  }
  for (const day of cells) {
    if (!day) {
      const blank = document.createElement('div');
      blank.className = 'month-blank';
      blank.setAttribute('aria-hidden', 'true');
      grid.append(blank);
      continue;
    }
    const load = result.days[day] || { minutes: 0, required: false, short: false };
    const cell = document.createElement('section');
    cell.className =
      'month-day' + (day === localToday() ? ' is-today' : '') + (load.short ? ' is-short' : '');
    cell.dataset.date = day;
    const minimum = GroupPreview.hoursLabel(GroupPreview.MIN_DAILY_MINUTES);
    cell.setAttribute(
      'aria-label',
      pretty(day) +
        (load.minutes > 0 ? ', ' + GroupPreview.hoursLabel(load.minutes) + ' de aula' : '') +
        (load.short ? ', menos de ' + minimum + ' de aula' : ''),
    );
    const head = document.createElement('div');
    head.className = 'month-day-head';
    const number = document.createElement('h3');
    number.textContent = String(Number(day.slice(-2)));
    // Dia da semana: só aparece na lista do celular, onde não há cabeçalho de colunas.
    const weekday = document.createElement('span');
    weekday.className = 'day-weekday';
    weekday.setAttribute('aria-hidden', 'true');
    weekday.textContent = new Date(day + 'T12:00:00')
      .toLocaleDateString('pt-BR', { weekday: 'long' })
      .replace('-feira', '');
    head.append(number, weekday);
    if (load.required || load.minutes > 0) {
      const total = document.createElement('small');
      total.className = 'day-total';
      total.textContent = GroupPreview.hoursLabel(load.minutes);
      total.title = load.short
        ? `Menos de ${minimum} de aula neste dia`
        : 'Total de aulas no dia (horas de 60 minutos)';
      head.append(total);
    }
    cell.append(head);
    const dayEvents = eventsByDate.get(day) || [];
    for (const event of dayEvents) {
      const box = document.createElement(event.courseId ? 'button' : 'div');
      if (event.courseId) {
        box.type = 'button';
        box.onclick = () => openCourse(event.courseId);
      }
      box.className = 'preview-event is-' + event.kind;
      const label = document.createElement('strong');
      label.textContent = event.label;
      const detail = document.createElement('small');
      detail.textContent =
        event.kind === 'extra'
          ? `${event.detail} · ${fmt(event.hours)} ${event.unit === 60 ? 'h' : 'h-aula'}`
          : event.detail;
      box.append(label);
      if (detail.textContent) box.append(detail);
      box.setAttribute('aria-label', event.label + (detail.textContent ? ': ' + detail.textContent : ''));
      cell.append(box);
    }
    const entries = byDate.get(day) || [];
    for (const entry of entries) {
      const card = button(
        '',
        () => openCourse(entry.courseId),
        'preview-lesson' +
          (entry.final ? ' is-final' : '') +
          (entry.review ? ' is-review' : entry.surplus ? ' is-surplus' : entry.past ? ' is-completed' : ''),
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
          ', ' +
          lessonStatus(entry).toLowerCase() +
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
      status.textContent = lessonStatus(entry);
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
    if (!entries.length && !dayEvents.length && !load.required) cell.classList.add('is-off');
    if (!entries.length && !dayEvents.length) {
      const empty = document.createElement('span');
      empty.className = 'day-empty';
      empty.textContent = '—';
      cell.append(empty);
    }
    grid.append(cell);
  }
}
/** Situação do cartão: marcações primeiro, depois realizada (até hoje) ou prevista. */
function lessonStatus(entry) {
  if (entry.review) return 'Conferir';
  if (entry.surplus) return 'Aula a mais';
  return entry.past ? 'Realizada' : 'Prevista';
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
