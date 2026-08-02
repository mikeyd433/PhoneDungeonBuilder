import { readFileSync } from 'node:fs'
import { it } from 'vitest'
import { buildBrainstormPlan } from '@/features/import/brainstorm'
import { suggestSplit } from '@/features/import/split'

it('splits the real graph', () => {
  const data = JSON.parse(readFileSync('/root/.claude/uploads/69aad64a-77f4-54f2-bcd4-7aa3569e1e86/3062ec2a-brainstorm1785678967460.json','utf8'))
  const s = suggestSplit(data)!
  const det = (id:string)=> data.nodes.find((n:{id:string})=>n.id===id)?.data?.details ?? '-'
  const lbl = (id:string)=> (data.nodes.find((n:{id:string})=>n.id===id)?.data?.label ?? '').slice(0,58)
  console.log(`cut AT [${det(s.cutId)}] "${lbl(s.cutId)}"`)
  const menu = buildBrainstormPlan(data, { restrictTo: s.upstream, otherStoryName: 'The Delve' })
  const game = buildBrainstormPlan(data, { restrictTo: s.downstream, otherStoryName: 'Hotline' })
  for (const [n,p] of [['PHONE TREE',menu],['DUNGEON',game]] as const) {
    console.log(`\n${n}: ${p.nodes.length} rooms · ${p.choices.length} exits · entrance ${p.rootSlug}`)
    const root = p.nodes.find(x=>x.slug===p.rootSlug)!
    console.log(`  first room: "${root.narration.slice(0,70)}"`)
    console.log(`  its exits: ${p.choices.filter(c=>c.fromSlug===p.rootSlug).map(c=>`${c.digit}=${c.label.slice(0,18)}`).join('  ')}`)
  }
})
