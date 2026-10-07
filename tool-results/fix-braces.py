# -*- coding: utf-8 -*-
"""Fix: move closing }; to after each inserted locale block"""
import io, re

PATH = '/home/z/my-project/src/lib/i18n/index.ts'
src = io.open(PATH, encoding='utf-8').read()

# en block: between '};' and 'const ar: Dict = {'
m = re.search(r"\};\s*\n(\s*/\* ===== v0\.1\.0-alpha.*?)(\n\s*\nconst ar: Dict = \{)", src, re.S)
assert m, 'en anchor not found'
src = src[:m.start()] + '\n' + m.group(1) + '\n};\n' + m.group(2).lstrip('\n') + src[m.end():]

m = re.search(r"\};\s*\n(\s*/\* ===== v0\.1\.0-alpha.*?)(\n\s*\nconst tr: Dict = \{)", src, re.S)
assert m, 'ar anchor not found'
src = src[:m.start()] + '\n' + m.group(1) + '\n};\n' + m.group(2).lstrip('\n') + src[m.end():]

m = re.search(r"\};\s*\n(\s*/\* ===== v0\.1\.0-alpha.*?)(\n\s*\nexport const DICTIONARIES)", src, re.S)
assert m, 'tr anchor not found'
src = src[:m.start()] + '\n' + m.group(1) + '\n};\n' + m.group(2).lstrip('\n') + src[m.end():]

io.open(PATH, 'w', encoding='utf-8').write(src)
print('OK braces fixed')
