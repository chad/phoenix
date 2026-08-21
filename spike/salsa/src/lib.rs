//! Phoenix's pipeline, expressed as salsa queries.
//!
//! This is a SPIKE, not a port. It exists to answer one question with running code rather
//! than opinion: **does salsa's incremental engine give Phoenix, for free and by
//! construction, the selective invalidation Phoenix currently hand-rolls?**
//!
//! The pipeline modelled here is the real one, shrunk to its skeleton:
//!
//! ```text
//!   SpecDoc (input)
//!     → clauses            parse + normalise; interned by normalised text
//!     → canonicalize       ONE SIMULATED LLM CALL PER CLAUSE
//!     → plan               cluster canonical requirements into implementation units
//!     → generate           ONE SIMULATED LLM CALL PER UNIT
//!     → build              the assembled set of files
//! ```
//!
//! Every simulated model call is counted. The tests then assert *how many calls* a given
//! spec edit costs — because in Phoenix the model call is the expensive thing, and the
//! only reason selective invalidation exists is to avoid paying for it twice. A framework
//! that gets the graph right and the call count wrong would be no use.
//!
//! Nothing here is Phoenix-quality: the parser is a line splitter, "canonicalization" is a
//! string rewrite, and the "generated code" is a formatted string. The engine's behaviour
//! is what is under test, not the pipeline's intelligence.

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

// ─── The database ────────────────────────────────────────────────────────────

/// The call log. Every simulated model call appends to it; the tests read it.
///
/// This is the spike's instrument, and it is deliberately a side channel rather than a
/// salsa accumulator: an accumulator is *recomputed* along with its query, which is
/// exactly the property that would hide the thing being measured.
#[derive(Default, Clone)]
pub struct CallLog(Arc<Mutex<Vec<String>>>);

impl CallLog {
    pub fn record(&self, what: impl Into<String>) {
        self.0.lock().unwrap().push(what.into());
    }
    pub fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }
    pub fn count(&self, prefix: &str) -> usize {
        self.0.lock().unwrap().iter().filter(|c| c.starts_with(prefix)).count()
    }
}

#[salsa::db]
pub trait Db: salsa::Database {
    fn calls(&self) -> &CallLog;
}

#[salsa::db]
#[derive(Clone, Default)]
pub struct PhoenixDb {
    storage: salsa::Storage<Self>,
    calls: CallLog,
}

#[salsa::db]
impl salsa::Database for PhoenixDb {}

#[salsa::db]
impl Db for PhoenixDb {
    fn calls(&self) -> &CallLog {
        &self.calls
    }
}

impl PhoenixDb {
    pub fn take_calls(&self) -> Vec<String> {
        self.calls.take()
    }
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

/// A spec document on disk. The one thing the outside world changes.
#[salsa::input(persist)]
pub struct SpecDoc {
    #[returns(deref)]
    pub path: String,
    #[returns(deref)]
    pub text: String,
}

/// The prompt pack / architecture target: how things are generated rather than what.
///
/// Phoenix's PRINCIPLES call this a pace layer — it changes far less often than a spec,
/// and when it changes, everything downstream is suspect. Salsa spells that `Durability`,
/// and the tests set this input HIGH so that editing a spec never walks its edges.
#[salsa::input(persist)]
pub struct PromptPack {
    #[returns(deref)]
    pub version: String,
}

// ─── Salsa structs for the intermediate graph ────────────────────────────────

/// A clause, interned by its NORMALISED text.
///
/// This is the whole A/B/C/D classifier's A-class, obtained structurally: two spec
/// versions that differ only in whitespace, bullet style or trailing punctuation produce
/// the *same interned id*, so every downstream memo stays valid without anyone computing
/// a similarity score or picking a threshold.
#[salsa::interned(persist)]
pub struct Clause<'db> {
    #[returns(deref)]
    pub normalized: String,
    #[returns(deref)]
    pub section: String,
}

/// A canonical requirement — what the "LLM" extracted from one clause.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, salsa::SalsaValue)]
pub struct CanonNode {
    pub entity: String,
    pub kind: CanonKind,
    pub statement: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, salsa::SalsaValue)]
pub enum CanonKind {
    Requirement,
    Constraint,
    Context,
}

/// An implementation unit: one entity's worth of canonical requirements.
///
/// Interned, so a unit's identity IS its content — Phoenix's content-addressed IU, with
/// the addressing done by the engine. Two specs that imply the same unit share one memo,
/// and an edit that leaves a unit's statements alone cannot reach `generate` at all.
#[salsa::interned(persist)]
pub struct Iu<'db> {
    #[returns(deref)]
    pub entity: String,
    /// Sorted, so that a reordering of the spec is not a change to the unit.
    #[returns(deref)]
    pub statements: Vec<String>,
}

/// A generated file, carrying the provenance Phoenix sells.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, salsa::SalsaValue)]
pub struct GeneratedFile {
    pub path: String,
    pub code: String,
    /// The clauses this file came from — see `provenance` in the investigation doc: salsa
    /// knows this internally and will not tell you, so it is threaded by hand.
    pub from_clauses: Vec<String>,
    pub prompt_pack: String,
}

