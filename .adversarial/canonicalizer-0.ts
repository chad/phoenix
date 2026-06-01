
console.log('\n--- can colon DEFINITION EVER reach scoreSentence via extractFromClause? ---');
// Try several Term: Definition forms
const cases = [
  'Tenant: An isolated customer workspace.',
  'Idempotency: A property where repeated requests yield the same result.',
  'Quorum: The minimum number of nodes required.',
];
for (const r of cases) {
  console.log(JSON.stringify(r), '-> stripLeadingNoise:', JSON.stringify(stripLeadingNoise(r)));
}
