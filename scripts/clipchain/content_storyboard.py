"""Build a prompt-first storyboard from a ClipChain frame and DINOv2 cache."""

import argparse
from collections import defaultdict
import html
import json
from pathlib import Path
import re
import sqlite3
import tempfile
import unicodedata

import numpy as np
from scipy.sparse import vstack
from scipy.sparse.csgraph import connected_components
from sklearn.cluster import AgglomerativeClustering, KMeans
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.neighbors import NearestNeighbors

from storyboard import make_chains, order, page


def normalize(prompt):
    return " ".join(re.findall(r"[^\W_]+", unicodedata.normalize("NFKC", prompt).casefold()))


def prompt_groups(prompts):
    groups = defaultdict(list)
    for index, prompt in enumerate(prompts):
        groups[prompt].append(index)
    distinct = sorted(groups.keys() - {""})
    result = []
    if distinct:
        features = TfidfVectorizer(token_pattern=r"(?u)\b\w+\b",
                                   ngram_range=(1, 2)).fit_transform(distinct)
        neighbors = NearestNeighbors(metric="cosine", algorithm="brute").fit(features)
        graph = vstack([
            neighbors.radius_neighbors_graph(features[start:start + 256], radius=0.30)
            for start in range(0, len(distinct), 256)
        ])
        _, labels = connected_components(graph, directed=False)
        merged = defaultdict(list)
        for prompt, label in zip(distinct, labels):
            merged[int(label)].extend(groups[prompt])
        result.extend(merged.values())
    if "" in groups:
        result.append(groups[""])
    return result


def visual_groups(group, means):
    if len(group) < 2:
        yield group
        return
    vectors = means[group]
    if len(group) > 256:
        labels = KMeans(n_clusters=2, n_init=3, random_state=0).fit_predict(vectors)
        if labels.min() == labels.max():
            # K-means has no meaningful partition for identical embeddings.
            labels[len(group) // 2:] = 1
        for label in (0, 1):
            yield from visual_groups([item for item, value in zip(group, labels)
                                      if value == label], means)
        return
    distance = np.clip(1 - vectors @ vectors.T, 0, 2)
    np.fill_diagonal(distance, 0)
    labels = AgglomerativeClustering(
        n_clusters=None, metric="precomputed", linkage="average", distance_threshold=0.28,
    ).fit_predict(distance)
    for label in sorted(set(labels)):
        yield [item for item, value in zip(group, labels) if value == label]


def arrange(records, edges):
    chains = make_chains({row[0]: i for i, row in enumerate(records)}, edges)
    by_pair = {(edge["from"], edge["to"]): edge for edge in edges}
    vectors = np.stack([np.frombuffer(row[3], dtype=np.float32).reshape(3, -1)
                        for row in records])
    heads = vectors[[chain[0] for chain in chains], 0]
    tails = vectors[[chain[-1] for chain in chains], 2]
    means = np.stack([vectors[chain].mean(axis=(0, 1)) for chain in chains])
    means /= np.maximum(np.linalg.norm(means, axis=1, keepdims=True), 1e-8)
    prompts = []
    for chain in chains:
        text = [json.loads(records[item][1]).get("prompt") for item in chain]
        normalized = dict.fromkeys(normalize(p) for p in text if isinstance(p, str))
        normalized.pop("", None)
        prompts.append(" ".join(normalized))
    groups = prompt_groups(prompts)
    scenes, index = [], {}
    for group_id, group in enumerate(groups):
        for members in visual_groups(group, means):
            costs = np.clip(1 - tails[members] @ heads[members].T, 0, 2)
            sequence = order(list(range(len(members))), costs)
            scene = []
            offset = 0
            for position, local in enumerate(sequence):
                chain = members[local]
                names = [records[item][0] for item in chains[chain]]
                cost = float(costs[sequence[position - 1], local]) if position else None
                for name in names:
                    index[name] = {"scene": len(scenes), "chain": chain, "order": offset,
                                   "prompt_group": group_id}
                    offset += 1
                scene.append({
                    "chain": chain, "clips": names, "prompt_group": group_id,
                    "prompt": prompts[chain],
                    "links": [by_pair[a, b] for a, b in zip(names, names[1:])],
                    "transition_cost": cost,
                    "junction": None if cost is None else ("good" if cost <= 0.18 else "weak"),
                })
            scenes.append(scene)
    return scenes, index, {"clips": len(records), "scenes": len(scenes),
                           "chains": len(chains), "prompt_groups": len(groups),
                           "continuation_links": len(edges)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--links", type=Path, help="Existing confirmed continuation links")
    parser.add_argument("--limit", type=int, default=-1)
    options = parser.parse_args()
    with sqlite3.connect(options.cache.resolve(strict=True).as_uri() + "?mode=ro", uri=True) as db:
        records = db.execute("""SELECT clips.path, clips.metadata, clips.middle, embeddings.vectors
            FROM clips JOIN embeddings ON embeddings.path = clips.path
                AND embeddings.size = clips.size AND embeddings.mtime = clips.mtime
            ORDER BY clips.path LIMIT ?""", (options.limit,)).fetchall()
        if options.limit < 0 and len(records) != db.execute("SELECT count(*) FROM clips").fetchone()[0]:
            parser.error("Embedding cache is incomplete")
    if not records:
        parser.error("No DINOv2 embeddings found")
    edges = json.loads(options.links.read_text(encoding="utf-8")) if options.links else []
    scenes, index, counts = arrange(records, edges)
    labels = iter(
        f"Prompt group {scene[0]['prompt_group'] + 1} · "
        + html.escape(next((chain["prompt"] for chain in scene if chain["prompt"]), "No prompt"))
        for scene in scenes
    )
    document = re.sub(r"(<section><h2>Scene \d+</h2>)",
                      lambda match: f"{match[1]}<details><summary>Prompt</summary>"
                                    f"<p>{next(labels)}</p></details>", page(records, scenes))
    staging = Path(tempfile.mkdtemp(prefix=f".{options.output.name}-", dir=options.output.parent))
    with (staging / "index.html").open("x", encoding="utf-8") as stream:
        stream.write(document)
    with (staging / "index.json").open("x", encoding="utf-8") as stream:
        json.dump({"counts": counts, "clips": index, "scenes": scenes}, stream, ensure_ascii=False)
    staging.rename(options.output)
    print(json.dumps(counts), flush=True)


if __name__ == "__main__":
    main()
