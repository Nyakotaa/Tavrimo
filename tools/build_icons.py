from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / 'assets' / 'icons'
SOURCE = ICONS / 'source-icon-1024.png'

if not SOURCE.exists():
    raise SystemExit(f'Файл не найден: {SOURCE}')

image = Image.open(SOURCE).convert('RGBA')
if image.size != (1024, 1024):
    raise SystemExit(f'Ожидался исходник 1024x1024, получено: {image.size}')

sizes = {
    'apple-touch-icon-v13.png': 180,
    'icon-180.png': 180,
    'icon-192.png': 192,
    'icon-512.png': 512,
    'favicon-32.png': 32,
}

for filename, size in sizes.items():
    target = ICONS / filename
    image.resize((size, size), Image.Resampling.LANCZOS).save(target, optimize=True)
    print(f'Создан: {target.relative_to(ROOT)}')
