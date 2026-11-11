use crate::engine;
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
    date(&f.reference)?;
    if f.notes.chars().count() > 2000 {
        return Err("Use até 2000 caracteres na orientação.".into());
    }
    let projections = engine::projections(data)?;
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
            let completed = row["completed"] == true;
            if !completed && n(&row["credited"]) <= 0.0 {
                continue;
            }
            let pending = s(&row["day"]) <= f.reference.as_str();
            rows.push(Row{events:Vec::new(),day:s(&row["day"]).into(),minutes:n(&row["minutes"]),status:if completed{"Registrada"}else if pending{"Conferir registro"}else{"Prevista"}.into(),reason:if completed{"Marcada como ministrada no SCR."}else if pending{"Motivo não informado: aula prevista sem marcação. Confirmar se foi ministrada antes de registrar."}else{"Data futura em relação à referência; ainda não é pendência."}.into()});
        }
        if let Some(cal) = cal.filter(|_| !r.is_null()) {
            // Mesma carga diária das previsões, incluindo a grade da turma.
            let mut graded = c.clone();
            graded["gradeTurmas"] = engine::grade_for(data, &c["id"]);
            let mut day = date(s(&cal["start"]))?;
            let end = date(s(&cal["end"]))?;
            let last = if r["complete"] == true {
                list(&r["rows"])
                    .iter()
                    .filter(|x| x["completed"] == true)
                    .map(|x| s(&x["day"]))
                    .max()
                    .unwrap_or("")
            } else if r["finish"].is_string() {
                s(&r["finish"])
            } else {
                s(&cal["end"])
            };
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
        courses.push(Course{id:s(&c["id"]).into(),complete:r["complete"]==true,unit,name:s(&c["name"]).into(),people:assigned.iter().map(|p|s(&p["name"])).collect::<Vec<_>>().join(", "),groups:list(&c["groups"]).iter().map(s).collect::<Vec<_>>().join(", "),period:cal.map(|cal|format!("{} | {} a {}",s(&cal["name"]),pretty(s(&cal["start"])),pretty(s(&cal["end"])))).unwrap_or_else(||"Calendário não vinculado".into()),summary:format!("Carga: {} / {} {} ({} minutos por unidade). Carga anterior ao período: {} {}.\n{} registradas | {} a conferir | {} futuras.",amount(n(&r["done"])/unit),amount(n(&c["total"])),unit_label,amount(unit),amount(n(&c["done"])),unit_label,counts("Registrada"),counts("Conferir registro"),counts("Prevista")),finish,rows});
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

// PDF 1.4 with standard Type 1 fonts and Windows-1252 for Portuguese text.
fn encoded(text: &str) -> Vec<u8> {
    text.chars()
        .map(|c| match c {
            '\u{2013}' | '\u{2014}' => b'-',
            '\u{2018}' | '\u{2019}' => b'\'',
            '\u{201c}' | '\u{201d}' => b'"',
            c if (c as u32) <= 255 => c as u8,
            _ => b'?',
        })
        .collect()
}
fn literal(text: &str) -> String {
    encoded(text).iter().map(|c| format!("{c:02X}")).collect()
}
struct Pdf {
    pages: Vec<String>,
    page: String,
    y: f64,
    landscape: bool,
}
impl Pdf {
    fn new() -> Self {
        Self {
            pages: Vec::new(),
            page: String::new(),
            y: 0.0,
            landscape: false,
        }
    }
    fn next(&mut self) {
        if !self.page.is_empty() {
            self.pages.push(std::mem::take(&mut self.page));
        }
        self.y = if self.landscape { 550.0 } else { 780.0 };
        self.text("SCR | CALENDÁRIO DE AULAS", 11.0, true);
        self.y -= 12.0;
    }
    fn text(&mut self, t: &str, size: f64, bold: bool) {
        self.page.push_str(&format!(
            "BT /{} {size} Tf 0.12 0.15 0.19 rg 1 0 0 1 44 {} Tm <{}> Tj ET\n",
            if bold { "F2" } else { "F1" },
            self.y,
            literal(t)
        ));
        self.y -= size + 5.0;
    }
    fn lines(t: &str, max: usize) -> Vec<String> {
        let mut out = Vec::new();
        for paragraph in t.lines() {
            let mut line = String::new();
            for word in paragraph.split_whitespace() {
                for chunk in word.chars().collect::<Vec<_>>().chunks(max) {
                    let word: String = chunk.iter().collect();
                    if line.chars().count() + word.chars().count() + 1 > max {
                        out.push(std::mem::take(&mut line));
                    }
                    if !line.is_empty() {
                        line.push(' ')
                    }
                    line.push_str(&word);
                }
            }
            out.push(line);
        }
        out
    }
    fn block(&mut self, t: &str, size: f64, bold: bool) {
        let max = (500.0 / (size * 0.62)) as usize;
        for line in Self::lines(t, max) {
            if self.y < 100.0 {
                self.next();
            }
            self.text(&line, size, bold);
        }
    }
    fn bytes(mut self) -> Vec<u8> {
        if !self.page.is_empty() {
            self.pages.push(self.page);
        }
        let count = self.pages.len();
        let mut objects=vec!["<< /Type /Catalog /Pages 2 0 R >>".into(),format!("<< /Type /Pages /Count {count} /Kids [{}] >>",(0..count).map(|i|format!("{} 0 R",5+i*2)).collect::<Vec<_>>().join(" ")),"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>".into(),"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>".into()];
        for (i, mut content) in self.pages.into_iter().enumerate() {
            content.push_str(&legend());
            content.push_str(&format!("0.82 0.84 0.87 RG 0.5 w 44 42 m 798 42 l S\nBT /F1 8 Tf 0.35 0.38 0.42 rg 1 0 0 1 44 24 Tm <{}> Tj ET\n",literal(&format!("SCR - Relatório de acompanhamento | Página {} de {}",i+1,count))));
            objects.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {} {}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {} 0 R >>",if self.landscape{842}else{595},if self.landscape{595}else{842},6+i*2));
            objects.push(format!(
                "<< /Length {} >>\nstream\n{}endstream",
                content.len(),
                content
            ));
        }
        let mut bytes = b"%PDF-1.4\n".to_vec();
        let mut offsets = vec![0];
        for (i, o) in objects.iter().enumerate() {
            offsets.push(bytes.len());
            bytes.extend(format!("{} 0 obj\n{}\nendobj\n", i + 1, o).as_bytes());
        }
        let xref = bytes.len();
        bytes.extend(format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len()).as_bytes());
        for off in offsets.iter().skip(1) {
            bytes.extend(format!("{off:010} 00000 n \n").as_bytes());
        }
        bytes.extend(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
                offsets.len()
            )
            .as_bytes(),
        );
        bytes
    }
}
const ABSENCE_COLOR: &str = "1 0.76 0.49";
const CALENDAR_COLOR: &str = "1 0.95 0.55";
const FINISH_COLOR: &str = "0.08 0.42 0.20";
fn legend() -> String {
    let mut result = format!(
        "BT /F2 8 Tf 0.12 0.15 0.19 rg 1 0 0 1 44 82 Tm <{}> Tj ET\n",
        literal("Legenda")
    );
    for (i, (label, color)) in [
        ("Ministrada", "0.86 0.92 0.99"),
        ("Prevista", "0.95 0.96 0.97"),
        ("Conferir registro", "0.93 0.89 0.98"),
        ("Ausência / cancelamento", ABSENCE_COLOR),
        ("Feriado / dia não letivo", CALENDAR_COLOR),
        ("Conclusão prevista", FINISH_COLOR),
    ]
    .iter()
    .enumerate()
    {
        let x = 44.0 + (i % 3) as f64 * 245.0;
        let y = 67.0 - (i / 3) as f64 * 14.0;
        result.push_str(&format!("q {color} rg 0.7 0.7 0.7 RG 0.4 w {x} {y} 9 9 re B Q\nBT /F1 8 Tf 0.12 0.15 0.19 rg 1 0 0 1 {} {} Tm <{}> Tj ET\n",x+14.0,y+1.0,literal(label)));
    }
    result
}
fn push_card(
    cards: &mut Vec<(Vec<String>, &'static str)>,
    lines: Vec<String>,
    color: &'static str,
) {
    for (i, chunk) in lines.chunks(14).enumerate() {
        let mut part = Vec::new();
        if i > 0 {
            part.push("Observação (cont.)".into());
        }
        if color == ABSENCE_COLOR || color == CALENDAR_COLOR {
            part.push("Não registrar".into());
        }
        part.extend_from_slice(chunk);
        cards.push((part, color));
    }
}
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
    let projections = engine::projections(data)?;

    let title = format!(
        "{} {}",
        [
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
            "Dezembro"
        ][(first.month() - 1) as usize],
        first.year()
    );
    fn at(pdf: &mut Pdf, x: f64, y: f64, text: &str, size: f64, bold: bool) {
        let finish = text == "Conclusão prevista";
        let color = if finish {
            FINISH_COLOR
        } else {
            "0.12 0.15 0.19"
        };
        pdf.page.push_str(&format!(
            "BT /{} {size} Tf {color} rg 1 0 0 1 {x} {y} Tm <{}> Tj ET\n",
            if bold || finish || text == "Não registrar" {
                "F2"
            } else {
                "F1"
            },
            literal(text)
        ));
    }
    fn rect(pdf: &mut Pdf, x: f64, y: f64, w: f64, h: f64, color: &str) {
        pdf.page.push_str(&format!(
            "q {color} rg 0.82 0.84 0.87 RG 0.4 w {x} {y} {w} {h} re B Q\n"
        ));
    }
    fn heading(pdf: &mut Pdf, title: &str, report: &Report) {
        pdf.next();
        pdf.block(title, 20.0, true);
        pdf.block(&report.label, 11.0, true);
        pdf.block(
            &format!("Referência: {}", pretty(&report.reference)),
            9.0,
            false,
        );
        pdf.y -= 8.0;
        for (i, label) in ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"]
            .iter()
            .enumerate()
        {
            at(pdf, 34.0 + i as f64 * 111.0, pdf.y, label, 9.0, true);
        }
        pdf.y -= 12.0;
    }
    heading(pdf, &title, report);
    for week in 0..(offset + days).div_ceil(7) {
        let mut cells = Vec::new();
        for col in 0..7 {
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
                    if course.complete {
                        continue;
                    }
                    for row in course.rows.iter().filter(|r| r.day == key) {
                        if row.status != "Sem aula regular" {
                            let original = list(&projections[&course.id]["rows"])
                                .iter()
                                .find(|r| s(&r["day"]) == key);
                            let minutes = original
                                .map(|r| {
                                    if r["completed"] == true {
                                        n(&r["minutes"])
                                    } else {
                                        n(&r["credited"])
                                    }
                                })
                                .unwrap_or(0.0);
                            let mut lines = Pdf::lines(&course.name, 23);
                            lines.push(format!(
                                "{} {} | {}",
                                amount(minutes / course.unit),
                                if course.unit == 60.0 { "h" } else { "h-aula" },
                                if row.status == "Registrada" {
                                    "Ministrada"
                                } else if row.status == "Conferir registro" {
                                    "Conferir"
                                } else {
                                    "Prevista"
                                }
                            ));
                            lines.extend(Pdf::lines(&course.people, 23));
                            if s(&projections[&course.id]["finish"]) == key {
                                lines.push("Conclusão prevista".into());
                            }
                            let color = if row.status == "Registrada" {
                                "0.86 0.92 0.99"
                            } else if row.status == "Conferir registro" {
                                "0.93 0.89 0.98"
                            } else {
                                "0.95 0.96 0.97"
                            };
                            push_card(&mut cards, lines, color);
                        }
                        for event in &row.events {
                            let mut lines = Pdf::lines(&course.name, 23);
                            lines.extend(Pdf::lines(&event.text, 23));
                            push_card(
                                &mut cards,
                                lines,
                                if event.absence {
                                    ABSENCE_COLOR
                                } else {
                                    CALENDAR_COLOR
                                },
                            );
                        }
                    }
                }
            }
            cells.push((day, cards));
        }
        // Split unusually busy weeks across sheets rather than cutting off lessons.
        let max_cards = cells
            .iter()
            .map(|(_, cards)| cards.len())
            .max()
            .unwrap_or(0);
        let batches = max_cards.max(1).div_ceil(2);
        for batch in 0..batches {
            let height = cells
                .iter()
                .map(|(_, cards)| {
                    cards
                        .iter()
                        .skip(batch * 2)
                        .take(2)
                        .map(|(lines, _)| lines.len() as f64 * 9.0 + 12.0)
                        .sum::<f64>()
                        + 26.0
                })
                .fold(58.0, f64::max);
            if pdf.y - height < 100.0 {
                heading(pdf, &format!("{title} - continuação"), report);
            }
            let top = pdf.y;
            for (col, (day, cards)) in cells.iter().enumerate() {
                let x = 30.0 + col as f64 * 111.0;
                rect(pdf, x, top - height, 111.0, height, "1 1 1");
                if let Some(day) = day {
                    at(
                        pdf,
                        x + 5.0,
                        top - 13.0,
                        &format!("{}{}", day.day(), if batch > 0 { " (cont.)" } else { "" }),
                        9.0,
                        true,
                    );
                    let mut y = top - 21.0;
                    for (lines, color) in cards.iter().skip(batch * 2).take(2) {
                        let h = lines.len() as f64 * 9.0 + 8.0;
                        rect(pdf, x + 3.0, y - h, 105.0, h, color);
                        for (i, line) in lines.iter().enumerate() {
                            at(pdf, x + 7.0, y - 11.0 - i as f64 * 9.0, line, 7.5, i == 0);
                        }
                        y -= h + 4.0;
                    }
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
    let mut pdf = Pdf::new();
    pdf.landscape = true;
    for month in months {
        calendar_pdf(data, &report, &month, &mut pdf)?;
    }
    if !report.notes.trim().is_empty() {
        if pdf.y < 110.0 {
            pdf.next();
        } else {
            pdf.y -= 20.0;
        }
        pdf.block("Observações", 12.0, true);
        pdf.block(report.notes.trim(), 10.0, false);
    }
    Ok(pdf.bytes())
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn data() -> Value {
        json!({"version":4,"professors":[{"id":"p","name":"João","absences":[],"extras":[]}],"calendars":[{"id":"cal","name":"Semestre","start":"2026-10-19","end":"2026-11-30","entries":[{"start":"2026-10-21","end":"2026-10-21","type":"holiday","name":"Feriado"}]}],"courses":[{"id":"c","name":"Matemática","calendarId":"cal","professorIds":["p"],"groups":["Turma A"],"total":8,"done":0,"unit":60,"schedule":{"1":2,"3":2},"completedLessons":[{"day":"2026-10-19","minutes":120}]}]})
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
        assert!(rows
            .iter()
            .any(|r| r.day == "2026-10-19" && r.status == "Registrada"));
        assert!(rows
            .iter()
            .any(|r| r.day == "2026-10-21" && r.reason.contains("Feriado")));
        assert!(rows.iter().any(|r| r.day == "2026-10-26"
            && r.status == "Conferir registro"
            && r.reason.contains("não informado")));
        assert!(rows
            .iter()
            .any(|r| r.day == "2026-10-28" && r.status == "Prevista"));
        assert!(!rows.iter().any(|r| r.day.as_str() > "2026-11-02"));
    }
    #[test]
    fn completed_course_has_no_pending() {
        let mut d = data();
        d["courses"][0]["total"] = json!(2);
        let r = collect(&d, &filter("disciplina", "c")).unwrap();
        assert!(r.courses[0].rows.iter().all(|r| r.status == "Registrada"));
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
            pdf.matches(&literal("Legenda")).count(),
            pdf.matches("/Type /Page /Parent").count()
        );
    }
    #[test]
    fn no_register_is_only_added_to_blocked_cards() {
        for color in [ABSENCE_COLOR, CALENDAR_COLOR, "0.95 0.96 0.97"] {
            let mut cards = Vec::new();
            push_card(&mut cards, vec!["Motivo".into(); 40], color);
            for (lines, _) in cards {
                assert_eq!(
                    lines.iter().any(|l| l == "Não registrar"),
                    color != "0.95 0.96 0.97"
                );
                assert!(lines.len() <= 16);
            }
        }
    }
    #[test]
    fn conclusion_text_is_green_and_bold() {
        let mut f = filter("professor", "p");
        f.months.push("2026-11".into());
        let pdf = String::from_utf8(generate(&data(), &f).unwrap()).unwrap();
        assert!(pdf.contains(&format!("/F2 7.5 Tf {FINISH_COLOR} rg")));
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
        assert!(pdf.contains(ABSENCE_COLOR));
        assert!(pdf.contains(CALENDAR_COLOR));
        assert!(pdf.contains(&literal("Reunião pedagógica")));
        assert!(pdf.contains(&literal("Feriado: Feriado")));
        assert!(pdf.contains(&literal("Dia não letivo:")));
    }
    #[test]
    fn long_notes_are_split_without_losing_content() {
        let lines = (0..70).map(|i| format!("Linha {i}")).collect::<Vec<_>>();
        let mut cards = Vec::new();
        push_card(&mut cards, lines.clone(), ABSENCE_COLOR);
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
    fn weekly_override_uses_actual_schedule() {
        let mut d = data();
        d["courses"][0]["weekOverrides"] = json!([{"weekStart":"2026-10-26","schedule":{"2":2}}]);
        let r = collect(&d, &filter("professor", "p")).unwrap();
        assert!(!r.courses[0].rows.iter().any(|r| r.day == "2026-10-26"));
        assert!(r.courses[0].rows.iter().any(|r| r.day == "2026-10-27"));
    }
}
