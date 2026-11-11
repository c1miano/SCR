let draftWeekOverrides = [];
function weekGrid(container, prefix) {
  container.innerHTML = [1, 2, 3, 4, 5, 6, 0]
    .map(
      (d) =>
        `<label>${days[d]}<input aria-label="${prefix} ${days[d]}" name="${prefix}${d}" type="number" min="0" max="24" step="0.01" value="0"></label>`,
    )
    .join('');
}
weekGrid($('#week-b'), 'dayB');
weekGrid($('#override-week'), 'overrideDay');
function syncRoutine() {
  const alternate = $('#form').elements.scheduleMode.value === 'alternating';
  $('#alternate-settings').hidden = !alternate;
  $('#week-a-title').textContent = alternate ? 'Semana A' : 'Todas as semanas';
  $('#form').elements.weekAnchor.required = alternate;
  $('#form').elements.weekAnchor.disabled = !alternate;
  for (let d = 0; d < 7; d++) $('#form').elements['dayB' + d].disabled = !alternate;
}
function loadRoutine(course) {
  const f = $('#form');
  f.elements.scheduleMode.value = course?.scheduleMode || 'fixed';
  f.elements.weekAnchor.value = course?.weekAnchor || '';
  for (let d = 0; d < 7; d++) f.elements['dayB' + d].value = course?.scheduleB?.[d] || 0;
  draftWeekOverrides = JSON.parse(JSON.stringify(course?.weekOverrides || []));
  $('#routine-message').textContent = '';
  f.elements.overrideDate.value = '';
  for (let d = 0; d < 7; d++) f.elements['overrideDay' + d].value = 0;
  syncRoutine();
  renderOverrides();
}
function renderOverrides() {
  const body = $('#override-rows');
  body.replaceChildren();
  if (!draftWeekOverrides.length) {
    const cell = body.insertRow().insertCell();
    cell.colSpan = 3;
    cell.textContent = 'Nenhuma alteração pontual. A rotina acima será usada.';
  }
  for (const entry of [...draftWeekOverrides].sort((a, b) => a.weekStart.localeCompare(b.weekStart))) {
    const row = body.insertRow();
    row.insertCell().textContent = 'Semana de ' + pretty(entry.weekStart);
    row.insertCell().textContent =
      Object.entries(entry.schedule)
        .filter(([, n]) => n > 0)
        .map(([day, n]) => `${days[day]}: ${fmt(n)}`)
        .join(' · ') || 'Sem aulas regulares';
    const cell = row.insertCell();
    cell.className = 'calendar-row-actions';
    cell.append(
      button('Editar', () => {
        const f = $('#form');
        f.elements.overrideDate.value = entry.weekStart;
        for (let d = 0; d < 7; d++) f.elements['overrideDay' + d].value = entry.schedule[d] || 0;
        f.elements.overrideDate.focus();
      }),
      button('Remover', () => {
        draftWeekOverrides = draftWeekOverrides.filter((x) => x.weekStart !== entry.weekStart);
        renderOverrides();
        $('#routine-message').textContent =
          'Alteração removida do formulário. Clique em Salvar e recalcular para confirmar.';
      }),
    );
  }
}
$('#form').elements.scheduleMode.onchange = syncRoutine;
$('#save-week-override').onclick = () => {
  const f = $('#form'),
    date = f.elements.overrideDate.value;
  if (!validDate(date)) {
    $('#routine-message').textContent = 'Escolha uma data da semana que deseja alterar.';
    return;
  }
  const schedule = {};
  for (let d = 0; d < 7; d++) {
    const field = f.elements['overrideDay' + d];
    if (!field.checkValidity()) {
      field.reportValidity();
      return;
    }
    schedule[d] = Number(field.value);
  }
  const weekStart = (() => {
    const d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  })();
  draftWeekOverrides = [
    ...draftWeekOverrides.filter((x) => x.weekStart !== weekStart),
    { weekStart, schedule },
  ];
  renderOverrides();
  $('#routine-message').textContent =
    'Semana preparada. Clique em Salvar e recalcular para aplicar à disciplina.';
};
syncRoutine();
