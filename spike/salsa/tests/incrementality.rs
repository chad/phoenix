//! The experiment: what does an edit COST?
//!
//! Every assertion below is a count of simulated model calls, because that is the only
//! resource Phoenix's selective invalidation exists to conserve. The point is not that
//! salsa recomputes less — every incremental framework claims that — but that these
//! counts fall out of the engine, with no invalidation code written anywhere in the
//! spike. Compare `src/invalidation.ts`, `src/cascade.ts`, `src/semhash.ts`,
//! `src/warm-hasher.ts` and `src/iu-deps.ts` in the TypeScript implementation.

use phoenix_salsa_spike::*;
use salsa::{Durability, Setter};

const SPEC_V1: &str = "\
# Task API

## tasks

- A task has a title and a priority
- Users can create a task by providing a title
- A task title must not be empty

## stats

- Users can read a summary of progress
- The summary must reflect every change immediately
";

fn setup() -> (PhoenixDb, SpecDoc, PromptPack) {
    let db = PhoenixDb::default();
    let doc = SpecDoc::new(&db, "spec/tasks.md".to_string(), SPEC_V1.to_string());
    let pack = PromptPack::builder("promptpack-v1".to_string())
        .version_durability(Durability::HIGH)
        .new(&db);
    (db, doc, pack)
}

/// Edit a document, returning the calls the next build costs.
fn rebuild_after(db: &mut PhoenixDb, doc: SpecDoc, pack: PromptPack, text: &str) -> Vec<String> {
    doc.set_text(db).to(text.to_string());
    let _ = build(db, doc, pack);
    db.take_calls()
}

// ─── 1. What a cold build costs ──────────────────────────────────────────────

#[test]
fn a_cold_build_pays_for_every_clause_and_every_unit() {
    let (db, doc, pack) = setup();

    let files = build(&db, doc, pack);
    let calls = db.take_calls();

    assert_eq!(files.len(), 2, "one module per section");
    assert_eq!(calls.iter().filter(|c| c.starts_with("canonicalize:")).count(), 5);
    assert_eq!(calls.iter().filter(|c| c.starts_with("generate:")).count(), 2);
}

#[test]
fn asking_twice_costs_nothing() {
    let (db, doc, pack) = setup();
    let _ = build(&db, doc, pack);
    db.take_calls();

    let _ = build(&db, doc, pack);
    assert_eq!(db.take_calls(), Vec::<String>::new());
}

// ─── 2. A-class changes: formatting is not meaning ───────────────────────────

#[test]
fn a_formatting_only_edit_costs_nothing_at_all() {
    let (mut db, doc, pack) = setup();
    let _ = build(&db, doc, pack);
    db.take_calls();

    // Reindent, change the bullet character, add trailing whitespace and a full stop.
    let reformatted = SPEC_V1
        .replace("- A task has a title and a priority", "  * A task has a title and a priority.  ")
        .replace("- Users can read a summary of progress", "*    Users can read a summary of progress");

    let calls = rebuild_after(&mut db, doc, pack, &reformatted);

    // Phoenix's TypeScript pipeline gets here with a hand-written A/B/C/D classifier over
    // semantic hashes. Here it is the interning key: the normalised text is unchanged, so
    // the clause ids are unchanged, so nothing downstream is even asked.
    assert_eq!(calls, Vec::<String>::new(), "a formatting edit must not cost a single call");
}

#[test]
fn reordering_requirements_within_a_unit_costs_nothing() {
    let (mut db, doc, pack) = setup();
    let _ = build(&db, doc, pack);
    db.take_calls();

    let swapped = SPEC_V1.replace(
        "- Users can create a task by providing a title\n- A task title must not be empty",
        "- A task title must not be empty\n- Users can create a task by providing a title",
    );
    let calls = rebuild_after(&mut db, doc, pack, &swapped);

    // The clauses are unchanged, so canonicalization is free; the unit sorts its
    // statements, so its VALUE is unchanged and `generate` is backdated rather than re-run.
    assert_eq!(calls, Vec::<String>::new());
}

// ─── 3. The defining capability: one line changes, one subtree regenerates ───

