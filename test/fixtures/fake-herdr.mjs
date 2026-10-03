#!/usr/bin/env node
import { readFile, writeFile, rename } from 'node:fs/promises';

const path = process.env.TEST_HERDR_STATE;
const agents = JSON.parse(await readFile(path, 'utf8'));
const [group, action, paneId, name] = process.argv.slice(2);
if (group !== 'agent') process.exit(2);
if (action === 'list') {
  console.log(JSON.stringify({ result: { agents } }));
} else if (action === 'rename') {
  const agent = agents.find((item) => item.pane_id === paneId);
  if (!agent || agents.some((item) => item !== agent && item.name === name)) process.exit(1);
  agent.name = name;
  await writeFile(`${path}.tmp`, JSON.stringify(agents));
  await rename(`${path}.tmp`, path);
  console.log(JSON.stringify({ result: { agent } }));
} else process.exit(2);
