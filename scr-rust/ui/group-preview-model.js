(function (root) {
  const normalize = (s) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
  const EPS = 1e-7;
  /** Carga mínima de aulas por dia letivo (minutos de relógio): 4 horas. */
  const MIN_DAILY_MINUTES = 240;
  const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
  const DAY = /^\d{4}-\d{2}-\d{2}$/;

  function inGroup(course, group) {
    return (course.groups || []).some((t) => normalize(t) === normalize(group));
  }

  function collect(courses, group, month, getForecast) {
    const result = { entries: [], completed: 0, missingCalendar: [], matched: 0 };
    if (!group || !MONTH.test(month)) return result;
    for (const course of courses) {
      if (!inGroup(course, group)) continue;
      result.matched++;
      const projection = getForecast(course);
      if (!projection) {
        result.missingCalendar.push(course.name);
        continue;
      }
      if (projection.complete) result.completed++;
      // O cálculo completo é feito antes do recorte mensal: a carga não reinicia a cada mês.
      // Aulas além da carga total só aparecem marcadas como "Aula a mais".
      for (const row of projection.rows) {
        if (!(row.credited > EPS || row.surplus)) continue;
        if (!row.day.startsWith(month + '-')) continue;
        result.entries.push({
          courseId: course.id,
          name: course.name,
          day: row.day,
          minutes: row.surplus ? row.minutes : row.credited,
          plannedMinutes: row.minutes,
          unit: course.unit,
          extra: row.extra,
          past: row.past,
          review: row.review,
          surplus: row.surplus,
          final: !row.surplus && row.day === projection.finish,
        });
      }
    }
    result.entries.sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name, 'pt-BR'));
    return result;
  }

  /** Dias de `month` dentro do intervalo [start, end] (datas AAAA-MM-DD). */
  function daysIn(month, start, end) {
    if (!DAY.test(start || '') || !DAY.test(end || '') || start > end) return [];
    return monthCells(month).filter((day) => day && day >= start && day <= end);
  }

  /**
   * Feriados, dias não letivos, ausências de professores, cancelamentos e aulas
   * extras das disciplinas da turma no mês.
   */
  function events(data, group, month) {
    const list = [];
    if (!group || !MONTH.test(month)) return list;
    const seen = new Set();
    const add = (key, item) => {
      if (seen.has(key)) return;
      seen.add(key);
      list.push(item);
    };
    const courses = (data.courses || []).filter((c) => inGroup(c, group));
    const ids = new Set(courses.map((c) => c.id));
    for (const course of courses) {
      const cal = (data.calendars || []).find((x) => x.id === course.calendarId);
      for (const e of cal?.entries || []) {
        const kind = e.type === 'holiday' ? 'holiday' : 'nonschool';
        for (const day of daysIn(month, e.start, e.end))
          add(`${kind}|${e.name || ''}|${day}`, {
            day,
            kind,
            label: kind === 'holiday' ? 'Feriado' : 'Dia não letivo',
            detail: e.name || '',
          });
      }
      for (const day of course.excluded || [])
        if (typeof day === 'string' && day.startsWith(month + '-'))
          add(`cancel|${course.id}|${day}`, {
            day,
            kind: 'cancel',
            label: 'Cancelamento',
            detail: course.name,
            courseId: course.id,
          });
      for (const x of course.extras || [])
        if (typeof x.date === 'string' && x.date.startsWith(month + '-'))
          list.push({
            day: x.date,
            kind: 'extra',
            label: 'Reposição',
            detail: course.name,
            courseId: course.id,
            hours: Number(x.hours) || 0,
            unit: course.unit,
          });
    }
    for (const person of data.professors || []) {
      const linked = courses.filter((c) => (c.professorIds || []).includes(person.id));
      if (!linked.length) continue;
      for (const a of person.absences || [])
        for (const day of daysIn(month, a.start, a.end || a.start))
          add(`absence|${person.id}|${a.id || a.start}|${day}`, {
            day,
            kind: 'absence',
            label: 'Ausência',
            detail: `${person.name}: ${a.note || 'motivo não informado'}`,
          });
      for (const x of person.extras || []) {
        if (!ids.has(x.courseId) || typeof x.date !== 'string' || !x.date.startsWith(month + '-')) continue;
        const course = courses.find((c) => c.id === x.courseId);
        list.push({
          day: x.date,
          kind: 'extra',
          label: 'Reposição',
          detail: `${course.name} · ${person.name}`,
          courseId: course.id,
          hours: Number(x.hours) || 0,
          unit: Number(x.unit) || course.unit,
        });
      }
    }
    const order = { holiday: 0, nonschool: 1, absence: 2, cancel: 3, extra: 4 };
    list.sort((a, b) => a.day.localeCompare(b.day) || order[a.kind] - order[b.kind]);
    return list;
  }

  /**
   * Prévia completa da turma: aulas, ocorrências e a carga de cada dia.
   * Dias letivos (segunda a sexta, dentro do período de algum calendário da
   * turma e sem feriado/dia não letivo) com menos de 4 horas ficam `short`.
   */
  function preview(data, group, month, getForecast) {
    const result = collect(data.courses || [], group, month, getForecast);
    const all = events(data, group, month);
    result.events = all;
    result.days = {};
    if (!group || !MONTH.test(month)) return result;
    const courses = (data.courses || []).filter((c) => inGroup(c, group));
    const periods = courses
      .map((c) => (data.calendars || []).find((x) => x.id === c.calendarId))
      .filter((cal) => cal && DAY.test(cal.start || '') && DAY.test(cal.end || ''));
    const closed = new Set(
      all.filter((e) => e.kind === 'holiday' || e.kind === 'nonschool').map((e) => e.day),
    );
    for (const day of monthCells(month)) {
      if (!day) continue;
      const minutes = result.entries.filter((x) => x.day === day).reduce((s, x) => s + x.minutes, 0);
      const weekday = new Date(day + 'T12:00:00Z').getUTCDay();
      const required =
        weekday >= 1 &&
        weekday <= 5 &&
        !closed.has(day) &&
        periods.some((cal) => cal.start <= day && cal.end >= day);
      result.days[day] = { minutes, required, short: required && minutes < MIN_DAILY_MINUTES - EPS };
    }
    // Aula extra já exibida no cartão da disciplina não se repete como ocorrência.
    result.events = all.filter(
      (e) =>
        e.kind !== 'extra' ||
        !result.entries.some((x) => x.courseId === e.courseId && x.day === e.day && x.extra),
    );
    return result;
  }

  /** 200 → "3h20", 240 → "4h". */
  function hoursLabel(minutes) {
    const total = Math.round(minutes);
    const h = Math.floor(total / 60),
      m = total % 60;
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  }

  function monthCells(month) {
    if (!MONTH.test(month)) return [];
    const first = new Date(month + '-01T12:00:00Z'),
      offset = (first.getUTCDay() + 6) % 7;
    const end = new Date(first);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
    const count = end.getUTCDate(),
      size = Math.ceil((offset + count) / 7) * 7;
    return Array.from({ length: size }, (_, i) => {
      const number = i - offset + 1;
      return number >= 1 && number <= count ? month + '-' + String(number).padStart(2, '0') : null;
    });
  }
  const api = { collect, events, preview, monthCells, hoursLabel, MIN_DAILY_MINUTES };
  root.GroupPreview = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
