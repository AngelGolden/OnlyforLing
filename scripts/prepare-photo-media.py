#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把用户自行添加的 42 张照片归一为 public/photo-media/photo-NN.jpg。

只做尺寸 / 格式归一：不放大、不裁剪、不调色、不改写画面内容。
清单与素材的对应关系见 data/photos/sources.json；照片说明、时间、收藏
一律不在这里生成，见 scripts/import-photos.mjs。

用法：python scripts/prepare-photo-media.py
"""

import json
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
MAPPING = json.loads(
    (ROOT / "data/photos/sources.json").read_text(encoding="utf-8")
)
OUT = ROOT / "public/photo-media"
OUT.mkdir(parents=True, exist_ok=True)

MAX_SIDE = 1280
QUALITY = 82

files = MAPPING["files"]
if len(files) != 42:
    raise SystemExit(f"素材映射应为 42 张，实际 {len(files)} 张")

total = 0
for number, entry in enumerate(files, 1):
    source = Path(entry["source"])
    if not source.is_file():
        raise SystemExit(f"【照片 {number:02d}】素材不存在: {source}")
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original).convert("RGB")
        width, height = image.size
        if max(width, height) > MAX_SIDE:
            scale = MAX_SIDE / max(width, height)
            image = image.resize(
                (round(width * scale), round(height * scale)), Image.LANCZOS
            )
        destination = OUT / entry["file"]
        image.save(
            destination, "JPEG", quality=QUALITY, optimize=True, progressive=True
        )
    size = destination.stat().st_size
    total += size
    print(
        f"{number:02d} {entry['file']} "
        f"{width}x{height} -> {image.size[0]}x{image.size[1]} {size // 1024}KB"
    )

print(f"TOTAL {len(files)} files / {total / 1024 / 1024:.2f} MiB")
