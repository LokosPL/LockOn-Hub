!include "LogicLib.nsh"

; Każdy instalator uruchomiony przez electron-updater dostaje flagę --updated.
; Wymuszamy tryb cichy także wtedy, gdy starsza wersja aplikacji uruchomiła
; instalator bez /S. Ręczne uruchomienie instalatora nadal pokazuje normalny kreator.
!macro customInit
  ${StdUtils.TestParameter} $R0 "updated"
  ${If} $R0 == "true"
    SetSilent silent
  ${EndIf}
!macroend
