@echo off
setlocal enabledelayedexpansion
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo ============================================
echo  Add tools to USER PATH
echo  Root: %ROOT%
echo ============================================
echo.

for /f "tokens=2,*" %%a in ('reg query HKCU\Environment /v Path 2^>nul ^| findstr /i "Path"') do set "OLDPATH=%%b"
if not defined OLDPATH set "OLDPATH="
set "NEWPATH=!OLDPATH!"
set "ADDED=0"

call :ADD "%ROOT%\7zip"
call :ADD "%ROOT%\node"
call :ADD "%ROOT%\node\node_modules\npm\bin"
call :ADD "%ROOT%\python"
call :ADD "%ROOT%\python\Scripts"
call :ADD "%ROOT%\git\cmd"
call :ADD "%ROOT%\git\bin"
call :ADD "%ROOT%\ffmpeg\bin"
call :ADD "%ROOT%\platform-tools"
call :ADD "%ROOT%\pwsh"
call :ADD "%ROOT%\uv"
call :ADD "%ROOT%\chrome"
call :ADD "%ROOT%\jdk-21\bin"
call :ADD "%ROOT%\ghidra_12.1.4_PUBLIC"

echo.
if "!NEWPATH!"=="!OLDPATH!" (
    echo [skip] PATH unchanged
    goto :done
)
reg add HKCU\Environment /v Path /t REG_EXPAND_SZ /d "!NEWPATH!" /f >nul
if errorlevel 1 (
    echo [fail] cannot write registry
    goto :done
)
echo [ok] PATH updated, added !ADDED! directories
powershell -NoProfile -Command "Add-Type -Namespace W -Name N -MemberDefinition '[DllImport(\"user32.dll\",SetLastError=true,CharSet=CharSet.Auto)]public static extern IntPtr SendMessageTimeout(IntPtr a,uint b,UIntPtr c,string d,uint e,uint f,out UIntPtr g);'; $r=[UIntPtr]::Zero; [W.N]::SendMessageTimeout([IntPtr]0xffff,0x1A,[UIntPtr]::Zero,'Environment',2,3000,[ref]$r) | Out-Null" >nul 2>&1
echo [info] open a NEW terminal to take effect

:done
echo.
echo Current USER PATH:
powershell -NoProfile -Command "([Environment]::GetEnvironmentVariable('Path','User') -split ';' | Where-Object { $_ }) | ForEach-Object { '  ' + $_ }"
echo.
pause
exit /b 0

:ADD
set "P=%~1"
if not exist "%P%" goto :eof
echo ;!NEWPATH!; | findstr /i /c:";!P!;" >nul
if not errorlevel 1 (
    echo   [have] %P%
    goto :eof
)
if "!NEWPATH!"=="" ( set "NEWPATH=!P!" ) else ( set "NEWPATH=!NEWPATH!;!P!" )
set /a ADDED+=1
echo   [add ] %P%
goto :eof
