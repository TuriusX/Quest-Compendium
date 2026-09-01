import json

with open('metadata.json', 'r') as f:
    data = json.load(f)

if 'display-capture' not in data.get('requestFramePermissions', []):
    if 'requestFramePermissions' not in data:
        data['requestFramePermissions'] = []
    data['requestFramePermissions'].append('display-capture')

with open('metadata.json', 'w') as f:
    json.dump(data, f, indent=2)
print("Patched metadata.json")
