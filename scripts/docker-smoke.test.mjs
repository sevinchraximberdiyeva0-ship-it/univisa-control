import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smokeEnvironment,assertProject,publishedOrigin,redact } from './docker-smoke.mjs';
test('smoke credentials and resource names are generated independently with live sending off',()=>{
  const first=smokeEnvironment(),second=smokeEnvironment();assertProject(first.project);assert.notEqual(first.project,second.project);assert.notEqual(first.values.POSTGRES_PASSWORD,second.values.POSTGRES_PASSWORD);assert.match(first.values.ENCRYPTION_KEY,/^[a-f0-9]{64}$/);assert.equal(first.values.ALLOW_LIVE_NOTIFICATIONS,'false');assert.equal(first.values.SMS_MODE,'mock');assert.equal(first.values.TELEGRAM_MODE,'mock');assert.equal(first.values.NODE_ENV,'production');
});
test('cleanup resource guard rejects normal production project names',()=>{
  for(const project of ['univisa-control','production','univisa-smoke-','univisa-smoke-123456789012-extra',''])assert.throws(()=>assertProject(project));
});
test('only loopback published addresses are accepted',()=>{
  assert.equal(publishedOrigin('127.0.0.1:32768\n'),'http://127.0.0.1:32768');for(const address of ['0.0.0.0:8080','localhost:8080','127.0.0.1:0','127.0.0.1:65536','https://external.invalid'])assert.throws(()=>publishedOrigin(address));
});
test('generated secrets are redacted from diagnostic output',()=>{
  const secret='1234567890abcdefghijkl';assert.equal(redact(`failure: ${secret}`,[secret]),'failure: [redacted]');
});
