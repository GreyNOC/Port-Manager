const test = require('node:test');
const assert = require('node:assert/strict');

const cli = require('../bin/greynoc-port-manager');

test('parseArgv parses commands, booleans, and option values', () => {
  const parsed = cli.parseArgv(['list', '--scope', 'localhost', '--filter=vite', '--json', '-y']);
  assert.deepEqual(parsed._, ['list']);
  assert.equal(parsed.options.scope, 'localhost');
  assert.equal(parsed.options.filter, 'vite');
  assert.equal(parsed.options.json, true);
  assert.equal(parsed.options.yes, true);
});

test('splitCommandLine parses interactive command input', () => {
  assert.deepEqual(cli.splitCommandLine('stop 5173'), ['stop', '5173']);
  assert.deepEqual(cli.splitCommandLine('timer 5173 5m --yes'), ['timer', '5173', '5m', '--yes']);
  assert.deepEqual(cli.splitCommandLine('list --filter "vite dev"'), ['list', '--filter', 'vite dev']);
  assert.throws(() => cli.splitCommandLine('list "unterminated'), /Unclosed/);
});

test('buildRequest converts numeric PID, port, and duration shorthand', () => {
  const request = cli.buildRequest({
    pid: '1234',
    port: '5173',
    seconds: '5m',
    key: '1234:5173',
    'command-line': 'node server.js'
  });
  assert.deepEqual(request, {
    pid: 1234,
    port: 5173,
    seconds: 300,
    key: '1234:5173',
    commandLine: 'node server.js'
  });
});

test('filterServers applies scope and text filters', () => {
  const servers = [
    { key: '1:3000', pid: 1, port: 3000, processName: 'node', label: 'Vite', scope: 'localhost', addresses: ['127.0.0.1'] },
    { key: '2:8080', pid: 2, port: 8080, processName: 'java', label: 'Proxy', scope: 'local-network', addresses: ['0.0.0.0'] }
  ];
  assert.deepEqual(cli.filterServers(servers, { scope: 'localhost' }).map((server) => server.key), ['1:3000']);
  assert.deepEqual(cli.filterServers(servers, { scope: 'all', filter: 'proxy' }).map((server) => server.key), ['2:8080']);
  assert.throws(() => cli.filterServers(servers, { scope: 'external' }), /--scope/);
});
