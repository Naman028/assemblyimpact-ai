import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { before, after, test } from 'node:test';

process.env.CDS_ENV = 'test';
const { default: cds } = await import('@sap/cds');
let server, base;
const entity = 'assemblyimpact.Assemblies';
const sample = (code = cds.utils.uuid()) => ({ assemblyCode: code, plant: '1000', description: 'Assembly' });

before(async () => {
  server = await cds.server({ port: 0, in_memory: true });
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/odata/v4/assembly-catalog`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await cds.db?.disconnect();
});

async function request(path = '/Assemblies', { user = 'maintainer', method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(base + path, {
    method, headers: {
      ...(user ? { authorization: `Basic ${Buffer.from(`${user}:test`).toString('base64')}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}), ...headers
    }, body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, etag: response.headers.get('etag') };
}
async function create(body = sample(), user = 'maintainer') {
  const result = await request('/Assemblies', { method: 'POST', body, user });
  assert.equal(result.status, 201, JSON.stringify(result));
  return result;
}
const key = id => `/Assemblies(${id})`;

test('model, SQLite constraint and service metadata', async () => {
  const model = await cds.load('*');
  assert(model.definitions['AssemblyCatalog.Assemblies']);
  const sql = cds.compile.to.sql(model, { dialect: 'sqlite' }).join('\n');
  assert.match(sql, /UNIQUE\s*\(assemblyCode, plant\)/);
  const metadata = await request('/$metadata', { user: 'viewer' });
  assert.equal(metadata.status, 200);
  assert.match(metadata.data, /EntitySet Name="Assemblies"/);
  assert.match(metadata.data, /OptimisticConcurrency/);
  const row = { ...sample(), ID: cds.utils.uuid() };
  await cds.db.run(INSERT.into(entity).entries(row));
  assert.equal((await cds.db.run(SELECT.one.from(entity).where({ ID: row.ID }))).description, row.description);
  await assert.rejects(cds.db.run(INSERT.into(entity).entries({ ...row, ID: cds.utils.uuid() })));
  await cds.db.run(INSERT.into(entity).entries({ ...row, ID: cds.utils.uuid(), plant: '2000' }));
  await assert.rejects(cds.db.run(INSERT.into(entity).entries({ ...row, ID: cds.utils.uuid(), assemblyCode: null })));
});

test('create, requiredness, format, types, lengths and relaxed identifiers', async () => {
  await create({ assemblyCode: 'mixed.case / 1', plant: 'a1', description: 'Valid description' });
  await create({ assemblyCode: 'a'.repeat(40), plant: 'abcd', description: 'a'.repeat(160) });
  await create({ ...sample(), description: '😀'.repeat(80) });
  assert.equal((await request('/Assemblies', { method: 'POST', body: { ...sample(), description: '😀'.repeat(81) } })).status, 400);
  for (const field of ['assemblyCode', 'plant', 'description']) {
    for (const value of [undefined, null, '', '   ', 42, true, {}, []]) {
      const result = await request('/Assemblies', { method: 'POST', body: { ...sample(), [field]: value } });
      assert.equal(result.status, 400, `${field}=${JSON.stringify(value)}: ${JSON.stringify(result)}`);
    }
  }
  for (const [field, length] of [['assemblyCode', 41], ['plant', 5], ['description', 161]]) {
    const result = await request('/Assemblies', { method: 'POST', body: { ...sample(), [field]: 'a'.repeat(length) } });
    assert.equal(result.status, 400, JSON.stringify(result));
  }
  assert.equal((await request('/Assemblies', { method: 'POST', body: { ...sample(), unknown: true } })).status, 400);
});

