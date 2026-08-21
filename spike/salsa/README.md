# salsa spike

Does [salsa](https://github.com/salsa-rs/salsa) give Phoenix, by construction, the selective
invalidation Phoenix hand-rolls in `src/invalidation.ts`, `src/cascade.ts`, `src/semhash.ts`,
`src/warm-hasher.ts` and `src/iu-deps.ts`?

```bash
cargo test
```

16 tests. Each one asserts **how many simulated model calls an edit costs**, because that is
the only resource selective invalidation exists to conserve. There is no invalidation code in
this crate — every count is salsa's behaviour.

Findings, the recommendation, and what would reverse it:
[`docs/SALSA-INVESTIGATION.md`](../../docs/SALSA-INVESTIGATION.md).

This is a spike. The parser is a line splitter, "canonicalization" is a string rewrite, and
the generated code is a formatted comment block. The engine is what is under test.
