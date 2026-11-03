import {beforeEach,expect,it,vi} from 'vitest';
import {localCredentialProof,validLocalCredentialProof} from './local-credential-proof';
beforeEach(()=>vi.stubEnv('AUTH_SECRET','synthetic-local-session-secret'));
it('binds proof to account, password and server secret without exposing the hash',()=>{
 const token=localCredentialProof('local','hash-before-reset');
 expect(validLocalCredentialProof(token,'local','hash-before-reset')).toBe(true);
 expect(validLocalCredentialProof(token,'local','hash-after-reset')).toBe(false);
 expect(validLocalCredentialProof(token,'other','hash-before-reset')).toBe(false);
 expect(validLocalCredentialProof(undefined,'local','hash-before-reset')).toBe(false);
 expect(token).not.toContain('hash-before-reset');
 vi.stubEnv('AUTH_SECRET','different-secret');expect(validLocalCredentialProof(token,'local','hash-before-reset')).toBe(false);
});
