/* Turmas e grade semanal de horários.
 *
 * Modelo (data.turmas):
 *   { id, name, periods: [{ start: '07:30', end: '08:20' }, ...],
 *     versions: [{ id, validFrom: 'AAAA-MM-DD', grid: { '1': [courseId|'' ...], ..., '6': [...] } }] }
 *
 * Cada célula é uma aula (na unidade da disciplina). Uma versão vale da sua data
 * até a véspera da próxima; o cálculo em Rust (engine::grade_for) usa a versão
 * vigente em cada dia. Mudar a grade a qualquer momento = salvar nova vigência.
 */
const GRADE_DAYS = [1, 2, 3, 4, 5, 6];
let selectedTurma = null,
  selectedVersion = null,
  gradeDraft = null,
  turmaNotice = '';

function turmas() {
  return data.turmas || [];
}
function getTurma() {
  return turmas().find((t) => t.id === selectedTurma) || null;
}
function sortedVersions(t) {
  return [...(t.versions || [])].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
}
/** Versão vigente numa data (a última com validFrom <= data). */
function versionAt(t, day) {
  return sortedVersions(t)
    .filter((v) => v.validFrom <= day)
    .at(-1);
}
function emptyGrid(periods) {
  return Object.fromEntries(GRADE_DAYS.map((d) => [String(d), Array(periods).fill('')]));
}
function resizeGrid(grid, periods) {
  return Object.fromEntries(
    GRADE_DAYS.map((d) => {
      const cells = [...(grid?.[d] || [])].slice(0, periods);
      while (cells.length < periods) cells.push('');
      return [String(d), cells];
    }),
  );
}
function weeklyCounts(grid) {
  const counts = new Map();
  for (const d of GRADE_DAYS)
    for (const id of grid?.[d] || []) if (id) counts.set(id, (counts.get(id) || 0) + 1);
  return counts;
}
function courseName(id) {
  return data.courses.find((c) => c.id === id)?.name || 'Disciplina removida';
}
function unitLabel(id) {
  const c = data.courses.find((x) => x.id === id);
  return c?.unit === 60 ? 'h' : 'aulas';
}

/* ---------- Lista ---------- */
function renderTurmaCards() {
  $('#turma-empty').hidden = !!turmas().length;
  $('#turma-list').replaceChildren();
  const today = localToday();
  for (const t of [...turmas()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))) {
    const card = document.createElement('article');
    card.className = 'calendar-card' + (t.id === selectedTurma ? ' selected' : '');
    const title = document.createElement('h3');
    title.textContent = 'Turma ' + t.name;
    const desc = document.createElement('p');
    const current = versionAt(t, today) || sortedVersions(t)[0];
    if (current) {
      const counts = weeklyCounts(current.grid);
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      desc.textContent = `Grade ${versionAt(t, today) ? 'vigente desde' : 'a partir de'} ${pretty(current.validFrom)} · ${total} aula(s) por semana · ${counts.size} disciplina(s)`;
    } else desc.textContent = 'Nenhuma grade cadastrada.';
    card.append(
      title,
      desc,
      button('Abrir grade', () => openTurma(t.id)),
    );
    $('#turma-list').append(card);
  }
}
function openTurmas() {
  show('turmas');
  renderTurmaCards();
  if (getTurma()) openTurma(selectedTurma, false);
  else $('#turma-detail').hidden = true;
}

