"""인천공항 주기장 좌표 — 항공정보간행물(AIP Korea) RKSI AD CHART 2-5 'INS COORDINATES FOR AIRCRAFT STANDS (WGS-84)' PDF 에서 뽑는다.
실행: python3 parse-aip.py '(2-3) AIRCRAFT PARKING DOCKING CHART_*.pdf' > stands.json   (pdfplumber 필요)
- 도면 PDF 주소는 aim.koca.go.kr/eaipPub/Package/<판>/html/eAIP/KR-AD-2.RKSI-en-GB.html 의 'AIRCRAFT PARKING DOCKING CHART' 링크
- 표마다 '주기장 번호 | 위도 | 경도 | 높이 | 기종' 한 줄. 여러 기종용 주기장은 번호가 칸 가운데에 한 번, 줄마다 L/R/A~D(가끔 LL · RR 로 겹쳐 찍힘)
- 경도가 '126°26' + '48.77"E' 두 조각으로 갈라진 줄이 있어 이어 붙인다
- 결과 확인: 437개(2026-10-15 도면), 문제 0, 위성사진에 겹쳐 화물 6xx · T1 게이트가 기수 위치에 맞음(v1.85 작업 기록) """
import sys, re, json
import pdfplumber
latre = re.compile(r'(\d{2})°(\d{2})\'(\d{2}(?:\.\d+)?)"N')
lonre = re.compile(r'(\d{3})°(\d{2})\'(\d{2}(?:\.\d+)?)"E')
lonA = re.compile(r'(\d{3})°(\d{2})\'?$'); lonB = re.compile(r'^(\d{2}(?:\.\d+)?)"E$')
num = re.compile(r'^\d{1,3}[A-Z]?$')
dms = lambda d, m, s: int(d) + int(m) / 60 + float(s) / 3600
def suf(t):
    m = re.fullmatch(r'([LRABCD])\1?', t)
    return m.group(1) if m else None
out, prob = {}, []
for pi, page in enumerate(pdfplumber.open(sys.argv[1]).pages):
    words = page.extract_words(x_tolerance=1.5, y_tolerance=2)
    for w in words:
        m = latre.fullmatch(w['text'])
        if not m: continue
        row = sorted([x for x in words if abs(x['top'] - w['top']) < 2.5], key=lambda x: x['x0'])
        right = [x for x in row if 0 < x['x0'] - w['x1'] < 80]
        lon = None
        if right and lonre.fullmatch(right[0]['text']): lon = lonre.fullmatch(right[0]['text']).groups()
        elif len(right) >= 2 and lonA.fullmatch(right[0]['text']) and lonB.fullmatch(right[1]['text']):
            a = lonA.fullmatch(right[0]['text']); b = lonB.fullmatch(right[1]['text']); lon = (a.group(1), a.group(2), b.group(1))
        left = [x for x in row if x['x1'] <= w['x0'] + 0.5 and w['x0'] - x['x1'] < 60]
        st = None
        if left and suf(left[-1]['text']) and w['x0'] - left[-1]['x1'] < 20:
            s = left[-1]
            cand = [x for x in words if re.fullmatch(r'\d{1,3}', x['text']) and 0 <= s['x0'] - x['x1'] < 30 and abs(x['top'] - s['top']) <= 26]
            if cand: st = min(cand, key=lambda x: abs(x['top'] - s['top']))['text'] + suf(s['text'])
        if st is None and left and num.match(left[-1]['text']) and w['x0'] - left[-1]['x1'] < 45: st = left[-1]['text']
        if st is None or lon is None: prob.append((pi + 1, w['text'])); continue
        v = [round(dms(*m.groups()[:3]), 6), round(dms(*lon), 6)]
        if st in out and out[st] != v: prob.append((pi + 1, 'DUP', st))
        out[st] = v
if prob: print('problems', prob, file=sys.stderr)
json.dump(out, sys.stdout, sort_keys=True)
