---
apiVersion: codebase-profile/v2
kind: CodebaseProfile
metadata:
  name: vikunja-mcp
  repo_url: git@github.com:LukaVodopivec/vikunja-mcp.git
  git_sha: 8ffeff6db72e2169c50eed19d8c1952e9a1646a9
  git_branch: main
  inputs_hash: 98320b4bc9e2857eb51843856b1c414b74796c7b185e84ddc55c9808bd537609
  generated_at: 2026-05-17T10:12:27Z
  generated_by: codebase-profile skill v2
  tool_versions:
    node: 20.20.2
    typescript: latest
spec:
  stack:
    languages:
      - name: TypeScript
        percentage: 85
      - name: JavaScript
        percentage: 15
    frameworks:
      - Model Context Protocol (MCP)
      - node-vikunja SDK
    runtime: Node.js 20.20.2
    build: npm
  app_type:
    kind: library
    public_surface:
      - MCP Protocol (subcommand-based tools)
      - HTTP via underlying Vikunja API
  modules:
    - path: src/auth
      purpose: Session authentication, token management
    - path: src/client
      purpose: Vikunja API client factory and wrapper
    - path: src/config
      purpose: Configuration management and environment handling
    - path: src/tools
      purpose: MCP tool implementations (tasks, projects, users, labels, teams, webhooks)
    - path: src/storage
      purpose: Filter storage and query serialization
    - path: src/middleware
      purpose: Rate limiting and direct middleware
    - path: src/utils
      purpose: Cross-cutting utilities (validation, filtering, security, error handling)
    - path: src/services
      purpose: Domain services (entity resolution, task creation)
    - path: src/formatters
      purpose: Response formatting
    - path: src/parsers
      purpose: CSV/JSON input parsing
  dependency_graph:
    - from: src/tools
      to: [src/auth, src/client, src/utils, src/services, src/formatters]
    - from: src/services
      to: [src/client, src/utils, src/types]
    - from: src/client
      to: [node-vikunja, src/auth]
    - from: src/middleware
      to: [src/utils]
    - from: src/utils/filtering
      to: [src/types]
  entry_points:
    - kind: http
      value: MCP server (stdio transport)
      source: src/index.ts
    - kind: cli
      value: start-mcp.sh
      source: start-mcp.sh
  cross_cutting:
    auth: src/auth/AuthManager.ts — session-based with token management
    logging: src/utils/logger.ts — structured logging
    config: src/config/ConfigurationManager.ts — environment variables + ConfigurationManager
    feature_flags: none
    observability: src/utils/performance/performance-monitor.ts — performance tracking + opossum circuit breaker metrics
    error_handling: src/types/errors.ts — typed error classes + centralized src/utils/error-handler.ts
  storage:
    - Primary: Vikunja instance via node-vikunja SDK (no local DB)
    - Caches: none (stateless MCP server)
    - Queues: none
  integrations:
    - node-vikunja (Vikunja API client)
    - zod (input validation)
    - opossum (circuit breaker)
  testing:
    frameworks:
      - Vitest
      - Jest (legacy)
    counts:
      unit: ~80
      integration: ~30
      e2e: ~20
    coverage: unknown
  anti_patterns:
    - Over-engineered storage layer (refactored in v0.2.0 from 33 files / 9,803 LOC to 4 files)
    - SDK method bypassing for label operations (direct fetch used instead of node-vikunja bulk endpoint)
    - Task-update cascades causing unintended bucket resets
  adjacent_research:
    - docs/VIKUNJA_API_ISSUES.md — SDK limitations and workarounds
    - docs/SECURITY_AUDIT_REPORT.md — DoS protection, input validation strategy
    - docs/BULK_OPERATIONS_PERFORMANCE_OPTIMIZATION.md — batch performance tuning
    - ARCHITECTURE_SIMPLIFICATION.md — v0.2.0 refactoring rationale
---

# Codebase Profile — vikunja-mcp

