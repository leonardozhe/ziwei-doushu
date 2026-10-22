#!/usr/bin/env node
/**
 * 把 v4.0 解读数据集的 JSONL 转成两个 TSV，供 psql \copy 直灌。
 *
 *   node jsonl-to-tsv.mjs <input.jsonl> <charts.tsv> <readings.tsv>
 *
 * 格式（制表符分隔，字段内换行/制表符已转义）：
 *   charts.tsv   : chart_key \t year \t month \t day \t hour \t gender \t mingzhu
 *   readings.tsv : chart_key \t topic \t char_count \t content
 *
 * content 为 Markdown 正文，制表符转成空格，换行转成 \n 字面量。
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

const [input, chartsOut, readingsOut] = process.argv.slice(2);
if (!input || !chartsOut || !readingsOut) {
  console.error('usage: jsonl-to-tsv.mjs <input.jsonl|.zst> <charts.tsv> <readings.tsv>');
  process.exit(1);
}

const TOPICS = [
  'overview', 'personality', 'love', 'career', 'wealth', 'health',
  'family', 'children', 'move', 'friends', 'home', 'spirit', 'parents',
];

// TSV 安全转义：反斜杠、制表符、换行
const esc = (s) => s
  .replace(/\\/g, '\\\\')
  .replace(/\t/g, '\\t')
  .replace(/\n/g, '\\n')
  .replace(/\r/g, '\\r');

let charts = 0;
let readings = 0;
let bytes = 0;

const chartsStream = createWriteStream(chartsOut);
const readingsStream = createWriteStream(readingsOut);

const write = async (stream, chunk) => {
  if (!stream.write(chunk)) await new Promise((r) => stream.once('drain', r));
};

const source = input.endsWith('.zst')
  ? pipeline(createReadStream(input), createGunzip())
  : createReadStream(input);

const rl = createInterface({ input: source, crlfDelay: Infinity });

for await (const line of rl) {
  if (!line.trim()) continue;
  let rec;
  try { rec = JSON.parse(line); } catch (e) {
    console.error(`skip bad json at line ${charts + 1}: ${e.message}`);
    continue;
  }
  const { k, y, m, d, h, g, ms, c } = rec;
  if (!k || !c) continue;

  await write(chartsStream, `${k}\t${y}\t${m}\t${d}\t${h}\t${g}\t${ms ?? ''}\n`);
  charts++;

  for (const topic of TOPICS) {
    const body = c[topic];
    if (typeof body !== 'string' || body.length === 0) continue;
    bytes += body.length;
    await write(readingsStream, `${k}\t${topic}\t${body.length}\t${esc(body)}\n`);
    readings++;
  }
}

chartsStream.end();
readingsStream.end();
await Promise.all([
  new Promise((r) => chartsStream.once('close', r)),
  new Promise((r) => readingsStream.once('close', r)),
]);

console.log(JSON.stringify({ charts, readings, contentBytes: bytes }));
