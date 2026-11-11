; User records live outside $INSTDIR. Keep a separate, non-overwritten copy
; before updating the executable. Abort if preservation fails.
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
!macroend
