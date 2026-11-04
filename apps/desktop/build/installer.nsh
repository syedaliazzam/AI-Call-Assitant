; File: apps/desktop/build/installer.nsh
; Purpose: Kite's uninstall step (Day 6 Stage 3): asks whether to keep the user's local Kite data
;          (sessions, transcripts, answers and settings in %APPDATA%\kite). "No", and a silent
;          uninstall (/S), remove it. The updater's cache (%LOCALAPPDATA%\kite-updater) is always
;          removed, so nothing of Kite is left behind.
; Used by: electron-builder.yml (nsis.include)
; Architecture: docs/architecture/kite-architecture-v3.1.md §10 (installation); ADR-0028

!macro customUnInstall
  ; During an update the old version is uninstalled first: never touch the data then.
  ${ifNot} ${isUpdated}
    ; The updater's download cache (a copy of the installer) is not user data: always remove it.
    ; The one cached file, then the folder if it is empty (a recursive delete here makes Windows
    ; Smart App Control block the build's installer stub; Day 6 Stage 3).
    Delete "$LOCALAPPDATA\kite-updater\installer.exe"
    RMDir "$LOCALAPPDATA\kite-updater"
    MessageBox MB_YESNO|MB_ICONQUESTION "Keep your Paramount AI data on this computer (sessions, transcripts and settings)?$\r$\n$\r$\nChoose No to remove everything." /SD IDNO IDYES kite_keep_data
      RMDir /r "$APPDATA\Kite"
    kite_keep_data:
  ${endIf}
!macroend
