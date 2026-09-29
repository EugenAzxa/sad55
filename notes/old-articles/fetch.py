import subprocess, os, sys
urls=[u.strip() for u in open('urls.txt') if u.strip()]
bad=[]
for u in urls:
    slug=u.rstrip('/').split('/')[-1] or 'index'
    if slug=='articles': slug='_index'
    out=f'raw/{slug}.html'
    if os.path.exists(out) and b'</html>' in open(out,'rb').read(): continue
    ok=False
    for t in range(8):
        r=subprocess.run(['curl','-s','--max-time','40','-A','Mozilla/5.0 (Macintosh) Chrome/128',u],capture_output=True)
        if b'</html>' in r.stdout:
            open(out,'wb').write(r.stdout); ok=True; break
    print(('OK ' if ok else 'FAIL ')+str(t+1)+' '+slug+' '+str(len(r.stdout)), flush=True)
    if not ok: bad.append(u)
print('BAD',bad)
