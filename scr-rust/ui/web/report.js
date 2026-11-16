// Port para JavaScript de src-tauri/src/report.rs: calendário mensal de registros em PDF.
(function (root) {
  'use strict';
  const W = (root.SCRWeb = root.SCRWeb || {});
  const { parseDay, dayString, fromSunday, fromMonday, ymd } = W.dates;
  const { array: list, num: n, text: s, get, same } = W.json;
  const { wrap, width, Pdf, T } = W.pdf;
  const { MARGIN, PAGE_W, BOTTOM, INK, MUTED, SUBTLE, LINE, SURFACE_2, BG, WHITE, PRIMARY } = T;

  const norm = (v) => v.split(/\s+/).filter(Boolean).join(' ').toLowerCase();
  function date(v) {
    const d = parseDay(v);
    if (d === null) throw 'Data de referência inválida';
    return d;
  }
  function pretty(v) {
    const d = parseDay(v);
    if (d === null) return v;
    const x = ymd(d);
    return `${String(x.day).padStart(2, '0')}/${String(x.month).padStart(2, '0')}/${x.year}`;
  }
  const amount = (v) =>
    v
      .toFixed(2)
      .replace(/0+$/, '')
      .replace(/\.+$/, '')
      .replace('.', ',');

  function collect(data, f) {
    date(f.reference);
    if ([...f.notes].length > 2000) throw 'Use até 2000 caracteres na orientação.';
    const projections = W.engine.projections(data);
    const people = list(get(data, 'professors'));
    let label = null;
    if (f.kind === 'professor') {
      const p = people.find((p) => s(get(p, 'id')) === f.value);
      if (p) label = `Professor: ${s(p.name)}`;
    } else if (f.kind === 'disciplina') {
      const c = list(get(data, 'courses')).find((c) => s(get(c, 'id')) === f.value);
      if (c) label = `Disciplina: ${s(c.name)}`;
    } else if (f.kind === 'turma') {
      for (const c of list(get(data, 'courses'))) {
        const g = list(get(c, 'groups')).find((g) => norm(s(g)) === norm(f.value));
        if (g !== undefined) {
          label = `Turma: ${s(g)}`;
          break;
        }
      }
    }
    if (label === null) throw 'Selecione um professor, disciplina ou turma cadastrado.';
    const courses = [];
    for (const c of list(get(data, 'courses'))) {
      const assigned = people.filter((p) => list(get(c, 'professorIds')).some((id) => same(id, get(p, 'id'))));
      const selected =
        f.kind === 'professor'
          ? assigned.some((p) => s(get(p, 'id')) === f.value)
          : f.kind === 'disciplina'
            ? s(get(c, 'id')) === f.value
            : list(get(c, 'groups')).some((g) => norm(s(g)) === norm(f.value));
      if (!selected) continue;
      const r = projections[s(get(c, 'id'))] ?? null;
      const cal = list(get(data, 'calendars')).find((k) => same(get(k, 'id'), get(c, 'calendarId')));
      const unit = n(get(c, 'unit'));
      const rows = [];
      for (const row of list(get(r, 'rows'))) {
        const completed = row.completed === true;
        if (!completed && n(row.credited) <= 0) continue;
        const pending = s(row.day) <= f.reference;
        rows.push({
          events: [],
          day: s(row.day),
          status: completed ? 'Registrada' : pending ? 'Conferir registro' : 'Prevista',
        });
      }
      if (cal && r !== null) {
        const graded = JSON.parse(JSON.stringify(c));
        graded.gradeTurmas = W.engine.gradeFor(data, get(c, 'id'));
        let day = date(s(get(cal, 'start')));
        const end = date(s(get(cal, 'end')));
        let last;
        if (r.complete === true) {
          last = list(r.rows)
            .filter((x) => x.completed === true)
            .map((x) => s(x.day))
            .reduce((a, b) => (b > a ? b : a), '');
        } else if (typeof r.finish === 'string') last = r.finish;
        else last = s(get(cal, 'end'));
        for (; day <= end; day++) {
          const key = dayString(day);
          const regular = n(get(W.engine.schedule(graded, day), String(fromSunday(day)))) * unit;
          if (!(regular > 0 && key <= last)) continue;
          const events = [];
          for (const e of list(get(cal, 'entries')))
            if (s(get(e, 'start')) <= key && s(get(e, 'end')) >= key)
              events.push({
                absence: false,
                text: `${s(get(e, 'type')) === 'holiday' ? 'Feriado' : 'Dia não letivo'}: ${s(get(e, 'name'))}`,
              });
          if (list(get(c, 'excluded')).some((x) => s(x) === key))
            events.push({ absence: true, text: 'Falta/cancelamento da disciplina: motivo não informado.' });
          for (const p of assigned)
            for (const a of list(get(p, 'absences')))
              if (s(get(a, 'start')) <= key && s(get(a, 'end')) >= key)
                events.push({
                  absence: true,
                  text: `Ausência de ${s(get(p, 'name'))}: ${s(get(a, 'note')) === '' ? 'Sem justificativa detalhada' : s(get(a, 'note'))}`,
                });
          if (events.length) {
            const row = rows.find((x) => x.day === key);
            if (row) row.events = events.slice();
            else rows.push({ events, day: key, status: 'Sem aula regular' });
          }
        }
      }
      rows.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
      courses.push({
        id: s(get(c, 'id')),
        complete: r !== null && r.complete === true,
        unit,
        name: s(get(c, 'name')),
        people: assigned.map((p) => s(get(p, 'name'))).join(', '),
        rows,
      });
    }
    if (!courses.length) throw 'Nenhuma disciplina vinculada à seleção.';
    return { label, reference: f.reference, notes: f.notes, courses };
  }

  const unsafe = (c) => c.codePointAt(0) < 32 || (c.codePointAt(0) >= 127 && c.codePointAt(0) < 160) || '<>:"/\\|?*'.includes(c);
  function safeName(name, limit) {
    return [...name]
      .map((c) => (unsafe(c) ? '-' : c))
      .slice(0, limit)
      .join('')
      .trim()
      .replace(/\.+$/, '');
  }
  function issuedText(issued) {
    const x = ymd(issued);
    return `${String(x.day).padStart(2, '0')}-${String(x.month).padStart(2, '0')}-${x.year}`;
  }

  function filename(data, f, issued) {
    const courses = list(get(data, 'courses'));
    const names = list(get(data, 'professors'))
      .filter((p) => {
        if (f.kind === 'professor') return s(get(p, 'id')) === f.value;
        return courses.some(
          (c) =>
            (f.kind === 'disciplina'
              ? s(get(c, 'id')) === f.value
              : list(get(c, 'groups')).some((g) => norm(s(g)) === norm(f.value))) &&
            list(get(c, 'professorIds')).some((id) => same(id, get(p, 'id'))),
        );
      })
      .map((p) => s(get(p, 'name')))
      .filter((x) => x.trim() !== '');
    names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const unique = names.filter((x, i) => i === 0 || x !== names[i - 1]);
    const name = unique.length ? unique.join(', ') : 'Sem professor';
    return `Registros Prof ${safeName(name, 140)} - ${issuedText(issued)}.pdf`;
  }

  const TAUGHT = { fill: '#e0eaff', stroke: '#93b4f0', accent: '#1d4ed8' };
  const PLANNED = { fill: '#f1f5f4', stroke: '#cad8d5', accent: '#8a9e9a' };
  const REVIEW = { fill: '#f3e8ff', stroke: '#d8b4fe', accent: '#7c3aed' };
  const ABSENCE = { fill: '#ffedd5', stroke: '#fdba74', accent: '#c2410c' };
  const HOLIDAY = { fill: '#fef9c3', stroke: '#fde047', accent: '#ca8a04' };
  const FINISH = { fill: '#dcfce7', stroke: '#86efac', accent: '#15803d' };
  const CARD_LINE = 9;

  function pushCard(cards, lines, tone) {
    for (let i = 0; i * 14 < lines.length; i++) {
      const part = [];
      if (i > 0) part.push('Observação (cont.)');
      if (tone === ABSENCE || tone === HOLIDAY) part.push('Não registrar');
      part.push(...lines.slice(i * 14, i * 14 + 14));
      cards.push([part, tone]);
    }
  }
  const MONTHS = [
    'Janeiro',
    'Fevereiro',
    'Março',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro',
  ];

  function heading(pdf, title, report, cols, colW) {
    pdf.next();
    pdf.heading(title, report.label, `Referência: ${pretty(report.reference)}`);
    const y = pdf.y;
    pdf.rect(MARGIN, y - 6, PAGE_W - 2 * MARGIN, 18, SURFACE_2, LINE);
    const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    cols.forEach((col, i) => pdf.labelAt(MARGIN + 7 + i * colW, y, labels[col], 7.5, SUBTLE));
    pdf.y -= 6;
  }

  function calendarPdf(data, report, month, pdf) {
    const first = date(`${month}-01`);
    const fy = ymd(first);
    const nextFirst = parseDay(
      fy.month === 12 ? `${String(fy.year + 1).padStart(4, '0')}-01-01` : `${String(fy.year).padStart(4, '0')}-${String(fy.month + 1).padStart(2, '0')}-01`,
    );
    if (nextFirst === null) throw 'Mês inválido';
    const days = nextFirst - first;
    const offset = fromMonday(first);
    const projections = W.engine.projections(data);
    const reference = parseDay(report.reference);
    const title = `${MONTHS[fy.month - 1]} ${fy.year}`;
    const used = (weekday) =>
      report.courses
        .filter((c) => !c.complete)
        .some((c) =>
          c.rows.some((r) => {
            if (!(r.day.startsWith(month) && (r.status !== 'Sem aula regular' || r.events.length))) return false;
            const d = parseDay(r.day);
            return d !== null && fromMonday(d) === weekday;
          }),
        );
    const cols = [0, 1, 2, 3, 4, 5, 6].filter((c) => c < 5 || used(c));
    const colW = (PAGE_W - 2 * MARGIN) / cols.length;
    const cardText = colW - 18;

    heading(pdf, title, report, cols, colW);
    const weeks = Math.ceil((offset + days) / 7);
    for (let week = 0; week < weeks; week++) {
      const cells = [];
      for (const col of cols) {
        const idx = week * 7 + col;
        const day = idx >= offset && idx < offset + days ? first + (idx - offset) : null;
        const cards = [];
        if (day !== null) {
          const key = dayString(day);
          for (const course of report.courses) {
            if (course.complete) continue;
            const proj = projections[course.id] ?? null;
            for (const row of course.rows.filter((r) => r.day === key)) {
              if (row.status !== 'Sem aula regular') {
                const original = list(get(proj, 'rows')).find((r) => s(r.day) === key);
                const minutes = original ? (original.completed === true ? n(original.minutes) : n(original.credited)) : 0;
                const lines = wrap(course.name, 7.5, true, cardText);
                lines.push(
                  `${amount(minutes / course.unit)} ${course.unit === 60 ? 'h' : 'h-aula'} · ${
                    row.status === 'Registrada' ? 'Ministrada' : row.status === 'Conferir registro' ? 'Conferir' : 'Prevista'
                  }`,
                );
                lines.push(...wrap(course.people, 7.5, false, cardText));
                if (s(get(proj, 'finish')) === key) lines.push('Conclusão prevista');
                const tone =
                  row.status === 'Registrada' ? TAUGHT : row.status === 'Conferir registro' ? REVIEW : PLANNED;
                pushCard(cards, lines, tone);
              }
              for (const event of row.events) {
                const lines = wrap(course.name, 7.5, true, cardText);
                const at = event.text.indexOf(': ');
                if (at >= 0) {
                  lines.push(...wrap(`${event.text.slice(0, at)}:`, 7.5, false, cardText));
                  lines.push(...wrap(event.text.slice(at + 2), 7.5, false, cardText));
                } else lines.push(...wrap(event.text, 7.5, false, cardText));
                pushCard(cards, lines, event.absence ? ABSENCE : HOLIDAY);
              }
            }
          }
        }
        cells.push([col, day, cards]);
      }
      if (cells.every(([, day]) => day === null)) continue;
      const maxCards = cells.reduce((m, [, , cards]) => Math.max(m, cards.length), 0);
      const batches = Math.ceil(Math.max(maxCards, 1) / 2);
      for (let batch = 0; batch < batches; batch++) {
        const height = cells
          .map(
            ([, , cards]) =>
              cards
                .slice(batch * 2, batch * 2 + 2)
                .reduce((sum, [lines]) => sum + (lines.length * CARD_LINE + 12), 0) + 26,
          )
          .reduce((a, b) => Math.max(a, b), 56);
        if (pdf.y - height < BOTTOM) heading(pdf, `${title} - continuação`, report, cols, colW);
        const top = pdf.y;
        cells.forEach(([col, day, cards], i) => {
          const x = MARGIN + i * colW;
          const weekend = col >= 5;
          const fill = day === null || weekend ? BG : WHITE;
          pdf.rect(x, top - height, colW, height, fill, LINE);
          if (day === null) return;
          const label = String(ymd(day).day);
          if (day === reference) {
            const w = width(label, 9, true) + 8;
            pdf.rect(x + 4, top - 16, w, 13, PRIMARY, null);
            pdf.textAt(x + 8, top - 12.6, label, 9, true, WHITE);
          } else pdf.textAt(x + 7, top - 12.6, label, 9, true, weekend ? SUBTLE : INK);
          if (batch > 0) pdf.textAt(x + 10 + width(label, 9, true), top - 12.6, '(cont.)', 7, false, SUBTLE);
          let y = top - 21;
          for (const [lines, tone] of cards.slice(batch * 2, batch * 2 + 2)) {
            const h = lines.length * CARD_LINE + 8;
            pdf.card(x + 3.5, y - h, colW - 7, h, tone);
            lines.forEach((line, k) => {
              let bold, color;
              if (line === 'Conclusão prevista') [bold, color] = [true, FINISH.accent];
              else if (line === 'Não registrar') [bold, color] = [true, tone.accent];
              else if (k === 0 || (k === 1 && lines[0] === 'Não registrar')) [bold, color] = [true, INK];
              else [bold, color] = [false, MUTED];
              pdf.textAt(x + 9, y - 10.5 - k * CARD_LINE, line, 7.5, bold, color);
            });
            y -= h + 4;
          }
        });
        pdf.y -= height;
      }
    }
  }

  function selectedMonths(f) {
    let months = Array.isArray(f.months) ? f.months.slice() : [];
    if (!months.length && typeof f.month === 'string') months.push(f.month);
    if (!months.length) throw 'Selecione pelo menos um mês para o calendário PDF.';
    months.sort();
    months = months.filter((m, i) => i === 0 || m !== months[i - 1]);
    if (months.length > 36) throw 'Selecione até 36 meses por relatório.';
    for (const month of months) {
      if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) throw 'Mês inválido.';
      date(`${month}-01`);
    }
    return months;
  }

  function checkFilter(f) {
    if (!f || typeof f !== 'object') throw 'Filtro inválido.';
    for (const k of ['kind', 'value', 'reference', 'notes'])
      if (typeof f[k] !== 'string') throw `invalid type: campo ${k} ausente`;
    return f;
  }

  function generate(data, filter) {
    const f = checkFilter(filter);
    const months = selectedMonths(f);
    const report = collect(data, f);
    const pdf = new Pdf('Calendário de aulas', 'SCR · Relatório de acompanhamento');
    pdf.legend = [
      ['Ministrada', TAUGHT],
      ['Prevista', PLANNED],
      ['Conferir registro', REVIEW],
      ['Ausência / cancelamento', ABSENCE],
      ['Feriado / dia não letivo', HOLIDAY],
      ['Conclusão prevista', FINISH],
    ];
    for (const month of months) calendarPdf(data, report, month, pdf);
    if (report.notes.trim() !== '') {
      if (pdf.y < BOTTOM + 40) pdf.next();
      else pdf.y -= 22;
      pdf.textAt(MARGIN, pdf.y, 'Observações', 12, true, INK);
      pdf.y -= 18;
      pdf.block(report.notes.trim(), 10, false);
    }
    return pdf.bytes();
  }

  W.report = { generate, filename, collect, selectedMonths, safeName, issuedText, pretty };
  if (typeof module !== 'undefined') module.exports = W;
})(typeof globalThis !== 'undefined' ? globalThis : window);
