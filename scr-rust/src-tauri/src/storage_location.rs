use std::{fs,path::{Path,PathBuf},io::Write};
use serde_json::{Value,json};
use crate::{engine,error};

// Documents is not subject to packaged-app AppData virtualization. Never
// derive the production store from the executable, version or package identity.
pub fn migrate(target:&Path,candidates:&[PathBuf])->Result<(),String>{
 if target.try_exists().map_err(error)? {return Ok(())}
 let mut valid=Vec::new();let mut invalid=false;
 for source in candidates {
  if !source.try_exists().map_err(error)? {continue}
  let bytes=fs::read(source).map_err(error)?;
  let parsed=serde_json::from_slice::<Value>(&bytes).ok().filter(|d|engine::projections(d).is_ok());
  if let Some(data)=parsed {let populated=["courses","calendars","professors"].iter().any(|k|data[*k].as_array().is_some_and(|a|!a.is_empty()));valid.push((populated,fs::metadata(source).map_err(error)?.modified().map_err(error)?,source,bytes));}else{invalid=true}
 }
 valid.sort_by(|a,b|b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
 if let Some((_,_,source,bytes))=valid.first(){
  let parent=target.parent().ok_or("Pasta inválida")?;fs::create_dir_all(parent).map_err(error)?;
  let archive=parent.join("originais-migracao");fs::create_dir_all(&archive).map_err(error)?;
  for(i,(_,_,_,copy))in valid.iter().enumerate(){let mut file=fs::OpenOptions::new().create_new(true).write(true).open(archive.join(format!("origem-{}-{i}.json",chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()))).map_err(error)?;file.write_all(copy).map_err(error)?;file.sync_all().map_err(error)?;}
  let mut temp=tempfile::NamedTempFile::new_in(parent).map_err(error)?;temp.write_all(bytes).map_err(error)?;temp.as_file().sync_all().map_err(error)?;temp.persist_noclobber(target).map_err(error)?;
  fs::write(parent.join("origem-dados.json"),serde_json::to_vec_pretty(&json!({"source":source,"destination":target,"migratedAt":chrono::Utc::now().to_rfc3339()})).map_err(error)?).map_err(error)?;
 }else if invalid{return Err("Há dados antigos inválidos. A criação de uma base vazia foi bloqueada.".into())}
 Ok(())
}
pub fn candidates(roaming:&Path,local:&Path)->Result<Vec<PathBuf>,String>{
 let mut paths=vec![roaming.join("SCR/dados.json")];
 let packages=local.join("Packages");
 if packages.try_exists().map_err(error)? {for entry in fs::read_dir(packages).map_err(error)?{let entry=entry.map_err(error)?;let p=entry.path().join("LocalCache/Roaming/SCR/dados.json");if p.is_file(){paths.push(p);}}}
 Ok(paths)
}
#[cfg(test)]mod tests{use super::*;
 #[test]fn chooses_nonempty_virtualized_records_and_never_overwrites_target(){let dir=tempfile::tempdir().unwrap();let native=dir.path().join("native.json");let virtualized=dir.path().join("virtual.json");let target=dir.path().join("Documents/SCR/dados.json");let empty=json!({"version":4,"courses":[],"calendars":[],"professors":[]});let mut data=empty.clone();data["professors"]=json!([{"id":"p","name":"Preservado"}]);fs::write(&native,serde_json::to_vec(&empty).unwrap()).unwrap();let bytes=serde_json::to_vec(&data).unwrap();fs::write(&virtualized,&bytes).unwrap();migrate(&target,&[native.clone(),virtualized]).unwrap();assert_eq!(fs::read(&target).unwrap(),bytes);migrate(&target,&[native]).unwrap();assert_eq!(fs::read(target).unwrap(),bytes);}
}
