//! PDF da grade semanal de uma turma (uma vigência), no mesmo visual do calendário.
use crate::pdf::{
    width, wrap, Pdf, Tone, BG, BOTTOM, INK, LINE, MARGIN, MUTED, PAGE_W, PRIMARY, SUBTLE,
    SURFACE_2, WHITE,
};
use chrono::{Duration, NaiveDate};
use serde_json::Value;

const DAYS: [&str; 6] = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
/// Uma cor por disciplina, na ordem do resumo (tons da paleta Tailwind usada na interface).
const PALETTE: [Tone; 12] = [
    Tone {
        fill: "#ccfbf1",
        stroke: "#5eead4",
        accent: "#0f766e",
    },
    Tone {
        fill: "#dbeafe",
        stroke: "#93c5fd",
        accent: "#1d4ed8",
    },
    Tone {
        fill: "#ede9fe",
        stroke: "#c4b5fd",
        accent: "#6d28d9",
    },
    Tone {
        fill: "#fef3c7",
        stroke: "#fcd34d",
        accent: "#b45309",
    },
    Tone {
        fill: "#ffe4e6",
        stroke: "#fda4af",
        accent: "#be123c",
    },
    Tone {
        fill: "#dcfce7",
        stroke: "#86efac",
        accent: "#15803d",
    },
    Tone {
        fill: "#e0f2fe",
        stroke: "#7dd3fc",
        accent: "#0369a1",
    },
    Tone {
        fill: "#ffedd5",
        stroke: "#fdba74",
        accent: "#c2410c",
    },
    Tone {
        fill: "#fae8ff",
        stroke: "#f0abfc",
        accent: "#a21caf",
    },
    Tone {
        fill: "#ecfccb",
        stroke: "#bef264",
        accent: "#4d7c0f",
    },
    Tone {
        fill: "#e2e8f0",
        stroke: "#94a3b8",
        accent: "#334155",
    },
    Tone {
        fill: "#f5f5f4",
        stroke: "#a8a29e",
        accent: "#57534e",
    },
];

fn s(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
fn list(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn day(v: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(v, "%Y-%m-%d").ok()
}
fn pretty(v: &str) -> String {
    day(v)
        .map(|d| d.format("%d/%m/%Y").to_string())
        .unwrap_or_else(|| v.into())
}

struct Subject {
    id: String,
    name: String,
    people: String,
    unit_hours: bool,
    count: usize,
    tone: Tone,
}

/// Vigência pedida (ou, sem id, a que vale em `issued`; senão a mais recente).
fn version<'a>(
    turma: &'a Value,
    id: &str,
    issued: NaiveDate,
) -> Result<(usize, Vec<&'a Value>), String> {
    let mut versions: Vec<&Value> = list(&turma["versions"]).iter().collect();
    versions.sort_by(|a, b| s(&a["validFrom"]).cmp(s(&b["validFrom"])));
    if versions.is_empty() {
        return Err("Salve uma vigência da grade antes de gerar o PDF.".into());
    }
    let index = if id.is_empty() {
        versions
            .iter()
            .rposition(|v| day(s(&v["validFrom"])).is_some_and(|d| d <= issued))
            .unwrap_or(versions.len() - 1)
    } else {
        versions
            .iter()
            .position(|v| s(&v["id"]) == id)
            .ok_or("Vigência não encontrada. Ela pode ter sido excluída.")?
    };
    Ok((index, versions))
}

fn find_turma<'a>(data: &'a Value, turma_id: &str) -> Result<&'a Value, String> {
    list(&data["turmas"])
        .iter()
        .find(|t| s(&t["id"]) == turma_id)
        .ok_or_else(|| "Turma não encontrada.".to_string())
}

pub fn filename(data: &Value, turma_id: &str, version_id: &str, issued: NaiveDate) -> String {
    let Ok(turma) = find_turma(data, turma_id) else {
        return "Grade.pdf".into();
    };
    let from = version(turma, version_id, issued)
        .map(|(i, v)| s(&v[i]["validFrom"]).to_string())
        .unwrap_or_default();
    let safe: String = s(&turma["name"])
        .chars()
        .map(|c| {
            if c.is_control() || r#"<>:"/\|?*"#.contains(c) {
                '-'
            } else {
                c
            }
        })
        .take(80)
        .collect();
    format!(
        "Grade Turma {} - vigência {}.pdf",
        safe.trim().trim_end_matches('.'),
        day(&from)
            .map(|d| d.format("%d-%m-%Y").to_string())
            .unwrap_or(from)
    )
}

