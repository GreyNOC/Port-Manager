const test = require('node:test');
const assert = require('node:assert/strict');

const scanner = require('../lib/scanner');

test('classifyAddress separates localhost, local-network, and external addresses', () => {
  assert.equal(scanner.classifyAddress('127.0.0.1'), 'localhost');
  assert.equal(scanner.classifyAddress('[::1]'), 'localhost');
  assert.equal(scanner.classifyAddress('0.0.0.0'), 'local-network');
  assert.equal(scanner.classifyAddress('192.168.1.10'), 'local-network');
  assert.equal(scanner.classifyAddress('172.20.1.2'), 'local-network');
  assert.equal(scanner.classifyAddress('8.8.8.8'), 'external-or-system');
});

test('inferLabel uses command hints before common port fallback', () => {
  assert.equal(scanner.inferLabel('node', 'npm exec vite --host 127.0.0.1', 5173), 'Vite');
  assert.equal(scanner.inferLabel('python', 'python manage.py runserver', 8000), 'Django');
  assert.equal(scanner.inferLabel('unknown', '', 9229), 'Node inspector');
  assert.equal(scanner.inferLabel('unknown', '', 49152), 'Local server');
});

test('protected PID and stop-allowed logic blocks unsafe targets', () => {
  assert.equal(scanner.isProtectedPid(0), true);
  assert.equal(scanner.isProtectedPid(1), true);
  assert.equal(scanner.isProtectedPid(process.pid), true);
  assert.equal(scanner.isStopAllowed({ pid: 1, port: 3000, scope: 'localhost' }), false);
  assert.equal(scanner.isStopAllowed({ pid: 12345, port: 3000, scope: 'external-or-system' }), false);
  assert.equal(scanner.isStopAllowed({ pid: 12345, port: 3000, scope: 'localhost', ownedByCurrentUser: false }), false);
  assert.equal(scanner.isStopAllowed({ pid: 12345, port: 3000, scope: 'localhost', ownedByCurrentUser: true }), true);
  if (process.platform === 'win32') {
    assert.equal(scanner.isStopAllowed({ pid: 12345, port: 3000, scope: 'localhost', processName: 'lsass', ownedByCurrentUser: true }), false);
    assert.equal(scanner.isStopAllowed({ pid: 12345, port: 3000, scope: 'localhost', processName: 'node', ownedByCurrentUser: null }), false);
  }
});

test('parseEndpoint handles scanner endpoint formats', () => {
  assert.deepEqual(scanner.parseEndpoint('127.0.0.1:5173'), { address: '127.0.0.1', port: 5173 });
  assert.deepEqual(scanner.parseEndpoint('*:3000'), { address: '*', port: 3000 });
  assert.deepEqual(scanner.parseEndpoint('[::1]:9229'), { address: '::1', port: 9229 });
  assert.deepEqual(scanner.parseEndpoint('TCP 0.0.0.0:8080'), { address: '0.0.0.0', port: 8080 });
});

test('aggregate filters external listeners and merges addresses by pid and port', () => {
  const rows = [
    { pid: 54321, port: 3000, address: '127.0.0.1', processName: 'node', commandLine: 'node server.js' },
    { pid: 54321, port: 3000, address: '0.0.0.0', processName: 'node', commandLine: 'node server.js' },
    { pid: 54322, port: 80, address: '8.8.8.8', processName: 'system' }
  ];
  const result = scanner.aggregate(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].key, '54321:3000');
  assert.deepEqual(result[0].addresses.sort(), ['0.0.0.0', '127.0.0.1']);
  assert.equal(result[0].scope, 'localhost');
});
