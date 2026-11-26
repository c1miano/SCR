const $ = (s) => document.querySelector(s),
  fmt = (n) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(n),
  pretty = (d) => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR');
const normalizeTag = (s) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
function parseTags(text) {
  const unique = new Map();
  for (const raw of text.split(/[,;\n]/)) {
    const value = raw.trim().replace(/\s+/g, ' ');
    if (value && !unique.has(normalizeTag(value))) unique.set(normalizeTag(value), value);
  }
  return [...unique.values()];
}
function tagValues(field) {
  if (field === 'professors')
    return data.professors.map((p) => [p.id, p.name]).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  const map = new Map();
  for (const c of data.courses)
    for (const t of c[field] || []) if (!map.has(normalizeTag(t))) map.set(normalizeTag(t), t);
  return [...map].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
}
function refreshFilters() {
  for (const [id, field, label] of [
    ['#filter-professor', 'professors', 'Todos os professores'],
    ['#filter-turma', 'groups', 'Todas as turmas'],
  ]) {
    const select = $(id),
      value = select.value;
    select.replaceChildren(new Option(label, ''));
    for (const [key, name] of tagValues(field)) select.add(new Option(name, key));
    select.value = [...select.options].some((o) => o.value === value) ? value : '';
  }
}
function filteredCourses() {
  return data.courses.filter(
    (c) =>
      (!$('#filter-search').value ||
        normalizeTag(c.name).includes(normalizeTag($('#filter-search').value))) &&
      (!$('#filter-professor').value || (c.professorIds || []).includes($('#filter-professor').value)) &&
      (!$('#filter-turma').value ||
        (c.groups || []).some((x) => normalizeTag(x) === $('#filter-turma').value)),
  );
}
function tagBadges(c) {
  const container = document.createElement('div');
  container.className = 'course-tags';
  for (const [field, label] of [
    ['professors', 'Professor'],
    ['groups', 'Turma'],
  ])
    for (const value of field === 'professors'
      ? data.professors.filter((p) => (c.professorIds || []).includes(p.id)).map((p) => p.name)
      : c[field] || []) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = label + ': ' + value;
      container.append(tag);
    }
  return container;
}
const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
let data = { version: 4, calendars: [], courses: [], professors: [] },
  readError = false,
  page = 'home',
  selected = null,
  calendarId = null,
  eventId = null,
  all = false,
  pendingCourse = false;
