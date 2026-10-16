"""Package only the already-frozen simulated experiment outputs."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

def main(source,output):
    source=source.resolve(strict=True);output=output.resolve()
    if output.exists():raise FileExistsError(output)
    files=sorted(p for p in source.rglob('*') if p.is_file())
    if len(files)!=70 or len(list(source.rglob('manifest.json')))!=6:raise ValueError('Unexpected evidence set')
    index={'sourceCommit':'e78421dd90322ec0f2561824156679d5a436eb51','sourceKind':'mechanics_simulation','files':{}}
    output.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(output,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for file in files:
            relative='outputs/'+file.relative_to(source).as_posix()
            index['files'][relative]={'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}
            z.write(file,'research-evidence/'+relative)
        z.writestr('research-evidence/archive-index.json',json.dumps(index,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'file':str(output),'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'files':len(files)},ensure_ascii=False),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',required=True,type=Path);p.add_argument('--output',required=True,type=Path)
    a=p.parse_args();main(a.source,a.output)
