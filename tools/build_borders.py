#!/usr/bin/env python3
"""Make assets/map/borders.json: light country and prefecture outlines for the map's theme colouring.

  python -I tools/build_borders.py <ne_50m_admin_0_countries.geojson> <ne_10m_admin_1_states_provinces.geojson> <out.json>

Source: Natural Earth (public domain, https://www.naturalearthdata.com/about/terms-of-use/), the geojson of
nvkelso/natural-earth-vector v5.1.2. Natural Earth draws the lines of de facto control; here they are only a guide for colouring.
Each ring is simplified (Douglas-Peucker), rounded and delta-coded: [x0, y0, dx1, dy1, ...] in units of 1/U degree.
"""
import json, sys

CU, CTOL, CMIN = 20, 0.14, 0.12    # countries: 0.05 degree units, tolerance, the smallest ring kept (square degrees)
PU, PTOL, PMIN = 100, 0.025, 0.006 # prefectures
NAMES = {'アメリカ合衆国': '米国', 'イギリス': '英国', 'オーストラリア': '豪州', '大韓民国': '韓国', '中華人民共和国': '中国',
         '朝鮮民主主義人民共和国': '北朝鮮', '中華民国': '台湾', 'ロシア連邦': 'ロシア'}

def dp(pts, tol):
    if len(pts) < 4:
        return pts
    keep, stack = {0, len(pts) - 1}, [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay, bx, by = *pts[a], *pts[b]
        dx, dy = bx - ax, by - ay
        L = (dx * dx + dy * dy) ** .5
        far, at = 0, -1
        for i in range(a + 1, b):
            x, y = pts[i]
            d = abs(dy * (x - ax) - dx * (y - ay)) / L if L else ((x - ax) ** 2 + (y - ay) ** 2) ** .5
            if d > far:
                far, at = d, i
        if far > tol and at >= 0:
            keep.add(at)
            stack += [(a, at), (at, b)]
    return [pts[i] for i in sorted(keep)]

def area(pts):
    return abs(sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))) / 2

def rings(geom):
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    return [[(p[0], p[1]) for p in poly[0]] for poly in polys]   # outer rings only: the even-odd holes of a light map are not worth their weight

def encode(rs, unit, tol, smallest):
    big = max(rs, key=area)
    out, box = [], [999, 999, -999, -999]
    for r in rs:
        if r is not big and area(r) < smallest:
            continue
        s = dp(r[:-1] if r[0] == r[-1] else r, tol)
        if len(s) < 3:
            continue
        ints, code, px, py = [], [], 0, 0
        for x, y in s:
            ix, iy = round(x * unit), round(y * unit)
            if ints and ints[-1] == (ix, iy):
                continue
            ints.append((ix, iy))
            code += [ix - px, iy - py]
            px, py = ix, iy
            box = [min(box[0], ix), min(box[1], iy), max(box[2], ix), max(box[3], iy)]
        if len(ints) >= 3:
            out.append(code)
    return out, box

def main(countries, admin1, dest):
    with open(countries, encoding='utf-8') as f:
        C = json.load(f)
    with open(admin1, encoding='utf-8') as f:
        A = json.load(f)
    cs = []
    for ft in C['features']:
        p = ft['properties']
        name = NAMES.get(p.get('NAME_JA') or '', p.get('NAME_JA') or p.get('NAME') or '')
        if not name or p.get('ISO_A2_EH') == 'AQ':
            continue
        r, b = encode(rings(ft['geometry']), CU, CTOL, CMIN)
        if r:
            cs.append({'n': name, 'a': (p.get('ISO_A2_EH') or '').replace('-99', ''), 'b': b, 'r': r})
    ps = []
    for ft in A['features']:
        p = ft['properties']
        if p.get('iso_a2') != 'JP':
            continue
        name = (p.get('name_ja') or p.get('name') or '').rstrip()
        if name != '北海道' and name[-1:] in '都府県':
            name = name[:-1]
        r, b = encode(rings(ft['geometry']), PU, PTOL, PMIN)
        if r:
            ps.append({'n': name, 'b': b, 'r': r})
    doc = {'src': 'Natural Earth 1:50m countries, 1:10m admin-1 (public domain). De facto lines, a guide for colouring only.',
           'cu': CU, 'pu': PU, 'c': cs, 'p': sorted(ps, key=lambda x: x['n'])}
    with open(dest, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    print(len(cs), 'countries', len(ps), 'prefectures')
    print(' '.join(c['n'] for c in cs))
    print(' '.join(c['n'] for c in ps))

if __name__ == '__main__':
    main(*sys.argv[1:4])