test('role and plant isolation on collection, counts, keys, creates and updates', async () => {
  const row = await create();
  const second = await create({ ...sample(), plant: '2000' }, 'other');
  for (const user of [null, 'unknown', 'alice', 'developer']) assert.equal((await request('/Assemblies', { user })).status, 401);
  for (const user of ['norole', 'missing', 'empty', 'malformed', 'wildcard', 'mixed']) {
    assert.equal((await request('/Assemblies', { user })).status, 403, user);
    assert.equal((await request('/Assemblies', { user, method: 'POST', body: sample() })).status, 403, user);
    assert.equal((await request(key(row.data.ID), { user })).status, 403, user);
    assert.equal((await request(key(row.data.ID), { user, method: 'PATCH', body: { description: 'Denied' }, headers: { 'if-match': row.etag } })).status, 403, user);
  }
  const visible = await request('/Assemblies?$count=true&$orderby=assemblyCode&$top=1000', { user: 'viewer' });
  assert.equal(visible.status, 200);
  assert(visible.data.value.every(row => row.plant === '1000'));
  assert.equal(visible.data['@odata.count'], visible.data.value.length);
  assert.equal((await request('/Assemblies?$filter=plant%20eq%20%272000%27', { user: 'viewer' })).data.value.length, 0);
  assert.equal((await request(key(second.data.ID), { user: 'viewer' })).status, 404);
  assert.equal((await request('/Assemblies', { user: 'viewer', method: 'POST', body: sample() })).status, 403);
  assert.equal((await request('/Assemblies', { method: 'POST', body: { ...sample(), plant: '2000' } })).status, 403);
  assert.equal((await request(key(row.data.ID), { user: 'viewer', method: 'PATCH', body: { description: 'Denied' }, headers: { 'if-match': row.etag } })).status, 403);
  const denied = await request(key(second.data.ID), { method: 'PATCH', body: { description: 'Denied' }, headers: { 'if-match': second.etag } });
  assert.equal(denied.status, 412);
  assert.equal((await request(key(second.data.ID), { user: 'other' })).data.description, 'Assembly');
  assert.equal((await request(key(second.data.ID), { user: 'multi' })).status, 200);
  const multi = await request('/Assemblies?$count=true', { user: 'multi' });
  assert(multi.data.value.some(row => row.plant === '1000'));
  assert(multi.data.value.some(row => row.plant === '2000'));
  assert.equal(multi.data['@odata.count'], multi.data.value.length);
  assert.equal((await request('/Assemblies', { user: 'viewer', headers: { 'x-user-roles': 'AssemblyMaintainer', 'x-user-plants': '2000' } })).data.value.some(row => row.plant === '2000'), false);
});

test('server-owned fields, immutable identity and conditional PATCH', async () => {
  const supplied = cds.utils.uuid();
  const row = await create({ ...sample(), ID: supplied, version: supplied, createdBy: 'spoof', modifiedBy: 'spoof', createdAt: '2000-01-01T00:00:00Z' });
  assert.notEqual(row.data.ID, supplied);
  assert.notEqual(row.data.version, supplied);
  assert.equal(row.data.createdBy, 'maintainer');
  assert.equal(row.data.modifiedBy, 'maintainer');
  assert.notEqual(row.data.createdAt, '2000-01-01T00:00:00Z');
  assert(row.etag);
  const path = key(row.data.ID);
  const update = (body, token) => request(path, { method: 'PATCH', body, headers: token ? { 'if-match': token } : {} });
  assert.equal((await update({ description: 'Changed' })).status, 428);
  for (const token of ['*', 'invalid', `${row.etag},${row.etag}`]) assert.equal((await update({ description: 'Changed' }, token)).status, 400);
  for (const field of ['assemblyCode', 'plant']) assert.equal((await update({ description: 'Changed', [field]: row.data[field] }, row.etag)).status, 400);
  for (const description of ['', ' ', null, 12, 'x'.repeat(161)]) assert.equal((await update({ description }, row.etag)).status, 400);
  const changed = await update({ ID: supplied, description: 'Changed', version: supplied, modifiedBy: 'spoof', createdBy: 'spoof', createdAt: '2000-01-01T00:00:00Z', modifiedAt: '2000-01-01T00:00:00Z' }, row.etag);
  assert([200, 204].includes(changed.status), JSON.stringify(changed));
  const current = await request(path);
  assert.equal(current.data.description, 'Changed');
  assert.equal(current.data.modifiedBy, 'maintainer');
  assert.equal(current.data.ID, row.data.ID);
  assert.equal(await cds.db.run(SELECT.one.from(entity).where({ ID: supplied })), undefined);
  assert.equal(current.data.createdAt, row.data.createdAt);
  assert.equal(current.data.createdBy, row.data.createdBy);
  assert.notEqual(current.data.modifiedAt, '2000-01-01T00:00:00Z');
  assert.notEqual(current.data.version, row.data.version);
  assert.notEqual(current.data.version, supplied);
  assert.equal((await update({ description: 'Stale' }, row.etag)).status, 412);
  const race = await Promise.all(['Race A', 'Race B'].map(description => update({ description }, current.etag)));
  assert.deepEqual(race.map(result => result.status).sort(), [200, 412]);
  const winner = await request(path);
  assert.equal(winner.data.description, ['Race A', 'Race B'][race.findIndex(result => result.status === 200)]);
  assert.notEqual(winner.etag, current.etag);
});

