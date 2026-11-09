"""Writes evidence-manifest.json: SHA-256 and size of every file in the evidence folder (run in BAS)."""
import hashlib, json, os, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
files = []
for d, _, fs in os.walk(root):
    for f in sorted(fs):
        p = os.path.join(d, f); rel = os.path.relpath(p, root)
        if rel == 'evidence-manifest.json': continue
        files.append({'path': rel, 'bytes': os.path.getsize(p), 'sha256': hashlib.sha256(open(p, 'rb').read()).hexdigest()})
files.sort(key=lambda x: x['path'])
json.dump({'milestone': 'P3 Case Worklist', 'head': sys.argv[1] if len(sys.argv) > 1 else '', 'files': files},
          open(os.path.join(root, 'evidence-manifest.json'), 'w'), indent=1)
print(len(files), 'files')
