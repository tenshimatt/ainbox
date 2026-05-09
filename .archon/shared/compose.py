#!/usr/bin/env python3
"""
compose.py — Composes a project workflow YAML with the shared 2-tier classifier.

Text-level insertion that preserves formatting. Handles re-composition
by stripping existing lane-router/vibe-code-bash nodes first.

Usage:
  python3 compose.py <project-yaml> [output-path]
  
  Output path defaults to <project-yaml>.full.yaml.
  Use '-' for stdout.
"""

import sys, re, os

def find_node_boundary(content, start_idx, node_id):
    """Find the text boundaries of a node block starting from start_idx.
    Returns (node_start, node_end) where node_end is the start of the next
    node or the end of the nodes section.
    """
    # From start_idx, find the next "- id:" that's at the same indentation level
    # The node starts at start_idx and ends right before the next "- id:"
    
    # Find the indentation of this node
    prefix, _ = re.match(r'^(\s*)- id:', content[start_idx:]).groups()
    indent = len(prefix)
    
    # Find the next "- id:" at same indentation
    rest = content[start_idx + len(f'  - id: {node_id}'):]
    next_pattern = re.compile(r'\n' + re.escape(prefix) + r'- id: ')
    next_match = next_pattern.search(rest)
    
    if next_match:
        node_end = start_idx + len(f'  - id: {node_id}') + next_match.start()
    else:
        # This is the last node — find end of the nodes block
        node_end = len(content)
        # Trim trailing whitespace
    
    return start_idx, node_end


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <project-yaml> [output-path]", file=sys.stderr)
        sys.exit(1)

    project_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else project_path.replace('.yaml', '.full.yaml')
    write_stdout = output_path == '-'

    script_dir = os.path.dirname(os.path.abspath(__file__))
    tier_path = os.path.join(script_dir, '2-tier.yaml')

    for path in [project_path, tier_path]:
        if not os.path.exists(path):
            print(f"✗ Not found: {path}", file=sys.stderr)
            sys.exit(1)

    with open(project_path) as f:
        content = f.read()

    with open(tier_path) as f:
        tier_content = f.read()

    # ── Remove existing 2-tier nodes if present (re-compose) ──
    while 'lane-router' in content:
        # Find lane-router section start
        lr_start = content.find('\n  - id: lane-router\n')
        if lr_start == -1:
            lr_start = content.find('  - id: lane-router\n')
        
        if lr_start == -1:
            break  # not found (shouldn't happen)
        
        # Find vibe-code-bash end — look for the last "exit 0" in vibe-code-bash
        # that's followed by a blank line and the next "- id:" or end-of-section
        lr_rest = content[lr_start:]
        
        # Find the start of vibe-code-bash within this section
        vcb_start = lr_rest.find('vibe-code-bash')
        if vcb_start == -1:
            break
        
        # Find the end of the vibe-code-bash node
        # Look for the next "- id:" after the vibe-code-bash node starts
        after_vcb_name = lr_rest[vcb_start + len('vibe-code-bash'):]
        next_node = re.search(r'\n  - id: ', after_vcb_name)
        
        if next_node:
            insert_end = lr_start + vcb_start + len('vibe-code-bash') + next_node.start()
        else:
            # This is the last node — find end of content
            insert_end = len(content)
        
        # Remove the section
        content = content[:lr_start] + content[insert_end:]
        print("  Re-composing: removed existing 2-tier block", file=sys.stderr)

    # ── Find insertion point after gate-classify ──
    gc_pos = content.find('  - id: gate-classify\n')
    if gc_pos == -1:
        print("✗ No gate-classify node in project YAML", file=sys.stderr)
        sys.exit(1)

    # Find the next "- id:" after gate-classify
    after_gc = content[gc_pos + len('  - id: gate-classify\n'):]
    next_node = re.search(r'\n  - id: ', after_gc)
    if not next_node:
        print("✗ No node found after gate-classify", file=sys.stderr)
        sys.exit(1)

    insert_point = gc_pos + len('  - id: gate-classify\n') + next_node.start() + 1

    # ── Insert 2-tier nodes ──
    new_content = content[:insert_point] + '\n' + tier_content + '\n' + content[insert_point:]

    # ── Write output ──
    if write_stdout:
        sys.stdout.write(new_content)
    else:
        with open(output_path, 'w') as f:
            f.write(new_content)
        print(f"✓ Composed: {output_path}", file=sys.stderr)

    # ── Verify ──
    assert 'lane-router' in new_content, "lane-router missing!"
    assert 'vibe-code-bash' in new_content, "vibe-code-bash missing!"
    assert 'gate-classify' in new_content, "gate-classify missing!"
    
    import yaml
    data = yaml.safe_load(new_content)
    nodes = data.get('nodes', [])
    ids = [n['id'] for n in nodes]
    lr_idx = ids.index('lane-router')
    gc_idx = ids.index('gate-classify')
    print(f"  Nodes: {len(nodes)} total", file=sys.stderr)
    print(f"  Order: gate-classify @{gc_idx} → lane-router @{lr_idx}", file=sys.stderr)
    print(f"  Contains: {ids[:4]}...{ids[-3:]}", file=sys.stderr)

if __name__ == '__main__':
    main()
