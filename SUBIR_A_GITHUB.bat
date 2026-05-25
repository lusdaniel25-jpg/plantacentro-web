@echo off
echo ========================================
echo   ACTUALIZANDO PLANTA CENTRO EN LA WEB
echo ========================================
echo.

:: Navegar a la carpeta de assets
cd app/src/main/assets

:: Preparar cambios
echo Preparando archivos...
git add .

:: Crear el mensaje con la fecha y hora actual
set mensaje=Actualizacion %date% %time%
echo Creando paquete: %mensaje%
git commit -m "%mensaje%"

:: Enviar a GitHub
echo Enviando a GitHub...
git push origin main

echo.
echo ========================================
echo   ¡LISTO! APP ACTUALIZADA EN LA WEB
echo ========================================
echo.
pause
