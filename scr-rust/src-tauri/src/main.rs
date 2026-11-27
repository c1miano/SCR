#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod engine;
mod grade;
mod pdf;
mod report;
mod storage_location;
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Manager, State};
struct Store {
    path: PathBuf,
    lock: Mutex<Option<Value>>,
}
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn empty() -> Value {
    json!({"version":4,"calendars":[],"courses":[],"professors":[]})
}
/// Dados prontos para a interface: marcações antigas convertidas
/// (`engine::migrate`) e previsões calculadas. A conversão é gravada no
/// próximo salvamento.
fn envelope(data: Value) -> Result<Value, String> {
    let data = engine::migrate(&data);
    let (forecasts, issues) = engine::projections_with_issues(&data)?;
    Ok(
        json!({"data":data,"forecasts":forecasts,"issues":issues,"test":cfg!(debug_assertions)&&std::env::var("SCR_TEST_DIR").is_ok()&&std::env::var("SCR_MANUAL").is_err()}),
    )
}
fn atomic(path: &Path, data: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or("Pasta inválida")?;
    fs::create_dir_all(parent).map_err(error)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(error)?;
    temp.write_all(&serde_json::to_vec_pretty(data).map_err(error)?)
        .map_err(error)?;
    temp.as_file().sync_all().map_err(error)?;
    if path.exists() {
        fs::copy(path, path.with_extension("backup.json")).map_err(error)?;
    }
    temp.persist(path).map_err(error)?;
    Ok(())
}
fn snapshot(path: &Path) -> Result<(), String> {
    if !path.try_exists().map_err(error)? {
        return Ok(());
    }
    let bytes = fs::read(path).map_err(error)?;
    let data: Value = serde_json::from_slice(&bytes).map_err(error)?;
    engine::projections(&data)?;
    let dir = path.with_file_name("backups");
    fs::create_dir_all(&dir).map_err(error)?;
    let mut file = tempfile::Builder::new()
        .prefix(&format!(
            "scr-{}-",
            chrono::Local::now().format("%Y%m%d-%H%M%S")
        ))
        .suffix(".json")
        .tempfile_in(&dir)
        .map_err(error)?;
    file.write_all(&bytes).map_err(error)?;
    file.as_file().sync_all().map_err(error)?;
    file.keep().map_err(error)?;
    // A limpeza nunca impede a gravação: uma falha apenas mantém cópias a mais.
    let _ = prune_backups(&dir, chrono::Local::now().naive_local());
    Ok(())
}
/// Retenção do histórico em `backups/`: mantém sempre as 20 cópias mais
/// recentes, todas as dos últimos 30 dias e, antes disso, a mais recente de
/// cada semana. Só considera arquivos `scr-AAAAMMDD-HHMMSS-*.json` criados
/// pelo SCR; qualquer outro arquivo da pasta é ignorado.
fn prune_backups(dir: &Path, now: chrono::NaiveDateTime) -> Result<usize, String> {
    use chrono::Datelike;
    let mut found: Vec<(chrono::NaiveDateTime, PathBuf)> = Vec::new();
    for entry in fs::read_dir(dir).map_err(error)? {
        let path = entry.map_err(error)?.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.starts_with("scr-") || !name.ends_with(".json") || name.len() < 19 {
            continue;
        }
        if let Ok(when) = chrono::NaiveDateTime::parse_from_str(&name[4..19], "%Y%m%d-%H%M%S") {
            found.push((when, path));
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    let limit = now - chrono::Duration::days(30);
    let mut weeks = std::collections::HashSet::new();
    let mut removed = 0;
    for (i, (when, path)) in found.iter().enumerate() {
        let week = when.date().iso_week();
        let first_of_week = weeks.insert((week.year(), week.week()));
        if i < 20 || *when >= limit || first_of_week {
            continue;
        }
        fs::remove_file(path).map_err(error)?;
        removed += 1;
    }
    Ok(removed)
}
fn save_checked(path: &Path, data: &Value, loaded: &mut Option<Value>) -> Result<Value, String> {
    let expected = loaded
        .as_ref()
        .ok_or("Os cadastros precisam ser carregados antes de salvar.")?;
    let current: Value = serde_json::from_slice(&fs::read(path).map_err(error)?).map_err(error)?;
    // A interface recebe os dados já convertidos; compara na mesma forma.
    if &engine::migrate(&current) != expected {
        return Err("O arquivo de dados mudou desde a abertura do SCR. Feche e reabra o aplicativo antes de salvar. Nenhum cadastro foi sobrescrito.".into());
    }
    let result = envelope(data.clone())?;
    snapshot(path)?;
    let receipt = path.with_file_name("migracao-concluida.json");
    if !receipt.try_exists().map_err(error)? {
        atomic(&receipt, &json!({"completed":true}))?;
    }
    atomic(path, data)?;
    *loaded = Some(data.clone());
    Ok(result)
}
fn load_path(path: &Path) -> Result<Value, String> {
    let legacy = path.with_file_name("importacao-electron.json");
    let receipt = path.with_file_name("migracao-concluida.json");
    let exists = path.try_exists().map_err(error)?;
    if !exists
        && (receipt.try_exists().map_err(error)?
            || path.with_file_name("backups").try_exists().map_err(error)?
            || path
                .with_extension("backup.json")
                .try_exists()
                .map_err(error)?)
    {
        return Err(format!("O arquivo {} não foi encontrado, mas há registros de uso anterior. A criação de um cadastro vazio foi bloqueada. Restaure o arquivo a partir de um backup",path.display()));
    }
    let current: Value = if exists {
        serde_json::from_slice(&fs::read(path).map_err(error)?).map_err(error)?
    } else {
        empty()
    };
    // Nunca substitui dados existentes ou um arquivo inválido por uma importação.
    let result = envelope(current.clone())?;
    let is_empty = ["courses", "calendars", "professors"]
        .iter()
        .all(|k| current[*k].as_array().is_some_and(|a| a.is_empty()));
    if is_empty && legacy.exists() && !receipt.exists() {
        let imported: Value =
            serde_json::from_slice(&fs::read(&legacy).map_err(error)?).map_err(error)?;
        let imported_result = envelope(imported.clone())?;
        atomic(path, &imported)?;
        atomic(&receipt, &json!({"completed":true}))?;
        return Ok(imported_result);
    }
    if !path.exists() {
        atomic(path, &current)?;
    }
    Ok(result)
}
#[tauri::command]
fn load_data(store: State<Store>) -> Result<Value, String> {
    let mut loaded = store.lock.lock().map_err(error)?;
    let mut result = load_path(&store.path)?;
    if loaded.is_none() {
        snapshot(&store.path)?;
    }
    *loaded = Some(result["data"].clone());
    result["storagePath"] = json!(store.path);
    Ok(result)
}
#[tauri::command]
fn save_data(data: Value, store: State<Store>) -> Result<Value, String> {
    let mut loaded = store.lock.lock().map_err(error)?;
    save_checked(&store.path, &data, &mut loaded)
}
#[tauri::command]
async fn export_backup(data: Value) -> Result<bool, String> {
    engine::projections(&data)?;
    let file = rfd::AsyncFileDialog::new()
        .set_title("Exportar backup do SCR")
        .set_file_name("scr-backup.json")
        .add_filter("Backup SCR", &["json"])
        .save_file()
        .await;
    let Some(file) = file else { return Ok(false) };
    fs::write(
        file.path(),
        serde_json::to_vec_pretty(&data).map_err(error)?,
    )
    .map_err(error)?;
    Ok(true)
}
#[tauri::command]
async fn import_backup() -> Result<Option<Value>, String> {
    let file = rfd::AsyncFileDialog::new()
        .set_title("Importar backup do SCR")
        .add_filter("Backup SCR", &["json"])
        .pick_file()
        .await;
    let Some(file) = file else { return Ok(None) };
    let data: Value =
        serde_json::from_slice(&fs::read(file.path()).map_err(error)?).map_err(error)?;
    engine::projections(&data)?;
    Ok(Some(engine::migrate(&data)))
}
#[tauri::command]
async fn export_csv(text: String) -> Result<bool, String> {
    let file = rfd::AsyncFileDialog::new()
        .set_file_name("calendario-disciplina.csv")
        .add_filter("CSV", &["csv"])
        .save_file()
        .await;
    let Some(file) = file else { return Ok(false) };
    fs::write(file.path(), text).map_err(error)?;
    Ok(true)
}
#[tauri::command]
async fn export_report(filter: report::Filter, store: State<'_, Store>) -> Result<bool, String> {
    let (bytes, name) = {
        let _guard = store.lock.lock().map_err(error)?;
        let data: Value =
            serde_json::from_slice(&fs::read(&store.path).map_err(error)?).map_err(error)?;
        (
            report::generate(&data, &filter)?,
            report::filename(&data, &filter, chrono::Local::now().date_naive()),
        )
    };
    let file = rfd::AsyncFileDialog::new()
        .set_title("Salvar relatório de registros")
        .set_file_name(name)
        .add_filter("Documento PDF", &["pdf"])
        .save_file()
        .await;
    let Some(file) = file else { return Ok(false) };
    fs::write(file.path(), bytes).map_err(error)?;
    Ok(true)
}
#[tauri::command]
async fn export_grade(
    turma_id: String,
    version_id: String,
    store: State<'_, Store>,
) -> Result<bool, String> {
    let (bytes, name) = {
        let _guard = store.lock.lock().map_err(error)?;
        let data: Value =
            serde_json::from_slice(&fs::read(&store.path).map_err(error)?).map_err(error)?;
        let today = chrono::Local::now().date_naive();
        (
            grade::generate(&data, &turma_id, &version_id, today)?,
            grade::filename(&data, &turma_id, &version_id, today),
        )
    };
    let file = rfd::AsyncFileDialog::new()
        .set_title("Salvar grade da turma")
        .set_file_name(name)
        .add_filter("Documento PDF", &["pdf"])
        .save_file()
        .await;
    let Some(file) = file else { return Ok(false) };
    fs::write(file.path(), bytes).map_err(error)?;
    Ok(true)
}
#[tauri::command]
fn test_report(result: Value, store: State<Store>, app: tauri::AppHandle) -> Result<(), String> {
    if !cfg!(debug_assertions) || std::env::var("SCR_TEST_DIR").is_err() {
        return Err("Indisponível".into());
    }
    fs::write(
        store.path.with_file_name("result.json"),
        serde_json::to_vec_pretty(&result).map_err(error)?,
    )
    .map_err(error)?;
    app.exit(if result["ok"] == true { 0 } else { 1 });
    Ok(())
}
#[tauri::command]
fn ui_diagnostic(message: String, store: State<Store>) -> Result<(), String> {
    use std::fs::OpenOptions;
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(store.path.with_file_name("interface.log"))
        .map_err(error)?;
    writeln!(f, "{}", message).map_err(error)
}
fn main() {
    if let Some(file) = std::env::args()
        .nth(1)
        .filter(|s| s == "--report-fixture")
        .and_then(|_| std::env::args().nth(2))
    {
        let run = || -> Result<(), String> {
            let input: Value =
                serde_json::from_slice(&fs::read(&file).map_err(error)?).map_err(error)?;
            let filter = serde_json::from_value(input["filter"].clone()).map_err(error)?;
            fs::write(
                format!("{file}.pdf"),
                report::generate(&input["data"], &filter)?,
            )
            .map_err(error)
        };
        if let Err(e) = run() {
            eprintln!("{e}");
            std::process::exit(1)
        }
        return;
    }
    if let Some(file) = std::env::args()
        .nth(1)
        .filter(|s| s == "--grade-fixture")
        .and_then(|_| std::env::args().nth(2))
    {
        let run = || -> Result<(), String> {
            let input: Value =
                serde_json::from_slice(&fs::read(&file).map_err(error)?).map_err(error)?;
            let issued = chrono::NaiveDate::parse_from_str(
                input["issued"].as_str().unwrap_or(""),
                "%Y-%m-%d",
            )
            .map_err(error)?;
            fs::write(
                format!("{file}.pdf"),
                grade::generate(
                    &input["data"],
                    input["turmaId"].as_str().unwrap_or(""),
                    input["versionId"].as_str().unwrap_or(""),
                    issued,
                )?,
            )
            .map_err(error)
        };
        if let Err(e) = run() {
            eprintln!("{e}");
            std::process::exit(1)
        }
        return;
    }
    // Permite comparar o núcleo Rust com as mesmas entradas da versão anterior sem abrir janela.
    if let Some(file) = std::env::args()
        .nth(1)
        .filter(|s| s == "--verify")
        .and_then(|_| std::env::args().nth(2))
    {
        let run = || -> Result<(), String> {
            let cases: Vec<Value> =
                serde_json::from_slice(&fs::read(&file).map_err(error)?).map_err(error)?;
            let results: Result<Vec<_>, _> = cases
                .iter()
                // Data de referência opcional (3º argumento); sem ela, nenhuma aula
                // conta como realizada. Os resultados da versão Electron
                // (verification.expected.json) seguem a regra antiga de aulas ministradas.
                .map(|c| {
                    let today = std::env::args()
                        .nth(3)
                        .and_then(|d| chrono::NaiveDate::parse_from_str(&d, "%Y-%m-%d").ok())
                        .unwrap_or(chrono::NaiveDate::MIN);
                    engine::forecast(&c["course"], &c["calendar"], today)
                })
                .collect();
            fs::write(
                format!("{file}.results.json"),
                serde_json::to_vec(&results?).map_err(error)?,
            )
            .map_err(error)
        };
        if let Err(e) = run() {
            eprintln!("{e}");
            std::process::exit(1)
        }
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            let path = if cfg!(debug_assertions) && std::env::var_os("SCR_TEST_DIR").is_some() {
                PathBuf::from(std::env::var_os("SCR_TEST_DIR").unwrap())
            } else {
                {
                    let target = app.path().document_dir()?.join("SCR");
                    storage_location::migrate(
                        &target.join("dados.json"),
                        &storage_location::candidates(
                            &app.path().config_dir()?,
                            &app.path().local_data_dir()?,
                        )?,
                    )?;
                    target
                }
            };
            fs::create_dir_all(&path)?;
            let path = path.join("dados.json");
            use std::fs::OpenOptions;
            let mut log = OpenOptions::new()
                .create(true)
                .append(true)
                .open(path.with_file_name("interface.log"))?;
            writeln!(
                log,
                "{} SCR {} executable={} data={}",
                chrono::Utc::now(),
                env!("CARGO_PKG_VERSION"),
                std::env::current_exe()?.display(),
                path.display()
            )?;
            app.manage(Store {
                path,
                lock: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            export_backup,
            import_backup,
            export_csv,
            export_report,
            export_grade,
            test_report,
            ui_diagnostic
        ])
        .run(tauri::generate_context!())
        .expect("Não foi possível abrir o SCR");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn save_backup_and_read() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("dados.json");
        atomic(&p, &empty()).unwrap();
        let mut second = empty();
        second["note"] = json!("preservado");
        atomic(&p, &second).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(&p).unwrap()).unwrap(),
            second
        );
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(p.with_extension("backup.json")).unwrap())
                .unwrap(),
            empty()
        );
    }
}

