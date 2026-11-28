# ClipChain — PC2, 2026-11-28

EP1 საქაღალდის ინდექსი გადამოწმდა: ქეშში 14,354 კლიპია, შეცდომა არ დაფიქსირებულა. საცდელ 2,000 კლიპზე შეიქმნა 744 სცენა და 2,000 ჯაჭვი. კლიპები ჯერ Wan2GP-ის პრომპტებით ჯგუფდება, შემდეგ კი DINOv2-ის ვიზუალური მსგავსებით იყოფა სცენებად და ლაგდება. ხუთივე საქაღალდის დამუშავება ფონურ რეჟიმში გრძელდება. შედეგები იხსნება მხოლოდ PC2-ზე, პორტზე 8040. საწყისი ვიდეოები ხელუხლებელია.

## Verified counts

| Input | Indexed clips | Scenes | Chains | Prompt groups |
| --- | ---: | ---: | ---: | ---: |
| Existing pilot cache | 2,000 | 744 | 2,000 | 475 |
| EP1 full index | 14,354 | Pending | Pending | Pending |

The pilot used zero confirmed continuation edges. A separate check verified that a supplied edge stays adjacent and directed even when its clips have different prompts. The worker accepts existing confirmed links at `D:/ClipChainWork/<folder>-reviewed-links.json`.

Prompt grouping uses Unicode normalization, unigram/bigram TF-IDF and connected components at cosine similarity ≥0.70. Blank prompts share a bucket for visual subdivision. DINOv2 scene subdivision uses average linkage at cosine distance 0.28, with K-means partitioning for groups above 256 chains. The existing cheapest-insertion path TSP heuristic and directed 2-opt order whole chains. Junction scores are end-to-start cosine distances. These are provisional grouping thresholds for storyboard review.

## Detached worker and review

Worker PID `108952` processes the ranked catalog folders in order with the existing metadata and DINOv2 caches. The local preview server on port 8040 returned HTTP 200 for the pilot and HTTP 404 for direct cache access. Each completed folder gets an `index.html` and `index.json` in the same directory.

| Source | Output directory | Preview when complete |
| --- | --- | --- |
| `F:/Epizods/EP1` | `D:/ClipChainWork/EP1` | [EP1](http://127.0.0.1:8040/EP1/index.html) |
| `F:/Result/studio` | `D:/ClipChainWork/studio` | [studio](http://127.0.0.1:8040/studio/index.html) |
| `F:/Epizods/EP6` | `D:/ClipChainWork/EP6` | [EP6](http://127.0.0.1:8040/EP6/index.html) |
| `F:/Epizods/Salon` | `D:/ClipChainWork/Salon` | [Salon](http://127.0.0.1:8040/Salon/index.html) |
| `F:/Epizods/TMP/MG` | `D:/ClipChainWork/MG` | [MG](http://127.0.0.1:8040/MG/index.html) |

Check the process and output logs in PowerShell. A completed folder prints a JSON count line. After the queue finishes, verify each count against its index and refresh the task board.

```powershell
Get-Process -Id 108952 -ErrorAction SilentlyContinue
Get-Content D:/ClipChainWork/content-20261128-143536-947.log -Tail 20
Get-Content D:/ClipChainWork/content-20261128-143536-947-errors.log -Tail 20
```
