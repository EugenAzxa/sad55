import re, html, os, json, glob
out=[]
os.makedirs('text',exist_ok=True)
for f in sorted(glob.glob('raw/*.html')):
    slug=os.path.basename(f)[:-5]
    if slug=='_index': continue
    s=open(f,encoding='utf-8').read()
    def meta(p):
        m=re.search(p,s); return html.unescape(m.group(1)) if m else ''
    title=meta(r'<title>(.*?)</title>')
    ogt=meta(r'og:title" content="([^"]*)')
    desc=meta(r'name="description" content="([^"]*)')
    pub=meta(r'article:published_time" content="([^"]*)')[:10]
    mod=meta(r'article:modified_time" content="([^"]*)')[:10]
    a=s.find('<main'); b=s.find('<section class="section section_related',a); b=b if b>0 else s.find('</main>',a)
    c=s[a:b]
    imgs=re.findall(r'<img[^>]+src="([^"]+)"',c)
    c=re.sub(r'<script.*?</script>|<style.*?</style>','',c,flags=re.S)
    c=re.sub(r'<h[1-6][^>]*>(.*?)</h[1-6]>',lambda m:'\n\n## '+re.sub('<[^>]+>','',m.group(1)).strip()+'\n\n',c,flags=re.S)
    c=re.sub(r'<li[^>]*>','\n- ',c)
    c=re.sub(r'<br\s*/?>','\n',c)
    c=re.sub(r'</p>|</div>|</ul>|</ol>','\n\n',c)
    c=re.sub(r'<[^>]+>','',c)
    c=html.unescape(c).replace('\xa0',' ')
    c=re.sub(r'[ \t]+',' ',c); c=re.sub(r'\n[ \t]+','\n',c); c=re.sub(r'\n{3,}','\n\n',c).strip()
    words=len(re.findall(r'\w+',c))
    hs=re.findall(r'^## (.*)$',c,flags=re.M)
    open(f'text/{slug}.md','w').write(f'# {ogt or title}\n\nURL: https://sad56.ru/articles/{slug}/\nTitle: {title}\nDescription: {desc}\nPublished: {pub}  Modified: {mod}\nWords: {words}\nImages: {imgs}\n\n{c}\n')
    out.append(dict(slug=slug,title=ogt or title,desc=desc,pub=pub,mod=mod,words=words,h=hs,imgs=len(imgs)))
json.dump(out,open('index.json','w'),ensure_ascii=False,indent=1)
for o in sorted(out,key=lambda o:o['pub']): print(o['pub'],o['mod'],o['words'],o['imgs'],o['slug'],'|',o['title'])
print(len(out), sum(o['words'] for o in out))