try {
  if (!window.scrInitial) throw Error('Falha ao carregar');
  data = window.scrInitial.data;
} catch {
  readError = true;
  $('#storage-error').hidden = false;
  $('.local').textContent = '⚠ Falha ao carregar dados';
}
function announce(message) {
  $('#feedback').textContent = message;
}
async function commit(next) {
  if (readError || window.scrBusy) {
    announce('Aguarde a gravação ou reinicie o aplicativo se houve falha ao carregar.');
    return false;
  }
  window.scrBusy = true;
  document.body.inert = true;
  try {
    const result = await window.__TAURI__.core.invoke('save_data', { data: next });
    data = result.data;
    window.scrInitial = result;
    return true;
  } catch (error) {
    announce('Não foi possível salvar: ' + error);
    return false;
  } finally {
    window.scrBusy = false;
    document.body.inert = false;
  }
}
function calendarFor(c) {
  return data.calendars.find((k) => k.id === c.calendarId);
}
function coursePeriod(c) {
  const cal = calendarFor(c);
  return { ...c, start: cal?.start || '', end: cal?.end || '' };
}
function hasPeriod(cal) {
  return cal && validDate(cal.start) && validDate(cal.end) && cal.start <= cal.end;
}
function forecast(c) {
  return window.scrInitial?.forecasts[c.id] || null;
}
function button(text, fn, cls = 'secondary') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  b.onclick = fn;
  return b;
}
function show(next) {
  page = next;
  document.querySelectorAll('[data-page]').forEach((el) => (el.hidden = el.dataset.page !== next));
  document
    .querySelectorAll('[data-nav]')
    .forEach((el) => el.classList.toggle('active', el.dataset.nav === next));
  $('#page-title').textContent = {
    home: 'Visão geral',
    calendars: 'Calendários acadêmicos',
    course: 'Disciplinas',
    professors: 'Professores',
    preview: 'Prévia por turma',
    turmas: 'Turmas e grades',
    reports: 'Relatórios em PDF',
  }[next];
  announce('');
  renderHome();
  renderNav();
  window.scrollTo(0, 0);
}
function renderNav() {
  $('#courses').replaceChildren();
  for (const c of data.courses)
    $('#courses').append(
      button(
        c.name,
        () => openCourse(c.id),
        'course-link' + (selected === c.id && page === 'course' ? ' active' : ''),
      ),
    );
  $('#no-courses').hidden = data.courses.length > 0;
}
function status(c, r) {
  const issue = window.scrInitial?.issues?.[c.id];
  return !r
    ? issue
      ? 'Revisar cadastro: ' + issue
      : 'Revisar calendário'
    : r.complete
      ? 'Carga concluída'
      : r.deficit
        ? 'Reposição necessária'
        : 'Dentro do prazo';
}
function renderHome() {
  const results = data.courses.map((c) => forecast(c));
  $('#count-courses').textContent = data.courses.length;
  $('#count-calendars').textContent = data.calendars.length;
  $('#count-attention').textContent = results.filter((r) => !r || r.deficit > 0).length;
  $('#getting-started').hidden = data.courses.length > 0;
  $('#welcome-title').textContent = data.courses.length
    ? 'Acompanhe seu semestre.'
    : 'Vamos planejar seu semestre.';
  $('#welcome-copy').textContent = data.courses.length
    ? 'Confira a carga registrada e organize as próximas aulas.'
    : 'Comece pelo calendário acadêmico. Depois, vincule suas disciplinas e acompanhe a previsão de conclusão.';
  $('#step-calendar').textContent = data.calendars.length
    ? '✓ Calendário cadastrado'
    : '1 · Cadastre um calendário';
  $('#home-primary').textContent = data.calendars.length ? 'Cadastrar disciplina' : 'Cadastrar calendário';
  $('#home-primary').onclick = () => (data.calendars.length ? newCourse() : openCalendars());
  $('#overview-empty').hidden = data.courses.length > 0;
  $('#overview-table').hidden = !data.courses.length;
  renderSemesterRegister(results);
  refreshFilters();
  const filtered = filteredCourses();
  $('#filter-summary').textContent =
    `${filtered.length} de ${data.courses.length} disciplina(s). Os totais acima consideram todos os cadastros.`;
  const body = $('#overview-rows');
  body.replaceChildren();
  if (data.courses.length && !filtered.length) {
    const cell = body.insertRow().insertCell();
    cell.colSpan = 4;
    cell.textContent = 'Nenhuma disciplina corresponde aos filtros.';
  }
  for (const c of filtered) {
    const r = forecast(c),
      row = body.insertRow();
    const nameCell = row.insertCell();
    nameCell.append(
      button(c.name, () => openCourse(c.id), 'text-button'),
      tagBadges(c),
    );
    const loadCell = row.insertCell();
    loadCell.className = 'course-load';
    if (r) {
      const amount = document.createElement('span');
      amount.textContent =
        fmt(r.done / c.unit) + ' / ' + fmt(c.total) + ' ' + (c.unit === 60 ? 'h' : 'h-aula');
      const bar = document.createElement('progress');
      bar.max = 100;
      bar.value = Math.min(100, (r.done / (c.total * c.unit)) * 100);
      bar.setAttribute('aria-label', 'Carga cumprida de ' + c.name);
      loadCell.append(amount, bar);
    } else loadCell.textContent = 'Defina o calendário';
    row.insertCell().textContent = r?.complete ? 'Concluída' : r?.finish ? pretty(r.finish) : '—';
    const badge = document.createElement('span');
    badge.className = 'badge' + (!r || r.deficit ? ' attention' : r.complete ? ' done' : '');
    badge.textContent = status(c, r);
    row.insertCell().append(badge);
  }
}
function refreshCalendarOptions(value = '') {
  const select = $('#form').elements.calendarId;
  select.replaceChildren(new Option('Selecione um calendário', ''));
  for (const c of data.calendars) select.add(new Option(c.name, c.id));
  select.value = value;
}
function openCalendars() {
  show('calendars');
  renderCalendars();
}
function renderCalendars() {
  $('#calendar-list').replaceChildren();
  $('#calendar-empty').hidden = data.calendars.length > 0;
  $('#calendar-required').hidden = !pendingCourse || !!data.calendars.length;
  for (const cal of data.calendars) {
    const card = document.createElement('article');
    card.className = 'calendar-card' + (cal.id === calendarId ? ' selected' : '');
    const title = document.createElement('h3');
    title.textContent = cal.name;
    const desc = document.createElement('p');
    desc.textContent = `${hasPeriod(cal) ? pretty(cal.start) + ' a ' + pretty(cal.end) : 'Defina o início e o fim'} · ${cal.entries.length} data(s) ou período(s) · ${data.courses.filter((c) => c.calendarId === cal.id).length} disciplina(s)`;
    card.append(
      title,
      desc,
      button('Gerenciar calendário', () => selectCalendar(cal.id)),
    );
    $('#calendar-list').append(card);
  }
  const cal = data.calendars.find((c) => c.id === calendarId);
  $('#calendar-detail').hidden = !cal;
  if (!cal) return;
  $('#calendar-title').textContent = cal.name;
  $('#rename-form').elements.name.value = cal.name;
  $('#rename-form').elements.start.value = cal.start || '';
  $('#rename-form').elements.end.value = cal.end || '';
  $('#calendar-period-warning').hidden = !cal.legacyPeriods?.length;
  $('#calendar-period-warning').textContent = cal.legacyPeriods?.length
    ? 'As disciplinas antigas tinham períodos diferentes: ' +
      cal.legacyPeriods.map((p) => pretty(p.start) + ' a ' + pretty(p.end)).join('; ') +
      '. Defina um período único para este calendário.'
    : '';
  const body = $('#calendar-entries');
  body.replaceChildren();
  if (!cal.entries.length) {
    const cell = body.insertRow().insertCell();
    cell.colSpan = 4;
    cell.textContent = 'Nenhum feriado ou dia não letivo cadastrado neste calendário.';
  }
  for (const item of [...cal.entries].sort((a, b) => a.start.localeCompare(b.start))) {
    const row = body.insertRow();
    for (const value of [
      item.name,
      item.start === item.end ? pretty(item.start) : `${pretty(item.start)} a ${pretty(item.end)}`,
      item.type === 'holiday' ? 'Feriado' : 'Dia não letivo',
    ])
      row.insertCell().textContent = value;
    const actions = row.insertCell();
    actions.className = 'calendar-row-actions';
    actions.append(
      button('Editar', () => {
        eventId = item.id;
        const f = $('#calendar-form');
        for (const k of ['name', 'type', 'start', 'end']) f.elements[k].value = item[k];
        $('#calendar-save').textContent = 'Salvar data';
        $('#calendar-cancel').hidden = false;
        f.elements.name.focus();
      }),
      button('Excluir', async () => {
        if (!confirm('Excluir esta data? As disciplinas deste calendário serão recalculadas.')) return;
        if (await updateCalendar({ ...cal, entries: cal.entries.filter((e) => e.id !== item.id) }))
          resetEvent();
      }),
    );
  }
}
function resetEvent() {
  eventId = null;
  $('#calendar-form').reset();
  $('#calendar-save').textContent = 'Adicionar data';
  $('#calendar-cancel').hidden = true;
  $('#calendar-message').textContent = '';
}
function selectCalendar(id) {
  calendarId = id;
  resetEvent();
  renderCalendars();
  $('#calendar-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function validateCalendarPeriod(cal) {
  if (!hasPeriod(cal)) {
    announce('Informe um início e um fim válidos para o calendário.');
    return false;
  }
  if ((Date.parse(cal.end) - Date.parse(cal.start)) / 86400000 > 1096) {
    announce('Use um período de até três anos.');
    return false;
  }
  const affected = data.courses.filter(
    (c) =>
      c.calendarId === cal.id && (c.completedLessons || []).some((x) => x.day < cal.start || x.day > cal.end),
  );
  if (affected.length) {
    announce(
      'O período deve incluir as aulas ministradas de: ' +
        affected.map((c) => c.name).join(', ') +
        '. Corrija as marcações antes de retirar essas datas.',
    );
    return false;
  }
  return true;
}
async function updateCalendar(cal) {
  if (!(await commit({ ...data, calendars: data.calendars.map((c) => (c.id === cal.id ? cal : c)) })))
    return false;
  renderCalendars();
  renderHome();
  announce('Calendário salvo. As disciplinas vinculadas foram recalculadas.');
  return true;
}
$('#create-calendar').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.currentTarget,
    name = f.elements.name.value.trim();
  if (!name) return;
  if (data.calendars.some((c) => c.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    announce('Já existe um calendário com esse nome.');
    return;
  }
  const start = f.elements.start.value,
    end = f.elements.end.value;
  if (!validateCalendarPeriod({ start, end })) {
    return;
  }
  const cal = { id: crypto.randomUUID(), name, start, end, entries: [] };
  if (!(await commit({ ...data, calendars: [...data.calendars, cal] }))) return;
  f.reset();
  selectCalendar(cal.id);
  renderHome();
  $('#continue-course').hidden = !pendingCourse;
  announce('Calendário cadastrado. Adicione as datas não letivas ou continue para a disciplina.');
};
$('#rename-form').onsubmit = async (e) => {
  e.preventDefault();
  const name = e.currentTarget.elements.name.value.trim();
  if (!name) return;
  if (
    data.calendars.some((c) => c.id !== calendarId && c.name.toLocaleLowerCase() === name.toLocaleLowerCase())
  ) {
    announce('Já existe um calendário com esse nome.');
    return;
  }
  const cal = {
    ...data.calendars.find((c) => c.id === calendarId),
    name,
    start: e.currentTarget.elements.start.value,
    end: e.currentTarget.elements.end.value,
  };
  if (!validateCalendarPeriod(cal)) return;
  cal.legacyPeriods = [];
  updateCalendar(cal);
};
function validDate(s) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !isNaN(new Date(s + 'T12:00:00')) &&
    new Date(s + 'T12:00:00').getDate() === Number(s.slice(-2))
  );
}
$('#calendar-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.currentTarget,
    cal = data.calendars.find((c) => c.id === calendarId);
  if (!cal) return;
  const item = {
    id: eventId || crypto.randomUUID(),
    name: f.elements.name.value.trim(),
    type: f.elements.type.value,
    start: f.elements.start.value,
    end: f.elements.end.value || f.elements.start.value,
  };
  if (!item.name || !validDate(item.start) || !validDate(item.end) || item.start > item.end) {
    $('#calendar-message').textContent =
      'Informe nome e datas válidas. O fim não pode ser anterior ao início.';
    return;
  }
  if (cal.entries.some((x) => x.id !== item.id && x.start === item.start && x.end === item.end)) {
    $('#calendar-message').textContent = 'Essa data ou período já está cadastrado neste calendário.';
    return;
  }
  if (
    await updateCalendar({
      ...cal,
      entries: eventId ? cal.entries.map((x) => (x.id === eventId ? item : x)) : [...cal.entries, item],
    })
  ) {
    resetEvent();
    $('#calendar-message').textContent = 'Data salva neste calendário.';
  }
};
$('#calendar-cancel').onclick = resetEvent;
function newCourse() {
  if (!data.calendars.length) {
    pendingCourse = true;
    openCalendars();
    $('#create-calendar').elements.name.focus();
    return;
  }
  pendingCourse = false;
  $('#continue-course').hidden = true;
  selected = null;
  all = false;
  const f = $('#form');
  f.reset();
  refreshCalendarOptions();
  renderCourseProfessors([]);
  loadRoutine();
  showCalendarPeriod();
  f.elements.done.value = 0;
  for (let d = 0; d < 7; d++) f.elements['day' + d].value = 0;
  $('#error').textContent = '';
  show('course');
  renderCourse();
  f.elements.name.focus();
}
function openCourse(id) {
  selected = id;
  const c = data.courses.find((x) => x.id === id);
  if (!c) return;
  const f = $('#form');
  for (const k of ['name', 'total', 'done', 'unit']) f.elements[k].value = c[k];
  refreshCalendarOptions(c.calendarId);
  loadRoutine(c);
  showCalendarPeriod();
  renderCourseProfessors(c.professorIds || []);
  f.elements.groups.value = (c.groups || []).join(', ');
  for (let d = 0; d < 7; d++) f.elements['day' + d].value = c.schedule[d] || 0;
  f.elements.excluded.value = c.excluded.join('\n');
  f.elements.extras.value = c.extras.map((x) => `${x.date}, ${x.hours}`).join('\n');
  $('#error').textContent = '';
  all = false;
  show('course');
  renderCourse();
}
function renderCourse() {
  const raw = data.courses.find((x) => x.id === selected),
    c = raw ? coursePeriod(raw) : null,
    r = c ? forecast(c) : null;
  $('#course-title').textContent = c ? c.name : 'Cadastrar disciplina';
  $('#status').textContent = c ? status(c, r) : 'Novo cadastro';
  $('#status').className = 'badge' + (c && (!r || r.deficit) ? ' attention' : r?.complete ? ' done' : '');
  $('#course-results').hidden = !r;
  $('#calendar-output').hidden = !r;
  $('#export').disabled = !r;
  $('#course-missing-calendar').hidden = !c || !!r;
  renderProfessorEffects(c);
  if (typeof renderCourseGradeNote === 'function') renderCourseGradeNote(raw);
  if (!r) return;
  const unit = c.unit === 60 ? 'h' : 'h-aula';
  $('#metrics').innerHTML =
    `<div class="metric"><small>CARGA TOTAL</small><strong>${fmt(c.total)} <span>${unit}</span></strong><span>Cada unidade tem ${c.unit} minutos</span></div><div class="metric"><small>FALTA CUMPRIR</small><strong>${fmt(r.remaining / c.unit)} <span>${unit}</span></strong><span>${fmt(r.remaining / 60)} horas de 60 minutos</span></div><div class="metric"><small>CONCLUSÃO PREVISTA</small><strong>${r.complete ? 'Concluída' : r.finish ? pretty(r.finish) : 'Sem previsão'}</strong><span>Fim do semestre: ${pretty(c.end)}</span></div>`;
  const pct = Math.min(100, (r.done / (c.total * c.unit)) * 100);
  $('#progress').value = pct;
  $('#progress-text').textContent = `${fmt(r.done / c.unit)} de ${fmt(c.total)} ${unit} · ${fmt(pct)}%`;
  $('#notice').className = 'notice' + (r.deficit ? ' warn' : '');
  $('#notice').textContent = r.complete
    ? 'A carga horária já foi cumprida.'
    : r.deficit
      ? `Faltam ${fmt(r.deficit / c.unit)} ${unit} além dos encontros previstos. Planeje reposições até ${pretty(c.end)}.`
      : `Conclusão prevista em ${pretty(r.finish)}, conforme o calendário ${calendarFor(c).name}.`;
  const rows = all ? r.rows : r.rows.slice(0, 6);
  $('#rows').replaceChildren();
  if (!rows.length) {
    const cell = $('#rows').insertRow().insertCell();
    cell.colSpan = 5;
    cell.textContent = 'Nenhum encontro previsto.';
  }
  for (const x of rows) {
    const tr = $('#rows').insertRow();
    tr.className = x.completed ? 'taught' : x.day === r.finish ? 'finish' : '';
    for (const text of [
      pretty(x.day),
      (x.day === r.finish ? '✓ Conclusão' : days[new Date(x.day + 'T12:00:00').getDay()]) +
        (x.extra ? ' · Extra' : ''),
      fmt(x.minutes / c.unit) + ' ' + unit,
      fmt(x.accumulated / c.unit) + ' ' + unit,
    ])
      tr.insertCell().textContent = text;
    const label = document.createElement('label');
    label.className = 'lesson-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = x.completed;
    input.setAttribute('aria-label', 'Aula ministrada em ' + pretty(x.day));
    input.onchange = () => setLessonCompleted(c.id, x.day, input.checked);
    label.append(input, document.createTextNode(x.completed ? 'Sim' : 'Marcar'));
    tr.insertCell().append(label);
  }
  $('#toggle').textContent = all ? 'Ver menos' : `Ver todos (${r.rows.length})`;
  $('#toggle').disabled = r.rows.length <= 6;
}
$('#week').innerHTML = [1, 2, 3, 4, 5, 6, 0]
  .map(
    (d) =>
      `<label>${days[d]}<input aria-label="Carga de ${days[d]}" name="day${d}" type="number" min="0" max="24" step="0.01" value="0" required></label>`,
  )
  .join('');
