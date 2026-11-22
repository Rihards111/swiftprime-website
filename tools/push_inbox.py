"""Add a batch of panel actions to the encrypted inbox (panel-inbox/inbox.enc).
Usage: python3 tools/push_inbox.py actions.json   (needs PANEL_API_KEY in the environment)
The panel applies each batch once, the next time it is opened after the deploy."""
import base64, hashlib, json, os, sys, time, secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
key = hashlib.sha256(os.environ['PANEL_API_KEY'].encode()).digest()
path = os.path.join(os.path.dirname(__file__), '..', 'panel-inbox', 'inbox.enc')
def load():
    if not os.path.exists(path): return {'batches': []}
    box = json.load(open(path))
    raw = AESGCM(key).decrypt(base64.b64decode(box['iv']), base64.b64decode(box['data']) + base64.b64decode(box['tag']), None)
    return json.loads(raw)
inbox = load()
actions = json.load(open(sys.argv[1]))
inbox['batches'].append({'id': time.strftime('%Y%m%d%H%M%S') + '-' + secrets.token_hex(3), 'actions': actions})
inbox['batches'] = inbox['batches'][-50:]
iv = secrets.token_bytes(12)
ct = AESGCM(key).encrypt(iv, json.dumps(inbox, ensure_ascii=False).encode(), None)
json.dump({'iv': base64.b64encode(iv).decode(), 'data': base64.b64encode(ct[:-16]).decode(), 'tag': base64.b64encode(ct[-16:]).decode()}, open(path, 'w'))
print('batches:', len(inbox['batches']), 'actions in new batch:', len(actions))
