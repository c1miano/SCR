(function (root) {
  const normalize = (s) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
  function collect(courses, group, month, getForecast) {
    const result = { entries: [], completed: 0, missingCalendar: [], matched: 0 };
    if (!group || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return result;
    for (const course of courses) {
      if (!(course.groups || []).some((t) => normalize(t) === normalize(group))) continue;
      result.matched++;
      const projection = getForecast(course);
      if (!projection) {
        result.missingCalendar.push(course.name);
        continue;
      }
      if (projection.complete) {
        result.completed++;
        continue;
      }
      // O cálculo completo é feito antes do recorte mensal: a carga não reinicia a cada mês.
      const pending = projection.rows.filter((row) => !row.completed && row.credited > 1e-7);
      for (const row of projection.rows.filter((row) => row.completed || row.credited > 1e-7)) {
        if (!row.day.startsWith(month + '-')) continue;
        result.entries.push({
          courseId: course.id,
          name: course.name,
          day: row.day,
          minutes: row.completed ? row.minutes : row.credited,
          plannedMinutes: row.minutes,
          unit: course.unit,
          extra: row.extra,
          completed: row.completed,
          final: !row.completed && projection.deficit <= 1e-7 && row === pending.at(-1),
        });
      }
    }
    result.entries.sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name, 'pt-BR'));
    return result;
  }
  function monthCells(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
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
  const api = { collect, monthCells };
  root.GroupPreview = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
