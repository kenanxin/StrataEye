"""Verify immutable research evidence without importing or unpickling models."""
import argparse
import hashlib
import json
from pathlib import Path

def digest(path):
    value=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):value.update(block)
    return value.hexdigest()

def verify_files(root,files):
    root=root.resolve(strict=True)
    for relative,item in files.items():
        path=(root/relative).resolve(strict=True)
        if not path.is_relative_to(root):raise ValueError('Archive path escapes its root')
        if not path.is_file() or path.stat().st_size!=item['bytes'] or digest(path)!=item['sha256']:
            raise ValueError('Evidence mismatch: '+relative)
    return len(files)

def verify(root):
    root=Path(root).resolve(strict=True)
    index=json.loads((root/'archive-index.json').read_text(encoding='utf-8'))
    count=verify_files(root,index['files'])
    actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and p.name!='archive-index.json'}
    if actual!=set(index['files']):raise ValueError('Unexpected or missing archived file')
    manifests=list((root/'outputs').rglob('manifest.json'))
    if len(manifests)!=6:raise ValueError('Expected six original experiment manifests')
    checked=0
    for manifest in manifests:
        data=json.loads(manifest.read_text(encoding='utf-8'))
        checked+=verify_files(manifest.parent,data['files'])
    return {'files':count,'originalManifests':len(manifests),'manifestEntries':checked,'hashes':'passed','semanticReplay':False}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('root',type=Path)
    print(json.dumps(verify(parser.parse_args().root),ensure_ascii=False,indent=2))
