@echo off
echo ========================================
echo   ACTUALIZANDO PLANTA CENTRO EN LA WEB
echo ========================================
echo.

:: URL con el usuario explícito para forzar el cambio de cuenta
set REPO_URL=https://lusdaniel25-jpg@github.com/lusdaniel25-jpg/plantacentro-web.git

:: Limpiar configuración de usuario local para evitar conflictos
git config user.name "lusdaniel25-jpg"
git config --local credential.username "lusdaniel25-jpg"

:: Asegurar que el remote use el usuario correcto
git remote set-url origin %REPO_URL%

:: Preparar archivos
echo Preparando archivos de assets...
git add app/src/main/assets/*

:: Crear el mensaje
set mensaje=Actualizacion %date% %time%
echo Creando paquete: %mensaje%
git commit -m "%mensaje%"

:: Enviar a GitHub
echo Enviando a GitHub como lusdaniel25-jpg...
echo (Si se abre una ventana, inicia sesion con tu cuenta nueva)
echo.
git push -u origin main --force

echo.
echo ========================================
echo   ¡LISTO! APP ACTUALIZADA EN LA WEB
echo ========================================
echo.
pause
