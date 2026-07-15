#!/usr/bin/env python3
from pathlib import Path
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[2]
manifests = list(ROOT.glob('crates/*/*/Cargo.toml')) + list(ROOT.glob('services/*/Cargo.toml')) + list(ROOT.glob('tools/*/Cargo.toml'))
packages = {}
edges = {}
for manifest in manifests:
    data = tomllib.loads(manifest.read_text())
    name = data['package']['name']
    packages[name] = manifest
    edges[name] = {dep for dep in data.get('dependencies', {}) if dep.startswith('chat-')}

errors = []

def forbid(pkg, predicate, message):
    for dep in sorted(edges.get(pkg, ())):
        if predicate(dep): errors.append(f'{pkg} -> {dep}: {message}')

# Services communicate through contracts, never direct Cargo dependencies.
for pkg in packages:
    if pkg.startswith('chat-service-'):
        forbid(pkg, lambda d: d.startswith('chat-service-'), 'services must not depend on other services')

# Lowest layers cannot point upward.
foundation_allowed = {
    'chat-foundation-common': set(),
    'chat-foundation-errors': set(),
    'chat-foundation-config': {'chat-foundation-common','chat-foundation-errors'},
    'chat-foundation-telemetry': {'chat-foundation-common','chat-foundation-errors'},
}
for pkg, allowed in foundation_allowed.items():
    bad = edges.get(pkg, set()) - allowed
    for dep in sorted(bad): errors.append(f'{pkg} -> {dep}: forbidden foundation dependency')

core_allowed_prefix = ('chat-foundation-',)
for pkg in ['chat-protocol-core','chat-crypto-api','chat-privacy-core','chat-transport-core','chat-storage-core']:
    for dep in sorted(edges.get(pkg, ())):
        if not dep.startswith(core_allowed_prefix):
            errors.append(f'{pkg} -> {dep}: core abstraction may depend only on foundation crates')

forbid('chat-crypto-api', lambda d: d.startswith('chat-crypto-') and d != 'chat-crypto-api', 'crypto API must not depend on concrete crypto crates')
forbid('chat-storage-core', lambda d: d in {'chat-storage-client','chat-storage-server'}, 'storage core must not depend on adapters')
forbid('chat-transport-core', lambda d: d.startswith('chat-transport-') and d != 'chat-transport-core', 'transport core must not depend on implementations')
forbid('chat-privacy-core', lambda d: d.startswith('chat-privacy-') and d != 'chat-privacy-core', 'privacy core must not depend on implementations')
forbid('chat-protocol-core', lambda d: d.startswith('chat-protocol-') and d != 'chat-protocol-core', 'protocol core must not depend on protocol implementations')
forbid('chat-server-core', lambda d: d.startswith('chat-service-'), 'server core must not depend on services')

# Detect internal dependency cycles.
state = {}
stack = []
def visit(node):
    state[node] = 1
    stack.append(node)
    for dep in edges.get(node, ()):
        if dep not in packages: continue
        if state.get(dep) == 0 or dep not in state:
            visit(dep)
        elif state.get(dep) == 1:
            i = stack.index(dep)
            errors.append('dependency cycle: ' + ' -> '.join(stack[i:] + [dep]))
    stack.pop()
    state[node] = 2
for node in packages:
    if node not in state: visit(node)

if errors:
    print('Dependency rule violations:', file=sys.stderr)
    for error in errors: print(f'  - {error}', file=sys.stderr)
    raise SystemExit(1)
print(f'[OK] dependency rules ({len(packages)} packages)')
