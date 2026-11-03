import {describe,it,expect} from 'vitest';
import {safeCentralNext} from './central-navigation';
describe('SSO next destination allowlist',()=>{
  it('accepts customer and compact context routes only',()=>{
    expect(safeCentralNext('/clientes/customer-1')).toBe('/clientes/customer-1');
    expect(safeCentralNext('/central-context?conversationId=conv-1')).toBe('/central-context?conversationId=conv-1');
  });
  it('accepts the activity center per company and a single agenda item',()=>{
    expect(safeCentralNext('/central-activities?company=mibro')).toBe('/central-activities?company=mibro');
    expect(safeCentralNext('/agenda?open=appt_1')).toBe('/agenda?open=appt_1');
    for(const value of ['/central-activities?company=outra','/central-activities?company=mibro&scope=team','/agenda?open=a&novo=1','/agenda?open=../x'])expect(safeCentralNext(value)).toBe('/dashboard');
  });
  it('rejects external URLs, traversal, extra queries and injected markup',()=>{
    for(const value of ['https://evil.invalid','//evil.invalid','/clientes/../admin','/central-context?conversationId=one&next=//evil.invalid','/clientes/a" onload="x',null])expect(safeCentralNext(value)).toBe('/dashboard');
  });
});
