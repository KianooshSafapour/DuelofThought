#!/usr/bin/env python3
"""
make-native-packages.py — builds the native "build kits" served by /api/releases.

Each kit is a ready-to-build wrapper project around the deployed web platform:

  DuelOfThought-Windows-kit.zip  -> Electron + electron-builder  -> build.bat -> NSIS installer .exe
  DuelOfThought-Linux-kit.zip    -> Electron + electron-builder  -> build.sh  -> AppImage / deb
  DuelOfThought-Android-kit.zip  -> Capacitor                    -> Android Studio / gradle -> .apk

The wrappers load the platform URL configured in config.json (or PLATFORM_URL
env) so the same builds work for local dev, LAN, or the deployed host.
"""
import json
import os
import zipfile

OUT = os.path.join(os.path.dirname(__file__), '..', 'releases', 'native')
os.makedirs(OUT, exist_ok=True)

ELECTRON_MAIN = r"""const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const URL = process.env.PLATFORM_URL || CONFIG.url;

function createWindow () {
  const win = new BrowserWindow({
    width: 1360, height: 900,
    minWidth: 360, minHeight: 480,
    backgroundColor: '#09011b',
    autoHideMenuBar: true,
    title: CONFIG.title,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(URL);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
"""

ELECTRON_PKG = {
    "name": "duel-of-thought",
    "version": "0.3.0",
    "description": "Duel of Thought — Thoughtkeepers of Tomorrow's East (developed by Farenheit Studios)",
    "main": "main.js",
    "scripts": {
        "start": "electron .",
        "dist": "electron-builder",
    },
    "devDependencies": {"electron": "^31.0.0", "electron-builder": "^24.13.3"},
    "build": {
        "appId": "east.tomorrow.thoughtkeepers.duel",
        "productName": "Duel of Thought",
        "files": ["main.js", "config.json", "icon.png"],
    },
}

BUILD_BAT = r"""@echo off
REM Duel of Thought - Windows build (output: dist/Duel of Thought Setup .exe)
echo [1/3] Installing dependencies (one-time)...
call npm install
echo [2/3] Building installer...
call npm run dist -- --win nsis
echo [3/3] Done. See the dist\ folder.
pause
"""

BUILD_SH = r"""#!/usr/bin/env bash
# Duel of Thought - Linux build (output: dist/*.AppImage + *.deb)
set -e
echo "[1/3] Installing dependencies (one-time)..."
npm install
echo "[2/3] Building packages..."
npm run dist -- --linux AppImage deb
echo "[3/3] Done. See the dist/ folder."
"""

CAPACITOR_JSON = {
    "appId": "east.tomorrow.thoughtkeepers.duel",
    "appName": "Duel of Thought",
    "webDir": "www",
    "server": {"url": "REPLACE_WITH_PLATFORM_URL", "cleartext": True},
    "android": {"allowMixedContent": True},
}

ANDROID_README = r"""# Duel of Thought - Android Kit (Capacitor)

## One-time setup
1. Install Android Studio + JDK 17.
2. Edit capacitor.config.json -> set server.url to the platform URL.
3. npm install && npm run build:project   (creates the native android project)

## Build the APK
    npx cap open android      # Android Studio -> Build > Build APK
    # or headless:
    cd android && ./gradlew assembleDebug
    # APK: android/app/build/outputs/apk/debug/app-debug.apk

Release APK: ./gradlew assembleRelease (configure signing in build.gradle).
"""

WIN_README = """# Duel of Thought - Windows Kit

1. (Optional) edit config.json -> url (defaults to the deployed platform).
2. Double-click build.bat (needs Node.js 18+).
3. Output: dist/Duel of Thought Setup 0.3.0.exe - installable, shortcuts + uninstaller.
"""

LIN_README = """# Duel of Thought - Linux Kit

1. (Optional) edit config.json -> url.
2. bash build.sh   (needs Node.js 18+).
3. Output: dist/*.AppImage (portable) and dist/*.deb (installable).
"""

ICON_1PX = bytes.fromhex(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
    '0000000d4944415478da63fccf00f603000303010067f80f460000000049454e44ae426082'
)


def write_zip(dest, entries):
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in entries:
            if isinstance(data, (dict, list)):
                data = json.dumps(data, indent=2)
            if isinstance(data, str):
                data = data.encode('utf-8')
            z.writestr(name, data)


def main():
    common = [('icon.png', ICON_1PX), ('config.json', {"url": "http://localhost:3000", "title": "Duel of Thought"})]

    write_zip(os.path.join(OUT, 'DuelOfThought-Windows-kit.zip'), [
        ('main.js', ELECTRON_MAIN), ('package.json', ELECTRON_PKG),
        ('build.bat', BUILD_BAT), ('README.txt', WIN_README), *common,
    ])
    write_zip(os.path.join(OUT, 'DuelOfThought-Linux-kit.zip'), [
        ('main.js', ELECTRON_MAIN), ('package.json', ELECTRON_PKG),
        ('build.sh', BUILD_SH), ('README.txt', LIN_README), *common,
    ])
    write_zip(os.path.join(OUT, 'DuelOfThought-Android-kit.zip'), [
        ('capacitor.config.json', CAPACITOR_JSON),
        ('package.json', {
            "name": "duel-of-thought-android", "version": "0.3.0", "private": True,
            "scripts": {"build:project": "npx cap add android && npx cap sync android"},
            "devDependencies": {"@capacitor/cli": "^6.0.0", "@capacitor/core": "^6.0.0", "@capacitor/android": "^6.0.0"},
        }),
        ('www/index.html', '<!doctype html><meta http-equiv="refresh" content="0;url=REPLACE_WITH_PLATFORM_URL">'),
        ('README.txt', ANDROID_README), ('icon.png', ICON_1PX),
    ])

    for f in sorted(os.listdir(OUT)):
        p = os.path.join(OUT, f)
        print(f, os.path.getsize(p), 'bytes')


if __name__ == '__main__':
    main()
