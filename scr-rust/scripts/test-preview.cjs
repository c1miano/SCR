// Testes da prévia por turma (ui/group-preview-model.js) com o núcleo JS (ui/web/engine.js).
const assert = require('node:assert/strict');
const { preview, hoursLabel } = require('../ui/group-preview-model.js');
const { engine } = require('../ui/web/engine.js');

function data() {
  return {
    version: 4,
    calendars: [
      {
        id: 'cal',
        name: 'Semestre',
        start: '2026-10-01',
        end: '2026-12-18',
        entries: [
          { id: 'f', type: 'holiday', name: 'Finados', start: '2026-11-02', end: '2026-11-02' },
          { id: 'n', type: 'nonschool', name: 'Conselho', start: '2026-11-20', end: '2026-11-20' },
        ],
      },
    ],
    professors: [
      {
        id: 'p',
        name: 'Ana',
        absences: [{ id: 'a', start: '2026-11-10', end: '2026-11-10', note: 'Consulta' }],
        extras: [{ id: 'x', date: '2026-11-14', hours: 2, unit: 50, courseId: 'mat' }],
      },
    ],
    courses: [
      // 4 aulas de 60 min de segunda a sexta: 4h por dia.
      {
        id: 'mat',
        name: 'Matemática',
        calendarId: 'cal',
        professorIds: ['p'],
        groups: ['Turma A'],
        total: 400,
        done: 0,
        unit: 60,
        schedule: { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4 },
        excluded: ['2026-11-12'],
        extras: [],
        completedLessons: [],
      },
      // Concluída: só a aula ministrada (além dos 100%) aparece.
      {
        id: 'art',
        name: 'Artes',
        calendarId: 'cal',
        professorIds: [],
        groups: ['turma a'],
        total: 2,
        done: 2,
        unit: 50,
        schedule: { 1: 2 },
        excluded: [],
        extras: [{ date: '2026-11-25', hours: 1 }],
        completedLessons: [{ day: '2026-11-09', minutes: 100 }],
      },
    ],
  };
}
const forecasts = (d) => {
  const f = engine.projections(d);
  return (c) => f[c.id];
};

const d = data();
const r = preview(d, 'Turma A', '2026-11', forecasts(d));

// Concluída: conta e aparece somente com a aula ministrada.
const art = r.entries.filter((x) => x.courseId === 'art');
assert.deepEqual(
  art.map((x) => [x.day, x.completed]),
  [['2026-11-09', true]],
);
assert.equal(r.completed, 1);
assert.equal(r.days['2026-11-09'].minutes, 340);

// Ocorrências na prévia.
const kinds = (day) => r.events.filter((e) => e.day === day).map((e) => e.kind);
assert.deepEqual(kinds('2026-11-02'), ['holiday']);
assert.deepEqual(kinds('2026-11-20'), ['nonschool']);
assert.deepEqual(kinds('2026-11-10'), ['absence']);
assert.match(r.events.find((e) => e.kind === 'absence').detail, /Ana: Consulta/);
assert.deepEqual(kinds('2026-11-12'), ['cancel']);
// Extra do professor no sábado aparece como cartão da aula (marcado Extra), sem repetir.
assert.ok(r.entries.some((x) => x.day === '2026-11-14' && x.extra));
assert.deepEqual(kinds('2026-11-14'), []);
// Extra de disciplina concluída, não ministrada: só como ocorrência.
assert.deepEqual(kinds('2026-11-25'), ['extra']);
assert.ok(!r.entries.some((x) => x.day === '2026-11-25' && x.courseId === 'art'));

// Carga mínima de 4h nos dias letivos.
assert.equal(r.days['2026-11-03'].short, false); // 4h
assert.equal(r.days['2026-11-10'].short, true); // ausência: 0h
assert.equal(r.days['2026-11-12'].short, true); // cancelamento: 0h
assert.equal(r.days['2026-11-02'].required, false); // feriado
assert.equal(r.days['2026-11-20'].required, false); // não letivo
assert.equal(r.days['2026-11-14'].required, false); // sábado
assert.equal(r.days['2026-11-14'].short, false);

// Dia com 3 aulas de 60 min fica abaixo de 4h.
const d2 = data();
d2.courses[0].schedule = { 1: 3, 2: 4, 3: 4, 4: 4, 5: 4 };
const r2 = preview(d2, 'turma a', '2026-11', forecasts(d2));
assert.equal(r2.days['2026-11-16'].minutes, 180);
assert.equal(r2.days['2026-11-16'].short, true);
// Fora do período do calendário não há exigência.
const r3 = preview(d2, 'turma a', '2026-12', forecasts(d2));
assert.equal(r3.days['2026-12-21'].required, false);

assert.equal(hoursLabel(200), '3h20');
assert.equal(hoursLabel(240), '4h');
console.log('Prévia por turma: testes aprovados.');
