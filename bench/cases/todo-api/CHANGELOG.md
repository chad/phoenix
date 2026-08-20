# todo-api — fixture history

Every change here changes the **fixture digest**, which means runs recorded before it and
runs recorded after it were not asked the same question and are never pooled. The log
exists so that a digest boundary in `bench/results/todo-api.jsonl` has a reason attached
to it instead of being a mystery.

## `9fc6564bd1448cda` → the runtime contract states the health route

*2026-08-20*

The first coarse run put the `intent` arm at 0/5 **broke** — "app did not become healthy
within 60000ms" on every sample. Reading one of them showed an application that booted
fine, served `/tasks`, and exposed `/` rather than `/health`.

That was a harness artifact, not a finding. The oracle uses `GET /health` to decide when a
service is ready, exactly as it uses `PORT` to find it — a requirement of the *harness*,
not a convention of the pipeline. The `phoenix` and `baseline` arms were told about it
because the specification lists it under "HTTP interface"; the `intent` arm gets one
sentence and was therefore being scored for failing a rule nobody gave it.

The runtime contract — which every arm is told verbatim — now states it. Prior runs stay
in the results under the old digest, uncomparable to the new ones by construction.
