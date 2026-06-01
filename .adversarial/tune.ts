import { extractTerms } from '/Users/chad/src/phoenix/src/canonicalizer.js';

function jaccard(a: string, b: string) {
  const A = new Set(extractTerms(a));
  const B = new Set(extractTerms(b));
  const inter = [...A].filter(t => B.has(t)).length;
  const uni = new Set([...A, ...B]).size;
  return { d: 1 - inter / uni, A: [...A], B: [...B] };
}
function lev(a: string, b: string) {
  const m=a.length,n=b.length;const dp=Array.from({length:n+1},(_,i)=>i);
  for(let i=1;i<=m;i++){let prev=dp[0];dp[0]=i;for(let j=1;j<=n;j++){const t=dp[j];dp[j]=a[i-1]===b[j-1]?prev:1+Math.min(prev,dp[j],dp[j-1]);prev=t;}}
  return dp[n]/Math.max(m,n);
}

const pairs: [string,string][] = [
  [
    'the vendor shall deliver the equipment hardware software documentation training within thirty days',
    'the vendor shall provide the equipment hardware software documentation training within thirty days',
  ],
  [
    'contractor must supply hardware software documentation training warranty support maintenance services promptly',
    'contractor must supply hardware software documentation training warranty support maintenance upgrades promptly',
  ],
  [
    'the supplier shall deliver hardware software documentation training warranty within sixty business days here',
    'the supplier shall deliver hardware firmware documentation training warranty within sixty business days here',
  ],
];
for (const [a,b] of pairs) {
  const j = jaccard(a,b);
  console.log('norm=', lev(a,b).toFixed(3), 'jac=', j.d.toFixed(3));
}
