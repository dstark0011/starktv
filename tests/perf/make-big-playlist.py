import random, json, time
random.seed(1)
teams=['Liverpool','Arsenal','Chelsea','Everton','Leeds','Fulham','Brentford','Wolves','Spurs','Villa','Newcastle','Brighton']
words='news live weather cooking drama quiz property garden travel history nature crime comedy kids cartoon motors darts snooker golf tennis cricket rugby boxing ufc racing'.split()
chs=[]
for i in range(15000):
    chs.append({'stream_id':i+1,'name':f'UK: {random.choice(words).title()} {random.choice(words).title()} {i}','category_id':1+i%60,'num':i+1,'epg_channel_id':f'ch{i%3000}.uk'})
json.dump(chs,open('live.json','w'))
now=int(time.time())
def ts(t): return time.strftime('%Y%m%d%H%M%S +0000',time.gmtime(t))
out=['<?xml version="1.0"?><tv>']
for c in range(3000):
    t=now-3600
    while t<now+3*86400:
        d=random.choice([1800,3600,5400,7200])
        if random.random()<0.05: title=f'Live Premier League: {random.choice(teams)} v {random.choice(teams)}'
        else: title=' '.join(random.choice(words).title() for _ in range(3))
        out.append(f'<programme start="{ts(t)}" stop="{ts(t+d)}" channel="ch{c}.uk"><title>{title}</title><desc>{" ".join(random.choice(words) for _ in range(25))}</desc><category>{random.choice(words)}</category></programme>')
        t+=d
out.append('</tv>')
open('xmltv.xml','w').write('\n'.join(out))
print(len(out))
