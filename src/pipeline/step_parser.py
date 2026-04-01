"""Parse STEP files to extract product hierarchy and assembly structure.

Uses text-based parsing since pythonocc-core may not be available.
Extracts PRODUCT entries, NEXT_ASSEMBLY_USAGE_OCCURRENCE relationships,
and AXIS2_PLACEMENT_3D transforms.
"""

import re
import json
import sys
from pathlib import Path
from dataclasses import dataclass, field


def parse_step_products(filepath: str) -> dict:
    """Parse a STEP file and extract the product assembly hierarchy."""

    print(f"Parsing STEP file: {filepath}")

    with open(filepath, 'r', errors='replace') as f:
        content = f.read()

    # Extract all entity definitions (#ID = TYPE(...);)
    # STEP entities can span multiple lines, so join continuation lines
    content_clean = re.sub(r'\n\s+', ' ', content)

    # Parse PRODUCT entries: #ID = PRODUCT('id','name','description',(#context));
    products = {}
    product_pattern = re.compile(
        r"#(\d+)\s*=\s*PRODUCT\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'"
    )
    for match in product_pattern.finditer(content_clean):
        entity_id = int(match.group(1))
        prod_id = match.group(2)
        prod_name = match.group(3)
        products[entity_id] = {
            "entity_id": entity_id,
            "id": prod_id,
            "name": prod_name,
            "children": [],
            "parent": None,
        }

    print(f"  Found {len(products)} PRODUCT entries")

    # Parse PRODUCT_DEFINITION_FORMATION -> links to PRODUCT
    pdf_to_product = {}
    pdf_pattern = re.compile(
        r"#(\d+)\s*=\s*PRODUCT_DEFINITION_FORMATION(?:_WITH_SPECIFIED_SOURCE)?\s*\([^,]*,[^,]*,\s*#(\d+)"
    )
    for match in pdf_pattern.finditer(content_clean):
        pdf_id = int(match.group(1))
        product_id = int(match.group(2))
        pdf_to_product[pdf_id] = product_id

    # Parse PRODUCT_DEFINITION -> links to PDF
    pd_to_pdf = {}
    pd_pattern = re.compile(
        r"#(\d+)\s*=\s*PRODUCT_DEFINITION\s*\([^,]*,[^,]*,\s*#(\d+)"
    )
    for match in pd_pattern.finditer(content_clean):
        pd_id = int(match.group(1))
        pdf_id = int(match.group(2))
        pd_to_pdf[pd_id] = pdf_id

    # Build PD -> PRODUCT mapping
    pd_to_product = {}
    for pd_id, pdf_id in pd_to_pdf.items():
        if pdf_id in pdf_to_product:
            pd_to_product[pd_id] = pdf_to_product[pdf_id]

    # Parse NEXT_ASSEMBLY_USAGE_OCCURRENCE (parent-child relationships)
    # NAUO('id','name','desc',#parent_pd,#child_pd)
    nauo_pattern = re.compile(
        r"#(\d+)\s*=\s*NEXT_ASSEMBLY_USAGE_OCCURRENCE\s*\([^,]*,[^,]*,[^,]*,\s*#(\d+)\s*,\s*#(\d+)"
    )
    relationships = []
    for match in nauo_pattern.finditer(content_clean):
        parent_pd = int(match.group(2))
        child_pd = int(match.group(3))
        relationships.append((parent_pd, child_pd))

    # Resolve relationships to product names
    for parent_pd, child_pd in relationships:
        parent_prod_id = pd_to_product.get(parent_pd)
        child_prod_id = pd_to_product.get(child_pd)
        if parent_prod_id and child_prod_id:
            if parent_prod_id in products and child_prod_id in products:
                products[parent_prod_id]["children"].append(child_prod_id)
                products[child_prod_id]["parent"] = parent_prod_id

    print(f"  Found {len(relationships)} assembly relationships")

    # Parse COLOUR_RGB entries
    colors = {}
    color_pattern = re.compile(
        r"#(\d+)\s*=\s*COLOUR_RGB\s*\(\s*'([^']*)'\s*,\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)"
    )
    for match in color_pattern.finditer(content_clean):
        entity_id = int(match.group(1))
        name = match.group(2)
        r, g, b = float(match.group(3)), float(match.group(4)), float(match.group(5))
        colors[entity_id] = {"name": name, "r": round(r, 4), "g": round(g, 4), "b": round(b, 4)}

    print(f"  Found {len(colors)} COLOUR_RGB entries")

    # Build hierarchy tree
    roots = [pid for pid, p in products.items() if p["parent"] is None]

    def build_tree(product_id, depth=0):
        prod = products[product_id]
        node = {
            "name": prod["name"],
            "id": prod["id"],
            "entity_id": product_id,
            "depth": depth,
            "children": [build_tree(cid, depth + 1) for cid in prod["children"]],
        }
        return node

    tree = [build_tree(r) for r in roots]

    # Flatten for summary
    flat_products = []
    def flatten(node, parent_name=None):
        flat_products.append({
            "name": node["name"],
            "id": node["id"],
            "parent": parent_name,
            "child_count": len(node["children"]),
            "depth": node["depth"],
        })
        for child in node["children"]:
            flatten(child, node["name"])

    for t in tree:
        flatten(t)

    result = {
        "file": str(filepath),
        "total_products": len(products),
        "total_relationships": len(relationships),
        "total_colors": len(colors),
        "colors": list(colors.values()),
        "hierarchy": tree,
        "products_flat": flat_products,
    }

    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python step_parser.py <file.step> [output.json]")
        sys.exit(1)

    filepath = sys.argv[1]
    output = sys.argv[2] if len(sys.argv) > 2 else None

    result = parse_step_products(filepath)

    if output:
        with open(output, 'w') as f:
            json.dump(result, f, indent=2)
        print(f"Saved to {output}")
    else:
        print(json.dumps(result, indent=2))
