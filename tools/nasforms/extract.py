"""국가항공보안 수준관리지침(국토교통부예규 제217호) 별표 점검표 HWPX → js/nasforms.js
   실행: python3 tools/nasforms/extract.py assets/forms/nas js/nasforms.js   (lxml 필요)
   양식 원본: 국가법령정보센터 별표 HWP(2018-05-16) → python-hwpx 6.7 로 HWPX 변환(assets/forms/nas/b*.hwpx).
   셀 주소는 [표 순번(문서 순서), rowAddr, colAddr] — js/selfcheck.js 가 이 주소에 답을 채워 HWPX · A4 로 낸다.
   ※ 양식을 바꾸면 이 스크립트로 다시 만들고, 기존 기록의 항목 id(구분 순번.가나다)가 그대로인지 확인할 것."""
import zipfile, re, json, sys
from lxml import etree
HP='{http://www.hancom.co.kr/hwpml/2011/paragraph}'
def ptext(p): return ''.join(t.xpath('string(.)') for t in p.iter(HP+'t'))
def norm(s): return re.sub(r'\s+',' ',s.replace('\xa0',' ')).strip()
def load(path):
    z=zipfile.ZipFile(path); return etree.fromstring(z.read('Contents/section0.xml'))
def tables(root): return list(root.iter(HP+'tbl'))
def cells(tbl):
    out=[]
    for tr in tbl.findall(HP+'tr'):
        for tc in tr.findall(HP+'tc'):
            a=tc.find(HP+'cellAddr'); s=tc.find(HP+'cellSpan')
            sl=tc.find(HP+'subList')
            paras=[ptext(p) for p in sl.findall(HP+'p')] if sl is not None else []
            out.append(dict(r=int(a.get('rowAddr')),c=int(a.get('colAddr')),cs=int(s.get('colSpan')),rs=int(s.get('rowSpan')),paras=paras,t=norm(' '.join(paras))))
    return out
def rows(tbl):
    R={}
    for c in cells(tbl): R.setdefault(c['r'],[]).append(c)
    return [sorted(R[k],key=lambda x:x['c']) for k in sorted(R)]
LBL=re.compile(r'^([가-힣])\.\s*(.*)$')
SEC=re.compile(r'^(\d+)\.\s*(.+?)\s*(\(계속\))?$')
UNIT=re.compile(r'^(.*?):?\s*(년|개|%)$')

def insp_form(fid, path, title):
    root=load(path); T=tables(root)
    f=dict(id=fid,kind='insp',title=title,head={},secs=[])
    cur=None; secidx=0; pend=None
    for ti,tb in enumerate(T):
        rr=rows(tb)
        for row in rr:
            txts=[c['t'] for c in row]
            first=row[0]
            if pend is not None:   # 서술 질문 다음 줄 = 답 칸
                c=row[0]; it=pend; pend=None
                it['a']=[ti,c['r'],c['c']]
                lines=[norm(p) for p in c['paras'] if norm(p)]
                if lines and all(l.startswith('-') for l in lines) or (lines and all(re.search(r':\s*$',l) for l in lines)):
                    it['k']='pr'; it['p']=lines
                elif lines:
                    it['d']=' '.join(lines)
                continue
            if ti==0 and first['t']=='점검분야':
                f['field']=row[1]['t']
                gi=txts.index('감독관'); f['head']['insp']=[ti,row[gi+1]['r'],row[gi+1]['c']]
                continue
            if ti==0 and first['t'].replace(' ','')=='점검일':
                f['head']['date']=[ti,row[1]['r'],row[1]['c']]
                gi=txts.index('수검자 및 기관'); f['head']['org']=[ti,row[gi+1]['r'],row[gi+1]['c']]
                continue
            if first['t']=='항공보안감독관 점검표' or first['t'].startswith('Y :') or (len(row)==1 and not first['t']):
                continue
            m=SEC.match(first['t'])
            if m and txts[1:]==['Y','N','R/C','N/A']:
                if m.group(3) and cur is not None and cur['n']==m.group(1):
                    continue
                secidx+=1
                cur=dict(n=m.group(1),title=norm(m.group(2)),items=[]); f['secs'].append(cur)
                continue
            m=LBL.match(first['t'])
            if not m: raise SystemExit('%s 표%d 행%d 알 수 없음: %r'%(fid,ti,first['r'],txts))
            it=dict(id='%d.%s'%(secidx,m.group(1)),l=m.group(1),t=norm(m.group(2)))
            rest=row[1:]
            if len(rest)==4 and all(c['t']=='□' for c in rest):
                it['k']='yn'; it['b']=[[ti,c['r'],c['c']] for c in rest]
            elif len(rest)==1:
                c=rest[0]; it['a']=[ti,c['r'],c['c']]
                lines=[norm(p) for p in c['paras'] if norm(p)]
                joined=' '.join(lines)
                us=re.findall(r'([^:/]*?):?\s*(년|개|%)(?:/|$)',joined)
                rebuilt='/'.join(((l.strip()+':  ') if l.strip() else '')+u for l,u in us)
                if lines and us and re.sub(r'\s','',rebuilt)==re.sub(r'\s','',joined):
                    it['k']='un'; it['u']=[[l.strip(),u] for l,u in us]
                else:
                    it['k']='tx'
            elif len(rest)==0:
                it['k']='tx'; pend=it
            else: raise SystemExit('%s 행 모양 %r'%(fid,txts))
            cur['items'].append(it)
    assert pend is None
    return f

