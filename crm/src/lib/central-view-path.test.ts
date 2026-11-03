import {describe,it,expect} from 'vitest';
import {safeCrmViewPath} from './central-view-path';
describe('CRM tab resume allowlist',()=>{
  it('retains allowed screen and filters',()=>{
    for(const path of ['/dashboard','/clientes?q=Ana&city=Campinas','/cotacoes/quote-1','/agenda?scope=mine'])expect(safeCrmViewPath(path)).toBe(path);
  });
  it('rejects external, auth, secrets, arbitrary routes and traversal escapes',()=>{
    for(const path of ['//evil.invalid','https://evil.invalid','/api/auth/signout','/clientes?token=secret','/clientes/../../admin','/clientes#fragment','/clientes\\admin',null])expect(safeCrmViewPath(path)).toBeNull();
  });
});
