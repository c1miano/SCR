// Port para JavaScript de src-tauri/src/grade.rs: PDF da grade semanal de uma turma.
(function (root) {
  'use strict';
  const W = (root.SCRWeb = root.SCRWeb || {});
  const { parseDay, ymd } = W.dates;
  const { array: list, text: s, get, same } = W.json;
  const { wrap, width, Pdf, T } = W.pdf;
  const { MARGIN, PAGE_W, BOTTOM, INK, MUTED, SUBTLE, LINE, SURFACE_2, BG, WHITE, PRIMARY } = T;

  const DAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const PALETTE = [
    ['#ccfbf1', '#5eead4', '#0f766e'],
    ['#dbeafe', '#93c5fd', '#1d4ed8'],
    ['#ede9fe', '#c4b5fd', '#6d28d9'],
    ['#fef3c7', '#fcd34d', '#b45309'],
    ['#ffe4e6', '#fda4af', '#be123c'],
    ['#dcfce7', '#86efac', '#15803d'],
    ['#e0f2fe', '#7dd3fc', '#0369a1'],
    ['#ffedd5', '#fdba74', '#c2410c'],
    ['#fae8ff', '#f0abfc', '#a21caf'],
    ['#ecfccb', '#bef264', '#4d7c0f'],
    ['#e2e8f0', '#94a3b8', '#334155'],
    ['#f5f5f4', '#a8a29e', '#57534e'],
  ].map(([fill, stroke, accent]) => ({ fill, stroke, accent }));

  const br = (d) => {
    const x = ymd(d);
    return `${String(x.day).padStart(2, '0')}/${String(x.month).padStart(2, '0')}/${x.year}`;
  };
  const pretty = (v) => {
    const d = parseDay(v);
    return d === null ? v : br(d);
  };
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  function version(turma, id, issued) {
    const versions = list(get(turma, 'versions')).slice();
    versions.sort((a, b) => cmp(s(get(a, 'validFrom')), s(get(b, 'validFrom'))));
    if (!versions.length) throw 'Salve uma vigência da grade antes de gerar o PDF.';
    let index;
    if (id === '') {
      index = versions.length - 1;
      for (let i = versions.length - 1; i >= 0; i--) {
        const d = parseDay(s(get(versions[i], 'validFrom')));
        if (d !== null && d <= issued) {
          index = i;
          break;
        }
      }
    } else {
      index = versions.findIndex((v) => s(get(v, 'id')) === id);
      if (index < 0) throw 'Vigência não encontrada. Ela pode ter sido excluída.';
    }
    return [index, versions];
  }

  function findTurma(data, turmaId) {
    const t = list(get(data, 'turmas')).find((t) => s(get(t, 'id')) === turmaId);
    if (!t) throw 'Turma não encontrada.';
    return t;
  }

  function filename(data, turmaId, versionId, issued) {
    let turma;
    try {
      turma = findTurma(data, turmaId);
    } catch {
      return 'Grade.pdf';
    }
    let from = '';
    try {
      const [i, v] = version(turma, versionId, issued);
      from = s(get(v[i], 'validFrom'));
    } catch {}
    const d = parseDay(from);
    const when = d === null ? from : W.report.issuedText(d);
    return `Grade Turma ${W.report.safeName(s(get(turma, 'name')), 80)} - vigência ${when}.pdf`;
  }

  function generate(data, turmaId, versionId, issued) {
    const turma = findTurma(data, turmaId);
    const [index, versions] = version(turma, versionId, issued);
    const current = versions[index];
    const from = s(get(current, 'validFrom'));
    const nextDay = index + 1 < versions.length ? parseDay(s(get(versions[index + 1], 'validFrom'))) : null;
    const range =
      nextDay !== null ? `Vigência: ${pretty(from)} a ${br(nextDay - 1)}` : `Vigência: desde ${pretty(from)}`;
    const grid = get(current, 'grid');
    const periods = list(get(turma, 'periods'));
    let maxCells = 0;
    for (let d = 1; d <= 6; d++) maxCells = Math.max(maxCells, list(get(grid, String(d))).length);
    const rows = Math.max(periods.length, maxCells, 1);
    const cell = (d, p) => {
      const arr = list(get(grid, String(d)));
      return p < arr.length ? s(arr[p]) : '';
    };
    let saturday = false;
    for (let p = 0; p < rows; p++) if (cell(6, p) !== '') saturday = true;
    const days = saturday ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];

    const courses = list(get(data, 'courses'));
    const professors = list(get(data, 'professors'));
    const subjects = [];
    for (let d = 1; d <= 6; d++)
      for (let p = 0; p < rows; p++) {
        const id = cell(d, p);
        if (id === '') continue;
        const found = subjects.find((x) => x.id === id);
        if (found) {
          found.count++;
          continue;
        }
        const course = courses.find((c) => s(get(c, 'id')) === id);
        const people = course
          ? professors
              .filter((p) => list(get(course, 'professorIds')).some((x) => same(x, get(p, 'id'))))
              .map((p) => s(get(p, 'name')))
              .filter((n) => n.trim() !== '')
          : [];
        subjects.push({
          id,
          name: course ? s(get(course, 'name')) : 'Disciplina removida',
          people: people.join(', '),
          unitHours: !!course && get(course, 'unit') === 60,
          count: 1,
          tone: PALETTE[0],
        });
      }
    subjects.sort((a, b) => cmp(a.name.toLowerCase(), b.name.toLowerCase()));
    subjects.forEach((x, i) => (x.tone = PALETTE[i % PALETTE.length]));
    const subject = (id) => subjects.find((x) => x.id === id);

    const name = s(get(turma, 'name'));
    const pdf = new Pdf('Grade de horários', `SCR · Grade semanal da turma ${name}`);
    pdf.next();
    pdf.heading(`Turma ${name}`, range, `Emitida em ${br(issued)}`);

    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const summaryH = 34 + Math.max(subjects.length, 1) * 17 + 20;
    const headH = 20;
    const free = pdf.y - BOTTOM - headH;
    let rowH = clamp((free - summaryH) / rows, 26, 64);
    const summaryBelow = rowH * rows + summaryH <= free;
    if (!summaryBelow) rowH = clamp(free / rows, 22, 64);

    const timeW = 86;
    const colW = (PAGE_W - 2 * MARGIN - timeW) / days.length;
    const top = pdf.y;
    pdf.rect(MARGIN, top - headH + 6, PAGE_W - 2 * MARGIN, headH, SURFACE_2, LINE);
    pdf.labelAt(MARGIN + 8, top - 6, 'Horário', 7.5, SUBTLE);
    days.forEach((d, i) => pdf.labelAt(MARGIN + timeW + 8 + i * colW, top - 6, DAYS[d - 1], 7.5, SUBTLE));
    const gridTop = top - headH + 6;
    for (let p = 0; p < rows; p++) {
      const y = gridTop - (p + 1) * rowH;
      pdf.rect(MARGIN, y, timeW, rowH, BG, LINE);
      pdf.textAt(MARGIN + 8, y + rowH - 14, `${p + 1}ª aula`, 9, true, INK);
      const start = p < periods.length ? s(get(periods[p], 'start')) : '';
      const end = p < periods.length ? s(get(periods[p], 'end')) : '';
      const times = start !== '' && end !== '' ? `${start} - ${end}` : start !== '' ? `às ${start}` : '';
      if (times !== '' && rowH >= 26) pdf.textAt(MARGIN + 8, y + rowH - 25, times, 8, false, MUTED);
    }
    days.forEach((d, i) => {
      const x = MARGIN + timeW + i * colW;
      let p = 0;
      while (p < rows) {
        const id = cell(d, p);
        let span = 1;
        while (id !== '' && p + span < rows && cell(d, p + span) === id) span++;
        const h = rowH * span;
        const y = gridTop - p * rowH - h;
        pdf.rect(x, y, colW, h, WHITE, LINE);
        const sub = subject(id);
        if (sub) {
          pdf.card(x + 3, y + 3, colW - 6, h - 6, sub.tone);
          const max = colW - 18;
          const lines = wrap(sub.name, 8.5, true, max).map((l) => [l, true, INK]);
          if (sub.people !== '') lines.push(...wrap(sub.people, 7.5, false, max).map((l) => [l, false, MUTED]));
          if (span > 1) lines.push([`${span} aulas seguidas`, false, sub.tone.accent]);
          const fit = Math.max(Math.floor((h - 10) / 10), 1);
          if (lines.length > fit) {
            lines.length = fit;
            const last = lines[lines.length - 1];
            last[0] = `${last[0].replace(/[. ]+$/, '')}...`;
          }
          lines.forEach(([line, bold, color], k) =>
            pdf.textAt(x + 11, y + h - 15 - k * 10, line, bold ? 8.5 : 7.5, bold, color),
          );
        }
        p += span;
      }
    });
    pdf.y = gridTop - rows * rowH;

    if (!summaryBelow) pdf.next();
    else pdf.y -= 26;
    pdf.labelAt(MARGIN, pdf.y, 'Resumo semanal', 8, PRIMARY);
    pdf.y -= 20;
    const cols = [MARGIN, MARGIN + 330, PAGE_W - MARGIN - 120];
    pdf.rect(MARGIN, pdf.y - 5, PAGE_W - 2 * MARGIN, 17, SURFACE_2, LINE);
    ['Disciplina', 'Professor(es)', 'Por semana'].forEach((label, i) => pdf.labelAt(cols[i] + 8, pdf.y, label, 7, SUBTLE));
    pdf.y -= 5;
    if (!subjects.length) {
      pdf.y -= 13;
      pdf.textAt(MARGIN + 8, pdf.y, 'Nenhuma disciplina nesta vigência.', 8.5, false, MUTED);
      pdf.y -= 4;
    }
    const fitText = (t, size, bold, max) => {
      const lines = wrap(t, size, bold, max);
      if (lines.length > 1) return `${lines[0]}...`;
      return lines.length ? lines[0] : '';
    };
    let total = 0;
    for (const sub of subjects) {
      if (pdf.y - 17 < BOTTOM) pdf.next();
      const y = pdf.y - 17;
      pdf.rect(MARGIN, y, PAGE_W - 2 * MARGIN, 17, WHITE, LINE);
      pdf.card(MARGIN + 8, y + 4.5, 12, 8, sub.tone);
      pdf.textAt(MARGIN + 27, y + 5.5, fitText(sub.name, 8.5, true, 290), 8.5, true, INK);
      const people = sub.people === '' ? '-' : fitText(sub.people, 8.5, false, 300);
      pdf.textAt(cols[1] + 8, y + 5.5, people, 8.5, false, MUTED);
      const amount = sub.unitHours ? `${sub.count} h` : `${sub.count} ${sub.count === 1 ? 'aula' : 'aulas'}`;
      pdf.textAt(cols[2] + 8, y + 5.5, amount, 8.5, true, INK);
      total += sub.count;
      pdf.y = y;
    }
    if (subjects.length) {
      pdf.y -= 16;
      const t = `${total} ${total === 1 ? 'aula' : 'aulas'} por semana · ${subjects.length} ${subjects.length === 1 ? 'disciplina' : 'disciplinas'}`;
      pdf.textAt(PAGE_W - MARGIN - width(t, 8.5, true), pdf.y, t, 8.5, true, INK);
    }
    return pdf.bytes();
  }

  W.grade = { generate, filename };
  if (typeof module !== 'undefined') module.exports = W;
})(typeof globalThis !== 'undefined' ? globalThis : window);
