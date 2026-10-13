#!/usr/bin/env python3
"""Builds skins/ezpayouts-chart-skins.zip (the download on ezpayouts.xyz/skins/)
from the extension/ folder. Run it after changing the extension:

    python3 tools/build-extension-zip.py

With --store it builds dist/ezpayouts-chart-skins-store.zip instead, the one
to upload to the Chrome Web Store: the same extension without the video
skins (clips from films and shows) and without the README.

Files sit at the top of the zip (no wrapper folder), so Windows "Extract All"
and a Mac double-click both give one folder with manifest.json right inside.
Timestamps are fixed, so an unchanged extension builds a byte-identical zip.
"""
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "extension")
STORE = "--store" in sys.argv
OUT = os.path.join(ROOT, "dist", "ezpayouts-chart-skins-store.zip") if STORE else os.path.join(ROOT, "skins", "ezpayouts-chart-skins.zip")
os.makedirs(os.path.dirname(OUT), exist_ok=True)


def contents(path):
    with open(path, "rb") as f:
        data = f.read()
    if STORE and path.endswith(os.path.join("shared", "skins.js")):
        text, n = re.subn(r"// store-build: videos start\n.*?// store-build: videos end\n",
                          "var VIDEOS = [];\n", data.decode("utf-8"), flags=re.S)
        if n != 1:
            sys.exit("store build: couldn't find the video list markers in shared/skins.js")
        data = text.encode("utf-8")
    return data


paths = []
for folder, dirs, files in os.walk(SRC):
    dirs.sort()
    for name in sorted(files):
        if name.startswith(".") or name.endswith("~"):
            continue
        if STORE and name == "README.md":
            continue
        paths.append(os.path.join(folder, name))

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for path in paths:
        info = zipfile.ZipInfo(os.path.relpath(path, SRC).replace(os.sep, "/"), date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        z.writestr(info, contents(path))

print("wrote %s (%d files, %d KB)" % (os.path.relpath(OUT, ROOT), len(paths), os.path.getsize(OUT) // 1024))
