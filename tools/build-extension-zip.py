#!/usr/bin/env python3
"""Builds skins/ezpayouts-chart-skins.zip (the download on ezpayouts.xyz/skins/)
from the extension/ folder. Run it after changing the extension:

    python3 tools/build-extension-zip.py

Files sit at the top of the zip (no wrapper folder), so Windows "Extract All"
and a Mac double-click both give one folder with manifest.json right inside.
Timestamps are fixed, so an unchanged extension builds a byte-identical zip.
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "extension")
OUT = os.path.join(ROOT, "skins", "ezpayouts-chart-skins.zip")

paths = []
for folder, dirs, files in os.walk(SRC):
    dirs.sort()
    for name in sorted(files):
        if name.startswith(".") or name.endswith("~"):
            continue
        paths.append(os.path.join(folder, name))

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for path in paths:
        info = zipfile.ZipInfo(os.path.relpath(path, SRC).replace(os.sep, "/"), date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        with open(path, "rb") as f:
            z.writestr(info, f.read())

print("wrote %s (%d files, %d KB)" % (os.path.relpath(OUT, ROOT), len(paths), os.path.getsize(OUT) // 1024))
