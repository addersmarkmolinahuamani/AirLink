@echo off
title AirLink Express - Transferencia Celular y Laptop
cd /d "%~dp0"
cls
echo ========================================================
echo         AirLink Express - Celular ^<---^> Laptop
echo ========================================================
echo.
echo  Iniciando servidor de transferencia y enlace seguro...
echo.
node server.js
pause
