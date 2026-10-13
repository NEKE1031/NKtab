@echo off
setlocal
title 更新 NKtab 的桌面壁纸

set "SRC=%APPDATA%\Microsoft\Windows\Themes\WallpaperEngineOverride.jpg"
set "DST=%~dp0..\wallpapers\desktop.jpg"

echo.
echo   正在找 Wallpaper Engine 当前的壁纸...
echo.

if not exist "%SRC%" goto nofile

if not exist "%~dp0..\wallpapers" mkdir "%~dp0..\wallpapers"
copy /y "%SRC%" "%DST%" >nul
if errorlevel 1 goto failed

echo   [好了] 已经更新到：
echo          %DST%
echo.
echo   接着做这一步才会看到变化：
echo          1. 打开 edge://extensions，找到 NKtab，点一下那个转圈箭头
echo          2. 回到新标签页按 F5
echo.
pause
exit /b 0

:nofile
echo   [没找到] 这个文件不存在：
echo          %SRC%
echo.
echo   说明你现在没有在用 Wallpaper Engine 的动态壁纸。
echo   先打开 Wallpaper Engine 选一张壁纸、让它跑起来，再双击本文件。
echo.
pause
exit /b 1

:failed
echo   [失败] 复制不过去，可能是文件正被占用，或者没有权限。
echo   等几秒再试一次，或者右键本文件「以管理员身份运行」。
echo.
pause
exit /b 1

