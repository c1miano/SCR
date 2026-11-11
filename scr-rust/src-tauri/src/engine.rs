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
pub(crate) fn schedule<'a>(c: &'a V, d: NaiveDate) -> Result<&'a V, String> {
    let w = week(d);
    for item in array(&c["weekOverrides"]) {
        if text(&item["weekStart"]) == w.to_string() {
            return Ok(&item["schedule"]);
        }
    }
    if text(&c["scheduleMode"]) == "alternating" && !text(&c["weekAnchor"]).is_empty() {
        let offset = (w - week(date(text(&c["weekAnchor"]))?)).num_days() / 7;
        if offset.rem_euclid(2) == 1 {
            return Ok(&c["scheduleB"]);
        }
    }
    Ok(&c["schedule"])
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
}
