use crate::engine;
#[cfg(test)]
use crate::pdf::literal;
use crate::pdf::{
    self, wrap, Pdf, Tone, BG, BOTTOM, INK, LINE, MARGIN, MUTED, PAGE_W, PRIMARY, SUBTLE,
    SURFACE_2, WHITE,
};
use chrono::{Datelike, Duration, NaiveDate};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub kind: String,
    pub value: String,
    pub reference: String,
    pub notes: String,
    #[serde(default)]
    pub month: Option<String>,
    #[serde(default)]
    pub months: Vec<String>,
}
fn s(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
fn list(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn n(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.0)
}
fn norm(v: &str) -> String {
    v.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
fn date(v: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(v, "%Y-%m-%d").map_err(|_| "Data de referência inválida".into())
}
fn pretty(v: &str) -> String {
    date(v)
        .map(|d| d.format("%d/%m/%Y").to_string())
        .unwrap_or_else(|_| v.into())
}
fn amount(v: f64) -> String {
    format!("{v:.2}")
        .trim_end_matches('0')
        .trim_end_matches('.')
        .replace('.', ",")
}
#[derive(Clone)]
pub struct Event {
    pub absence: bool,
    pub text: String,
}
pub struct Row {
    pub day: String,
    pub minutes: f64,
    pub status: String,
    pub reason: String,
    pub events: Vec<Event>,
}
pub struct Course {
    pub id: String,
    pub complete: bool,
    pub unit: f64,
    pub name: String,
    pub people: String,
    pub groups: String,
    pub period: String,
    pub summary: String,
    pub finish: String,
    pub rows: Vec<Row>,
}
pub struct Report {
    pub label: String,
    pub reference: String,
    pub notes: String,
    pub courses: Vec<Course>,
}

pub fn collect(data: &Value, f: &Filter) -> Result<Report, String> {
    let reference = date(&f.reference)?;
    if f.notes.chars().count() > 2000 {
        return Err("Use até 2000 caracteres na orientação.".into());
    }
    // Aulas até a data de referência contam como realizadas.
    let projections = engine::projections_at(data, reference)?;
    let people = list(&data["professors"]);
    let label = match f.kind.as_str() {
        "professor" => people
            .iter()
            .find(|p| s(&p["id"]) == f.value)
            .map(|p| format!("Professor: {}", s(&p["name"]))),
        "disciplina" => list(&data["courses"])
            .iter()
            .find(|c| s(&c["id"]) == f.value)
            .map(|c| format!("Disciplina: {}", s(&c["name"]))),
        "turma" => list(&data["courses"])
            .iter()
            .flat_map(|c| list(&c["groups"]))
            .find(|g| norm(s(g)) == norm(&f.value))
            .map(|g| format!("Turma: {}", s(g))),
        _ => None,
    }
    .ok_or("Selecione um professor, disciplina ou turma cadastrado.")?;
    let mut courses = Vec::new();
    for c in list(&data["courses"]) {
        let assigned: Vec<_> = people
            .iter()
            .filter(|p| list(&c["professorIds"]).iter().any(|id| id == &p["id"]))
            .collect();
        let selected = match f.kind.as_str() {
            "professor" => assigned.iter().any(|p| s(&p["id"]) == f.value),
            "disciplina" => s(&c["id"]) == f.value,
            _ => list(&c["groups"])
                .iter()
                .any(|g| norm(s(g)) == norm(&f.value)),
        };
        if !selected {
            continue;
        }
        let r = &projections[s(&c["id"])];
        let cal = list(&data["calendars"])
            .iter()
            .find(|cal| cal["id"] == c["calendarId"]);
        let unit = n(&c["unit"]);
        let unit_label = if unit == 60.0 { "h" } else { "h-aula" };
        let mut rows = Vec::new();
        for row in list(&r["rows"]) {
            let surplus = row["surplus"] == true;
            // Aulas além da carga total só entram marcadas como "Aula a mais".
            if !surplus && n(&row["credited"]) <= 0.0 {
                continue;
            }
            let (status, reason) = if row["review"] == true {
                (
                    "Conferir registro",
                    "Marcada para o professor conferir o registro.",
                )
            } else if surplus {
                (
                    "Aula a mais",
                    "Aula além da carga total, marcada como aula a mais.",
                )
            } else if row["past"] == true {
                ("Realizada", "Aula prevista até a data de referência.")
            } else {
                ("Prevista", "Data futura em relação à referência.")
            };
            rows.push(Row {
                events: Vec::new(),
                day: s(&row["day"]).into(),
                minutes: n(&row[if surplus { "minutes" } else { "credited" }]),
                status: status.into(),
                reason: reason.into(),
            });
        }
        if let Some(cal) = cal.filter(|_| !r.is_null()) {
            // Mesma carga diária das previsões, incluindo a grade da turma.
            let mut graded = c.clone();
            graded["gradeTurmas"] = engine::grade_for(data, &c["id"]);
            let mut day = date(s(&cal["start"]))?;
            let end = date(s(&cal["end"]))?;
            // Impedimentos só até a conclusão (ou a última aula a mais marcada).
            let last = list(&r["rows"])
                .iter()
                .filter(|x| x["surplus"] == true)
                .map(|x| s(&x["day"]))
                .chain([if r["finish"].is_string() {
                    s(&r["finish"])
                } else {
                    s(&cal["end"])
                }])
                .max()
                .unwrap_or("");
            while day <= end {
                let key = day.to_string();
                let regular = n(&engine::schedule(&graded, day)?
                    [day.weekday().num_days_from_sunday().to_string()])
                    * unit;
                if regular > 0.0 && key.as_str() <= last {
                    let mut reasons = Vec::new();
                    let mut events = Vec::new();
                    for e in list(&cal["entries"]) {
                        if s(&e["start"]) <= key.as_str() && s(&e["end"]) >= key.as_str() {
                            events.push(Event {
                                absence: false,
                                text: format!(
                                    "{}: {}",
                                    if s(&e["type"]) == "holiday" {
                                        "Feriado"
                                    } else {
                                        "Dia não letivo"
                                    },
                                    s(&e["name"])
                                ),
                            });
                        }
                    }
                    if list(&c["excluded"]).iter().any(|x| s(x) == key) {
                        events.push(Event {
                            absence: true,
                            text: "Falta/cancelamento da disciplina: motivo não informado.".into(),
                        });
                    }
                    for p in &assigned {
                        for a in list(&p["absences"]) {
                            if s(&a["start"]) <= key.as_str() && s(&a["end"]) >= key.as_str() {
                                events.push(Event {
                                    absence: true,
                                    text: format!(
                                        "Ausência de {}: {}",
                                        s(&p["name"]),
                                        if s(&a["note"]).is_empty() {
                                            "Sem justificativa detalhada"
                                        } else {
                                            s(&a["note"])
                                        }
                                    ),
                                });
                            }
                        }
                    }
                    reasons.extend(events.iter().map(|event| event.text.clone()));
                    if !reasons.is_empty() {
                        if let Some(row) = rows.iter_mut().find(|r| r.day == key) {
                            row.events = events.clone();
                            row.reason.push_str(&format!(" Impedimento na rotina regular: {}. A carga exibida segue o registro ou a aula extra.",reasons.join("; ")));
                        } else {
                            rows.push(Row {
                                events,
                                day: key,
                                minutes: 0.0,
                                status: "Sem aula regular".into(),
                                reason: reasons.join("; "),
                            });
                        }
                    }
                }
                day += Duration::days(1);
            }
        }
        rows.sort_by(|a, b| a.day.cmp(&b.day));
        let counts = |status: &str| rows.iter().filter(|r| r.status == status).count();
        let finish = if r.is_null() {
            "Indisponível: defina um calendário válido.".into()
        } else if r["complete"] == true {
            "Carga horária concluída pelos registros do SCR.".into()
        } else if r["finish"].is_null() {
            format!("Sem conclusão prevista no calendário. Faltam {} {} de reposição além das aulas previstas.",amount(n(&r["deficit"])/unit),unit_label)
        } else {
            format!("{} (condicionada à confirmação das pendências e à realização das aulas previstas).",pretty(s(&r["finish"])))
        };
        courses.push(Course{id:s(&c["id"]).into(),complete:r["complete"]==true,unit,name:s(&c["name"]).into(),people:assigned.iter().map(|p|s(&p["name"])).collect::<Vec<_>>().join(", "),groups:list(&c["groups"]).iter().map(s).collect::<Vec<_>>().join(", "),period:cal.map(|cal|format!("{} | {} a {}",s(&cal["name"]),pretty(s(&cal["start"])),pretty(s(&cal["end"])))).unwrap_or_else(||"Calendário não vinculado".into()),summary:format!("Carga: {} / {} {} ({} minutos por unidade). Carga anterior ao período: {} {}.\n{} realizadas | {} a conferir | {} aulas a mais | {} futuras.",amount(n(&r["done"])/unit),amount(n(&c["total"])),unit_label,amount(unit),amount(n(&c["done"])),unit_label,counts("Realizada"),counts("Conferir registro"),counts("Aula a mais"),counts("Prevista")),finish,rows});
    }
    if courses.is_empty() {
        return Err("Nenhuma disciplina vinculada à seleção.".into());
    }
    Ok(Report {
        label,
        reference: f.reference.clone(),
        notes: f.notes.clone(),
        courses,
    })
}

pub fn filename(data: &Value, f: &Filter, issued: NaiveDate) -> String {
    let courses = list(&data["courses"]);
    let mut names: Vec<&str> = list(&data["professors"])
        .iter()
        .filter(|p| {
            if f.kind == "professor" {
                return s(&p["id"]) == f.value;
            }
            courses.iter().any(|c| {
                (if f.kind == "disciplina" {
                    s(&c["id"]) == f.value
                } else {
                    list(&c["groups"])
                        .iter()
                        .any(|g| norm(s(g)) == norm(&f.value))
                }) && list(&c["professorIds"]).iter().any(|id| id == &p["id"])
            })
        })
        .map(|p| s(&p["name"]))
        .filter(|n| !n.trim().is_empty())
        .collect();
    names.sort();
    names.dedup();
    let name = if names.is_empty() {
        "Sem professor".into()
    } else {
        names.join(", ")
    };
    let safe: String = name
        .chars()
        .map(|c| {
            if c.is_control() || r#"<>:"/\|?*"#.contains(c) {
                '-'
            } else {
                c
            }
        })
        .take(140)
        .collect();
    format!(
        "Registros Prof {} - {}.pdf",
        safe.trim().trim_end_matches('.'),
        issued.format("%d-%m-%Y")
    )
}

// Cores das aulas: as mesmas de `.preview-lesson` na interface.
pub(crate) const TAUGHT: Tone = Tone {
    fill: "#e0eaff",
    stroke: "#93b4f0",
    accent: "#1d4ed8",
};
pub(crate) const PLANNED: Tone = Tone {
    fill: "#f1f5f4",
    stroke: "#cad8d5",
    accent: "#8a9e9a",
};
pub(crate) const REVIEW: Tone = Tone {
    fill: "#f3e8ff",
    stroke: "#d8b4fe",
    accent: "#7c3aed",
};
pub(crate) const ABSENCE: Tone = Tone {
    fill: "#ffedd5",
    stroke: "#fdba74",
    accent: "#c2410c",
};
pub(crate) const HOLIDAY: Tone = Tone {
    fill: "#fef9c3",
    stroke: "#fde047",
    accent: "#ca8a04",
};
pub(crate) const SURPLUS: Tone = Tone {
    fill: "#d5f5ef",
    stroke: "#5eead4",
    accent: "#0f766e",
};
pub(crate) const FINISH: Tone = Tone {
    fill: "#dcfce7",
    stroke: "#86efac",
    accent: "#15803d",
};
const CARD_LINE: f64 = 9.0;

fn push_card(cards: &mut Vec<(Vec<String>, Tone)>, lines: Vec<String>, tone: Tone) {
    for (i, chunk) in lines.chunks(14).enumerate() {
        let mut part = Vec::new();
        if i > 0 {
            part.push("Observação (cont.)".into());
        }
        if tone == ABSENCE || tone == HOLIDAY {
            part.push("Não registrar".into());
        }
        part.extend_from_slice(chunk);
        cards.push((part, tone));
    }
}
const MONTHS: [&str; 12] = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
];
fn calendar_pdf(data: &Value, report: &Report, month: &str, pdf: &mut Pdf) -> Result<(), String> {
    let first = date(&format!("{month}-01"))?;
    let next = if first.month() == 12 {
        NaiveDate::from_ymd_opt(first.year() + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(first.year(), first.month() + 1, 1)
    }
    .ok_or("Mês inválido")?;
    let days = (next - first).num_days() as usize;
    let offset = first.weekday().num_days_from_monday() as usize;
    let reference = date(&report.reference).ok();
    let projections = engine::projections_at(data, date(&report.reference)?)?;
    let title = format!("{} {}", MONTHS[(first.month() - 1) as usize], first.year());
    // Sábado e domingo só aparecem quando há aula (grade, rotina ou aula extra) nesse dia.
    let used = |weekday: usize| {
        report.courses.iter().any(|c| {
            c.rows.iter().any(|r| {
                r.day.starts_with(month)
                    && (r.status != "Sem aula regular" || !r.events.is_empty())
                    && date(&r.day)
                        .is_ok_and(|d| d.weekday().num_days_from_monday() as usize == weekday)
            })
        })
    };
    let cols: Vec<usize> = (0..7).filter(|&c| c < 5 || used(c)).collect();
    let col_w = (PAGE_W - 2.0 * MARGIN) / cols.len() as f64;
    let card_text = col_w - 18.0;

    fn heading(pdf: &mut Pdf, title: &str, report: &Report, cols: &[usize], col_w: f64) {
        pdf.next();
        pdf.heading(
            title,
            &report.label,
            &format!("Referência: {}", pretty(&report.reference)),
        );
        // Cabeçalho dos dias da semana, como o da prévia na interface.
        let y = pdf.y;
        pdf.rect(
            MARGIN,
            y - 6.0,
            PAGE_W - 2.0 * MARGIN,
            18.0,
            SURFACE_2,
            Some(LINE),
        );
        let labels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
        for (i, col) in cols.iter().enumerate() {
            pdf.label_at(
                MARGIN + 7.0 + i as f64 * col_w,
                y,
                labels[*col],
                7.5,
                SUBTLE,
            );
        }
        pdf.y -= 6.0;
    }
    heading(pdf, &title, report, &cols, col_w);
    for week in 0..(offset + days).div_ceil(7) {
        let mut cells = Vec::new();
        for &col in &cols {
            let idx = week * 7 + col;
            let day = if idx >= offset && idx < offset + days {
                Some(first + Duration::days((idx - offset) as i64))
            } else {
                None
            };
            let mut cards = Vec::new();
            if let Some(day) = day {
                let key = day.to_string();
                for course in &report.courses {
                    for row in course.rows.iter().filter(|r| r.day == key) {
                        if row.status != "Sem aula regular" {
                            let mut lines = wrap(&course.name, 7.5, true, card_text);
                            lines.push(format!(
                                "{} {} · {}",
                                amount(row.minutes / course.unit),
                                if course.unit == 60.0 { "h" } else { "h-aula" },
                                if row.status == "Conferir registro" {
                                    "Conferir"
                                } else {
                                    row.status.as_str()
                                }
                            ));
                            lines.extend(wrap(&course.people, 7.5, false, card_text));
                            if s(&projections[&course.id]["finish"]) == key {
                                lines.push("Conclusão prevista".into());
                            }
                            let tone = match row.status.as_str() {
                                "Realizada" => TAUGHT,
                                "Conferir registro" => REVIEW,
                                "Aula a mais" => SURPLUS,
                                _ => PLANNED,
                            };
                            push_card(&mut cards, lines, tone);
                        }
                        for event in &row.events {
                            let mut lines = wrap(&course.name, 7.5, true, card_text);
                            // "Motivo: detalhe" -> motivo numa linha e detalhe abaixo.
                            match event.text.split_once(": ") {
                                Some((kind, detail)) => {
                                    lines.extend(wrap(&format!("{kind}:"), 7.5, false, card_text));
                                    lines.extend(wrap(detail, 7.5, false, card_text));
                                }
                                None => lines.extend(wrap(&event.text, 7.5, false, card_text)),
                            }
                            push_card(
                                &mut cards,
                                lines,
                                if event.absence { ABSENCE } else { HOLIDAY },
                            );
                        }
                    }
                }
            }
            cells.push((col, day, cards));
        }
        // Semana cujos dias visíveis são todos de outro mês (ex.: só o domingo 1º).
        if cells.iter().all(|(_, day, _)| day.is_none()) {
            continue;
        }
        // Semanas muito cheias continuam em outra folha em vez de cortar aulas.
        let max_cards = cells
            .iter()
            .map(|(_, _, cards)| cards.len())
            .max()
            .unwrap_or(0);
        let batches = max_cards.max(1).div_ceil(2);
        for batch in 0..batches {
            let height = cells
                .iter()
                .map(|(_, _, cards)| {
                    cards
                        .iter()
                        .skip(batch * 2)
                        .take(2)
                        .map(|(lines, _)| lines.len() as f64 * CARD_LINE + 12.0)
                        .sum::<f64>()
                        + 26.0
                })
                .fold(56.0, f64::max);
            if pdf.y - height < BOTTOM {
                heading(pdf, &format!("{title} - continuação"), report, &cols, col_w);
            }
            let top = pdf.y;
            for (i, (col, day, cards)) in cells.iter().enumerate() {
                let x = MARGIN + i as f64 * col_w;
                let weekend = *col >= 5;
                let fill = match day {
                    None => BG,
                    Some(_) if weekend => BG,
                    Some(_) => WHITE,
                };
                pdf.rect(x, top - height, col_w, height, fill, Some(LINE));
                let Some(day) = day else { continue };
                let label = format!("{}", day.day());
                if Some(*day) == reference {
                    // Data de referência destacada com a cor primária, como "hoje" na interface.
                    let w = pdf::width(&label, 9.0, true) + 8.0;
                    pdf.rect(x + 4.0, top - 16.0, w, 13.0, PRIMARY, None);
                    pdf.text_at(x + 8.0, top - 12.6, &label, 9.0, true, WHITE);
                } else {
                    pdf.text_at(
                        x + 7.0,
                        top - 12.6,
                        &label,
                        9.0,
                        true,
                        if weekend { SUBTLE } else { INK },
                    );
                }
                if batch > 0 {
                    let x2 = x + 10.0 + pdf::width(&label, 9.0, true);
                    pdf.text_at(x2, top - 12.6, "(cont.)", 7.0, false, SUBTLE);
                }
                let mut y = top - 21.0;
                for (lines, tone) in cards.iter().skip(batch * 2).take(2) {
                    let h = lines.len() as f64 * CARD_LINE + 8.0;
                    pdf.card(x + 3.5, y - h, col_w - 7.0, h, *tone);
                    for (i, line) in lines.iter().enumerate() {
                        let (bold, color) = if line == "Conclusão prevista" {
                            (true, FINISH.accent)
                        } else if line == "Não registrar" {
                            (true, tone.accent)
                        } else if i == 0 || (i == 1 && lines[0] == "Não registrar") {
                            (true, INK)
                        } else {
                            (false, MUTED)
                        };
                        pdf.text_at(
                            x + 9.0,
                            y - 10.5 - i as f64 * CARD_LINE,
                            line,
                            7.5,
                            bold,
                            color,
                        );
                    }
                    y -= h + 4.0;
                }
            }
            pdf.y -= height;
        }
    }
    Ok(())
}
pub fn selected_months(f: &Filter) -> Result<Vec<String>, String> {
    let mut months = f.months.clone();
    if months.is_empty() {
        if let Some(month) = &f.month {
            months.push(month.clone());
        }
    }
    if months.is_empty() {
        return Err("Selecione pelo menos um mês para o calendário PDF.".into());
    }
    months.sort();
    months.dedup();
    if months.len() > 36 {
        return Err("Selecione até 36 meses por relatório.".into());
    }
    for month in &months {
        if month.len() != 7
            || !month.as_bytes().iter().enumerate().all(|(i, b)| {
                if i == 4 {
                    *b == b'-'
                } else {
                    b.is_ascii_digit()
                }
            })
        {
            return Err("Mês inválido.".into());
        }
        date(&format!("{month}-01"))?;
    }
    Ok(months)
}
pub fn generate(data: &Value, f: &Filter) -> Result<Vec<u8>, String> {
    let months = selected_months(f)?;
    let report = collect(data, f)?;
    let mut pdf = Pdf::new("Calendário de aulas", "SCR · Relatório de acompanhamento");
    pdf.legend = vec![
        ("Realizada", TAUGHT),
        ("Prevista", PLANNED),
        ("Conferir", REVIEW),
        ("Aula a mais", SURPLUS),
        ("Ausência / cancelamento", ABSENCE),
        ("Feriado / não letivo", HOLIDAY),
        ("Conclusão prevista", FINISH),
    ];
    for month in months {
        calendar_pdf(data, &report, &month, &mut pdf)?;
    }
    if !report.notes.trim().is_empty() {
        if pdf.y < BOTTOM + 40.0 {
            pdf.next();
        } else {
            pdf.y -= 22.0;
        }
        pdf.text_at(MARGIN, pdf.y, "Observações", 12.0, true, INK);
        pdf.y -= 18.0;
        pdf.block(report.notes.trim(), 10.0, false);
    }
    Ok(pdf.bytes())
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn data() -> Value {
        json!({"version":4,"professors":[{"id":"p","name":"João","absences":[],"extras":[]}],"calendars":[{"id":"cal","name":"Semestre","start":"2026-10-19","end":"2026-11-30","entries":[{"start":"2026-10-21","end":"2026-10-21","type":"holiday","name":"Feriado"}]}],"courses":[{"id":"c","name":"Matemática","calendarId":"cal","professorIds":["p"],"groups":["Turma A"],"total":8,"done":0,"unit":60,"schedule":{"1":2,"3":2},"reviewLessons":["2026-10-26"]}]})
    }
    fn filter(kind: &str, value: &str) -> Filter {
        Filter {
            kind: kind.into(),
            value: value.into(),
            reference: "2026-10-26".into(),
            notes: String::new(),
            month: None,
            months: vec!["2026-10".into()],
        }
    }
    #[test]
    fn filenames_use_professors_and_issue_date() {
        let issued = NaiveDate::from_ymd_opt(2026, 11, 3).unwrap();
        for (k, v) in [
            ("professor", "p"),
            ("disciplina", "c"),
            ("turma", "turma a"),
        ] {
            assert_eq!(
                filename(&data(), &filter(k, v), issued),
                "Registros Prof João - 03-11-2026.pdf"
            );
        }
        let mut d = data();
        d["professors"][0]["name"] = json!("João/Paulo");
        assert_eq!(
            filename(&d, &filter("professor", "p"), issued),
            "Registros Prof João-Paulo - 03-11-2026.pdf"
        );
        d["professors"] = json!([]);
        assert_eq!(
            filename(&d, &filter("disciplina", "c"), issued),
            "Registros Prof Sem professor - 03-11-2026.pdf"
        );
    }
    #[test]
    fn filters_agree() {
        for (k, v) in [
            ("professor", "p"),
            ("disciplina", "c"),
            ("turma", " turma a "),
        ] {
            assert_eq!(collect(&data(), &filter(k, v)).unwrap().courses.len(), 1);
        }
    }
    #[test]
    fn statuses_and_reasons() {
        let r = collect(&data(), &filter("disciplina", "c")).unwrap();
        let rows = &r.courses[0].rows;
        // Até a referência (26/10) as aulas contam como realizadas.
        assert!(rows
            .iter()
            .any(|r| r.day == "2026-10-19" && r.status == "Realizada"));
        assert!(rows
            .iter()
            .any(|r| r.day == "2026-10-21" && r.reason.contains("Feriado")));
        assert!(rows.iter().any(|r| r.day == "2026-10-26"
            && r.status == "Conferir registro"
            && r.reason.contains("conferir")));
        assert!(rows
            .iter()
            .any(|r| r.day == "2026-10-28" && r.status == "Prevista"));
        assert!(!rows.iter().any(|r| r.day.as_str() > "2026-11-02"));
    }
    #[test]
    fn completed_course_shows_only_marked_extra_lessons() {
        let mut d = data();
        d["courses"][0]["total"] = json!(2);
        let r = collect(&d, &filter("disciplina", "c")).unwrap();
        let lessons: Vec<_> = r.courses[0]
            .rows
            .iter()
            .filter(|r| r.status != "Sem aula regular")
            .map(|r| (r.day.as_str(), r.status.as_str()))
            .collect();
        assert_eq!(lessons, [("2026-10-19", "Realizada")]);
        d["courses"][0]["surplusLessons"] = json!(["2026-10-28"]);
        let r = collect(&d, &filter("disciplina", "c")).unwrap();
        let row = r.courses[0]
            .rows
            .iter()
            .find(|r| r.day == "2026-10-28")
            .unwrap();
        assert_eq!(row.status, "Aula a mais");
        assert_eq!(row.minutes, 120.0);
        let pdf = String::from_utf8(generate(&d, &filter("disciplina", "c")).unwrap()).unwrap();
        assert!(pdf.contains(&literal("2 h · Aula a mais")));
        assert!(!pdf.contains(&literal("Ministrada")));
    }
    #[test]
    fn legend_fits_on_one_line() {
        let labels = [
            "Realizada",
            "Prevista",
            "Conferir",
            "Aula a mais",
            "Ausência / cancelamento",
            "Feriado / não letivo",
            "Conclusão prevista",
        ];
        let mut x = MARGIN + crate::pdf::width("LEGENDA", 7.0, true) + 7.0 * 0.6 + 16.0;
        for label in labels {
            x += 21.0 + crate::pdf::width(label, 8.0, false) + 18.0;
        }
        assert!(x - 18.0 <= PAGE_W - MARGIN, "legenda termina em {x}");
    }
    #[test]
    fn generates_valid_header() {
        assert!(generate(&data(), &filter("professor", "p"))
            .unwrap()
            .starts_with(b"%PDF-1.4"));
        assert!(collect(&data(), &filter("professor", "missing")).is_err());
    }
    #[test]
    fn legend_is_present_on_every_page_including_notes() {
        let mut f = filter("professor", "p");
        f.months.push("2026-11".into());
        f.notes = "Observação longa para verificar paginação. ".repeat(40);
        let pdf = String::from_utf8(generate(&data(), &f).unwrap()).unwrap();
        assert_eq!(
            pdf.matches(&literal("LEGENDA")).count(),
            pdf.matches("/Type /Page /Parent").count()
        );
    }
    #[test]
    fn no_register_is_only_added_to_blocked_cards() {
        for color in [ABSENCE, HOLIDAY, PLANNED] {
            let mut cards = Vec::new();
            push_card(&mut cards, vec!["Motivo".into(); 40], color);
            for (lines, _) in cards {
                assert_eq!(lines.iter().any(|l| l == "Não registrar"), color != PLANNED);
                assert!(lines.len() <= 16);
            }
        }
    }
    #[test]
    fn conclusion_text_is_green_and_bold() {
        let mut f = filter("professor", "p");
        f.months.push("2026-11".into());
        let pdf = String::from_utf8(generate(&data(), &f).unwrap()).unwrap();
        assert!(pdf.contains(&format!("/F2 7.5 Tf {} rg", pdf::rgb(FINISH.accent))));
    }
    #[test]
    fn calendar_has_no_explanatory_appendix_and_notes_are_optional() {
        let mut f = filter("professor", "p");
        let pdf = String::from_utf8(generate(&data(), &f).unwrap()).unwrap();
        for text in [
            "Conferência e previsão de término",
            "Observações",
            "Conferir não significa falta",
        ] {
            assert!(!pdf.contains(&literal(text)));
        }
        f.notes = "Orientação personalizada".into();
        let pdf = String::from_utf8(generate(&data(), &f).unwrap()).unwrap();
        assert!(pdf.contains(&literal("Orientação personalizada")));
        assert!(pdf.contains(&literal("Observações")));
    }
    #[test]
    fn absence_and_calendar_events_have_distinct_colors_and_notes() {
        let mut d = data();
        d["professors"][0]["absences"] =
            json!([{"start":"2026-10-26","end":"2026-10-26","note":"Reunião pedagógica"}]);
        d["calendars"][0]["entries"].as_array_mut().unwrap().push(json!({"start":"2026-10-28","end":"2026-10-28","type":"non-school","name":"Planejamento"}));
        let pdf = String::from_utf8(generate(&d, &filter("professor", "p")).unwrap()).unwrap();
        assert!(pdf.contains(&pdf::rgb(ABSENCE.fill)));
        assert!(pdf.contains(&pdf::rgb(HOLIDAY.fill)));
        assert!(pdf.contains(&literal("Reunião pedagógica")));
        assert!(pdf.contains(&literal("Feriado:")));
        assert!(pdf.contains(&literal("Dia não letivo:")));
    }
    #[test]
    fn long_notes_are_split_without_losing_content() {
        let lines = (0..70).map(|i| format!("Linha {i}")).collect::<Vec<_>>();
        let mut cards = Vec::new();
        push_card(&mut cards, lines.clone(), ABSENCE);
        assert!(cards.iter().all(|(p, _)| p.len() <= 19));
        let recovered = cards
            .iter()
            .flat_map(|(p, _)| p.iter())
            .filter(|s| s.as_str() != "Observação (cont.)" && s.as_str() != "Não registrar")
            .cloned()
            .collect::<Vec<_>>();
        assert_eq!(recovered, lines);
    }
    #[test]
    fn absent_month_never_falls_back_to_old_report() {
        let mut f = filter("professor", "p");
        f.months.clear();
        assert!(generate(&data(), &f).unwrap_err().contains("Selecione"));
    }
    #[test]
    fn multiple_months_are_sorted_unique_and_in_one_pdf() {
        let mut f = filter("professor", "p");
        f.months = vec!["2026-11".into(), "2026-10".into(), "2026-10".into()];
        assert_eq!(selected_months(&f).unwrap(), vec!["2026-10", "2026-11"]);
        let pdf = String::from_utf8(generate(&data(), &f).unwrap()).unwrap();
        assert!(
            pdf.find(&literal("Outubro 2026")).unwrap()
                < pdf.find(&literal("Novembro 2026")).unwrap()
        );
        assert_eq!(pdf.matches("%PDF-1.4").count(), 1);
    }
    #[test]
    fn monthly_pdf_is_landscape_and_validates_month() {
        let mut f = filter("turma", "turma a");
        f.months.clear();
        f.month = Some("2026-10".into());
        let pdf = String::from_utf8(generate(&data(), &f).unwrap()).unwrap();
        assert!(pdf.contains("/MediaBox [0 0 842 595]"));
        assert!(pdf.contains(&literal("Matemática")));
        f.month = Some("2026-13".into());
        assert!(generate(&data(), &f).is_err());
    }
    #[test]
    fn absence_note_and_extra_are_preserved() {
        let mut d = data();
        d["professors"][0]["absences"] =
            json!([{"start":"2026-10-26","end":"2026-10-26","note":"Reunião pedagógica"}]);
        d["professors"][0]["extras"] =
            json!([{"date":"2026-10-26","courseId":"c","hours":1,"unit":60}]);
        let r = collect(&d, &filter("professor", "p")).unwrap();
        let row = r.courses[0]
            .rows
            .iter()
            .find(|r| r.day == "2026-10-26")
            .unwrap();
        assert_eq!(row.minutes, 60.0);
        assert_eq!(row.status, "Conferir registro");
        assert!(row.reason.contains("Reunião pedagógica"));
    }
    #[test]
    fn weekend_columns_only_when_there_are_lessons() {
        let pdf = String::from_utf8(generate(&data(), &filter("professor", "p")).unwrap()).unwrap();
        assert!(!pdf.contains(&literal("SÁB")));
        assert!(!pdf.contains(&literal("DOM")));
        // Aula extra num sábado: só a coluna de sábado aparece.
        let mut d = data();
        d["professors"][0]["extras"] =
            json!([{"date":"2026-10-31","courseId":"c","hours":1,"unit":60}]);
        let pdf = String::from_utf8(generate(&d, &filter("professor", "p")).unwrap()).unwrap();
        assert!(pdf.contains(&literal("SÁB")));
        assert!(!pdf.contains(&literal("DOM")));
        // Aula regular no domingo (grade ou rotina).
        let mut d = data();
        d["courses"][0]["schedule"] = json!({"1":2,"0":2});
        let pdf = String::from_utf8(generate(&d, &filter("professor", "p")).unwrap()).unwrap();
        assert!(pdf.contains(&literal("DOM")));
        assert!(!pdf.contains(&literal("SÁB")));
    }
    #[test]
    fn weekly_override_uses_actual_schedule() {
        let mut d = data();
        d["courses"][0]["weekOverrides"] = json!([{"weekStart":"2026-10-26","schedule":{"2":2}}]);
        let r = collect(&d, &filter("professor", "p")).unwrap();
        assert!(!r.courses[0].rows.iter().any(|r| r.day == "2026-10-26"));
        assert!(r.courses[0].rows.iter().any(|r| r.day == "2026-10-27"));
    }
}