#[cfg(test)]
mod migration_tests {
    use super::*;
    fn fixture() -> Value {
        json!({"version":4,"courses":[],"professors":[],"calendars":[{"id":"cal","name":"Semestre","start":"2026-01-01","end":"2026-06-30","entries":[]}]})
    }
    #[test]
    fn imports_over_empty_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("dados.json");
        atomic(&p, &empty()).unwrap();
        atomic(&p.with_file_name("importacao-electron.json"), &fixture()).unwrap();
        assert_eq!(load_path(&p).unwrap()["data"], fixture());
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(p.with_extension("backup.json")).unwrap())
                .unwrap(),
            empty()
        );
    }
    #[test]
    fn preserves_existing_data() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("dados.json");
        atomic(&p, &fixture()).unwrap();
        atomic(&p.with_file_name("importacao-electron.json"), &empty()).unwrap();
        assert_eq!(load_path(&p).unwrap()["data"], fixture());
    }
    #[test]
    fn does_not_repeat_completed_migration() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("dados.json");
        atomic(&p.with_file_name("importacao-electron.json"), &fixture()).unwrap();
        load_path(&p).unwrap();
        atomic(&p, &empty()).unwrap();
        assert_eq!(load_path(&p).unwrap()["data"], empty());
    }
    #[test]
    fn invalid_data_is_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("dados.json");
        fs::write(&p, b"invalid").unwrap();
        atomic(&p.with_file_name("importacao-electron.json"), &fixture()).unwrap();
        assert!(load_path(&p).is_err());
        assert_eq!(fs::read(&p).unwrap(), b"invalid");
    }
    #[test]
    fn missing_data_after_migration_is_not_recreated() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("dados.json");
        atomic(
            &p.with_file_name("migracao-concluida.json"),
            &json!({"completed":true}),
        )
        .unwrap();
        assert!(load_path(&p).is_err());
        assert!(!p.exists());
    }
    #[test]
    fn stale_window_cannot_overwrite_restored_records() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("dados.json");
        atomic(&p, &empty()).unwrap();
        let mut loaded = Some(empty());
        atomic(&p, &fixture()).unwrap();
        assert!(save_checked(&p, &empty(), &mut loaded).is_err());
        assert_eq!(load_path(&p).unwrap()["data"], fixture());
    }
    #[test]
    fn save_requires_successful_load() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("dados.json");
        atomic(&p, &fixture()).unwrap();
        assert!(save_checked(&p, &empty(), &mut None).is_err());
    }
    #[test]
    fn saves_keep_all_previous_versions() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("dados.json");
        atomic(&p, &fixture()).unwrap();
        let mut loaded = Some(fixture());
        save_checked(&p, &empty(), &mut loaded).unwrap();
        save_checked(&p, &fixture(), &mut loaded).unwrap();
        let history: Vec<Value> = fs::read_dir(p.with_file_name("backups"))
            .unwrap()
            .map(|f| serde_json::from_slice(&fs::read(f.unwrap().path()).unwrap()).unwrap())
            .collect();
        assert_eq!(history.len(), 2);
        assert!(history.contains(&fixture()));
        assert!(history.contains(&empty()));
    }
    #[test]
    fn upgrade_preserves_twelve_courses_and_lesson_records() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("dados.json");
        let mut data = fixture();
        data["courses"]=json!((0..12).map(|n|json!({"id":format!("course-{n}"),"completedLessons":[{"day":"2026-01-01","minutes":50}]})).collect::<Vec<_>>());
        atomic(&p, &data).unwrap();
        atomic(
            &p.with_file_name("migracao-concluida.json"),
            &json!({"completed":true}),
        )
        .unwrap();
        let before = fs::read(&p).unwrap();
        for _ in 0..3 {
            assert_eq!(load_path(&p).unwrap()["data"], engine::migrate(&data));
            snapshot(&p).unwrap();
        }
        assert_eq!(fs::read(&p).unwrap(), before);
    }
    #[test]
    fn backup_retention_keeps_recent_and_one_per_week() {
        let dir = tempfile::tempdir().unwrap();
        let now = chrono::NaiveDate::from_ymd_opt(2026, 11, 11)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap();
        // 120 cópias, uma por dia, e um arquivo alheio que nunca deve ser apagado.
        for d in 0..120 {
            let when = now - chrono::Duration::days(d);
            fs::write(
                dir.path()
                    .join(format!("scr-{}-x.json", when.format("%Y%m%d-%H%M%S"))),
                b"{}",
            )
            .unwrap();
        }
        fs::write(dir.path().join("manual.json"), b"{}").unwrap();
        let removed = prune_backups(dir.path(), now).unwrap();
        let left: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|f| f.unwrap().file_name().into_string().unwrap())
            .collect();
        assert!(removed > 0);
        assert!(left.contains(&"manual.json".to_string()));
        let newest = format!("scr-{}-x.json", now.format("%Y%m%d-%H%M%S"));
        assert!(left.contains(&newest));
        // 31 dias recentes + ~13 semanas anteriores + o arquivo manual.
        assert!(left.len() >= 32 && left.len() <= 50, "{}", left.len());
        // Segunda execução não remove mais nada.
        assert_eq!(prune_backups(dir.path(), now).unwrap(), 0);
    }
}