$('#form').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  try {
    const c = {
      id: selected || crypto.randomUUID(),
      name: f.elements.name.value.trim(),
      calendarId: f.elements.calendarId.value,
      total: Number(f.elements.total.value),
      done: Number(f.elements.done.value),
      unit: Number(f.elements.unit.value),
      schedule: {},
      professorIds: [...$('#course-professors').querySelectorAll('input:checked')].map((x) => x.value),
      groups: parseTags(f.elements.groups.value),
      completedLessons: data.courses.find((x) => x.id === selected)?.completedLessons || [],
    };
    if (!hasPeriod(calendarFor(c))) throw Error('Selecione um calendário com início e fim definidos.');
    const period = coursePeriod(c);
    c.start = period.start;
    c.end = period.end;
    if (!c.name) throw Error('Informe o nome da disciplina.');
    if (c.done > c.total) throw Error('A carga cumprida não pode superar a carga total.');
    if (!validDate(c.start) || !validDate(c.end) || c.start > c.end)
      throw Error('Informe um período válido.');
    if ((new Date(c.end) - new Date(c.start)) / 86400000 > 1096)
      throw Error('Use um período de até três anos.');
    if (c.completedLessons.some((x) => x.day < c.start || x.day > c.end))
      throw Error(
        'O período precisa incluir as aulas já ministradas. Desmarque-as antes de retirar essas datas do período.',
      );
    for (let d = 0; d < 7; d++) c.schedule[d] = Number(f.elements['day' + d].value);
    c.excluded = [
      ...new Set(
        f.elements.excluded.value
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    if (c.excluded.some((d) => !validDate(d)))
      throw Error('Revise as faltas e cancelamentos. Use AAAA-MM-DD.');
    c.extras = f.elements.extras.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const m = s.match(/^(\d{4}-\d{2}-\d{2})\s*,\s*(\d+(?:[.,]\d+)?)$/);
        if (
          !m ||
          !validDate(m[1]) ||
          Number(m[2].replace(',', '.')) <= 0 ||
          Number(m[2].replace(',', '.')) > 24
        )
          throw Error('Reposições: use AAAA-MM-DD, quantidade (até 24 por registro).');
        return { date: m[1], hours: Number(m[2].replace(',', '.')) };
      });
    if ([...c.excluded, ...c.extras.map((x) => x.date)].some((d) => d < c.start || d > c.end))
      throw Error('Os ajustes individuais devem estar dentro do período da disciplina.');
    c.scheduleMode = f.elements.scheduleMode.value;
    c.weekAnchor = f.elements.weekAnchor.value;
    c.scheduleB = {};
    for (let d = 0; d < 7; d++) c.scheduleB[d] = Number(f.elements['dayB' + d].value);
    if (c.scheduleMode === 'alternating' && !validDate(c.weekAnchor))
      throw Error('Informe uma data da semana A de referência.');
    c.weekOverrides = JSON.parse(JSON.stringify(draftWeekOverrides));
    delete c.start;
    delete c.end;
    const next = {
      ...data,
      courses: selected ? data.courses.map((x) => (x.id === selected ? c : x)) : [...data.courses, c],
    };
    if (!(await commit(next))) return;
    selected = c.id;
    $('#error').textContent = '';
    renderCourse();
    renderNav();
    renderHome();
    announce('Disciplina salva e previsão atualizada.');
    window.scrollTo(0, 0);
  } catch (error) {
    $('#error').textContent = error.message;
  }
};
$('#toggle').onclick = () => {
  all = !all;
  renderCourse();
};
$('#export').onclick = async () => {
  const c = data.courses.find((x) => x.id === selected),
    r = c ? forecast(c) : null;
  if (!r) return;
  const text =
    '\uFEFFData;Carga prevista;Carga acumulada;Minutos por unidade;Ministrada\r\n' +
    r.rows
      .map(
        (x) =>
          `${pretty(x.day)};${fmt(x.minutes / c.unit)};${fmt(x.accumulated / c.unit)};${c.unit};${x.completed ? 'Sim' : 'Não'}`,
      )
      .join('\r\n');
  try {
    await window.__TAURI__.core.invoke('export_csv', { text });
  } catch (error) {
    announce('Falha ao exportar: ' + error);
  }
};
$('#nav-home').onclick = () => show('home');
$('#nav-calendars').onclick = openCalendars;
$('#new').onclick = newCourse;
$('#home-new').onclick = newCourse;
$('#home-calendars').onclick = openCalendars;
$('#continue-course').onclick = newCourse;
$('#course-calendar-link').onclick = () => {
  openCalendars();
  announce(
    'Cadastre o calendário e volte à disciplina pelo menu. Salve suas alterações antes de sair do formulário.',
  );
};
show('home');

