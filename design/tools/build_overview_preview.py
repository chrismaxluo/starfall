"""生成 design/preview/overview-v3.html：把后台的图标表（Sprite.vue）、新齿轮图标、荣耀勋章示例地址放进 overview-v3.src.html。"""
import json
import math
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
src = (ROOT / 'design/preview/overview-v3.src.html').read_text()
sprite = (ROOT / 'apps/admin/src/components/Sprite.vue').read_text()
sprite = sprite[sprite.index('<svg'):sprite.rindex('</svg>') + 6]

# 8 个齿的齿轮
n, ro, ri = 8, 10, 7.6
tw, bw = math.pi / n * 0.46, math.pi / n * 0.62
pts = []
for k in range(n):
    a = 2 * math.pi * k / n
    pts += [(a - bw, ri), (a - tw, ro), (a + tw, ro), (a + bw, ri)]
gear = 'M' + ' L'.join(f'{12 + r * math.cos(t):.2f} {12 + r * math.sin(t):.2f}' for t, r in pts) + 'Z'

# 荣耀勋章（B 站的图，只引用地址；来自 xlive/general-interface/v1/content/get?key=wealth）
B = 'https://i0.hdslb.com/bfs/live/'
honor = {5: '24f6ef867c3905064136f5c4e33a8d423d41ebdd.png', 12: 'f5f0cb238bfa8a4481fc67ee7e99c32e3b62ce83.png', 17: 'b6f2bf3e27f22b3039594842f0005b05a0dc5dae.png',
         21: '690c9a06d47e9cc53d78c0d951caef97bfcc6374.png', 28: '62fe89aef112353cfd97016b4b2cc653438642ac.png', 29: None, 33: '8d0656d3a7a74480b2faf6c9488794e54d0da026.png',
         37: 'fe08f62c736f93362b307d02f13beff0bd630d61.png', 44: 'f2e514f40d81133b5195a340e74b9183efa888ec.png', 53: '4a7190a04d94a87d2f760f5d4ced11be2d197438.png',
         61: 'a40f6e3616e4ae545ca64467687366fddc701c39.png', 68: 'ce6a2ca64b8cd945d14b49807124b7a8a4ea946d.png', 80: '6da9d5d7e68722cb7ec018c4f15dcbe15937ce8f.webp'}
honor = {k: B + v for k, v in honor.items() if v}

out = src.replace('%%SPRITE%%', sprite).replace('%%GEAR%%', gear).replace('%%HONOR%%', json.dumps(honor))
(ROOT / 'design/preview/overview-v3.html').write_text(out)
print('ok')
