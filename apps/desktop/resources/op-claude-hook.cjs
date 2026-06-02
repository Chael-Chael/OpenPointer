#!/usr/bin/env node
'use strict';

const http = require('node:http');

const event = process.argv[2] || '';
const permissionUrl = process.env.OPENPOINTER_PERMISSION_URL || '';
const token = process.env.OPENPOINTER_PERMISSION_TOKEN || '';

if (process.env.OPENPOINTER_SESSION !== '1' || !permissionUrl || !token) {
  process.exit(0);
}

if (event !== 'PermissionRequest' && event !== 'PreToolUse') {
  process.exit(0);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', async () => {
  try {
    const payload = input.trim() ? JSON.parse(input) : {};
    const response = await postJson(permissionUrl, {
      event,
      tool_name: payload.tool_name,
      tool_input: payload.tool_input,
      tool_use_id: payload.tool_use_id,
      permission_suggestions: payload.permission_suggestions,
      title: payload.title,
      display_name: payload.display_name,
      description: payload.description
    });
    if (response) process.stdout.write(JSON.stringify(response));
  } catch {
    // Pass through on hook errors so ordinary Claude Code sessions are not blocked.
  }
});

function postJson(url, body) {
  return new Promise((resolve) => {
    const target = new URL(url);
    const data = JSON.stringify(body);
    const req = http.request(
      {
        method: 'POST',
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data)
        },
        timeout: 120000
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          if (res.statusCode === 204) {
            resolve(null);
            return;
          }
          const text = Buffer.concat(chunks).toString('utf8');
          if (!text.trim()) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
  });
}