/* ---------- Detalhe e editor ---------- */
function openTurma(id, scroll = true, versionId = null) {
  selectedTurma = id;
  const t = getTurma();
  if (!t) return;
  const versions = sortedVersions(t);
  const current = versionAt(t, localToday());
  selectedVersion = versionId || current?.id || versions.at(-1)?.id || null;
  loadDraft();
  $('#turma-detail').hidden = false;
  $('#turma-title').textContent = 'Turma ' + t.name;
  $('#turma-settings').elements.name.value = t.name;
  $('#turma-settings').elements.periods.value = (t.periods || []).length || 5;
  $('#turma-message').textContent = turmaNotice;
  turmaNotice = '';
  renderTurmaCards();
  renderVersionSelect();
  renderGradeEditor();
  if (scroll) $('#turma-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function loadDraft() {
  const t = getTurma(),
    periods = (t.periods || []).length || 5,
    v = (t.versions || []).find((x) => x.id === selectedVersion);
  gradeDraft = {
    periods: Array.from({ length: periods }, (_, i) => ({ ...(t.periods?.[i] || { start: '', end: '' }) })),
    grid: resizeGrid(v?.grid || emptyGrid(periods), periods),
  };
  $('#turma-valid-from').value = v ? v.validFrom : localToday();
}
function renderVersionSelect() {
  const t = getTurma(),
    select = $('#turma-version'),
    today = localToday(),
    current = versionAt(t, today);
  select.replaceChildren();
  const versions = sortedVersions(t);
  if (!versions.length) select.add(new Option('Nenhuma vigência salva', ''));
  versions.forEach((v, i) => {
    const next = versions[i + 1];
    const range = next
      ? `${pretty(v.validFrom)} a ${pretty(prevDay(next.validFrom))}`
      : `desde ${pretty(v.validFrom)}`;
    const tag = v.id === current?.id ? ' — em vigor' : v.validFrom > today ? ' — futura' : '';
    select.add(new Option(`Grade ${range}${tag}`, v.id));
  });
  select.value = selectedVersion || '';
  select.disabled = !versions.length;
  $('#turma-version-delete').disabled = !versions.length;
  $('#turma-version-fix').disabled = !versions.length;
}
function prevDay(s) {
  const d = new Date(s + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function courseOptions(select, value) {
  const t = getTurma(),
    key = normalizeTag(t.name),
    sorted = [...data.courses].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  select.add(new Option('—', ''));
  const mine = sorted.filter((c) => (c.groups || []).some((g) => normalizeTag(g) === key));
  const others = sorted.filter((c) => !mine.includes(c));
  for (const [label, list] of [
    ['Desta turma', mine],
    ['Outras disciplinas', others],
  ]) {
    if (!list.length) continue;
    const group = document.createElement('optgroup');
    group.label = label;
    for (const c of list) group.append(new Option(c.name, c.id));
    select.append(group);
  }
  if (value && !data.courses.some((c) => c.id === value))
    select.add(new Option('Disciplina removida', value));
  select.value = value || '';
}
function renderGradeEditor() {
  const head = $('#grade-head'),
    body = $('#grade-body');
  head.replaceChildren();
  const hr = head.insertRow();
  const th0 = document.createElement('th');
  th0.textContent = 'Horário';
  hr.append(th0);
  for (const d of GRADE_DAYS) {
    const th = document.createElement('th');
    th.textContent = days[d];
    hr.append(th);
  }
  body.replaceChildren();
  gradeDraft.periods.forEach((p, i) => {
    const row = body.insertRow();
    const timeCell = row.insertCell();
    timeCell.className = 'grade-time';
    const label = document.createElement('strong');
    label.textContent = `${i + 1}ª aula`;
    const times = document.createElement('div');
    times.className = 'grade-times';
    for (const key of ['start', 'end']) {
      const input = document.createElement('input');
      input.type = 'time';
      input.value = p[key] || '';
      input.setAttribute('aria-label', `${key === 'start' ? 'Início' : 'Fim'} da ${i + 1}ª aula`);
      input.onchange = () => (gradeDraft.periods[i][key] = input.value);
      times.append(input);
    }
    timeCell.append(label, times);
    for (const d of GRADE_DAYS) {
      const cell = row.insertCell();
      const select = document.createElement('select');
      select.setAttribute('aria-label', `${days[d]}, ${i + 1}ª aula`);
      courseOptions(select, gradeDraft.grid[d][i]);
      cell.classList.toggle('filled', !!select.value);
      select.onchange = () => {
        gradeDraft.grid[d][i] = select.value;
        cell.classList.toggle('filled', !!select.value);
        renderGradeSummary();
      };
      cell.append(select);
    }
  });
  renderGradeSummary();
}
function renderGradeSummary() {
  const box = $('#grade-summary');
  box.replaceChildren();
  const counts = weeklyCounts(gradeDraft.grid);
  if (!counts.size) {
    const p = document.createElement('p');
    p.className = 'help';
    p.textContent = 'Escolha as disciplinas de cada horário. Células com “—” ficam sem aula.';
    box.append(p);
    return;
  }
  for (const [id, n] of [...counts].sort((a, b) =>
    courseName(a[0]).localeCompare(courseName(b[0]), 'pt-BR'),
  )) {
    const chip = document.createElement('span');
    chip.className = 'tag';
    chip.textContent = `${courseName(id)}: ${n} ${n === 1 ? 'aula' : 'aulas'}/semana`;
    box.append(chip);
  }
}

/* ---------- Gravação ---------- */
/** Garante a tag da turma nas disciplinas da grade (usada na prévia e nos relatórios). */
function withTurmaTags(courses, turma, grid) {
  const key = normalizeTag(turma.name),
    ids = new Set(weeklyCounts(grid).keys());
  return courses.map((c) =>
    ids.has(c.id) && !(c.groups || []).some((g) => normalizeTag(g) === key)
      ? { ...c, groups: [...(c.groups || []), turma.name] }
      : c,
  );
}
async function saveTurma(nextTurma, message, grid = null) {
  const next = {
    ...data,
    turmas: turmas().some((t) => t.id === nextTurma.id)
      ? turmas().map((t) => (t.id === nextTurma.id ? nextTurma : t))
      : [...turmas(), nextTurma],
  };
  if (grid) next.courses = withTurmaTags(data.courses, nextTurma, grid);
  if (!(await commit(next))) return false;
  $('#turma-message').textContent = turmaNotice = message;
  renderHome();
  renderNav();
  return true;
}
async function saveVersion(mode) {
  const t = getTurma(),
    validFrom = $('#turma-valid-from').value;
  if (!validDate(validFrom)) {
    $('#turma-message').textContent = 'Informe a data a partir da qual a grade vale.';
    $('#turma-valid-from').focus();
    return;
  }
  const grid = resizeGrid(gradeDraft.grid, gradeDraft.periods.length);
  let versions = [...(t.versions || [])],
    id;
  if (mode === 'fix') {
    id = selectedVersion;
    if (versions.some((v) => v.id !== id && v.validFrom === validFrom)) {
      $('#turma-message').textContent =
        'Já existe outra vigência nesta data. Escolha outra data ou edite aquela vigência.';
      return;
    }
    versions = versions.map((v) => (v.id === id ? { ...v, validFrom, grid } : v));
  } else {
    const same = versions.find((v) => v.validFrom === validFrom);
    if (
      same &&
      !confirm(
        `Já existe uma grade a partir de ${pretty(validFrom)}. Substituí-la pela grade atual do editor?`,
      )
    )
      return;
    id = same?.id || crypto.randomUUID();
    versions = [...versions.filter((v) => v.validFrom !== validFrom), { id, validFrom, grid }];
  }
  const nextTurma = { ...t, periods: gradeDraft.periods, versions };
  const msg =
    mode === 'fix'
      ? `Vigência corrigida. As previsões foram recalculadas desde ${pretty(validFrom)}.`
      : `Nova grade salva a partir de ${pretty(validFrom)}. As semanas anteriores mantêm a grade antiga.`;
  if (await saveTurma(nextTurma, msg, grid)) openTurma(t.id, false, id);
}

$('#nav-turmas').onclick = openTurmas;
$('#create-turma').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.currentTarget,
    name = f.elements.name.value.trim().replace(/\s+/g, ' '),
    periods = Number(f.elements.periods.value);
  if (!name) return;
  if (turmas().some((t) => normalizeTag(t.name) === normalizeTag(name))) {
    announce('Já existe uma turma com esse nome.');
    return;
  }
  const t = {
    id: crypto.randomUUID(),
    name,
    periods: Array.from({ length: periods }, () => ({ start: '', end: '' })),
    versions: [],
  };
  if (await saveTurma(t, 'Turma criada. Monte a grade e salve a vigência.')) {
    f.reset();
    openTurma(t.id);
  }
};
$('#turma-settings').onsubmit = async (e) => {
  e.preventDefault();
  const t = getTurma(),
    f = e.currentTarget,
    name = f.elements.name.value.trim().replace(/\s+/g, ' '),
    periods = Number(f.elements.periods.value);
  if (!name) return;
  if (turmas().some((x) => x.id !== t.id && normalizeTag(x.name) === normalizeTag(name))) {
    $('#turma-message').textContent = 'Já existe uma turma com esse nome.';
    return;
  }
  const losing =
    periods < (t.periods || []).length &&
    (t.versions || []).some((v) => GRADE_DAYS.some((d) => (v.grid?.[d] || []).slice(periods).some(Boolean)));
  if (
    losing &&
    !confirm(
      'Reduzir o número de aulas remove os últimos horários de todas as vigências desta turma. Continuar?',
    )
  )
    return;
  const nextPeriods = Array.from(
    { length: periods },
    (_, i) => gradeDraft.periods[i] || { start: '', end: '' },
  );
  const versions = (t.versions || []).map((v) => ({ ...v, grid: resizeGrid(v.grid, periods) }));
  if (await saveTurma({ ...t, name, periods: nextPeriods, versions }, 'Dados da turma salvos.'))
    openTurma(t.id, false, selectedVersion);
};
$('#turma-version').onchange = (e) => {
  selectedVersion = e.target.value;
  loadDraft();
  renderGradeEditor();
  $('#turma-message').textContent = '';
};
$('#turma-version-new').onclick = () => saveVersion('new');
$('#turma-version-fix').onclick = () => saveVersion('fix');
$('#turma-version-delete').onclick = async () => {
  const t = getTurma(),
    v = (t.versions || []).find((x) => x.id === selectedVersion);
  if (
    !v ||
    !confirm(
      `Excluir a grade a partir de ${pretty(v.validFrom)}? A vigência anterior passa a valer nessas datas.`,
    )
  )
    return;
  if (await saveTurma({ ...t, versions: t.versions.filter((x) => x.id !== v.id) }, 'Vigência excluída.'))
    openTurma(t.id, false);
};
$('#turma-delete').onclick = async () => {
  const t = getTurma();
  if (
    !t ||
    !confirm(
      `Excluir a turma ${t.name} e todas as suas grades? As disciplinas voltam a usar a própria rotina semanal.`,
    )
  )
    return;
  const next = { ...data, turmas: turmas().filter((x) => x.id !== t.id) };
  if (!(await commit(next))) return;
  selectedTurma = null;
  $('#turma-detail').hidden = true;
  renderTurmaCards();
  renderHome();
  announce('Turma excluída.');
};

/* ---------- Aviso no cadastro da disciplina ---------- */
function renderCourseGradeNote(course) {
  const box = $('#course-grade-note');
  box.replaceChildren();
  box.hidden = true;
  if (!course) return;
  const today = localToday();
  const lines = [];
  for (const t of turmas()) {
    const versions = sortedVersions(t).filter((v) => weeklyCounts(v.grid).has(course.id));
    if (!versions.length) continue;
    const current = versionAt(t, today);
    const n = current ? weeklyCounts(current.grid).get(course.id) || 0 : 0;
    lines.push({ t, first: versions[0].validFrom, n, current });
  }
  if (!lines.length) return;
  box.hidden = false;
  const title = document.createElement('strong');
  title.textContent = 'Horário definido pela grade da turma';
  box.append(title);
  for (const { t, first, n, current } of lines) {
    const p = document.createElement('p');
    p.append(
      `Turma ${t.name}: ${current ? `${n} ${n === 1 ? 'aula' : 'aulas'} por semana na grade em vigor` : 'grade futura'}; usada desde ${pretty(first)}. `,
      button(
        'Abrir grade',
        () => {
          selectedTurma = t.id;
          openTurmas();
        },
        'text-button',
      ),
    );
    box.append(p);
  }
  const help = document.createElement('small');
  help.textContent =
    'A rotina abaixo vale apenas para datas anteriores à primeira grade. “Alterar uma semana específica” continua tendo prioridade sobre a grade.';
  box.append(help);
}