test('business uniqueness and concurrent create preserve one row', async () => {
  const data = sample();
  const results = await Promise.all([1, 2].map(() => request('/Assemblies', { method: 'POST', body: data })));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409], JSON.stringify(results));
  assert.equal((await cds.db.run(SELECT.from(entity).where({ assemblyCode: data.assemblyCode, plant: data.plant }))).length, 1);
  const error = JSON.stringify(results.find(result => result.status === 409).data);
  assert.doesNotMatch(error, /SQLITE|INSERT INTO|stack|UNIQUE constraint/);
  const conflict = results.find(result => result.status === 409).data.error;
  assert.equal(conflict.code, 'ASSEMBLY_ALREADY_EXISTS');
  assert.equal(conflict.target, 'assemblyCode');
  assert.equal(conflict.message, 'An assembly with this code and plant already exists.');
});

test('unsupported direct operations never change stored data', async () => {
  const row = await create();
  for (const [method, suffix] of [['PUT', ''], ['DELETE', ''], ['PUT', '/description'], ['PATCH', '/description'], ['DELETE', '/description'], ['PUT', '/description/$value'], ['PATCH', '/description/$value'], ['DELETE', '/description/$value']]) {
    const result = await request(key(row.data.ID) + suffix, { method, body: method === 'DELETE' ? undefined : { description: 'Forbidden' }, headers: { 'if-match': row.etag } });
    assert.equal(result.status, 405, JSON.stringify(result));
  }
  const missing = cds.utils.uuid();
  assert.equal((await request(key(missing), { method: 'PATCH', body: { description: 'No upsert' }, headers: { 'if-match': row.etag } })).status, 412);
  assert.equal(await cds.db.run(SELECT.one.from(entity).where({ ID: missing })), undefined);
  assert.equal((await request(key(row.data.ID))).data.description, row.data.description);
});

