"""Build offline Noto Sans SC WOFF2; requires fonttools[woff] and brotli.

Usage: python tools/build-ui-font.py path/to/NotoSansSC.ttf
The upstream SIL Open Font License accompanies the generated asset.
"""
from pathlib import Path
import sys
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
text = ''.join(chr(c) for c in range(32, 256))
for directory in ('js', 'server', 'data'):
    for file in (root / directory).rglob('*'):
        if file.suffix in ('.js', '.mjs', '.json') and 'vendor' not in file.parts:
            text += file.read_text(encoding='utf-8', errors='ignore')
for file in root.glob('*.html'):
    text += file.read_text(encoding='utf-8')
options = subset.Options()
options.flavor = 'woff2'
options.name_IDs = ['*']
options.name_legacy = True
options.name_languages = ['*']
font = TTFont(sys.argv[1])
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=text)
subsetter.subset(font)
font.flavor = 'woff2'
output = root / 'assets' / 'fonts' / 'strata-sans-sc.woff2'
output.parent.mkdir(parents=True, exist_ok=True)
font.save(output)
print(f'{output}: {output.stat().st_size:,} bytes; {len(set(text)):,} source characters')
