/**
 * 出生信息 ⇄ URL 参数互转回归。
 *
 * 这是命盘分享链接的入口，参数口径必须和解读数据集严格一致：
 * h 是**时辰序号 0–11**（子=0 … 亥=11），不是钟点。
 */
import assert from 'node:assert/strict';
import { parseBirthFromSearch, birthToSearch } from '../../lib/ziwei/birth-url';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✅ ${name}`);
}

console.log('[birth-url] 出生信息 URL 参数回归');

// 正常解析
check('解析标准参数', () => {
  const b = parseBirthFromSearch('y=1990&m=1&d=1&h=4&g=male');
  assert.deepEqual(b, { year: 1990, month: 1, day: 1, hour: 4, gender: 'male' });
});

check('时辰序号 0 与 11 都接受', () => {
  assert.equal(parseBirthFromSearch('y=2000&m=6&d=15&h=0&g=female')?.hour, 0);
  assert.equal(parseBirthFromSearch('y=2000&m=6&d=15&h=11&g=female')?.hour, 11);
});

check('缺字段返回 null', () => {
  assert.equal(parseBirthFromSearch('y=1990&m=1&d=1&g=male'), null);
  assert.equal(parseBirthFromSearch(''), null);
});

check('非法时辰序号返回 null', () => {
  assert.equal(parseBirthFromSearch('y=1990&m=1&d=1&h=12&g=male'), null);
  assert.equal(parseBirthFromSearch('y=1990&m=1&d=1&h=-1&g=male'), null);
});

check('非法性别返回 null', () => {
  assert.equal(parseBirthFromSearch('y=1990&m=1&d=1&h=4&g=other'), null);
});

check('非法月份/日期返回 null', () => {
  assert.equal(parseBirthFromSearch('y=1990&m=13&d=1&h=4&g=male'), null);
  assert.equal(parseBirthFromSearch('y=1990&m=1&d=32&h=4&g=male'), null);
});

check('非整数返回 null', () => {
  assert.equal(parseBirthFromSearch('y=1990.5&m=1&d=1&h=4&g=male'), null);
});

check('URLSearchParams 实例也能解析', () => {
  const sp = new URLSearchParams('y=1988&m=12&d=25&h=9&g=female');
  assert.deepEqual(parseBirthFromSearch(sp), {
    year: 1988, month: 12, day: 25, hour: 9, gender: 'female',
  });
});

// 往返
check('编码→解析 往返一致', () => {
  const original = { year: 1990, month: 1, day: 1, hour: 4, gender: 'male' as const };
  const qs = birthToSearch(original);
  assert.deepEqual(parseBirthFromSearch(qs), original);
});

check('编码结果包含全部五个字段', () => {
  const qs = birthToSearch({ year: 2000, month: 3, day: 15, hour: 7, gender: 'female' });
  for (const k of ['y=', 'm=', 'd=', 'h=', 'g=']) {
    assert.ok(qs.includes(k), `missing ${k} in ${qs}`);
  }
});

console.log(`[birth-url] ${passed} 项断言全部通过`);
