import {describe,it,expect} from 'vitest';
import {proposalOriginId,withProposalOrigin} from './proposal-origin';
import {safeCentralNext} from './central-navigation';
describe('proposal return navigation',()=>{
 it('preserves the same origin on autosave and finalization',()=>{
  expect(withProposalOrigin('/cotacoes/nova?id=q1','c1')).toBe('/cotacoes/nova?id=q1&atendimento=c1');
  expect(withProposalOrigin('/cotacoes/q1','c1')).toBe('/cotacoes/q1?atendimento=c1');
 });
 it('ignores invalid identifiers and never transports a redirect',()=>{
  for(const v of ['../bad','https://other','id&redirect=x','a'.repeat(129),null,{}])expect(proposalOriginId(v)).toBeUndefined();
  expect(withProposalOrigin('/cotacoes/q1','../bad')).toBe('/cotacoes/q1');
 });
 it('allows only the exact initial proposal path through SSO',()=>{
  const path='/cotacoes/nova?cliente=customer&atendimento=conversation';expect(safeCentralNext(path)).toBe(path);
  expect(safeCentralNext(path+'&next=https://other')).toBe('/dashboard');
 });
});