test('JSON batch checks inner authorization, methods, ETags and atomic rollback', async () => {
  const row = await create();
  const outside = await create({ ...sample(), plant: '2000' }, 'other');
  const batch = requests => request('/$batch', { method: 'POST', body: { requests } });
  const make = (id, method, url, body, token = row.etag) => ({ id, method, url, headers: { 'content-type': 'application/json', 'if-match': token }, ...(body ? { body } : {}) });
  for (const [method, suffix] of [['DELETE', ''], ['PUT', ''], ['PUT', '/description'], ['PATCH', '/description'], ['DELETE', '/description'], ['PUT', '/description/$value'], ['PATCH', '/description/$value'], ['DELETE', '/description/$value']]) {
    const result = await batch([make('1', method, `Assemblies(${row.data.ID})${suffix}`, method === 'DELETE' ? undefined : { description: 'Forbidden' })]);
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.data.responses[0].status, 405, JSON.stringify(result));
  }
  const denied = await batch([make('1', 'PATCH', `Assemblies(${outside.data.ID})`, { description: 'Forbidden' }, outside.etag)]);
  assert.equal(denied.data.responses[0].status, 412, JSON.stringify(denied));
  const wildcard = await batch([make('1', 'PATCH', `Assemblies(${row.data.ID})`, { description: 'Forbidden' }, '*')]);
  assert.equal(wildcard.data.responses[0].status, 400);
  const missingID = cds.utils.uuid();
  const missing = await batch([make('1', 'PATCH', `Assemblies(${missingID})`, { description: 'No upsert' })]);
  assert.equal(missing.data.responses[0].status, 412);
  assert.equal(await cds.db.run(SELECT.one.from(entity).where({ ID: missingID })), undefined);
  const visible = await batch([make('1', 'GET', 'Assemblies?$count=true')]);
  assert(visible.data.responses[0].body.value.every(row => ['1000', 'a1', 'abcd'].includes(row.plant)));
  const viewerWrite = await request('/$batch', { user: 'viewer', method: 'POST', body: { requests: [make('1', 'POST', 'Assemblies', sample())] } });
  assert.equal(viewerWrite.data.responses[0].status, 403);
  const valid = await batch([make('1', 'PATCH', `Assemblies(${row.data.ID})`, { description: 'Batch update' })]);
  assert.equal(valid.data.responses[0].status, 200, JSON.stringify(valid));
  const updated = await request(key(row.data.ID));
  assert.equal(updated.data.description, 'Batch update');
  assert.notEqual(updated.etag, row.etag);
  const data = sample();
  const atomic = await batch([
    { ...make('1', 'POST', 'Assemblies', data), atomicityGroup: 'group' },
    { ...make('2', 'POST', 'Assemblies', data), atomicityGroup: 'group', dependsOn: ['1'] }
  ]);
  assert.equal(atomic.status, 200, JSON.stringify(atomic));
  assert(atomic.data.responses.some(result => result.status === 409), JSON.stringify(atomic));
  assert.equal((await cds.db.run(SELECT.from(entity).where({ assemblyCode: data.assemblyCode }))).length, 0);
  assert.equal((await request(key(row.data.ID))).data.description, 'Batch update');
  assert.equal((await request(key(outside.data.ID), { user: 'other' })).data.description, 'Assembly');
});

test('multipart batch preserves method guards and conditional updates', async () => {
  const row = await create();
  const batch = (method, token) => {
    const boundary = 'batch_m03';
    const body = [
      `--${boundary}`, 'Content-Type: multipart/mixed; boundary=changeset_m03', '',
      '--changeset_m03', 'Content-Type: application/http', 'Content-Transfer-Encoding: binary',
      'Content-ID: 1', '', `${method} Assemblies(${row.data.ID}) HTTP/1.1`,
      'Content-Type: application/json', `If-Match: ${token}`, '',
      JSON.stringify({ description: 'Multipart update' }),
      '--changeset_m03--', `--${boundary}--`, ''
    ].join('\r\n');
    return request('/$batch', { method: 'POST', body, headers: { 'content-type': `multipart/mixed; boundary=${boundary}` } });
  };
  const denied = await batch('PUT', row.etag);
  assert.equal(denied.status, 200, JSON.stringify(denied));
  assert.match(denied.data, /HTTP\/1\.1 405/);
  assert.equal((await request(key(row.data.ID))).data.description, 'Assembly');
  const wildcard = await batch('PATCH', '*');
  assert.match(wildcard.data, /HTTP\/1\.1 400/);
  const changed = await batch('PATCH', row.etag);
  assert.match(changed.data, /HTTP\/1\.1 200/);
  const current = await request(key(row.data.ID));
  assert.equal(current.data.description, 'Multipart update');
  assert.notEqual(current.etag, row.etag);
});