pub fn generate(
    data: &Value,
    turma_id: &str,
    version_id: &str,
    issued: NaiveDate,
) -> Result<Vec<u8>, String> {
    let turma = find_turma(data, turma_id)?;
    let (index, versions) = version(turma, version_id, issued)?;
    let current = versions[index];
    let from = s(&current["validFrom"]);
    let range = match versions
        .get(index + 1)
        .and_then(|v| day(s(&v["validFrom"])))
    {
        Some(next) => format!(
            "Vigência: {} a {}",
            pretty(from),
            (next - Duration::days(1)).format("%d/%m/%Y")
        ),
        None => format!("Vigência: desde {}", pretty(from)),
    };
    let grid = &current["grid"];
    let rows = list(&turma["periods"])
        .len()
        .max(
            (1..=6)
                .map(|d| list(&grid[d.to_string()]).len())
                .max()
                .unwrap_or(0),
        )
        .max(1);
    let cell =
        |d: usize, p: usize| -> &str { list(&grid[d.to_string()]).get(p).map(s).unwrap_or("") };
    let saturday = (0..rows).any(|p| !cell(6, p).is_empty());
    let days: Vec<usize> = (1..=if saturday { 6 } else { 5 }).collect();

    // Disciplinas da grade, em ordem alfabética, cada uma com sua cor.
    let courses = list(&data["courses"]);
    let professors = list(&data["professors"]);
    let mut subjects: Vec<Subject> = Vec::new();
    for d in 1..=6 {
        for p in 0..rows {
            let id = cell(d, p);
            if id.is_empty() {
                continue;
            }
            if let Some(found) = subjects.iter_mut().find(|x| x.id == id) {
                found.count += 1;
                continue;
            }
            let course = courses.iter().find(|c| s(&c["id"]) == id);
            let people: Vec<&str> = course
                .map(|c| {
                    professors
                        .iter()
                        .filter(|p| list(&c["professorIds"]).iter().any(|x| x == &p["id"]))
                        .map(|p| s(&p["name"]))
                        .filter(|n| !n.trim().is_empty())
                        .collect()
                })
                .unwrap_or_default();
            subjects.push(Subject {
                id: id.into(),
                name: course
                    .map(|c| s(&c["name"]).to_string())
                    .unwrap_or_else(|| "Disciplina removida".into()),
                people: people.join(", "),
                unit_hours: course.is_some_and(|c| c["unit"].as_f64() == Some(60.0)),
                count: 1,
                tone: PALETTE[0],
            });
        }
    }
    subjects.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    for (i, x) in subjects.iter_mut().enumerate() {
        x.tone = PALETTE[i % PALETTE.len()];
    }
    let subject = |id: &str| subjects.iter().find(|x| x.id == id);

    let name = s(&turma["name"]);
    let mut pdf = Pdf::new(
        "Grade de horários",
        &format!("SCR · Grade semanal da turma {name}"),
    );
    pdf.next();
    pdf.heading(
        &format!("Turma {name}"),
        &range,
        &format!("Emitida em {}", issued.format("%d/%m/%Y")),
    );

    // Altura das linhas: a grade ocupa a primeira página; o resumo vem abaixo se couber.
    let summary_h = 34.0 + subjects.len().max(1) as f64 * 17.0 + 20.0;
    let head_h = 20.0;
    let free = pdf.y - BOTTOM - head_h;
    let mut row_h = ((free - summary_h) / rows as f64).clamp(26.0, 64.0);
    let summary_below = row_h * rows as f64 + summary_h <= free;
    if !summary_below {
        row_h = (free / rows as f64).clamp(22.0, 64.0);
    }

    let time_w = 86.0;
    let col_w = (PAGE_W - 2.0 * MARGIN - time_w) / days.len() as f64;
    let top = pdf.y;
    pdf.rect(
        MARGIN,
        top - head_h + 6.0,
        PAGE_W - 2.0 * MARGIN,
        head_h,
        SURFACE_2,
        Some(LINE),
    );
    pdf.label_at(MARGIN + 8.0, top - 6.0, "Horário", 7.5, SUBTLE);
    for (i, d) in days.iter().enumerate() {
        pdf.label_at(
            MARGIN + time_w + 8.0 + i as f64 * col_w,
            top - 6.0,
            DAYS[d - 1],
            7.5,
            SUBTLE,
        );
    }
    let grid_top = top - head_h + 6.0;
    let periods = list(&turma["periods"]);
    for p in 0..rows {
        let y = grid_top - (p + 1) as f64 * row_h;
        pdf.rect(MARGIN, y, time_w, row_h, BG, Some(LINE));
        pdf.text_at(
            MARGIN + 8.0,
            y + row_h - 14.0,
            &format!("{}ª aula", p + 1),
            9.0,
            true,
            INK,
        );
        let (start, end) = periods
            .get(p)
            .map(|x| (s(&x["start"]), s(&x["end"])))
            .unwrap_or(("", ""));
        let times = match (start.is_empty(), end.is_empty()) {
            (false, false) => format!("{start} - {end}"),
            (false, true) => format!("às {start}"),
            _ => String::new(),
        };
        if !times.is_empty() && row_h >= 26.0 {
            pdf.text_at(MARGIN + 8.0, y + row_h - 25.0, &times, 8.0, false, MUTED);
        }
    }
    for (i, d) in days.iter().enumerate() {
        let x = MARGIN + time_w + i as f64 * col_w;
        let mut p = 0;
        while p < rows {
            let id = cell(*d, p);
            // Aulas seguidas da mesma disciplina viram um único bloco.
            let mut span = 1;
            while !id.is_empty() && p + span < rows && cell(*d, p + span) == id {
                span += 1;
            }
            let h = row_h * span as f64;
            let y = grid_top - p as f64 * row_h - h;
            pdf.rect(x, y, col_w, h, WHITE, Some(LINE));
            if let Some(sub) = subject(id) {
                pdf.card(x + 3.0, y + 3.0, col_w - 6.0, h - 6.0, sub.tone);
                let max = col_w - 18.0;
                let mut lines: Vec<(String, bool, &str)> = wrap(&sub.name, 8.5, true, max)
                    .into_iter()
                    .map(|l| (l, true, INK))
                    .collect();
                if !sub.people.is_empty() {
                    lines.extend(
                        wrap(&sub.people, 7.5, false, max)
                            .into_iter()
                            .map(|l| (l, false, MUTED)),
                    );
                }
                if span > 1 {
                    lines.push((format!("{span} aulas seguidas"), false, sub.tone.accent));
                }
                let fit = (((h - 10.0) / 10.0).floor() as usize).max(1);
                if lines.len() > fit {
                    lines.truncate(fit);
                    if let Some(last) = lines.last_mut() {
                        last.0 = format!("{}...", last.0.trim_end_matches(['.', ' ']));
                    }
                }
                for (k, (line, bold, color)) in lines.iter().enumerate() {
                    let size = if *bold { 8.5 } else { 7.5 };
                    pdf.text_at(
                        x + 11.0,
                        y + h - 15.0 - k as f64 * 10.0,
                        line,
                        size,
                        *bold,
                        color,
                    );
                }
            }
            p += span;
        }
    }
    pdf.y = grid_top - rows as f64 * row_h;

    // Resumo semanal.
    if !summary_below {
        pdf.next();
    } else {
        pdf.y -= 26.0;
    }
    pdf.label_at(MARGIN, pdf.y, "Resumo semanal", 8.0, PRIMARY);
    pdf.y -= 20.0;
    let cols = [MARGIN, MARGIN + 330.0, PAGE_W - MARGIN - 120.0];
    pdf.rect(
        MARGIN,
        pdf.y - 5.0,
        PAGE_W - 2.0 * MARGIN,
        17.0,
        SURFACE_2,
        Some(LINE),
    );
    for (x, label) in cols
        .iter()
        .zip(["Disciplina", "Professor(es)", "Por semana"])
    {
        pdf.label_at(x + 8.0, pdf.y, label, 7.0, SUBTLE);
    }
    pdf.y -= 5.0;
    if subjects.is_empty() {
        pdf.y -= 13.0;
        pdf.text_at(
            MARGIN + 8.0,
            pdf.y,
            "Nenhuma disciplina nesta vigência.",
            8.5,
            false,
            MUTED,
        );
        pdf.y -= 4.0;
    }
    let mut total = 0;
    for sub in &subjects {
        if pdf.y - 17.0 < BOTTOM {
            pdf.next();
        }
        let y = pdf.y - 17.0;
        pdf.rect(MARGIN, y, PAGE_W - 2.0 * MARGIN, 17.0, WHITE, Some(LINE));
        pdf.card(MARGIN + 8.0, y + 4.5, 12.0, 8.0, sub.tone);
        let fit = |t: &str, size: f64, bold: bool, max: f64| -> String {
            let mut lines = wrap(t, size, bold, max);
            if lines.len() > 1 {
                lines.truncate(1);
                lines[0].push_str("...");
            }
            lines.pop().unwrap_or_default()
        };
        pdf.text_at(
            MARGIN + 27.0,
            y + 5.5,
            &fit(&sub.name, 8.5, true, 290.0),
            8.5,
            true,
            INK,
        );
        let people = if sub.people.is_empty() {
            "-".to_string()
        } else {
            fit(&sub.people, 8.5, false, 300.0)
        };
        pdf.text_at(cols[1] + 8.0, y + 5.5, &people, 8.5, false, MUTED);
        let amount = if sub.unit_hours {
            format!("{} h", sub.count)
        } else {
            format!(
                "{} {}",
                sub.count,
                if sub.count == 1 { "aula" } else { "aulas" }
            )
        };
        pdf.text_at(cols[2] + 8.0, y + 5.5, &amount, 8.5, true, INK);
        total += sub.count;
        pdf.y = y;
    }
    if !subjects.is_empty() {
        pdf.y -= 16.0;
        let text = format!(
            "{total} {} por semana · {} {}",
            if total == 1 { "aula" } else { "aulas" },
            subjects.len(),
            if subjects.len() == 1 {
                "disciplina"
            } else {
                "disciplinas"
            }
        );
        let x = PAGE_W - MARGIN - width(&text, 8.5, true);
        pdf.text_at(x, pdf.y, &text, 8.5, true, INK);
    }
    Ok(pdf.bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::literal;
    use serde_json::json;
    fn data() -> Value {
        json!({
            "professors":[{"id":"p","name":"João"}],
            "courses":[
                {"id":"m","name":"Matemática","unit":50,"professorIds":["p"]},
                {"id":"h","name":"História","unit":60,"professorIds":[]}
            ],
            "turmas":[{"id":"t","name":"501","periods":[{"start":"07:30","end":"08:20"},{"start":"08:20","end":"09:10"}],
              "versions":[
                {"id":"v2","validFrom":"2026-11-03","grid":{"1":["m","m"],"2":["h",""],"3":["",""],"4":["",""],"5":["",""],"6":["",""]}},
                {"id":"v1","validFrom":"2026-08-01","grid":{"1":["h",""],"2":["",""],"3":["",""],"4":["",""],"5":["",""],"6":["","m"]}}
              ]}]
        })
    }
    fn issued() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, 11).unwrap()
    }
    #[test]
    fn current_version_with_range_merges_and_summary() {
        let pdf = String::from_utf8(generate(&data(), "t", "", issued()).unwrap()).unwrap();
        assert!(pdf.starts_with("%PDF-1.4"));
        assert!(pdf.contains("/MediaBox [0 0 842 595]"));
        assert!(pdf.contains(&literal("Turma 501")));
        assert!(pdf.contains(&literal("Vigência: desde 03/11/2026")));
        assert!(pdf.contains(&literal("07:30 - 08:20")));
        assert!(pdf.contains(&literal("2 aulas seguidas")));
        assert!(pdf.contains(&literal("1 h")));
        assert!(pdf.contains(&literal("3 aulas por semana · 2 disciplinas")));
        // Sem aulas no sábado, a coluna não aparece.
        assert!(!pdf.contains(&literal("SÁBADO")));
    }
    #[test]
    fn older_version_shows_closed_range_and_saturday() {
        let pdf = String::from_utf8(generate(&data(), "t", "v1", issued()).unwrap()).unwrap();
        assert!(pdf.contains(&literal("Vigência: 01/08/2026 a 02/11/2026")));
        assert!(pdf.contains(&literal("SÁBADO")));
    }
    #[test]
    fn errors_and_filename() {
        let mut d = data();
        assert!(generate(&d, "x", "", issued()).is_err());
        assert!(generate(&d, "t", "zz", issued()).is_err());
        assert_eq!(
            filename(&d, "t", "v1", issued()),
            "Grade Turma 501 - vigência 01-08-2026.pdf"
        );
        d["turmas"][0]["versions"] = json!([]);
        assert!(generate(&d, "t", "", issued())
            .unwrap_err()
            .contains("Salve"));
    }
    #[test]
    fn many_periods_still_fit_and_paginate() {
        let mut d = data();
        let cells: Vec<&str> = vec!["m"; 12];
        d["turmas"][0]["periods"] = json!(vec![json!({"start":"","end":""}); 12]);
        d["turmas"][0]["versions"] = json!([{"id":"v","validFrom":"2026-01-01","grid":{"1":cells,"2":cells,"3":cells,"4":cells,"5":cells,"6":cells}}]);
        let pdf = String::from_utf8(generate(&d, "t", "v", issued()).unwrap()).unwrap();
        assert!(pdf.contains(&literal("12 aulas seguidas")));
    }
}