async function setLessonCompleted(id, day, checked) {
  const c = data.courses.find((x) => x.id === id),
    r = forecast(c),
    row = r?.rows.find((x) => x.day === day);
  if (!row) return;
  const lessons = (c.completedLessons || []).filter((x) => x.day !== day);
  if (checked) lessons.push({ day, minutes: row.minutes });
  const updated = { ...c, completedLessons: lessons };
  if (await commit({ ...data, courses: data.courses.map((x) => (x.id === id ? updated : x)) })) {
    renderCourse();
    renderHome();
    announce(
      checked
        ? 'Aula registrada como ministrada. Progresso atualizado.'
        : 'Marcação desfeita. Progresso atualizado.',
    );
  } else renderCourse();
}
$('#filter-professor').onchange = renderHome;
$('#filter-turma').onchange = renderHome;
$('#clear-filters').onclick = () => {
  $('#filter-professor').value = '';
  $('#filter-turma').value = '';
  $('#filter-search').value = '';
  renderHome();
};
function syncThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#theme-label').textContent = dark ? 'Modo claro' : 'Modo escuro';
  $('#theme-toggle').setAttribute('aria-pressed', String(dark));
}
$('#theme-toggle').onclick = () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('semestre-theme', theme);
  } catch {
    announce('Tema aplicado nesta sessão; não foi possível salvar a preferência.');
  }
  syncThemeButton();
};
syncThemeButton();