// ─── The pipeline ────────────────────────────────────────────────────────────

/// Normalise a spec line the way Phoenix's clause parser does: collapse whitespace, drop
/// the bullet, drop trailing punctuation, lowercase. Formatting is not meaning.
fn normalize(line: &str) -> String {
    let stripped = line.trim().trim_start_matches(['-', '*', '+']).trim();
    let collapsed = stripped.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.trim_end_matches(['.', ';']).to_lowercase()
}

/// Parse a document into interned clauses.
///
/// Cheap and deterministic — no model call. It re-runs on every text edit, and that is
/// fine: what matters is that its RESULT is unchanged for a formatting edit, because
/// salsa then backdates it and nothing downstream runs.
#[salsa::tracked(persist, returns(clone))]
pub fn clauses(db: &dyn Db, doc: SpecDoc) -> Vec<Clause<'_>> {
    let mut section = String::from("(root)");
    let mut out = Vec::new();
    for line in doc.text(db).lines() {
        let t = line.trim();
        if let Some(heading) = t.strip_prefix("## ") {
            section = heading.trim().to_string();
            continue;
        }
        if t.starts_with('#') || t.is_empty() {
            continue;
        }
        let normalized = normalize(t);
        if normalized.is_empty() {
            continue;
        }
        out.push(Clause::new(db, normalized, section.clone()));
    }
    out
}

/// Canonicalize one clause. **This is a model call.**
///
/// Keyed on the interned clause, so the same sentence appearing in two documents, or
/// surviving an edit elsewhere in its own document, is extracted once — the memo is
/// content-addressed because the key is.
#[salsa::tracked(persist, returns(clone))]
pub fn canonicalize<'db>(db: &'db dyn Db, clause: Clause<'db>) -> CanonNode {
    db.calls().record(format!("canonicalize:{}", clause.normalized(db)));

    let text = clause.normalized(db);
    let kind = if text.contains("must") || text.contains("never") {
        CanonKind::Constraint
    } else if text.contains("users can") || text.contains("the system") {
        CanonKind::Requirement
    } else {
        CanonKind::Context
    };
    let entity = clause.section(db).to_lowercase();
    CanonNode { entity, kind, statement: text.to_string() }
}

/// Cluster canonical requirements into implementation units, one per entity.
#[salsa::tracked(persist, returns(clone))]
pub fn plan(db: &dyn Db, doc: SpecDoc) -> Vec<Iu<'_>> {
    let mut by_entity: std::collections::BTreeMap<String, Vec<String>> = Default::default();
    for clause in clauses(db, doc) {
        let node = canonicalize(db, clause);
        if node.kind == CanonKind::Context {
            continue;
        }
        by_entity.entry(node.entity).or_default().push(node.statement);
    }
    by_entity
        .into_iter()
        .map(|(entity, mut statements)| {
            statements.sort();
            Iu::new(db, entity, statements)
        })
        .collect()
}

/// Generate one module. **This is a model call.**
///
/// Keyed on the unit's VALUE, not on the document: two documents that imply the same unit
/// generate once, and a document edit that leaves a unit's statements untouched does not
/// reach this function at all.
#[salsa::tracked(persist, returns(clone))]
pub fn generate<'db>(db: &'db dyn Db, iu: Iu<'db>, pack: PromptPack) -> GeneratedFile {
    let entity = iu.entity(db);
    let statements = iu.statements(db);
    db.calls().record(format!("generate:{entity}"));

    let body = statements.iter().map(|s| format!("  // {s}")).collect::<Vec<_>>().join("\n");
    GeneratedFile {
        path: format!("src/generated/{entity}/{entity}.ts"),
        code: format!("export function {}() {{\n{body}\n}}\n", entity.replace(' ', "_")),
        from_clauses: statements.to_vec(),
        prompt_pack: pack.version(db).to_string(),
    }
}

/// The whole build.
#[salsa::tracked(persist, returns(clone))]
pub fn build(db: &dyn Db, doc: SpecDoc, pack: PromptPack) -> Vec<GeneratedFile> {
    plan(db, doc).into_iter().map(|iu| generate(db, iu, pack)).collect()
}

// ─── Persistence across processes ────────────────────────────────────────────

/// Serialize the whole memoized database — the thing a CLI has to do to survive its own
/// exit. Salsa 0.28 ships this as an experimental `persistence` feature.
pub fn save(db: &mut PhoenixDb) -> String {
    serde_json::to_string(&<dyn salsa::Database>::as_serialize(db)).expect("serialize")
}

/// Restore a database from a previous process's memos.
pub fn load(json: &str) -> PhoenixDb {
    let mut db = PhoenixDb::default();
    <dyn salsa::Database>::deserialize(&mut db, &mut serde_json::Deserializer::from_str(json))
        .expect("deserialize");
    db
}
