import path from 'path';
import { fileURLToPath } from 'url';
import { loadEngine, boot, call, login } from './engine.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = loadEngine(path.join(root, 'gas/baseline/Code.js'));
const store = boot(engine);
store.months['2026-11-01'] = {
  yearMonth: '2026-11-01',
  deadline: '2026-12-05',
  statements: [],
  cashItems: [{ id: 'CA-BASELINE', date: '2026-11-18', desc: 'SYN', direction: '收入', amount: 100, currency: 'HKD', amountHkd: 100, counterparty: 'SYN' }],
  rejectedCash: [],
  ledgerGenerated: false,
  bankBalanced: false,
  completionConfirmed: false,
  posted: false
};
const auth = login(engine, 'AC01-SYN-ADVISOR');
const read = call(engine, auth.token, 'getMonth', { yearMonth: '2026-11' });
const listed = (read.data && read.data.month && read.data.month.cashItems) || [];
const found = listed.some((item) => item.id === 'CA-BASELINE');
console.log(JSON.stringify({
  label: 'BASELINE_REPRO_NOT_A_PRODUCT_PASS',
  engine: 'gas/baseline/Code.js',
  input: { storedKey: '2026-11-01', query: '2026-11', id: 'CA-BASELINE' },
  actualListed: found,
  returnedKey: read.data && read.data.month && read.data.month.yearMonth,
  cashCount: listed.length,
  reproduced: found === false
}));
process.exit(found === false ? 0 : 1);
