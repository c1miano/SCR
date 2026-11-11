use chrono::{Datelike, Duration, NaiveDate};
use serde_json::{json, Value as V};
use std::collections::{BTreeMap, HashSet};
fn array(v: &V) -> Vec<&V> {
    v.as_array().map(|x| x.iter().collect()).unwrap_or_default()
}
fn num(v: &V) -> f64 {
    v.as_f64().unwrap_or(0.0)
}
fn text(v: &V) -> &str {
    v.as_str().unwrap_or("")
}
fn date(s: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| format!("Data inválida: {s}"))
}
fn week(d: NaiveDate) -> NaiveDate {
    d - Duration::days(d.weekday().num_days_from_monday() as i64)
}
/// Grade semanal das turmas que incluem a disciplina.
///
/// Cada turma (`data.turmas`) guarda versões da grade com `validFrom`. Uma
/// versão vale da sua data até a véspera da próxima. Cada célula da grade é
/// uma aula na unidade da disciplina; contar as células da disciplina num dia
/// da semana dá a carga desse dia. Só entram turmas cuja grade cita a
/// disciplina em alguma versão; se uma versão posterior a remove, a carga
/// passa a zero a partir dessa data.
pub fn grade_for(data: &V, course_id: &V) -> V {
    let mut turmas = Vec::new();
    for turma in array(&data["turmas"]) {
        let mut versions: Vec<V> = array(&turma["versions"])
            .into_iter()
            .map(|v| {
                let mut counts = serde_json::Map::new();
                if let Some(grid) = v["grid"].as_object() {
                    for (weekday, cells) in grid {
                        let n = array(cells).iter().filter(|x| **x == course_id).count();
                        if n > 0 {
                            counts.insert(weekday.clone(), json!(n));
                        }
                    }
                }
                json!({"validFrom": v["validFrom"], "schedule": counts})
            })
            .collect();
        let cites = versions
            .iter()
            .any(|v| v["schedule"].as_object().is_some_and(|m| !m.is_empty()));
        if !cites {
            continue;
        }
        versions.sort_by(|a, b| text(&a["validFrom"]).cmp(text(&b["validFrom"])));
        turmas.push(json!({"name": turma["name"], "versions": versions}));
    }
    V::Array(turmas)
}
/// Carga regular de cada dia da semana na data `d`, em unidades da disciplina.
///
/// Prioridade: alteração pontual da semana (`weekOverrides`) > grade da turma
/// vigente na data (`gradeTurmas`, preenchido por `grade_for`) > rotina da
/// disciplina (fixa ou alternada A/B).
pub(crate) fn schedule(c: &V, d: NaiveDate) -> Result<V, String> {
    let w = week(d);
    for item in array(&c["weekOverrides"]) {
        if text(&item["weekStart"]) == w.to_string() {
            return Ok(item["schedule"].clone());
        }
    }
    let day = d.to_string();
    let mut from_grade = serde_json::Map::new();
    let mut graded = false;
    for turma in array(&c["gradeTurmas"]) {
        let mut current = None;
        for v in array(&turma["versions"]) {
            date(text(&v["validFrom"]))?;
            if text(&v["validFrom"]) <= day.as_str() {
                current = Some(v);
            }
        }
        if let Some(v) = current {
            graded = true;
            if let Some(m) = v["schedule"].as_object() {
                for (k, n) in m {
                    let total = num(from_grade.get(k).unwrap_or(&V::Null)) + num(n);
                    from_grade.insert(k.clone(), json!(total));
                }
            }
        }
    }
    if graded {
        return Ok(V::Object(from_grade));
    }
    if text(&c["scheduleMode"]) == "alternating" && !text(&c["weekAnchor"]).is_empty() {
        let offset = (w - week(date(text(&c["weekAnchor"]))?)).num_days() / 7;
        if offset.rem_euclid(2) == 1 {
            return Ok(c["scheduleB"].clone());
        }
    }
    Ok(c["schedule"].clone())
}
/// Tolerância (em minutos) para resíduos de ponto flutuante: cargas com
/// frações de hora (ex.: 1,33 h × 50 min) podem somar 3999,9999999 em vez de 4000.
const EPS: f64 = 1e-6;
fn settle(x: f64) -> f64 {
    if x.abs() < EPS {
        0.0
    } else {
        x
    }
}
pub fn forecast(c: &V, cal: &V) -> Result<V, String> {
    let start = date(text(&c["start"]))?;
    let end = date(text(&c["end"]))?;
    if end < start || (end - start).num_days() > 1096 {
        return Err("O calendário deve ter até três anos.".into());
    }
    let unit = num(&c["unit"]);
    let target = num(&c["total"]) * unit;
    let baseline = num(&c["done"]) * unit;
    if ![45.0, 50.0, 60.0].contains(&unit) || target <= 0.0 || baseline < 0.0 || baseline > target {
        return Err("Carga horária inválida.".into());
    }
    let blocked: HashSet<&str> = array(&c["excluded"]).into_iter().map(text).collect();
    let mut completed = BTreeMap::new();
    for x in array(&c["completedLessons"]) {
        date(text(&x["day"]))?;
        let m = num(&x["minutes"]);
        if m <= 0.0 {
            return Err("Aula ministrada inválida.".into());
        }
        completed.insert(text(&x["day"]).to_string(), m);
    }
    let taught: f64 = completed.values().fold(0.0, |sum, m| sum + m);
    let done = target.min(baseline + taught);
    let remaining = settle((target - done).max(0.0));
    let mut rows = BTreeMap::new();
    let mut d = start;
    loop {
        let day = d.to_string();
        let regular = num(&schedule(c, d)?[d.weekday().num_days_from_sunday().to_string()]) * unit;
        let excluded = blocked.contains(day.as_str())
            || array(cal)
                .iter()
                .any(|e| text(&e["start"]) <= day.as_str() && text(&e["end"]) >= day.as_str());
        let extra: f64 = array(&c["extras"])
            .iter()
            .filter(|x| text(&x["date"]) == day)
            .map(|x| num(&x["hours"]) * unit)
            .sum();
        let minutes = completed
            .get(&day)
            .copied()
            .unwrap_or(if excluded { 0.0 } else { regular } + extra);
        if minutes > 0.0 {
            rows.insert(day.clone(),json!({"day":day,"minutes":minutes,"completed":completed.contains_key(&day),"extra":extra>0.0}));
        }
        if d == end {
            break;
        }
        d += Duration::days(1);
    }
    for (day, minutes) in &completed {
        rows.entry(day.clone())
            .or_insert(json!({"day":day,"minutes":minutes,"completed":true,"extra":false}));
    }
    let mut sum = 0.0;
    let mut available = 0.0;
    let mut accumulated = baseline;
    let mut finish: Option<String> = None;
    for row in rows.values_mut() {
        let m = num(&row["minutes"]);
        let credited = if row["completed"] == true {
            m
        } else {
            available += m;
            let cr = m.min((remaining - sum).max(0.0));
            sum += cr;
            if remaining > 0.0 && sum >= remaining - EPS && finish.is_none() {
                finish = Some(text(&row["day"]).to_string());
            }
            cr
        };
        accumulated = target.min(accumulated + credited);
        row["credited"] = json!(credited);
        row["accumulated"] = json!(accumulated);
    }
    if let Some(ref mut f) = finish {
        if let Some(last) = completed.keys().last() {
            if last > &*f {
                *f = last.clone();
            }
        }
    }
    Ok(
        json!({"remaining":remaining,"available":available,"deficit":settle((remaining-available).max(0.0)),"finish":finish,"complete":remaining==0.0,"done":done,"taught":taught,"rows":rows.into_values().collect::<Vec<_>>()}),
    )
}
/// Calcula as previsões de todas as disciplinas.
///
/// Erros estruturais (versão, listas ausentes, identificadores repetidos)
/// invalidam o arquivo inteiro. Um erro de cálculo em uma disciplina
/// (carga ou datas inválidas) não impede o carregamento das demais: a
/// previsão dela fica `null` e a mensagem vai para `issues`.
pub fn projections(data: &V) -> Result<V, String> {
    projections_with_issues(data).map(|(forecasts, _)| forecasts)
}
pub fn projections_with_issues(data: &V) -> Result<(V, V), String> {
    if data["version"] != 4
        || !data["courses"].is_array()
        || !data["calendars"].is_array()
        || !data["professors"].is_array()
    {
        return Err("Arquivo SCR inválido (esperado formato versão 4).".into());
    }
    let mut result = serde_json::Map::new();
    let mut issues = serde_json::Map::new();
    let mut ids = HashSet::new();
    for course in array(&data["courses"]) {
        let id = text(&course["id"]);
        if id.is_empty() || !ids.insert(id) {
            return Err("Identificador de disciplina inválido ou repetido.".into());
        }
        let cal = array(&data["calendars"])
            .into_iter()
            .find(|x| x["id"] == course["calendarId"]);
        let Some(cal) = cal else {
            result.insert(id.into(), V::Null);
            continue;
        };
        if text(&cal["start"]).is_empty() || text(&cal["end"]).is_empty() {
            result.insert(id.into(), V::Null);
            continue;
        }
        let mut c = course.clone();
        c["gradeTurmas"] = grade_for(data, &course["id"]);
        c["start"] = cal["start"].clone();
        c["end"] = cal["end"].clone();
        let mut blocked: Vec<V> = array(&cal["entries"]).into_iter().cloned().collect();
        let mut extras: Vec<V> = array(&c["extras"]).into_iter().cloned().collect();
        for person in array(&data["professors"]) {
            if !array(&course["professorIds"])
                .iter()
                .any(|id| **id == person["id"])
            {
                continue;
            }
            blocked.extend(array(&person["absences"]).into_iter().cloned());
            for x in array(&person["extras"]) {
                if x["courseId"] == course["id"] {
                    extras.push(json!({"date":x["date"],"hours":num(&x["hours"])*num(&x["unit"])/num(&c["unit"])}));
                }
            }
        }
        c["extras"] = json!(extras);
        match forecast(&c, &json!(blocked)) {
            Ok(r) => {
                result.insert(id.into(), r);
            }
            Err(e) => {
                result.insert(id.into(), V::Null);
                issues.insert(id.into(), json!(e));
            }
        }
    }
    Ok((V::Object(result), V::Object(issues)))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn target_and_completed() {
        let mut c = json!({"total":5,"done":0,"unit":50,"start":"2026-10-19","end":"2026-11-30","schedule":{"1":2,"3":2},"completedLessons":[]});
        let r = forecast(&c, &json!([])).unwrap();
        assert_eq!(r["finish"], "2026-10-26");
        assert_eq!(r["rows"][2]["credited"], 50.0);
        c["completedLessons"] = json!([{"day":"2026-10-19","minutes":250}]);
        assert_eq!(forecast(&c, &json!([])).unwrap()["complete"], true);
    }
    #[test]
    fn invalid_period() {
        assert!(forecast(
            &json!({"start":"2026-02-30","end":"2026-10-20"}),
            &json!([])
        )
        .is_err());
    }
    #[test]
    fn alternating() {
        let c = json!({"total":8,"done":0,"unit":50,"start":"2026-10-19","end":"2026-11-30","schedule":{"2":2},"scheduleMode":"alternating","weekAnchor":"2026-10-19","scheduleB":{"3":2},"weekOverrides":[{"weekStart":"2026-10-26","schedule":{"2":2}}]});
        let r = forecast(&c, &json!([])).unwrap();
        assert_eq!(r["rows"][1]["day"], "2026-10-27");
        assert_eq!(r["finish"], "2026-11-11");
    }
    #[test]
    fn invalid_course_does_not_block_others() {
        let data = json!({"version":4,"professors":[],
        "calendars":[{"id":"cal","start":"2026-10-19","end":"2026-11-30","entries":[]}],
        "courses":[
            {"id":"ok","calendarId":"cal","total":5,"done":0,"unit":50,"schedule":{"1":2}},
            {"id":"bad","calendarId":"cal","total":5,"done":9,"unit":50,"schedule":{"1":2}}
        ]});
        let (forecasts, issues) = projections_with_issues(&data).unwrap();
        assert!(forecasts["ok"]["finish"].is_string());
        assert!(forecasts["bad"].is_null());
        assert_eq!(issues["bad"], "Carga horária inválida.");
        assert!(issues.get("ok").is_none());
    }
    #[test]
    fn structural_errors_remain_fatal() {
        let data = json!({"version":4,"professors":[],"calendars":[],
            "courses":[{"id":"a"},{"id":"a"}]});
        assert!(projections(&data).is_err());
    }
    #[test]
    fn fractional_hours_complete_without_float_residue() {
        // 30 aulas de 50/30 min somam 49,999999999999986 em vez de 50.
        let lessons: Vec<V> = (1..=30)
            .map(|d| json!({"day":format!("2026-10-{:02}",d),"minutes":50.0/30.0}))
            .collect();
        let c = json!({"total":1,"done":0,"unit":50,"start":"2026-10-01","end":"2026-10-31",
            "schedule":{},"completedLessons":lessons});
        let r = forecast(&c, &json!([])).unwrap();
        assert_eq!(r["complete"], true);
        assert_eq!(r["deficit"], 0.0);
    }
    fn grade_data() -> V {
        json!({"version":4,"professors":[],
        "calendars":[{"id":"cal","start":"2026-10-19","end":"2026-11-30","entries":[]}],
        "courses":[{"id":"mat","calendarId":"cal","total":20,"done":0,"unit":50,"schedule":{"5":9}}],
        "turmas":[{"id":"t","name":"501","versions":[
            {"validFrom":"2026-11-02","grid":{"3":["mat","mat","mat"]}},
            {"validFrom":"2026-10-01","grid":{"1":["mat","mat","port"],"2":["port"]}}
        ]}]})
    }
    fn days_of(r: &V) -> Vec<(String, f64)> {
        r["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| {
                (
                    x["day"].as_str().unwrap().to_string(),
                    x["minutes"].as_f64().unwrap(),
                )
            })
            .collect()
    }
    #[test]
    fn grade_versions_drive_the_schedule_by_date() {
        let days = days_of(&projections(&grade_data()).unwrap()["mat"]);
        // Até 01/11: segundas com 2 aulas (a rotina própria de sexta é ignorada).
        assert_eq!(days[0], ("2026-10-19".to_string(), 100.0));
        assert_eq!(days[1], ("2026-10-26".to_string(), 100.0));
        // A partir de 02/11: quartas com 3 aulas, nenhuma segunda.
        assert_eq!(days[2], ("2026-11-04".to_string(), 150.0));
        assert!(days.iter().all(|(d, _)| d != "2026-11-02"));
    }
    #[test]
    fn course_without_grade_keeps_its_routine_and_overrides_win() {
        let mut data = grade_data();
        data["turmas"] = json!([]);
        assert_eq!(
            projections(&data).unwrap()["mat"]["rows"][0]["day"],
            "2026-10-23"
        );
        let mut data = grade_data();
        data["courses"][0]["weekOverrides"] =
            json!([{"weekStart":"2026-11-02","schedule":{"4":1}}]);
        let days = days_of(&projections(&data).unwrap()["mat"]);
        assert!(days.iter().any(|(d, _)| d == "2026-11-05"));
        assert!(days.iter().all(|(d, _)| d != "2026-11-04"));
    }
    #[test]
    fn grade_before_first_version_uses_course_routine() {
        let mut data = grade_data();
        data["turmas"][0]["versions"] = json!([{"validFrom":"2026-11-02","grid":{"3":["mat"]}}]);
        let r = &projections(&data).unwrap()["mat"];
        assert_eq!(r["rows"][0]["day"], "2026-10-23");
        assert_eq!(r["rows"][0]["minutes"], 450.0);
    }
    #[test]
    fn invalid_grade_date_is_a_course_issue() {
        let mut data = grade_data();
        data["turmas"][0]["versions"][0]["validFrom"] = json!("2026-02-30");
        let (f, issues) = projections_with_issues(&data).unwrap();
        assert!(f["mat"].is_null());
        assert!(issues["mat"].as_str().unwrap().contains("Data inválida"));
    }
}