## Stack
- **Languages**: TypeScript (~85%), JavaScript (~15%)
- **Frameworks**: Model Context Protocol (MCP), node-vikunja SDK
- **Runtime**: Node.js 20.20.2
- **Build / package manager**: npm

## App-type
- **Kind**: Library / MCP Server
- **Public surface**: MCP Protocol (subcommand-based tools), HTTP via Vikunja API integration

## Modules
Top-level modules implementing task management, project management, and user operations:

- `src/auth` — Session authentication and token management
- `src/client` — Vikunja API client factory and lifecycle management
- `src/config` — Configuration and environment variable handling
- `src/tools` — MCP tool implementations (tasks, projects, users, labels, teams, webhooks, batch import)
- `src/storage` — Filter storage, serialization, and query execution
- `src/middleware` — Rate limiting, DoS protection, direct HTTP middleware
- `src/utils` — Cross-cutting utilities (filtering, validation, security, error handling, performance monitoring)
- `src/services` — Domain services (entity resolution, task creation, batch processing)
- `src/formatters` — Response formatting and transformation
- `src/parsers` — Input parsing (CSV, JSON)

## Dependency graph
src/tools → [src/auth, src/client, src/utils, src/services, src/formatters]
src/services → [src/client, src/utils, src/types]
src/client → [node-vikunja, src/auth]
src/middleware → [src/utils]
src/utils/filtering → [src/types, src/storage]

## Entry points
- **MCP server**: stdio transport (src/index.ts) — main entry point
- **Shell startup**: start-mcp.sh — convenience launcher script

## Cross-cutting concerns
- **Auth**: Session-based authentication via src/auth/AuthManager.ts with automatic token renewal
- **Logging**: Structured logging via src/utils/logger.ts
- **Config**: Environment variables + ConfigurationManager (src/config/ConfigurationManager.ts)
- **Feature flags**: None implemented
- **Observability**: Performance monitoring (src/utils/performance/performance-monitor.ts) + opossum circuit breaker for API resilience
- **Error handling**: Typed error classes (src/types/errors.ts) with centralized handler (src/utils/error-handler.ts)

## Storage & integrations
- **Primary backend**: Vikunja instance (stateless MCP server; all data persisted remotely via node-vikunja SDK)
- **Caches**: None (stateless)
- **Queues**: None
- **External APIs**: 
  - `node-vikunja` — Vikunja task/project API client
  - `zod` — Type-safe input validation
  - `opossum` — Circuit breaker for API resilience

## Testing shape
- **Unit framework**: Vitest
- **Integration framework**: Vitest + Jest (legacy)
- **E2E framework**: Manual MCP validation scripts
- **Approximate counts**: ~80 unit, ~30 integration, ~20 validation tests
- **Fixture style**: Mock objects via __mocks__/node-vikunja.ts
- **Coverage**: Unknown (test suite is comprehensive; coverage metrics not indexed)

## Known anti-patterns in this repo
- **Over-engineered storage (pre-v0.2.0)**: Original 33-file / 9,803-LOC storage system refactored to 4 files with equivalent external API. Eliminated: health monitors, migration systems, statistics tracking.
- **SDK method bypassing**: Label operations bypass node-vikunja bulk endpoint (broken upstream); use direct fetch instead. See commit 8ffeff6.
- **Task-update cascades**: Label-only updates previously reset bucket state; see commit 6e44654 fix.

## Adjacent research
- **docs/VIKUNJA_API_ISSUES.md** — Known Vikunja API limitations and MCP workarounds
- **docs/SECURITY_AUDIT_REPORT.md** — DoS protection strategy, input validation rules, rate-limiting design
- **docs/BULK_OPERATIONS_PERFORMANCE_OPTIMIZATION.md** — Batch operation tuning and payload sizing
- **ARCHITECTURE_SIMPLIFICATION.md** — v0.2.0 refactoring rationale and code reduction metrics
