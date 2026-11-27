// Port para JavaScript de src-tauri/src/engine.rs (versão web do SCR).
// Mantém as mesmas regras de cálculo; qualquer mudança aqui deve repetir a do Rust.
(function (root) {
  'use strict';
  const W = (root.SCRWeb = root.SCRWeb || {});

  // ---- Datas 'AAAA-MM-DD' como número de dias (UTC) ----
  const DAY = 86400000;
  function parseDay(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
    if (!m) return null;
    const y = +m[1],
      mo = +m[2],
      d = +m[3];
    const t = Date.UTC(y, mo - 1, d);
    const back = new Date(t);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
    return Math.round(t / DAY);
  }
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  function dayString(n) {
    const d = new Date(n * DAY);
    return pad(d.getUTCFullYear(), 4) + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  const fromSunday = (n) => new Date(n * DAY).getUTCDay();
  const fromMonday = (n) => (fromSunday(n) + 6) % 7;
  const ymd = (n) => {
    const d = new Date(n * DAY);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  };
  W.dates = { parseDay, dayString, fromSunday, fromMonday, ymd };

  // ---- Acesso tolerante a valores JSON, como serde_json::Value ----
  const array = (v) => (Array.isArray(v) ? v : []);
  const num = (v) => (typeof v === 'number' ? v : 0);
  const text = (v) => (typeof v === 'string' ? v : '');
  const get = (v, k) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v[k] : undefined);
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  // Igualdade de valores JSON (como `==` entre serde_json::Value).
  function same(a, b) {
    if (a === b) return true;
    if (a === undefined) a = null;
    if (b === undefined) b = null;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
    return JSON.stringify(a) === JSON.stringify(b);
  }
  W.json = { array, num, text, get, isObject, same };

  function date(s) {
    const d = parseDay(s);
    if (d === null) throw `Data inválida: ${s}`;
    return d;
  }
  const week = (d) => d - fromMonday(d);

  /** Grade semanal das turmas que incluem a disciplina (ver engine.rs). */
  function gradeFor(data, courseId) {
    const turmas = [];
    for (const turma of array(get(data, 'turmas'))) {
      const versions = array(get(turma, 'versions')).map((v) => {
        const counts = {};
        const grid = get(v, 'grid');
        if (isObject(grid))
          for (const weekday of Object.keys(grid)) {
            const n = array(grid[weekday]).filter((x) => same(x, courseId)).length;
            if (n > 0) counts[weekday] = n;
          }
        return { validFrom: get(v, 'validFrom') ?? null, schedule: counts };
      });
      if (!versions.some((v) => Object.keys(v.schedule).length > 0)) continue;
      versions.sort((a, b) => cmp(text(a.validFrom), text(b.validFrom)));
      turmas.push({ name: get(turma, 'name') ?? null, versions });
    }
    return turmas;
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  /** Carga regular de cada dia da semana na data `d` (prioridade: semana > grade > rotina). */
  function schedule(c, d) {
    const w = week(d);
    const ws = dayString(w);
    for (const item of array(get(c, 'weekOverrides')))
      if (text(get(item, 'weekStart')) === ws) return get(item, 'schedule') ?? null;
    const day = dayString(d);
    const fromGrade = {};
    let graded = false;
    for (const turma of array(get(c, 'gradeTurmas'))) {
      let current = null;
      for (const v of array(get(turma, 'versions'))) {
        date(text(get(v, 'validFrom')));
        if (text(get(v, 'validFrom')) <= day) current = v;
      }
      if (current) {
        graded = true;
        const m = get(current, 'schedule');
        if (isObject(m))
          for (const k of Object.keys(m)) fromGrade[k] = num(fromGrade[k]) + num(m[k]);
      }
    }
    if (graded) return fromGrade;
    if (text(get(c, 'scheduleMode')) === 'alternating' && text(get(c, 'weekAnchor')) !== '') {
      const offset = Math.trunc((w - week(date(text(get(c, 'weekAnchor'))))) / 7);
      if (((offset % 2) + 2) % 2 === 1) return get(c, 'scheduleB') ?? null;
    }
    return get(c, 'schedule') ?? null;
  }

  const EPS = 1e-6;
  const settle = (x) => (Math.abs(x) < EPS ? 0 : x);

  const localToday = () => {
    const now = new Date();
    return pad(now.getFullYear(), 4) + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  };

  /**
   * Previsão de uma disciplina na data de referência `today` (AAAA-MM-DD).
   * Aulas previstas até `today` contam como dadas; `reviewLessons` (conferir)
   * e `surplusLessons` (aula a mais, além da carga total) são marcações.
   * Ver engine.rs.
   */
  function forecast(c, cal, today) {
    const start = date(text(get(c, 'start')));
    const end = date(text(get(c, 'end')));
    if (end < start || end - start > 1096) throw 'O calendário deve ter até três anos.';
    const unit = num(get(c, 'unit'));
    const target = num(get(c, 'total')) * unit;
    const baseline = num(get(c, 'done')) * unit;
    if (![45, 50, 60].includes(unit) || target <= 0 || baseline < 0 || baseline > target)
      throw 'Carga horária inválida.';
    const blocked = new Set(array(get(c, 'excluded')).map(text));
    const review = new Set(array(get(c, 'reviewLessons')).map(text));
    const surplus = new Set(array(get(c, 'surplusLessons')).map(text));
    const need = settle(Math.max(target - baseline, 0));
    const rows = [];
    const extras = array(get(c, 'extras'));
    const entries = array(cal);
    let sum = 0,
      doneExtra = 0,
      available = 0,
      surplusTaught = 0,
      finish = null;
    for (let d = start; ; d++) {
      const day = dayString(d);
      const sched = schedule(c, d);
      const regular = num(get(sched, String(fromSunday(d)))) * unit;
      const excluded =
        blocked.has(day) ||
        entries.some((e) => text(get(e, 'start')) <= day && text(get(e, 'end')) >= day);
      const extra = extras
        .filter((x) => text(get(x, 'date')) === day)
        .reduce((s, x) => s + num(get(x, 'hours')) * unit, 0);
      const minutes = (excluded ? 0 : regular) + extra;
      if (minutes > 0) {
        const past = day <= today;
        const credited = Math.min(minutes, Math.max(need - sum, 0));
        sum += credited;
        if (need > 0 && sum >= need - EPS && finish === null) finish = day;
        const beyond = settle(minutes - credited);
        const marked = surplus.has(day) && beyond > 0;
        if (past) {
          doneExtra += credited;
          if (marked) surplusTaught += beyond;
        } else available += minutes;
        rows.push({
          day,
          minutes,
          extra: extra > 0,
          past,
          review: review.has(day),
          surplus: marked,
          credited,
          beyond,
          accumulated: Math.min(target, baseline + sum),
        });
      }
      if (d === end) break;
    }
    const done = Math.min(target, baseline + doneExtra);
    const remaining = settle(Math.max(target - done, 0));
    return {
      remaining,
      available,
      deficit: settle(Math.max(remaining - available, 0)),
      finish,
      complete: remaining === 0,
      done,
      surplusTaught,
      rows,
    };
  }

  /** Disciplina pronta para o cálculo, ou null sem calendário com período (ver engine.rs). */
  function prepare(data, course) {
    const cal = array(get(data, 'calendars')).find((x) => same(get(x, 'id'), get(course, 'calendarId')));
    if (!cal || text(get(cal, 'start')) === '' || text(get(cal, 'end')) === '') return null;
    const c = JSON.parse(JSON.stringify(course));
    c.gradeTurmas = gradeFor(data, get(course, 'id'));
    c.start = cal.start;
    c.end = cal.end;
    const blocked = [...array(get(cal, 'entries'))];
    const extras = [...array(get(c, 'extras'))];
    for (const person of array(get(data, 'professors'))) {
      if (!array(get(course, 'professorIds')).some((pid) => same(pid, get(person, 'id')))) continue;
      blocked.push(...array(get(person, 'absences')));
      for (const x of array(get(person, 'extras')))
        if (same(get(x, 'courseId'), get(course, 'id')))
          extras.push({
            date: get(x, 'date') ?? null,
            hours: (num(get(x, 'hours')) * num(get(x, 'unit'))) / num(get(c, 'unit')),
          });
    }
    c.extras = extras;
    return { c, blocked };
  }

  /**
   * Converte as marcações "Ministrada" antigas (`completedLessons`): depois da
   * carga total viram "Aula a mais"; as demais saem (a carga conta pela data).
   * Marcação em data sem aula prevista vira aula extra. Ver engine.rs.
   */
  function migrate(data) {
    const out = JSON.parse(JSON.stringify(data));
    if (!Array.isArray(get(out, 'courses'))) return out;
    out.courses = out.courses.map((course) => {
      if (!isObject(course) || !('completedLessons' in course)) return course;
      const lessons = array(course.completedLessons)
        .map((x) => [text(get(x, 'day')), num(get(x, 'minutes'))])
        .filter(([, m]) => m > 0)
        .sort((a, b) => cmp(a[0], b[0]));
      const unit = num(course.unit);
      const target = num(course.total) * unit;
      let planned = new Set();
      const ready = prepare(data, course);
      if (ready)
        try {
          planned = new Set(forecast(ready.c, ready.blocked, '9999-12-31').rows.map((r) => r.day));
        } catch {
          /* disciplina com cadastro inválido: sem datas previstas */
        }
      const surplus = [...array(course.surplusLessons)];
      const extras = [...array(course.extras)];
      let accumulated = num(course.done) * unit;
      for (const [day, minutes] of lessons) {
        if (accumulated >= target - EPS && !surplus.some((x) => text(x) === day)) surplus.push(day);
        if (!planned.has(day) && unit > 0) extras.push({ date: day, hours: minutes / unit });
        accumulated += minutes;
      }
      const next = { ...course };
      delete next.completedLessons;
      if (surplus.length) next.surplusLessons = surplus;
      next.extras = extras;
      return next;
    });
    return out;
  }

  function projectionsWithIssues(data, today = localToday()) {
    if (
      get(data, 'version') !== 4 ||
      !Array.isArray(get(data, 'courses')) ||
      !Array.isArray(get(data, 'calendars')) ||
      !Array.isArray(get(data, 'professors'))
    )
      throw 'Arquivo SCR inválido (esperado formato versão 4).';
    data = migrate(data);
    const result = {},
      issues = {},
      ids = new Set();
    for (const course of data.courses) {
      const id = text(get(course, 'id'));
      if (id === '' || ids.has(id)) throw 'Identificador de disciplina inválido ou repetido.';
      ids.add(id);
      const ready = prepare(data, course);
      if (!ready) {
        result[id] = null;
        continue;
      }
      try {
        result[id] = forecast(ready.c, ready.blocked, today);
      } catch (e) {
        result[id] = null;
        issues[id] = String(e);
      }
    }
    return { forecasts: result, issues };
  }
  const projections = (data, today) => projectionsWithIssues(data, today).forecasts;

  W.engine = { gradeFor, schedule, forecast, migrate, projections, projectionsWithIssues, localToday };
  if (typeof module !== 'undefined') module.exports = W;
})(typeof globalThis !== 'undefined' ? globalThis : window);
