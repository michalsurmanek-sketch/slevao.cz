from pathlib import Path

PATH = Path('supabase/functions/process-leaflet/index.ts')
text = PATH.read_text(encoding='utf-8')
old = "const autoPublish = Boolean(job.leaflet_sources?.auto_publish)"
new = "const autoPublish = Boolean(job.leaflet_sources?.auto_publish || job.metadata?.auto_publish)"

if new in text:
    print('Podpora automatické publikace ručních letáků už je zapnutá.')
elif text.count(old) == 1:
    PATH.write_text(text.replace(old, new, 1), encoding='utf-8')
    print('Podpora automatické publikace ručních letáků byla zapnutá.')
else:
    raise SystemExit(f'Nelze upravit process-leaflet: očekáván 1 výskyt, nalezeno {text.count(old)}.')