test('UUID ETag contract across direct, JSON and multipart PATCH requests', async t => {
  for (const transport of ['direct', 'JSON batch', 'multipart batch']) {
    await t.test(transport, async () => {
      const row = await create();
      const path = key(row.data.ID);
      const patch = async (token, description) => {
        const headers = { 'content-type': 'application/json', ...(token === undefined ? {} : { 'if-match': token }) };
        const body = { description };
        if (transport === 'direct') return (await request(path, { method: 'PATCH', body, headers })).status;
        if (transport === 'JSON batch') {
          const response = await request('/$batch', { method: 'POST', body: {
            requests: [{ id: '1', method: 'PATCH', url: path.slice(1), headers, body }]
          } });
          assert.equal(response.status, 200, JSON.stringify(response));
          assert.equal(response.data.responses.length, 1);
          return response.data.responses[0].status;
        }
        const payload = [
          '--batch_etag', 'Content-Type: multipart/mixed; boundary=changeset_etag', '',
          '--changeset_etag', 'Content-Type: application/http', 'Content-Transfer-Encoding: binary',
          'Content-ID: 1', '', `PATCH ${path.slice(1)} HTTP/1.1`,
          'Content-Type: application/json', ...(token === undefined ? [] : [`If-Match: ${token}`]),
          '', JSON.stringify(body), '--changeset_etag--', '--batch_etag--', ''
        ].join('\r\n');
        const response = await request('/$batch', { method: 'POST', body: payload,
          headers: { 'content-type': 'multipart/mixed; boundary=batch_etag' } });
        assert.equal(response.status, 200, JSON.stringify(response));
        const statuses = [...response.data.matchAll(/HTTP\/1\.1 (\d{3})/g)];
        assert.equal(statuses.length, 1, response.data);
        return Number(statuses[0][1]);
      };
      const rejected = [
        [undefined, 428], ['*', 400], ['invalid', 400],
        ['"------------------------------------"', 400], ['"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"', 400],
        ['W/"------------------------------------"', 400], ['W/"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"', 400],
        [`${row.etag},${row.etag}`, 400],
        ['"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"', 412]
      ];
      for (const [token, status] of rejected) {
        assert.equal(await patch(token, 'Rejected change'), status, `${transport}: ${token}`);
        const persisted = await cds.db.run(SELECT.one.from(entity).where({ ID: row.data.ID }));
        assert.equal(persisted.description, row.data.description);
        assert.equal(persisted.version, row.data.version);
      }
      assert.equal(await patch(row.etag, 'Current token accepted'), 200);
      const updated = await request(path);
      assert.equal(updated.data.description, 'Current token accepted');
      assert.notEqual(updated.data.version, row.data.version);
      assert.notEqual(updated.etag, row.etag);
      assert.equal(await patch(row.etag, 'Stale change'), 412);
      const unchanged = await cds.db.run(SELECT.one.from(entity).where({ ID: row.data.ID }));
      assert.equal(unchanged.description, updated.data.description);
      assert.equal(unchanged.version, updated.data.version);
      // Both quoting forms supported by CAP must round-trip, without altering its payload.
      const alternate = updated.etag.startsWith('W/') ? updated.etag.slice(2) : `W/${updated.etag}`;
      assert.equal(await patch(alternate, 'Alternate quoting accepted'), 200);
      const current = await request(path);
      assert.equal(current.data.description, 'Alternate quoting accepted');
      assert.notEqual(current.data.version, updated.data.version);
      const race = await Promise.all(['Winner A', 'Winner B'].map(description => patch(current.etag, description)));
      assert.deepEqual([...race].sort(), [200, 412]);
      const winner = await cds.db.run(SELECT.one.from(entity).where({ ID: row.data.ID }));
      assert.equal(winner.description, ['Winner A', 'Winner B'][race.indexOf(200)]);
      assert.notEqual(winner.version, current.data.version);
    });
  }
});

test('production without a JWT provider fails before listening', async () => {
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    "import {Server} from 'node:net'; const listen=Server.prototype.listen; Server.prototype.listen=function(...args){console.log('UNEXPECTED_LISTEN');return listen.apply(this,args)}; const {default:cds}=await import('@sap/cds'); await cds.server({port:0,in_memory:true});"], {
    // BTP prep: production now also requires SAP HANA; an in-memory database isolates the authentication check.
    cwd: process.cwd(), env: { CDS_ENV: 'production', NODE_ENV: 'production', CDS_CONFIG: JSON.stringify({ requires: { db: { kind: 'sqlite', credentials: { url: ':memory:' } } } }) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    const [code, signal] = await once(child, 'exit');
    assert.equal(signal, null, output);
    assert.notEqual(code, 0, output);
    assert.match(output, /@sap\/xssec|Authentication kind|XSUAA/i);
    assert.doesNotMatch(output, /UNEXPECTED_LISTEN/);
  } finally { clearTimeout(timeout); child.kill(); }
});
