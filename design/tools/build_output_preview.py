"""生成 design/preview/output-v2.html：把后台的图标表（Sprite.vue）放进 output-v2.src.html。"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
src = (ROOT / 'design/preview/output-v2.src.html').read_text()
sprite = (ROOT / 'apps/admin/src/components/Sprite.vue').read_text()
sprite = sprite[sprite.index('<svg'):sprite.rindex('</svg>') + 6]
(ROOT / 'design/preview/output-v2.html').write_text(src.replace('%%SPRITE%%', sprite))
print('ok')