#[test]
fn a_meaning_change_regenerates_only_its_own_unit() {
    let (mut db, doc, pack) = setup();
    let _ = build(&db, doc, pack);
    db.take_calls();

    let edited = SPEC_V1.replace(
        "- A task title must not be empty",
        "- A task title must not be empty and must not exceed 200 characters",
    );
    let calls = rebuild_after(&mut db, doc, pack, &edited);

    assert_eq!(
        calls.iter().filter(|c| c.starts_with("canonicalize:")).count(),
        1,
        "exactly the changed clause is re-extracted"
    );
    assert_eq!(
        calls.iter().filter(|c| c.starts_with("generate:")).collect::<Vec<_>>(),
        vec!["generate:tasks"],
        "the stats module must not be touched"
    );
}

#[test]
fn adding_a_requirement_to_one_section_leaves_the_other_alone() {
    let (mut db, doc, pack) = setup();
    let _ = build(&db, doc, pack);
    db.take_calls();

    let edited = SPEC_V1.replace(
        "## stats",
        "- Users can delete a task\n\n## stats",
    );
    let calls = rebuild_after(&mut db, doc, pack, &edited);

    assert_eq!(calls.iter().filter(|c| c.starts_with("canonicalize:")).count(), 1);
    assert_eq!(
        calls.iter().filter(|c| c.starts_with("generate:")).collect::<Vec<_>>(),
        vec!["generate:tasks"]
    );
}

#[test]
fn deleting_a_requirement_regenerates_only_its_unit() {
    let (mut db, doc, pack) = setup();
    let _ = build(&db, doc, pack);
    db.take_calls();

    let edited = SPEC_V1.replace("- The summary must reflect every change immediately\n", "");
    let calls = rebuild_after(&mut db, doc, pack, &edited);

    assert_eq!(calls.iter().filter(|c| c.starts_with("canonicalize:")).count(), 0,
        "nothing new to extract — deletion is free on the way in");
    assert_eq!(
        calls.iter().filter(|c| c.starts_with("generate:")).collect::<Vec<_>>(),
        vec!["generate:stats"]
    );
}

#[test]
fn a_clause_that_moves_between_documents_is_extracted_once() {
    let db = PhoenixDb::default();
    let pack = PromptPack::new(&db, "promptpack-v1".to_string());
    let a = SpecDoc::new(&db, "a.md".to_string(), "## tasks\n\n- Users can create a task\n".to_string());
    let b = SpecDoc::new(&db, "b.md".to_string(), "## tasks\n\n- Users can create a task\n".to_string());

    let _ = build(&db, a, pack);
    let first = db.take_calls();
    let _ = build(&db, b, pack);
    let second = db.take_calls();

    assert_eq!(first.len(), 2, "cold: one canonicalize, one generate");
    // The clause is interned by content and the unit is keyed by value, so the second
    // document is free. Phoenix's content-addressed store is the same idea, done by hand.
    assert_eq!(second, Vec::<String>::new(), "the identical clause is not extracted twice");
}

// ─── 4. Pace layers, spelled Durability ──────────────────────────────────────

#[test]
fn changing_the_prompt_pack_regenerates_code_without_re_extracting_meaning() {
    let (mut db, doc, pack) = setup();
    let _ = build(&db, doc, pack);
    db.take_calls();

    pack.set_version(&mut db).with_durability(Durability::HIGH).to("promptpack-v2".to_string());
    let _ = build(&db, doc, pack);
    let calls = db.take_calls();

    // How-to-generate changed; what-is-required did not. Canonicalization does not depend
    // on the pack, so the whole extraction half of the pipeline is untouched — the
    // separation Phoenix argues for in PRINCIPLES §V, enforced by the dependency graph
    // rather than by discipline.
    assert_eq!(calls.iter().filter(|c| c.starts_with("canonicalize:")).count(), 0);
    assert_eq!(calls.iter().filter(|c| c.starts_with("generate:")).count(), 2);
}

// ─── 5. The process boundary — the finding that decides the architecture ─────

#[test]
fn a_fresh_process_pays_the_whole_bill_again() {
    let (db, doc, pack) = setup();
    let _ = build(&db, doc, pack);
    assert_eq!(db.take_calls().len(), 7);

    // A CLI exits. Rebuild the same database from the same inputs: salsa's memo table
    // lives in memory, so every model call happens again.
    let db2 = PhoenixDb::default();
    let doc2 = SpecDoc::new(&db2, "spec/tasks.md".to_string(), SPEC_V1.to_string());
    let pack2 = PromptPack::new(&db2, "promptpack-v1".to_string());
    let _ = build(&db2, doc2, pack2);

    assert_eq!(db2.take_calls().len(), 7, "in-memory memoization does not survive `exit`");
}

