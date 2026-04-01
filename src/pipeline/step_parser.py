"""Parse STEP files to extract product hierarchy and assembly structure.

Uses text-based parsing since pythonocc-core may not be available.
Extracts PRODUCT entries, NEXT_ASSEMBLY_USAGE_OCCURRENCE relationships,
and COLOUR_RGB definitions. Processes files in chunks to limit memory.
"""

import re
import json
import logging
import sys
from collections import deque

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
log = logging.getLogger(__name__)


def _read_step_entities(filepath: str) -> str:
    """Read a STEP file and join continuation lines.

    Reads in chunks to limit peak memory. Continuation lines (starting with
    whitespace) are joined to the previous line.
    """
    log.info("Reading STEP file: %s", filepath)
    chunks: list[str] = []
    chunk_size = 16 * 1024 * 1024  # 16MB chunks

    with open(filepath, 'r', errors='replace') as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            chunks.append(chunk)

    content = ''.join(chunks)
    # Join continuation lines (lines starting with whitespace)
    content_clean = re.sub(r'\n\s+', ' ', content)
    # Free the original content
    del content, chunks
    return content_clean


def parse_step_products(filepath: str) -> dict:
    """Parse a STEP file and extract the product assembly hierarchy."""
    content_clean = _read_step_entities(filepath)

    # Parse PRODUCT entries
    products: dict[int, dict] = {}
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

    log.info("  Found %d PRODUCT entries", len(products))

    # Parse PRODUCT_DEFINITION_FORMATION -> links to PRODUCT
    pdf_to_product: dict[int, int] = {}
    pdf_pattern = re.compile(
        r"#(\d+)\s*=\s*PRODUCT_DEFINITION_FORMATION(?:_WITH_SPECIFIED_SOURCE)?\s*\([^,]*,[^,]*,\s*#(\d+)"
    )
    for match in pdf_pattern.finditer(content_clean):
        pdf_to_product[int(match.group(1))] = int(match.group(2))

    # Parse PRODUCT_DEFINITION -> links to PDF
    pd_to_pdf: dict[int, int] = {}
    pd_pattern = re.compile(
        r"#(\d+)\s*=\s*PRODUCT_DEFINITION\s*\([^,]*,[^,]*,\s*#(\d+)"
    )
    for match in pd_pattern.finditer(content_clean):
        pd_to_pdf[int(match.group(1))] = int(match.group(2))

    # Build PD -> PRODUCT mapping
    pd_to_product: dict[int, int] = {}
    for pd_id, pdf_id in pd_to_pdf.items():
        if pdf_id in pdf_to_product:
            pd_to_product[pd_id] = pdf_to_product[pdf_id]

    # Parse NEXT_ASSEMBLY_USAGE_OCCURRENCE (parent-child relationships)
    nauo_pattern = re.compile(
        r"#(\d+)\s*=\s*NEXT_ASSEMBLY_USAGE_OCCURRENCE\s*\([^,]*,[^,]*,[^,]*,\s*#(\d+)\s*,\s*#(\d+)"
    )
    relationships: list[tuple[int, int]] = []
    for match in nauo_pattern.finditer(content_clean):
        relationships.append((int(match.group(2)), int(match.group(3))))

    # Resolve relationships to product names
    for parent_pd, child_pd in relationships:
        parent_prod_id = pd_to_product.get(parent_pd)
        child_prod_id = pd_to_product.get(child_pd)
        if parent_prod_id and child_prod_id:
            if parent_prod_id in products and child_prod_id in products:
                products[parent_prod_id]["children"].append(child_prod_id)
                products[child_prod_id]["parent"] = parent_prod_id

    log.info("  Found %d assembly relationships", len(relationships))

    # Parse COLOUR_RGB entries
    colors: dict[int, dict] = {}
    color_pattern = re.compile(
        r"#(\d+)\s*=\s*COLOUR_RGB\s*\(\s*'([^']*)'\s*,\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)"
    )
    for match in color_pattern.finditer(content_clean):
        entity_id = int(match.group(1))
        name = match.group(2)
        r, g, b = float(match.group(3)), float(match.group(4)), float(match.group(5))
        colors[entity_id] = {"name": name, "r": round(r, 4), "g": round(g, 4), "b": round(b, 4)}

    log.info("  Found %d COLOUR_RGB entries", len(colors))

    # Free the large string now that parsing is done
    del content_clean

    # Build hierarchy tree iteratively (avoids recursion limit)
    roots = [pid for pid, p in products.items() if p["parent"] is None]

    def build_tree_iterative(root_ids: list[int]) -> list[dict]:
        trees = []
        for root_id in root_ids:
            # BFS to build tree
            root_node = {
                "name": products[root_id]["name"],
                "id": products[root_id]["id"],
                "entity_id": root_id,
                "depth": 0,
                "children": [],
            }
            queue: deque[tuple[dict, int]] = deque()  # (parent_node, product_id)
            for child_id in products[root_id]["children"]:
                queue.append((root_node, child_id))

            while queue:
                parent_node, prod_id = queue.popleft()
                prod = products[prod_id]
                child_node = {
                    "name": prod["name"],
                    "id": prod["id"],
                    "entity_id": prod_id,
                    "depth": parent_node["depth"] + 1,
                    "children": [],
                }
                parent_node["children"].append(child_node)
                for grandchild_id in prod["children"]:
                    queue.append((child_node, grandchild_id))

            trees.append(root_node)
        return trees

    tree = build_tree_iterative(roots)

    # Flatten for summary (iterative)
    flat_products: list[dict] = []
    stack: list[tuple[dict, str | None]] = [(t, None) for t in reversed(tree)]
    while stack:
        node, parent_name = stack.pop()
        flat_products.append({
            "name": node["name"],
            "id": node["id"],
            "parent": parent_name,
            "child_count": len(node["children"]),
            "depth": node["depth"],
        })
        for child in reversed(node["children"]):
            stack.append((child, node["name"]))

    return {
        "file": str(filepath),
        "total_products": len(products),
        "total_relationships": len(relationships),
        "total_colors": len(colors),
        "colors": list(colors.values()),
        "hierarchy": tree,
        "products_flat": flat_products,
    }


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
        log.info("Saved to %s", output)
    else:
        print(json.dumps(result, indent=2))
