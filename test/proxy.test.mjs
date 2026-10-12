import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);

for (const protocol of ['http', 'https']) {
  test(`manifest runtime proxies ${protocol.toUpperCase()} classification and naming, respects NO_PROXY, and supports direct access`, { timeout: 15000 }, async (t) => {
    const requests = [];
    const tunnels = [];
    const sockets = new Set();
    const proxyPorts = new Set();
    const certPath = fileURLToPath(new URL('./fixtures/tls/localhost-cert.pem', import.meta.url));
    const tls = protocol === 'https' ? {
      cert: await readFile(certPath),
      key: await readFile(new URL('./fixtures/tls/localhost-key.pem', import.meta.url)),
    } : null;
    const handleRequest = async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      requests.push({ path: req.url, model: JSON.parse(body).model, proxied: proxyPorts.has(req.socket.remotePort) });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.url === '/systemone'
        ? { answers: { task: { type: 'choice', choice: 'new_task', confidence: 1,
          probabilities: { same_task: 0, new_task: 1, uncertain: 0 } } } }
        : { choices: [{ message: { content: JSON.stringify({
          decision: 'new_task', summary: 'Fix proxy support', name: 'fix-proxy',
        }) } }] }));
    };
    const backend = tls ? createSecureServer(tls, handleRequest) : createServer(handleRequest);
    const proxy = createServer();
    // Include raw connections so teardown also closes incomplete TLS handshakes.
    for (const server of [backend, proxy]) {
      server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
      });
    }
    t.after(async () => {
      for (const socket of sockets) socket.destroy();
      proxy.closeAllConnections();
      backend.closeAllConnections();
      await Promise.all([proxy, backend].map((server) => new Promise((resolve) => server.close(resolve))));
    });
    await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
    proxy.on('connect', (req, socket, head) => {
      tunnels.push(req.url);
      const upstream = connect(backend.address().port, '127.0.0.1', () => {
        proxyPorts.add(upstream.localPort);
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
      sockets.add(upstream);
      socket.on('error', () => upstream.destroy());
      upstream.on('error', () => socket.destroy());
      socket.on('close', () => { sockets.delete(socket); upstream.destroy(); });
      upstream.on('close', () => sockets.delete(upstream));
    });
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));

    const manifest = await readFile(new URL('../herdr-plugin.toml', import.meta.url), 'utf8');
    const command = JSON.parse(manifest.match(/on = "pane.agent_detected"\s+command = (\[[^\n]*\])/)[1]);
    const flags = command.slice(1, command.indexOf('src/main.mjs'));
    const baseUrl = `${protocol}://127.0.0.1:${backend.address().port}`;
    const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
    const config = { provider: 'deepseek', model: 'mock-naming', apiKey: 'test-key', baseUrl,
      classifier: { provider: 'typesafe', model: 'jev-latest', apiKey: 'test-key', baseUrl } };
    const moduleUrl = new URL('../src/naming.mjs', import.meta.url).href;
    const script = `import { classify } from ${JSON.stringify(moduleUrl)};
      const result = await classify({ summary: '', newMessages: [{ text: 'Fix proxy support' }] }, ${JSON.stringify(config)});
      console.log(result.name);`;
    const cleanEnv = { ...process.env };
    for (const key of Object.keys(cleanEnv)) {
      if (/proxy/i.test(key) || key === 'NODE_OPTIONS' || key === 'NODE_TLS_REJECT_UNAUTHORIZED' || key === 'NODE_EXTRA_CA_CERTS') delete cleanEnv[key];
    }
    for (const mode of ['proxy', 'bypass', 'direct']) {
      requests.length = 0; tunnels.length = 0; proxyPorts.clear();
      const env = { ...cleanEnv, NODE_EXTRA_CA_CERTS: certPath };
      if (mode !== 'direct') {
        // Set only the variable for this protocol to catch incorrect proxy selection.
        env[protocol === 'https' ? 'HTTPS_PROXY' : 'HTTP_PROXY'] = proxyUrl;
        env.NO_PROXY = mode === 'bypass' ? '127.0.0.1' : '';
      }
      const { stdout } = await exec(process.execPath, [...flags, '--input-type=module', '-e', script], {
        env, timeout: 4000,
      });
      assert.equal(stdout.trim(), 'fix-proxy', mode);
      assert.deepEqual(requests, [
        { path: '/systemone', model: 'jev-latest', proxied: mode === 'proxy' },
        { path: '/chat/completions', model: 'mock-naming', proxied: mode === 'proxy' },
      ], mode);
      assert.equal(tunnels.length > 0, mode === 'proxy', mode);
    }
  });
}
