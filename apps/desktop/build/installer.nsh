; File: apps/desktop/build/installer.nsh
; Purpose: Recreates a missing Start Menu shortcut (1.5.1, ADR-0069) and a missing Desktop shortcut (1.7.4)
;          at every install and update.
;          Registers the paramountai:// link at install (v1.2.0, spec S9), so it works before the app's
;          first start. Kite's uninstall step (Day 6 Stage 3): removes that link and asks whether to keep
;          the user's local data (sessions, transcripts, answers and settings in %APPDATA%\Kite, the
;          folder src/main.ts pins). "No", and a silent uninstall (/S), remove it. The updater's cache
;          (%LOCALAPPDATA%\kite-updater) is always removed, so nothing of the app is left behind.
; Used by: electron-builder.yml (nsis.include)
; Architecture: docs/architecture/kite-architecture-v3.1.md §10 (installation); ADR-0028

!macro customInstall
  ; 1.5.1 (ADR-0069): the Start Menu shortcut, whenever it is missing. electron-builder's update path keeps
  ; an existing shortcut but never recreates one that has gone (its keep-shortcuts rule), so once lost it
  ; stayed lost and Windows search could not find the app (seen on 11 Nov 2026; checked on a Windows
  ; runner). This runs after electron-builder's own shortcut step, on fresh installs and updates alike.
  ${IfNot} ${FileExists} "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${EndIf}
  ; 1.7.4: the Desktop shortcut, the same way. electron-builder creates it on a fresh install
  ; (createDesktopShortcut: true) but on an update keeps only one that is still there, so an update from
  ; 1.7.3 or earlier (which had none) would never add it. Skipped when the installer was run with
  ; --no-desktop-shortcut (electron-builder's own switch, isNoDesktopShortcut).
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    ${IfNot} ${isNoDesktopShortcut}
    ${AndIfNot} ${FileExists} "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      ; Tells Explorer the Desktop changed, so the icon shows without a refresh.
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${EndIf}
  !endif
  WriteRegStr SHCTX "Software\Classes\paramountai" "" "URL:Paramount AI"
  WriteRegStr SHCTX "Software\Classes\paramountai" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\paramountai\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHCTX "Software\Classes\paramountai\shell\open\command" "" '"$appExe" "%1"'
!macroend

!macro customUnInstall
  ; During an update the old version is uninstalled first: never touch the data then.
  ${ifNot} ${isUpdated}
    DeleteRegKey SHCTX "Software\Classes\paramountai"
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
