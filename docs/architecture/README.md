# TaskResponse — Architecture Diagrams

> BDATSI 6-view architecture for the AI Inbox Operations platform.
> Each file is an Excalidraw JSON — drag-and-drop onto [excalidraw.com](https://excalidraw.com) to view/edit.

## The 6 Views

| # | View | File | What it shows |
|---|---|---|---|
| 1 | **Boundary** | `01-boundary-view.excalidraw` | System context: actors, external services, and the TaskResponse system boundary |
| 2 | **Data** | `02-data-view.excalidraw` | Database schema: all tables, columns, relationships, retention policy |
| 3 | **Application** | `03-application-view.excalidraw` | Page hierarchy: marketing, onboarding, app pages, shared components |
| 4 | **Technology** | `04-technology-view.excalidraw` | Stack layers: framework, hosting, infra, APIs, version pins |
| 5 | **Security** | `05-security-view.excalidraw` | Trust boundaries: auth flows, encryption, RLS, non-negotiable rules |
| 6 | **Integration** | `06-integration-view.excalidraw` | Event & data flow: numbered processing pipeline from connect to auto-send |

## Theme

All diagrams use the **TaskResponse/Dreelio** design palette (warm creamy background `#f4f1ee`, semantic fills, `#8855ff` accent purple) for consistency with the web app.

## How to view

```bash
# Option 1: Open in browser
open https://excalidraw.com  # then drag-and-drop the .excalidraw file

# Option 2: Open file directly in Obsidian (if Excalidraw plugin installed)
# Ctrl/Cmd+P → Excalidraw: Open
```

## References

- [PRD](/docs/prd.md) — §X.Y anchors referenced in ticket descriptions
- [Architecture Levels](/docs/architecture/levels.md) — L1–L5 contract definitions
- [ADRs](/docs/decisions/) — Architecture Decision Records
