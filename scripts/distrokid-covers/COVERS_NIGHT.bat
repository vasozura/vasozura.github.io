@echo off
setlocal
rem Local Maestro/WanGP only. Waits for an idle GPU; leaves candidates unselected.
"D:\pinokio\api\Maestro.git\app\env-rtx50\Scripts\python.exe" "%~dp0dk_covers.py" --night >> "%~dp0covers_night.log" 2>&1
exit /b %errorlevel%
