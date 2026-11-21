---
name: api-comfy-video
description: Inspect ComfyUI video nodes and repair their dependencies through ComfyUI Manager.
---

# ComfyUI video API

## Operations

- `GET /object_info` lists registered node classes and their live input schemas. Check for `RIFE VFI`, `AILab_FlashVSR` and `SeedVR2VideoUpscaler` before building comparison workflows.
- Manager's `GET /customnode/getlist?mode=cache&skip_update=true` discovers installed node IDs and active versions. Parse with a case-sensitive JSON parser: registry keys can differ only by case.
- `POST /manager/queue/fix` accepts JSON with `id`, `version` and `ui_id`; use the discovered ID and active version. Then call `GET /manager/queue/start`. Repairs can be deferred until startup.
- `GET /manager/queue/status` reports repair queue progress. Confirm success in startup logs and `/object_info`; queue completion alone does not establish that a node imports.
- `POST /customnode/install/pip` accepts a plain-text package list, subject to Manager's security policy. A `403` with `{"error":"security_level"}` means this repair is unavailable under the current policy.

## Notes

Manager repairs install each requirement separately. This can leave mutually incompatible package versions; inspect actual import errors after restart. Preserve logs and report the conflict if the targeted package repair is denied.

Manager's legacy reboot can leave the launcher reporting a stale running state. Confirm readiness before further API calls and recover failed startup through the launcher.