def b1(path):
    root=load(path); T=tables(root)
    top=[el for el in root if el.tag==HP+'p']
    pidx=[i for i,p in enumerate(top) if norm(ptext(p)).startswith('점검일')][0]
    f=dict(id='b1',kind='fsc',title='현장보안확인표',sub='Field Security Check',head=dict(appr=[[0,1,0],[0,1,1],[0,1,2]],apprL=['점검자','담당','과장(소장)'],line=pidx),secs=[])
    # 1. 장비
    rr=rows(T[1]); items=[]; grp=''
    for row in rr[2:]:
        d={c['c']:c for c in row}
        if 0 in d: grp=d[0]['t']
        nm=d[1]['t']
        if nm=='(예)': continue
        r=row[0]['r']
        items.append(dict(id='e%d'%r,k='eq',g=grp,t=nm,nm=[1,r,1],b=[[1,r,2],[1,r,3]],rm=[1,r,4]))
    f['secs'].append(dict(n='1',title='보안검색용 장비의 정비․운용 실태',note='X-Ray, 문형탐지기, 휴대용탐지기, 폭발물흔적 및 탐지장비 등',items=items))
    def gp(ti,sub):
        out=[]; rm=None
        for row in rows(T[ti])[1:]:
            d={c['c']:c for c in row}
            if 3 in d: rm=[ti,d[3]['r'],3]
            t=d[0]['t'].lstrip('◦').strip()
            out.append(dict(id='g%d.%d'%(ti,row[0]['r']),k='gp',t=t,sub=sub,b=[[ti,row[0]['r'],1],[ti,row[0]['r'],2]],rm=rm))
        return out
    f['secs'].append(dict(n='2',title='여객․화물에 대한 검색운용 실태',items=gp(2,'여객')+gp(3,'화물')))
    f['secs'].append(dict(n='3',title='보호구역․출입증 관리 및 경비실태',items=gp(4,'')))
    return f

def b15(path):
    root=load(path); T=tables(root)
    top=[el for el in root if el.tag==HP+'p']
    pidx=[i for i,p in enumerate(top) if '(공항 또는 항공사 명)' in ptext(p)][0]
    cats=[]; cur=None
    for row in rows(T[0])[1:]:
        d={c['c']:c for c in row}
        if 0 in d:
            cur=dict(n=d[0]['t'].replace(' 분야','분야'),items=[]); cats.append(cur)
        r=row[0]['r']
        cur['items'].append(dict(id='p%d'%r,t=d[1]['t'].lstrip('ㅇ').strip(),n=[0,r,2],pct=[0,r,3]))
    return dict(id='b15',kind='ana',title='보안점검 등에 대한 문제점 분석표',head=dict(org=pidx),cats=cats)

D=sys.argv[1]; OUT=sys.argv[2]
TITLES={3:'검색장비 운용실태 점검표',4:'화물보관창고/검색절차 점검표',7:'출입증 발급/패용실태 점검표',8:'비행서류 보관실태 점검표',9:'보호구역출입통제 점검표',10:'항공기 보안통제 점검표',11:'보안검색절차 점검표'}
forms=[b1(D+'/b1.hwpx')]
for n in [3,4,7,8,9,10,11]:
    forms.append(insp_form('b%d'%n,D+'/b%d.hwpx'%n,TITLES[n]))
forms.append(b15(D+'/b15.hwpx'))
js=['/* ═══════════════════════════════════════════════════════',
    '   SeMIS · Logistics — 국가항공보안 수준관리지침 별표 점검표 양식 정의 (자동 생성 — 손으로 고치지 말 것)',
    '   원본: 국토교통부예규 제217호(2018-05-16) 별표 1 · 3 · 4 · 7 · 8 · 9 · 10 · 11 · 15 (국가법령정보센터, 공개 행정규칙)',
    '   만든 도구: tools/nasforms/extract.py  ←  assets/forms/nas/b*.hwpx',
    '   kind: insp(항공보안감독관 점검표 · Y/N/R/C/N/A) · fsc(현장보안확인표 · 양호/미흡) · ana(문제점 분석표)',
    '   항목 k: yn(□ 4칸) · tx(서술 — 다음 줄 답 칸) · pr(답 칸의 줄머리마다 채움) · un(인원:  년 같은 단위 칸) · eq · gp(별표 1)',
    '   ═══════════════════════════════════════════════════════ */',
    '"use strict";',
    'window.SemisNasForms = {',
    '  SRC: { title: "국가항공보안 수준관리지침", rev: "국토교통부예규 제217호", date: "2018-05-16", org: "국토교통부 / 항공보안정책과" },',
    '  FORMS: [']
js.append(',\n'.join('    '+json.dumps(f,ensure_ascii=False,separators=(',',':')) for f in forms))
js+=['  ]','};','']
open(OUT,'w',encoding='utf-8').write('\n'.join(js))
for f in forms:
    if f['kind']=='insp':
        n=sum(len(s['items']) for s in f['secs'])
        ks={}
        for s in f['secs']:
            for i in s['items']: ks[i['k']]=ks.get(i['k'],0)+1
        print(f['id'],f.get('field'),len(f['secs']),'secs',n,'items',ks)
    elif f['kind']=='fsc': print('b1', [len(s['items']) for s in f['secs']])
    else: print('b15',[(c['n'],len(c['items'])) for c in f['cats']])
