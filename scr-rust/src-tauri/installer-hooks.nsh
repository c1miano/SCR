; Os cadastros ficam fora de $INSTDIR (Documentos\SCR). Antes de atualizar o
; executável, guarda uma cópia exclusiva; cancela a atualização se falhar.
;
; A versão anterior do SCR Rust é substituída pela própria página de
; reinstalação do Tauri (opção padrão "desinstalar antes de instalar"). Esse
; desinstalador só pode apagar %APPDATA%\br.com.scr.rust e
; %LOCALAPPDATA%\br.com.scr.rust (perfil do WebView); nunca Documentos\SCR.
!macro NSIS_HOOK_PREINSTALL
  IfFileExists "$DOCUMENTS\SCR\dados.json" 0 scr_backup_done
  CreateDirectory "$DOCUMENTS\SCR\backups-atualizacao"
  ClearErrors
  GetTempFileName $0 "$DOCUMENTS\SCR\backups-atualizacao"
  IfErrors scr_backup_failed
  CopyFiles /SILENT "$DOCUMENTS\SCR\dados.json" "$0"
  IfErrors scr_backup_failed
  Rename "$0" "$0.json"
  IfErrors scr_backup_failed
  Goto scr_backup_done
  scr_backup_failed:
    MessageBox MB_OK|MB_ICONSTOP "Não foi possível preservar uma cópia dos cadastros. A atualização foi cancelada."
    Abort
  scr_backup_done:
  !insertmacro SCR_REMOVE_ELECTRON
!macroend

; Remove a versão antiga em Electron ("SCR 1.6.x", appId br.com.semestre.desktop),
; somente com confirmação. Antes, copia o perfil dela (%APPDATA%\Semestre) para
; Documentos\SCR\backups-atualizacao\perfil-electron. O desinstalador do Electron
; foi gerado com deleteAppDataOnUninstall=false, então o perfil original também
; permanece. Em instalação silenciosa a resposta padrão é "Não".
!define SCR_ELECTRON_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\c1285db7-11e2-5e39-8e1b-3d15478d6563"
!macro SCR_REMOVE_ELECTRON
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8

  ReadRegStr $1 HKCU "${SCR_ELECTRON_KEY}" "UninstallString"
  StrCmp $1 "" scr_electron_done
  ReadRegStr $2 HKCU "${SCR_ELECTRON_KEY}" "DisplayName"
  StrCpy $3 $2 4
  StrCmp $3 "SCR " 0 scr_electron_done

  ; UninstallString = "C:\...\Uninstall SCR.exe" /currentuser -> extrai o caminho entre aspas.
  StrCpy $3 $1 1
  StrCmp $3 '"' 0 scr_electron_done
  StrCpy $4 1
  scr_electron_scan:
    StrCpy $3 $1 1 $4
    StrCmp $3 "" scr_electron_done
    StrCmp $3 '"' scr_electron_found
    IntOp $4 $4 + 1
    Goto scr_electron_scan
  scr_electron_found:
  IntOp $5 $4 - 1
  StrCpy $6 $1 $5 1
  IfFileExists "$6" 0 scr_electron_done
  ${GetParent} "$6" $7

  MessageBox MB_YESNO|MB_ICONQUESTION "Foi encontrada a versão antiga $2.$\r$\n$\r$\nDeseja removê-la agora? Seus cadastros não são apagados: o SCR usa a pasta Documentos\SCR, e o perfil da versão antiga é copiado para Documentos\SCR\backups-atualizacao\perfil-electron antes da remoção." /SD IDNO IDYES scr_electron_backup
  Goto scr_electron_done

  scr_electron_backup:
  IfFileExists "$APPDATA\Semestre\*.*" 0 scr_electron_uninstall
  CreateDirectory "$DOCUMENTS\SCR\backups-atualizacao\perfil-electron"
  ClearErrors
  CopyFiles /SILENT "$APPDATA\Semestre\*.*" "$DOCUMENTS\SCR\backups-atualizacao\perfil-electron"
  IfErrors 0 scr_electron_uninstall
    MessageBox MB_OK|MB_ICONEXCLAMATION "Não foi possível copiar o perfil da versão antiga. Ela não será removida agora; você pode desinstalá-la depois em Configurações > Aplicativos."
    Goto scr_electron_done

  scr_electron_uninstall:
  ; _?= executa o desinstalador no lugar (sem cópia temporária), para aguardar o término.
  ExecWait '"$6" /currentuser /S _?=$7' $8
  ReadRegStr $3 HKCU "${SCR_ELECTRON_KEY}" "UninstallString"
  StrCmp $3 "" 0 scr_electron_failed
  Delete "$6"
  RMDir "$7"
  ${GetParent} "$7" $3
  RMDir "$3"
  Goto scr_electron_done
  scr_electron_failed:
    MessageBox MB_OK|MB_ICONEXCLAMATION "A versão antiga não pôde ser removida automaticamente (código $8). A instalação do SCR continua; remova a versão antiga depois em Configurações > Aplicativos."

  scr_electron_done:
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
!macroend