function showCalendarPeriod() {
  const cal = data.calendars.find((x) => x.id === $('#form').elements.calendarId.value);
  $('#course-period').textContent = hasPeriod(cal)
    ? 'Período herdado do calendário: ' + pretty(cal.start) + ' a ' + pretty(cal.end)
    : 'Escolha um calendário com início e fim definidos.';
}
$('#form').elements.calendarId.addEventListener('change', showCalendarPeriod);

function renderSemesterRegister(results) {
  let total = 0,
    done = 0,
    valid = 0;
  data.courses.forEach((c, i) => {
    if (results[i]) {
      total += c.total * c.unit;
      done += results[i].done;
      valid++;
    }
  });
  const pct = total ? Math.min(100, (done / total) * 100) : 0;
  $('#semester-percentage').textContent = total ? fmt(pct) + '%' : '—';
  $('#semester-progress').value = pct;
  $('#semester-description').textContent = total
    ? fmt(done / 60) +
      ' de ' +
      fmt(total / 60) +
      ' horas registradas' +
      (valid < data.courses.length ? ' · calendários válidos' : '')
    : 'Cadastre disciplinas para acompanhar.';
}
$('#filter-search').oninput = renderHome;

// ---------- Menu lateral em telas estreitas (gaveta) ----------
const narrowScreen = matchMedia('(max-width: 760px)');
function setSidebar(open, restoreFocus = false) {
  const sidebar = $('#sidebar'),
    toggle = $('#menu-toggle');
  const narrow = narrowScreen.matches;
  open = open && narrow;
  document.body.classList.toggle('sidebar-open', open);
  // Fechada no celular, a gaveta sai da ordem de foco e do leitor de tela.
  sidebar.inert = narrow && !open;
  $('.sidebar-backdrop').hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  if (open) sidebar.querySelector('.main-nav button')?.focus();
  else if (restoreFocus) toggle.focus();
}
$('#menu-toggle').onclick = () => setSidebar(!document.body.classList.contains('sidebar-open'));
$('.sidebar-backdrop').onclick = () => setSidebar(false, true);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) setSidebar(false, true);
});
// Escolher um item do menu fecha a gaveta.
$('#sidebar').addEventListener('click', (event) => {
  if (narrowScreen.matches && event.target.closest('button, a')) setSidebar(false);
});
narrowScreen.addEventListener('change', () => setSidebar(false));
setSidebar(false);

// ---------- Tabelas em cartões no celular ----------
// Cada célula recebe o título da coluna (data-label); o CSS mostra uma linha
// por cartão em telas estreitas. A grade semanal das turmas fica de fora.
function labelTable(table) {
  const titles = [...table.querySelectorAll('thead th')].map((th) => th.textContent.replace('*', '').trim());
  for (const row of table.tBodies[0]?.rows || [])
    [...row.cells].forEach((cell, i) => {
      if (cell.colSpan > 1) cell.classList.add('cell-full');
      else if (titles[i]) cell.dataset.label = titles[i];
    });
}
for (const table of document.querySelectorAll('.table-wrap table:not(.grade)')) {
  table.classList.add('stacked');
  labelTable(table);
  if (table.tBodies[0])
    new MutationObserver(() => labelTable(table)).observe(table.tBodies[0], {
      childList: true,
      subtree: true,
    });
}
