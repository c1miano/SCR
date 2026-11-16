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

  function forecast(c, cal) {
    const start = date(text(get(c, 'start')));
    const end = date(text(get(c, 'end')));
    if (end < start || end - start > 1096) throw 'O calendário deve ter até três anos.';
    const unit = num(get(c, 'unit'));
    const target = num(get(c, 'total')) * unit;
    const baseline = num(get(c, 'done')) * unit;
    if (![45, 50, 60].includes(unit) || target <= 0 || baseline < 0 || baseline > target)
      throw 'Carga horária inválida.';
    const blocked = new Set(array(get(c, 'excluded')).map(text));
    const completed = new Map();
    for (const x of array(get(c, 'completedLessons'))) {
      date(text(get(x, 'day')));
      const m = num(get(x, 'minutes'));
      if (m <= 0) throw 'Aula ministrada inválida.';
      completed.set(text(get(x, 'day')), m);
    }
    const completedKeys = [...completed.keys()].sort(cmp);
    const taught = completedKeys.reduce((sum, k) => sum + completed.get(k), 0);
    const done = Math.min(target, baseline + taught);
    const remaining = settle(Math.max(target - done, 0));
    const rows = new Map();
    const extras = array(get(c, 'extras'));
    const entries = array(cal);
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
      const minutes = completed.has(day) ? completed.get(day) : (excluded ? 0 : regular) + extra;
      if (minutes > 0)
        rows.set(day, { day, minutes, completed: completed.has(day), extra: extra > 0 });
      if (d === end) break;
    }
    for (const day of completedKeys)
      if (!rows.has(day)) rows.set(day, { day, minutes: completed.get(day), completed: true, extra: false });
    const ordered = [...rows.keys()].sort(cmp).map((k) => rows.get(k));
    let sum = 0,
      available = 0,
      accumulated = baseline,
      finish = null;
    for (const row of ordered) {
      const m = row.minutes;
      let credited;
      if (row.completed) credited = m;
      else {
        available += m;
        credited = Math.min(m, Math.max(remaining - sum, 0));
        sum += credited;
        if (remaining > 0 && sum >= remaining - EPS && finish === null) finish = row.day;
      }
      accumulated = Math.min(target, accumulated + credited);
      row.credited = credited;
      row.accumulated = accumulated;
    }
    if (finish !== null && completedKeys.length) {
      const last = completedKeys[completedKeys.length - 1];
      if (last > finish) finish = last;
    }
    return {
      remaining,
      available,
      deficit: settle(Math.max(remaining - available, 0)),
      finish,
      complete: remaining === 0,
      done,
      taught,
      rows: ordered,
    };
  }

  function projectionsWithIssues(data) {
    if (
      get(data, 'version') !== 4 ||
      !Array.isArray(get(data, 'courses')) ||
      !Array.isArray(get(data, 'calendars')) ||
      !Array.isArray(get(data, 'professors'))
    )
      throw 'Arquivo SCR inválido (esperado formato versão 4).';
    const result = {},
      issues = {},
      ids = new Set();
    for (const course of data.courses) {
      const id = text(get(course, 'id'));
      if (id === '' || ids.has(id)) throw 'Identificador de disciplina inválido ou repetido.';
      ids.add(id);
      const cal = data.calendars.find((x) => same(get(x, 'id'), get(course, 'calendarId')));
      if (!cal || text(get(cal, 'start')) === '' || text(get(cal, 'end')) === '') {
        result[id] = null;
        continue;
      }
      const c = JSON.parse(JSON.stringify(course));
      c.gradeTurmas = gradeFor(data, get(course, 'id'));
      c.start = cal.start;
      c.end = cal.end;
      const blocked = [...array(get(cal, 'entries'))];
      const extras = [...array(get(c, 'extras'))];
      for (const person of data.professors) {
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
      try {
        result[id] = forecast(c, blocked);
      } catch (e) {
        result[id] = null;
        issues[id] = String(e);
      }
    }
    return { forecasts: result, issues };
  }
  const projections = (data) => projectionsWithIssues(data).forecasts;

  W.engine = { gradeFor, schedule, forecast, projections, projectionsWithIssues };
  if (typeof module !== 'undefined') module.exports = W;
})(typeof globalThis !== 'undefined' ? globalThis : window);
