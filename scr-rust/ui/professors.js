let selectedProfessor = null,
  editingAbsence = null,
  editingExtra = null,
  removedProfessorEvent = null;
function renderChecks(container, items, ids, empty) {
  container.replaceChildren();
  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'help';
    p.textContent = empty;
    container.append(p);
    return;
  }
  for (const item of items) {
    const label = document.createElement('label');
    label.className = 'lesson-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = item.id;
    input.checked = ids.includes(item.id);
    label.append(input, document.createTextNode(item.name));
    container.append(label);
  }
}
function renderCourseProfessors(ids) {
  renderChecks(
    $('#course-professors'),
    data.professors,
    ids,
    'Nenhum professor cadastrado. Você pode salvar a disciplina sem professor e atribuir depois.',
  );
}
function renderProfessorEffects(course) {
  const box = $('#professor-effects');
  box.hidden = true;
  if (!course) return;
  course = coursePeriod(course);
  const people = data.professors.filter((p) => (course.professorIds || []).includes(p.id));
  if (!people.length) return;
  const effects = ProfessorModel.effects(course, people),
    absences = effects.absences.filter((x) => x.start <= course.end && x.end >= course.start),
    extras = effects.extras.filter((x) => x.date >= course.start && x.date <= course.end);
  box.hidden = false;
  box.textContent = `Professores: ${people.map((p) => p.name).join(', ')}. Neste período: ${absences.length} ausência(s) e ${extras.length} aula(s) extra(s) do cadastro de professores. Esses ajustes já entram no cálculo e não precisam ser repetidos aqui.`;
}
function professorCourses(id) {
  return data.courses.filter((c) => (c.professorIds || []).includes(id));
}
function getProfessor() {
  return data.professors.find((p) => p.id === selectedProfessor);
}
function professorMessage(text) {
  $('#professor-message').textContent = text;
  announce(text);
}
function renderProfessorCards() {
  $('#professor-empty').hidden = !!data.professors.length;
  $('#professor-list').replaceChildren();
  for (const person of [...data.professors].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))) {
    const card = document.createElement('article');
    card.className = 'calendar-card' + (person.id === selectedProfessor ? ' selected' : '');
    const name = document.createElement('h3');
    name.textContent = person.name;
    const detail = document.createElement('p');
    detail.textContent = `${professorCourses(person.id).length} disciplina(s) · ${person.absences.length} ausência(s) · ${person.extras.length} aula(s) extra(s)`;
    card.append(
      name,
      detail,
      button('Gerenciar professor', () => openProfessor(person.id)),
    );
    $('#professor-list').append(card);
  }
}
function resetAbsence() {
  editingAbsence = null;
  $('#professor-absence-form').reset();
  $('#absence-cancel').hidden = true;
  $('#absence-save').textContent = 'Registrar ausência';
}
function extraOptions(value = '') {
  const select = $('#professor-extra-form').elements.courseId;
  select.replaceChildren(new Option('Sem disciplina — somente registro', ''));
  for (const c of professorCourses(selectedProfessor)) select.add(new Option(c.name, c.id));
  if (value && ![...select.options].some((o) => o.value === value)) {
    const c = data.courses.find((x) => x.id === value);
    select.add(new Option((c?.name || 'Disciplina não encontrada') + ' — vínculo inativo', value));
  }
  select.value = value;
}
function resetExtra() {
  editingExtra = null;
  $('#professor-extra-form').reset();
  extraOptions();
  $('#extra-cancel').hidden = true;
  $('#extra-save').textContent = 'Registrar aula extra';
}
function openProfessor(id) {
  selectedProfessor = id;
  const p = getProfessor();
  if (!p) return;
  $('#professor-detail').hidden = false;
  $('#professor-title').textContent = p.name;
  $('#professor-profile').elements.name.value = p.name;
  renderChecks(
    $('#professor-courses'),
    data.courses,
    professorCourses(id).map((c) => c.id),
    'Nenhuma disciplina cadastrada. O professor pode ser salvo sem vínculos.',
  );
  resetAbsence();
  resetExtra();
  $('#professor-message').textContent = '';
  renderProfessorCards();
  renderProfessorEvents();
  $('#professor-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function openProfessors() {
  show('professors');
  renderProfessorCards();
  if (getProfessor()) openProfessor(selectedProfessor);
}
async function updateProfessor(person) {
  if (!(await commit({ ...data, professors: data.professors.map((p) => (p.id === person.id ? person : p)) })))
    return false;
  renderProfessorCards();
  renderProfessorEvents();
  renderHome();
  return true;
}
async function removeProfessorEvent(kind, id) {
  const p = getProfessor(),
    entry = p[kind].find((x) => x.id === id);
  if (!entry) return;
  if (await updateProfessor({ ...p, [kind]: p[kind].filter((x) => x.id !== id) })) {
    removedProfessorEvent = { professorId: p.id, kind, entry };
    if (kind === 'absences' && editingAbsence === id) resetAbsence();
    if (kind === 'extras' && editingExtra === id) resetExtra();
    $('#professor-undo').hidden = false;
    professorMessage('Registro excluído. As previsões foram atualizadas. Você pode desfazer.');
  }
}
function emptyRow(body, columns, text) {
  const cell = body.insertRow().insertCell();
  cell.colSpan = columns;
  cell.textContent = text;
}
function renderProfessorEvents() {
  const p = getProfessor();
  if (!p) return;
  const absences = $('#professor-absences');
  absences.replaceChildren();
  if (!p.absences.length) emptyRow(absences, 3, 'Nenhuma ausência registrada.');
  for (const item of [...p.absences].sort((a, b) => a.start.localeCompare(b.start))) {
    const row = absences.insertRow();
    row.insertCell().textContent =
      item.start === item.end ? pretty(item.start) : `${pretty(item.start)} a ${pretty(item.end)}`;
    row.insertCell().textContent = item.note || '—';
    const actions = row.insertCell();
    actions.className = 'calendar-row-actions';
    actions.append(
      button('Editar', () => {
        editingAbsence = item.id;
        const f = $('#professor-absence-form');
        for (const key of ['start', 'end', 'note']) f.elements[key].value = item[key] || '';
        $('#absence-cancel').hidden = false;
        $('#absence-save').textContent = 'Salvar ausência';
        f.elements.start.focus();
      }),
      button('Excluir', () => removeProfessorEvent('absences', item.id)),
    );
  }
  const extras = $('#professor-extras');
  extras.replaceChildren();
  if (!p.extras.length) emptyRow(extras, 5, 'Nenhuma aula extra registrada.');
  for (const item of [...p.extras].sort((a, b) => a.date.localeCompare(b.date))) {
    const row = extras.insertRow(),
      raw = data.courses.find((x) => x.id === item.courseId),
      c = raw ? coursePeriod(raw) : null;
    row.insertCell().textContent = pretty(item.date);
    row.insertCell().textContent = `${fmt(item.hours)} × ${item.unit} min`;
    let situation = 'Sem disciplina — somente registro';
    if (c)
      situation =
        c.name +
        (!(c.professorIds || []).includes(p.id)
          ? ' — vínculo inativo'
          : !hasPeriod(calendarFor(c))
            ? ' — calendário sem período'
            : item.date < c.start || item.date > c.end
              ? ' — fora do período'
              : ' — incluída na previsão');
    else if (item.courseId) situation = 'Disciplina indisponível — somente registro';
    row.insertCell().textContent = situation;
    row.insertCell().textContent = item.note || '—';
    const actions = row.insertCell();
    actions.className = 'calendar-row-actions';
    actions.append(
      button('Editar', () => {
        editingExtra = item.id;
        const f = $('#professor-extra-form');
        extraOptions(item.courseId);
        for (const key of ['date', 'hours', 'unit', 'note']) f.elements[key].value = item[key] || '';
        $('#extra-cancel').hidden = false;
        $('#extra-save').textContent = 'Salvar aula extra';
        f.elements.date.focus();
      }),
      button('Excluir', () => removeProfessorEvent('extras', item.id)),
    );
  }
  $('#professor-undo').hidden = !removedProfessorEvent || removedProfessorEvent.professorId !== p.id;
}
$('#nav-professors').onclick = openProfessors;
$('#create-professor').onsubmit = async (event) => {
  event.preventDefault();
  const f = event.currentTarget,
    name = f.elements.name.value.trim().replace(/\s+/g, ' ');
  if (!name) return;
  if (data.professors.some((p) => normalizeTag(p.name) === normalizeTag(name))) {
    announce(
      'Já existe um professor com esse nome. Abra o cadastro existente ou use um nome que diferencie os professores.',
    );
    return;
  }
  const person = { id: crypto.randomUUID(), name, absences: [], extras: [] };
  if (!(await commit({ ...data, professors: [...data.professors, person] }))) return;
  f.reset();
  openProfessor(person.id);
  renderHome();
  professorMessage('Professor cadastrado. Os vínculos com disciplinas são opcionais.');
};
$('#professor-profile').onsubmit = async (event) => {
  event.preventDefault();
  const p = getProfessor(),
    name = event.currentTarget.elements.name.value.trim().replace(/\s+/g, ' ');
  if (!p || !name) return;
  if (data.professors.some((x) => x.id !== p.id && normalizeTag(x.name) === normalizeTag(name))) {
    professorMessage('Já existe um professor com esse nome.');
    return;
  }
  const ids = [...$('#professor-courses').querySelectorAll('input:checked')].map((x) => x.value);
  const courses = data.courses.map((c) => {
    const links = (c.professorIds || []).filter((id) => id !== p.id);
    if (ids.includes(c.id)) links.push(p.id);
    return { ...c, professorIds: links };
  });
  if (
    await commit({
      ...data,
      courses,
      professors: data.professors.map((x) => (x.id === p.id ? { ...p, name } : x)),
    })
  ) {
    openProfessor(p.id);
    renderHome();
    professorMessage(
      'Professor e vínculos salvos. Aulas extras com vínculo removido ficam no histórico, sem alterar a previsão.',
    );
  }
};
$('#professor-absence-form').onsubmit = async (event) => {
  event.preventDefault();
  const p = getProfessor(),
    f = event.currentTarget;
  if (!p) return;
  const entry = {
    id: editingAbsence || crypto.randomUUID(),
    start: f.elements.start.value,
    end: f.elements.end.value || f.elements.start.value,
    note: f.elements.note.value.trim(),
  };
  if (!validDate(entry.start) || !validDate(entry.end) || entry.start > entry.end) {
    professorMessage('Informe um período válido para a ausência.');
    return;
  }
  if (p.absences.some((x) => x.id !== entry.id && x.start === entry.start && x.end === entry.end)) {
    professorMessage('Essa ausência já está cadastrada.');
    return;
  }
  if (
    await updateProfessor({
      ...p,
      absences: editingAbsence
        ? p.absences.map((x) => (x.id === editingAbsence ? entry : x))
        : [...p.absences, entry],
    })
  ) {
    resetAbsence();
    professorMessage('Ausência salva e aplicada a todas as disciplinas vinculadas no período.');
  }
};
$('#professor-extra-form').onsubmit = async (event) => {
  event.preventDefault();
  const p = getProfessor(),
    f = event.currentTarget;
  if (!p) return;
  const entry = {
    id: editingExtra || crypto.randomUUID(),
    date: f.elements.date.value,
    hours: Number(f.elements.hours.value),
    unit: Number(f.elements.unit.value),
    courseId: f.elements.courseId.value,
    note: f.elements.note.value.trim(),
  };
  if (
    !validDate(entry.date) ||
    !Number.isFinite(entry.hours) ||
    entry.hours <= 0 ||
    entry.hours > 24 ||
    ![45, 50, 60].includes(entry.unit)
  ) {
    professorMessage('Informe data, quantidade e unidade válidas.');
    return;
  }
  const old = p.extras.find((x) => x.id === editingExtra);
  if (
    entry.courseId &&
    !professorCourses(p.id).some((c) => c.id === entry.courseId) &&
    old?.courseId !== entry.courseId
  ) {
    professorMessage('Vincule a disciplina ao professor antes de atribuir a aula extra.');
    return;
  }
  if (
    await updateProfessor({
      ...p,
      extras: editingExtra ? p.extras.map((x) => (x.id === editingExtra ? entry : x)) : [...p.extras, entry],
    })
  ) {
    resetExtra();
    professorMessage(
      entry.courseId
        ? 'Aula extra salva. Confira a situação na lista abaixo.'
        : 'Aula extra salva somente no registro do professor, sem alterar disciplinas.',
    );
  }
};
$('#absence-cancel').onclick = resetAbsence;
$('#extra-cancel').onclick = resetExtra;
$('#professor-undo').onclick = async () => {
  const p = getProfessor(),
    last = removedProfessorEvent;
  if (!p || last?.professorId !== p.id) return;
  if (await updateProfessor({ ...p, [last.kind]: [...p[last.kind], last.entry] })) {
    removedProfessorEvent = null;
    renderProfessorEvents();
    professorMessage('Exclusão desfeita.');
  }
};
