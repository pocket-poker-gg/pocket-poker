import assert from 'node:assert/strict';
import pokersolver from 'pokersolver';
const { Hand } = pokersolver;
const cards=[...'cdhs'].flatMap(s=>[...'23456789TJQKA'].map(r=>r+s));
const counts={}; let total=0;
for(let a=0;a<48;a++) for(let b=a+1;b<49;b++) for(let c=b+1;c<50;c++) for(let d=c+1;d<51;d++) for(let e=d+1;e<52;e++) {
  const name=Hand.solve([cards[a],cards[b],cards[c],cards[d],cards[e]]).name;
  counts[name]=(counts[name]||0)+1; total++;
}
assert.equal(total,2598960);
assert.deepEqual(counts,{
  'High Card':1302540,'Pair':1098240,'Two Pair':123552,'Three of a Kind':54912,
  'Straight':10200,'Flush':5108,'Full House':3744,'Four of a Kind':624,'Straight Flush':40,
});
console.log(JSON.stringify({total,counts}));
