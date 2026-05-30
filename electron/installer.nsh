; Sets the tooltip/description on the desktop and start-menu shortcuts
; so hovering the Based icon shows a meaningful description instead of the file path.
!macro customInstall
  ; Desktop shortcut
  Delete "$DESKTOP\Based.lnk"
  CreateShortCut "$DESKTOP\Based.lnk" "$INSTDIR\Based.exe" "" "$INSTDIR\Based.exe" 0 SW_SHOWNORMAL "" "Based — your AI companion. Always on top, always ready."
  ; Start menu shortcut
  Delete "$SMPROGRAMS\Based\Based.lnk"
  CreateShortCut "$SMPROGRAMS\Based\Based.lnk" "$INSTDIR\Based.exe" "" "$INSTDIR\Based.exe" 0 SW_SHOWNORMAL "" "Based — your AI companion. Always on top, always ready."
!macroend