#[test]
fn persistence_carries_the_memos_across_the_process_boundary() {
    let (mut db, doc, pack) = setup();
    let _ = build(&db, doc, pack);
    assert_eq!(db.take_calls().len(), 7);

    let saved = save(&mut db);

    // …the process exits here, and a new one starts.
    let restored = load(&saved);
    let _ = build(&restored, doc, pack);

    assert_eq!(
        restored.take_calls(),
        Vec::<String>::new(),
        "a restored database re-uses every memo — this is what makes salsa usable from a CLI"
    );
}

#[test]
fn a_restored_database_is_still_incremental() {
    let (mut db, doc, pack) = setup();
    let _ = build(&db, doc, pack);
    db.take_calls();
    let saved = save(&mut db);

    let mut restored = load(&saved);

    // Touch the graph before editing it. A restored database has not yet "initialised"
    // the ingredient for a tracked function that has not run in THIS process, and setting
    // an input first panics inside salsa 0.28's persistence prototype:
    //   "tracked function ingredients cannot be accessed before calling `init`"
    // Recorded in the investigation as a rough edge, with the one-line workaround.
    let _ = build(&restored, doc, pack);
    for clause in clauses(&restored, doc) {
        let _ = canonicalize(&restored, clause);
    }
    for iu in plan(&restored, doc) {
        let _ = generate(&restored, iu, pack);
    }
    assert_eq!(restored.take_calls(), Vec::<String>::new(), "warming is memo hits, not work");

    let edited = SPEC_V1.replace(
        "- A task title must not be empty",
        "- A task title must not be empty and must not exceed 200 characters",
    );
    let calls = rebuild_after(&mut restored, doc, pack, &edited);

    assert_eq!(calls.iter().filter(|c| c.starts_with("canonicalize:")).count(), 1);
    assert_eq!(
        calls.iter().filter(|c| c.starts_with("generate:")).collect::<Vec<_>>(),
        vec!["generate:tasks"],
        "selective invalidation survives serialization — the CLI cycle is intact"
    );
}

#[test]
fn the_saved_database_is_a_readable_artifact() {
    let (mut db, doc, pack) = setup();
    let _ = build(&db, doc, pack);
    let saved = save(&mut db);

    // It is JSON, so it can be inspected, diffed and (importantly for Phoenix) hashed —
    // but it is salsa's schema, not Phoenix's, and nothing in it explains itself.
    let parsed: serde_json::Value = serde_json::from_str(&saved).unwrap();
    assert!(parsed.get("ingredients").is_some());
    assert!(parsed.get("runtime").is_some());
    assert!(saved.len() > 500, "it really does carry the memo table");
    let _ = (doc, pack);
}

// ─── 6. Where the fit ends ───────────────────────────────────────────────────

#[test]
fn provenance_has_to_be_threaded_by_hand() {
    let (db, doc, pack) = setup();
    let files = build(&db, doc, pack);

    // Salsa KNOWS which clauses this file depended on — it recorded the edges to decide
    // whether to re-execute — but that graph is private plumbing, not a public artifact.
    // `phoenix why` is a product feature, so provenance is carried in the VALUE instead,
    // and the engine's own graph is used for nothing but invalidation.
    let tasks = files.iter().find(|f| f.path.contains("tasks")).unwrap();
    assert!(!tasks.from_clauses.is_empty());
    assert_eq!(tasks.prompt_pack, "promptpack-v1");
}

