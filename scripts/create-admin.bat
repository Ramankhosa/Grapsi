@echo off
REM Windows batch file to create Super Admin
REM Usage: create-admin.bat [email] [password] [name]

node "%~dp0create-super-admin.js" %1 %2 %3
pause
