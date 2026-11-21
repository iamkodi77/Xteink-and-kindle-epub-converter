@echo off
rem Xteink & Kindle EPUB Converter — easy launcher (Windows)
rem Creates a virtual environment, installs dependencies, starts the web app.
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
    echo Creating virtual environment (.venv)...
    python -m venv .venv
    if errorlevel 1 (
        echo Could not create .venv with "python". Try: py -m venv .venv
        pause
        exit /b 1
    )
)

call .venv\Scripts\activate.bat

echo Installing dependencies...
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -r requirements.txt

if "%PORT%"=="" set PORT=5000
echo.
echo Starting EPUB converter at http://localhost:%PORT%
echo Press Ctrl+C to stop.
echo.
python app.py
pause