/// A model call is not a pure function, and salsa's whole contract is that queries are.
///
/// This test does not assert a defect in salsa; it measures the size of the problem the
/// real system would have to solve. A query whose output varies between executions can
/// never be backdated, so every re-execution — however incidental the cause — cascades
/// through everything downstream of it.
#[test]
fn a_nondeterministic_query_cascades_and_cannot_be_backdated() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NONCE: AtomicUsize = AtomicUsize::new(0);

    #[salsa::tracked(returns(clone))]
    fn flaky_generate<'db>(db: &'db dyn Db, iu: Iu<'db>) -> String {
        db.calls().record(format!("flaky:{}", iu.entity(db)));
        // A real model does this: same prompt, different-but-equivalent output.
        format!("// build {}\n{}", NONCE.fetch_add(1, Ordering::SeqCst), iu.statements(db).join("\n"))
    }

    #[salsa::tracked(returns(clone))]
    fn downstream<'db>(db: &'db dyn Db, iu: Iu<'db>) -> usize {
        db.calls().record(format!("downstream:{}", iu.entity(db)));
        flaky_generate(db, iu).len()
    }

    let (mut db, doc, pack) = setup();
    let _ = build(&db, doc, pack);
    let iu_entity = {
        let iu = plan(&db, doc).into_iter().next().unwrap();
        let e = iu.entity(&db).to_string();
        let _ = downstream(&db, iu);
        e
    };
    db.take_calls();

    // Touch an input the flaky query does not read, in a way that forces revalidation of
    // its inputs: the unit's statements are rebuilt identically…
    doc.set_text(&mut db).to(format!("{SPEC_V1}\n"));
    let iu2 = plan(&db, doc).into_iter().next().unwrap();
    assert_eq!(iu2.entity(&db), iu_entity, "the unit is the same unit");
    let _ = downstream(&db, iu2);
    let calls = db.take_calls();

    // …and nothing re-executed, because the unit's value never changed. Determinism only
    // becomes load-bearing when the query IS re-executed; that is the risk this records.
    assert!(!calls.iter().any(|c| c.starts_with("flaky:")), "value-keyed memo held");

    // Force the re-execution a real system cannot rule out (a new process with no memo,
    // a cache eviction, a prompt-pack bump) and the output differs even though the
    // requirement did not:
    let first = {
        let iu = plan(&db, doc).into_iter().next().unwrap();
        flaky_generate(&db, iu)
    };
    let db2 = PhoenixDb::default();
    let doc2 = SpecDoc::new(&db2, "spec/tasks.md".to_string(), SPEC_V1.to_string());
    let iu3 = plan(&db2, doc2).into_iter().next().unwrap();
    let second = flaky_generate(&db2, iu3);
    assert_ne!(first, second, "the same requirement produced different code on re-execution");
}

/// Phoenix's C-class change — "a contextual semantic shift" — is expressible here, and the
/// bill for it becomes visible instead of arguable.
///
/// The TypeScript pipeline hashes each clause twice: once alone (cold) and once with the
/// canonical graph around it (warm), then classifies edits with thresholds over those
/// hashes. In salsa the same idea is just a dependency: if extraction reads its
/// neighbours, it depends on its neighbours, and an edit re-extracts the whole
/// neighbourhood. No thresholds, no D-rate — but no cheap approximation either.
#[test]
fn context_sensitivity_is_a_dependency_you_can_see_and_price() {
    #[salsa::tracked(returns(clone))]
    fn section_context(db: &dyn Db, doc: SpecDoc, section: String) -> Vec<String> {
        clauses(db, doc)
            .into_iter()
            .filter(|c| c.section(db) == section)
            .map(|c| c.normalized(db).to_string())
            .collect()
    }

    #[salsa::tracked(returns(clone))]
    fn canonicalize_in_context<'db>(db: &'db dyn Db, clause: Clause<'db>, doc: SpecDoc) -> String {
        db.calls().record(format!("warm-canonicalize:{}", clause.normalized(db)));
        let ctx = section_context(db, doc, clause.section(db).to_string());
        format!("{} [in a section of {} requirements]", clause.normalized(db), ctx.len())
    }

    let (mut db, doc, _pack) = setup();
    for clause in clauses(&db, doc) {
        let _ = canonicalize_in_context(&db, clause, doc);
    }
    assert_eq!(db.take_calls().len(), 5);

    // Add one requirement to `tasks`. Cold extraction would cost 1 call; context-sensitive
    // extraction costs 4 — the new clause plus every sibling whose context just changed.
    // The `stats` section is untouched, so context does not mean "everything".
    let edited = SPEC_V1.replace("## stats", "- Users can delete a task\n\n## stats");
    doc.set_text(&mut db).to(edited);
    for clause in clauses(&db, doc) {
        let _ = canonicalize_in_context(&db, clause, doc);
    }
    let calls = db.take_calls();

    assert_eq!(calls.len(), 4, "the changed clause and its three section-mates");
    assert!(!calls.iter().any(|c| c.contains("summary")), "the other section is not context");
}
