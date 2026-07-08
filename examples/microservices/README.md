# Phoenix VCS — Microservices Example

A **spec-only** starter: three specs (API Gateway, User Service, Notification
Service) that Phoenix compiles into a working microservices platform. This
directory ships the specs; you generate the code yourself with the commands
below — nothing here is pre-generated.

## Layout

```
microservices/
  spec/
    api-gateway.md
    user-service.md
    notification-service.md
```

## Generate it

```bash
# From the phoenix repo root, build the CLI (one-time)
cd /path/to/phoenix
npm install && npm run build

# Enter this example
cd examples/microservices

# Initialize and compile the specs → code
node ../../dist/cli.js init --arch=sqlite-web-api
node ../../dist/cli.js bootstrap
```

Bootstrap runs the full pipeline: ingest → canonicalize → plan → generate →
scaffold → compile gate. With an LLM provider configured (ANTHROPIC_API_KEY /
OPENAI_API_KEY, or the Claude CLI) it generates real implementations; with none,
it produces typed, mountable stubs. Set `PHOENIX_NO_LLM=1` to force deterministic
stub generation.

## What you get

The exact counts depend on the pipeline and provider, but for these three specs
you should see roughly:

- **26** spec clauses across the three documents
- **~110** canonical nodes (requirements, constraints, invariants, definitions)
- **~15** Implementation Units, each with a risk tier, contract, and boundary policy
- Generated modules under `src/generated/`, wired together by the scaffold

Run `phoenix status` to see the trust dashboard, `phoenix journal` to see the
provenance chain, and `phoenix why <file>` to trace any generated file back to
the spec lines that produced it.

## Explore

```bash
node ../../dist/cli.js status          # trust dashboard — the primary UX
node ../../dist/cli.js clauses         # the ingested clauses
node ../../dist/cli.js canon           # the canonical graph
node ../../dist/cli.js plan            # the Implementation Units
node ../../dist/cli.js evals           # generate durable evaluations (the oracle)
node ../../dist/cli.js journal         # the append-only provenance chain
node ../../dist/cli.js why src/generated/<iu>/<iu>.ts   # trace code → spec
```

## Make a spec change (selective invalidation)

```bash
# Add a requirement to one service
echo "- The gateway must rate-limit requests to 100 per minute" >> spec/api-gateway.md

node ../../dist/cli.js ingest          # classifies the change, marks only the affected IU stale
node ../../dist/cli.js status          # shows the invalidation set + cause chain
node ../../dist/cli.js canonicalize
node ../../dist/cli.js plan
node ../../dist/cli.js regen            # selective by default — regenerates ONLY the stale subtree
```

Changing one spec line invalidates only the dependent subtree, not the whole
repository. That is the point.
