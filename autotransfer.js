// 자동이체 자동전표 모듈
const SPREADSHEET_ID = '1skfIKgMzy1vf5yMuTbgA0acwPUE0pQCTu0ha43bv7_I';
// 통장내역도 자동이체 리스트와 마찬가지로 자동으로 안 가져온다. 회사를 연결해달라고
// 요청하면 그때 { '회사명': '시트 탭 이름' } 형태로 여기에 등록한다.
const BANK_SHEET_NAMES = {};
// 자동이체 항목은 구글시트에서 자동으로 가져오지 않고, 사용자가 화면에서 직접 추가한
// 항목만 쓴다. 브라우저 localStorage에 저장되므로 이 브라우저를 벗어나면 안 보인다.
const RECURRING_ITEMS_STORAGE_KEY = 'autoTransferRecurringItems';
// 필드 구성이 바뀔 때마다 기존에 저장된 값을 새 자리로 옮기는 규칙을 여기에 순서대로 추가한다.
// 한 번 적용된 규칙은 다시 적용되지 않도록 RECURRING_SCHEMA_VERSION_KEY에 몇 번째까지 적용했는지 기록해둔다.
const RECURRING_SCHEMA_VERSION_KEY = 'autoTransferRecurringSchemaVersion';
// 사용자가 캡처해서 보내준 회사별 계정과목/거래처코드 참고 자료. "회사||거래처명"으로 찾는다.
// 이미지에서 읽은 값이라 숫자 코드는 오타 위험이 있으니, 적용 후 한 번 훑어봐 주는 게 안전하다.
const RECURRING_REFERENCE_LOOKUP = {
  '한백||에이엠시티 센트럴파크': { costAccount: '관리비_세금과공과금', vendorCode: '확인필요' },
  '한백||도천1단지중흥파크 102동 301호': { costAccount: '관리비_세금과공과금', vendorCode: '005536' },
  '한백||도천중흥2차아파트 111동 701호': { costAccount: '관리비_세금과공과금', vendorCode: '005537' },
  '한백||에스원(주)': { costAccount: '외상매입금', vendorCode: '013302' },
  '한백||(사)함께하는사랑밭': { costAccount: '기부금', vendorCode: '000156' },
  '한백||(사)굿네이버스인터내셔날': { costAccount: '기부금', vendorCode: '007606' },
  '한백||유니세프한국위원회': { costAccount: '기부금', vendorCode: '004731' },
  '한백||sk렌터카': { costAccount: '외상매입금', vendorCode: '005763' },
  '한백||코웨이': { costAccount: '외상매입금', vendorCode: '006054' },
  '한백||하이플러스-하이패스': { costAccount: '차량유지비-기타', vendorCode: '011103' },
  '한백||인재육성아카데미': { costAccount: '외상매입금', vendorCode: '007175' },
  '한백이엔씨||한국전력공사': { costAccount: '외상매입금', vendorCode: '000277' },
  '한백이엔씨||(주)해양에너지': { costAccount: '외상매입금', vendorCode: '001318' },
  '한백이엔씨||(주)케이티': { costAccount: '외상매입금', vendorCode: '000260' },
  '한백이엔씨||(주)엘지유플러스': { costAccount: '외상매입금', vendorCode: '000259' },
  '한백이엔씨||코웨이': { costAccount: '외상매입금', vendorCode: '005601' },
  '한백이엔씨||호반아파트입주자대표회의': { costAccount: '관리비_세금과공과금', vendorCode: '004497' },
  '한백이엔씨||동아아파트': { costAccount: '관리비_세금과공과금', vendorCode: '004494' },
  '한백이엔씨||인터넷등기소': { costAccount: '기타_지급수수료', vendorCode: '005923' },
  '한백이엔씨||에스엠하이플러스 주식회사': { costAccount: '기타_차량유지비', vendorCode: '000967' },
};
const RECURRING_MIGRATIONS = [
  // v0->v1: 사용자→원가계정과목, 출금은행→사용자로 옮기고 출금은행 자리를 새로 비운다.
  (item) => ({ ...item, costAccount: item.user || '', user: item.bankName || '', bankName: '' }),
  // v1->v2: 납부일→금액, 출금통장→납부일로 옮기고 출금통장 자리를 새로 비운다.
  (item) => ({ ...item, amount: item.dueDate || '', dueDate: item.bankAccount || '', bankAccount: '' }),
  // v2->v3: 한백 항목은 출금은행/출금통장을 실제 계좌로 통일한다.
  (item) => (item.company === '한백' ? { ...item, bankName: '농협', bankAccount: '246-17-000487' } : item),
  // v3->v4: 모든 항목의 원가계정과목을 외상매입금으로 통일한다.
  (item) => ({ ...item, costAccount: '외상매입금' }),
  // v4->v5: 대변계정과목은 전부 보통예금(고정)으로 채운다. 회사+거래처명이 참고 자료와
  // 일치하는 항목은 차변 계정과목/거래처코드도 그 자료 값으로 채운다(빈 값이든 아니든 덮어씀 -
  // v3->v4에서 임시로 넣어둔 "외상매입금"보다 이 자료 쪽이 실제 값이라 우선한다).
  (item) => {
    const updated = { ...item, creditAccount: '보통예금' };
    const match = RECURRING_REFERENCE_LOOKUP[`${item.company}||${item.vendor}`];
    if (match) {
      if (match.costAccount) updated.costAccount = match.costAccount;
      if (match.vendorCode) updated.vendorCode = match.vendorCode;
    }
    return updated;
  },
  // v5->v6: 차변 계정과목 코드를 계정과목명 기준으로 채운다 (외상매입금=25100, 기부금=933000).
  (item) => {
    const codeMap = { '외상매입금': '25100', '기부금': '933000' };
    const code = codeMap[item.costAccount];
    return code ? { ...item, costAccountCode: code } : item;
  },
  // v6->v7: 기부금 차변 계정과목 코드 오타 수정 (933000 -> 93300).
  (item) => (item.costAccount === '기부금' ? { ...item, costAccountCode: '93300' } : item),
  // v7->v8: 대변 계정과목 코드(보통예금)는 전부 10300으로 채운다.
  (item) => ({ ...item, creditAccountCode: '10300' }),
  // v8->v9: 대변 거래처코드(출금계좌)는 전부 98007로 채운다.
  (item) => ({ ...item, creditVendorCode: '98007' }),
];
// 이 코드가 배포되기 전에 이미 v1 모양(costAccount 있음)으로 저장된 브라우저는 버전 기록이 없어도
// v1까지는 끝난 것으로 봐야 v0->v1 규칙이 중복 적용되지 않는다.
function inferRecurringSchemaVersion(items) {
  if (items.some((it) => it.costAccount !== undefined)) return 1;
  return 0;
}
function loadRecurringItems() {
  try {
    let items = JSON.parse(localStorage.getItem(RECURRING_ITEMS_STORAGE_KEY) || '[]');
    const stored = localStorage.getItem(RECURRING_SCHEMA_VERSION_KEY);
    let version = stored === null ? inferRecurringSchemaVersion(items) : parseInt(stored, 10);
    while (version < RECURRING_MIGRATIONS.length) {
      items = items.map(RECURRING_MIGRATIONS[version]);
      version++;
    }
    localStorage.setItem(RECURRING_SCHEMA_VERSION_KEY, String(version));
    saveRecurringItems(items);
    return items;
  } catch (e) {
    return [];
  }
}
function saveRecurringItems(items) {
  localStorage.setItem(RECURRING_ITEMS_STORAGE_KEY, JSON.stringify(items));
}
function makeItemId() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}
function addRecurringItem(item) {
  const items = loadRecurringItems();
  items.push({ id: makeItemId(), ...item });
  saveRecurringItems(items);
  state.transfers = items;
  render();
}
function deleteRecurringItem(id) {
  const items = loadRecurringItems().filter((it) => it.id !== id);
  saveRecurringItems(items);
  state.transfers = items;
  render();
}
function updateRecurringItem(id, updates) {
  const items = loadRecurringItems().map((it) => (it.id === id ? { ...it, ...updates } : it));
  saveRecurringItems(items);
  state.transfers = items;
  render();
}
// 통장내역도 구글시트에서 자동으로 가져오지 않고, 사용자가 화면에서 직접 추가한 것만 쓴다.
const BANK_ROWS_STORAGE_KEY = 'autoTransferBankRows';
// 한 번 리셋 요청이 있었으므로, 이 플래그가 없는 브라우저는 다음에 열 때 딱 한 번 통장내역을 비운다.
const BANK_ROWS_RESET_FLAG_KEY = 'autoTransferBankRowsReset_v1';
function loadBankRowsFlat() {
  try {
    if (!localStorage.getItem(BANK_ROWS_RESET_FLAG_KEY)) {
      localStorage.setItem(BANK_ROWS_STORAGE_KEY, '[]');
      localStorage.setItem(BANK_ROWS_RESET_FLAG_KEY, '1');
    }
    return JSON.parse(localStorage.getItem(BANK_ROWS_STORAGE_KEY) || '[]');
  } catch (e) {
    return [];
  }
}
function saveBankRowsFlat(rows) {
  localStorage.setItem(BANK_ROWS_STORAGE_KEY, JSON.stringify(rows));
}
function groupBankRowsByCompany(rows) {
  const grouped = {};
  for (const r of rows) {
    if (!grouped[r.company]) grouped[r.company] = [];
    grouped[r.company].push(r);
  }
  return grouped;
}

// 통장내역 표시는 위 통장내역 리스트와 별개로, 엑셀 파일을 업로드하면 회사별로 통째로 저장해서
// 그대로 보여준다. 새로 올린 파일에 이미 있는 날짜가 겹치면 그 날짜는 버리고, 기존에 없던
// 날짜만 이어붙인다(아래 mergeBankFile). 완전히 새로 시작하려면 "전체 삭제"를 쓴다.
const BANK_FILE_STORAGE_KEY = 'autoTransferBankFile';
function loadBankFile() {
  try {
    return JSON.parse(localStorage.getItem(BANK_FILE_STORAGE_KEY) || '{}');
  } catch (e) {
    return {};
  }
}
function saveBankFile(byCompany) {
  localStorage.setItem(BANK_FILE_STORAGE_KEY, JSON.stringify(byCompany));
}
// "월/일" 열 헤더를 찾아서, 그 열의 값("01-07" 같은 형식)을 월/일로 나누는 데 쓴다.
function findDateColumnIndex(header) {
  return header.findIndex((h) => String(h).replace(/\s/g, '') === '월/일' || String(h).replace(/\s/g, '') === '월일');
}
function splitMonthDay(value) {
  const m = String(value).trim().match(/^(\d{1,2})-(\d{1,2})$/);
  return m ? { month: m[1].padStart(2, '0'), day: m[2].padStart(2, '0') } : null;
}
// 날짜가 없는 행("합계" 같은 요약 행)은 겹침 판단에서 빼고, 새로 올린 파일의 것을 맨 끝에 붙인다.
// 날짜가 있는 행은 기존에 이미 있던 날짜(가장 늦은 날짜까지)는 버리고, 그보다 늦은 날짜만 이어붙인다.
function mergeBankFile(existing, incoming) {
  if (!existing || !existing.rows.length) return incoming;
  const dateColIdx = findDateColumnIndex(incoming.header);
  if (dateColIdx === -1) return incoming;
  const dateKey = (row) => {
    const parsed = splitMonthDay(row[dateColIdx]);
    return parsed ? `${parsed.month}-${parsed.day}` : null;
  };
  const existingDated = existing.rows.filter((r) => dateKey(r) !== null);
  const maxExistingDate = existingDated.reduce((max, r) => {
    const k = dateKey(r);
    return k && k > max ? k : max;
  }, '');
  const incomingDated = incoming.rows.filter((r) => dateKey(r) !== null);
  const incomingOther = incoming.rows.filter((r) => dateKey(r) === null);
  const newRows = incomingDated.filter((r) => dateKey(r) > maxExistingDate);
  return { header: incoming.header, rows: [...existingDated, ...newRows, ...incomingOther] };
}
// 업로드/삭제로 통장내역이 바뀌면 그 탭만이 아니라 사이드바 표시(연결 여부)와 자동전표/연도
// 드롭다운까지 전부 지금 데이터 기준으로 다시 그려야, 탭을 옮겨도 새로고침 없이 최신 상태로 보인다.
function refreshAfterBankFileChange() {
  renderCompanyTabs();
  renderYearSelect();
  render();
}
function setBankFileForCompany(company, header, rows) {
  const byCompany = loadBankFile();
  byCompany[company] = mergeBankFile(byCompany[company], { header, rows });
  saveBankFile(byCompany);
  state.bankFile = byCompany;
  refreshAfterBankFileChange();
}
function resetBankFileForCompany(company) {
  const byCompany = loadBankFile();
  delete byCompany[company];
  saveBankFile(byCompany);
  state.bankFile = byCompany;
  refreshAfterBankFileChange();
}

// 구글시트 "자동전표 양식" 탭과 동일한 전표 컬럼 순서
const VOUCHER_HEADER = ['월', '일', '구분', '계정과목코드', '계정과목명', '거래처코드', '거래처명', '적요명', '차변(출금)', '대변(대변)', 'CODE', '부서'];
// 사이드바에는 5개 법인을 모두 보여주되, 통장내역 탭에 아직 엑셀을 안 올린 법인은
// "통장내역 업로드 필요"로 표시한다(구글시트 자동연결은 지금 안 쓰고 있어서 그 여부와는 무관).
const COMPANIES = ['한백', '한백이엔씨'];
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

// 한백 탭: [일,월,일,적요,입금액,출금액,잔액] A열부터. 한백이엔씨 탭: A열이 빈칸이라 [월/일,적요,입금액,출금액,잔액]이 B열부터 시작.
// 날짜(MM-DD) 셀을 행에서 직접 찾아 그 기준 상대 위치로 읽어서 컬럼 시작 위치 차이에 영향받지 않게 한다.
const BANK_ROW_OFFSETS = {
  '한백': { memo: 3, deposit: 4, withdrawal: 5, balance: 6 },
  '한백이엔씨': { memo: 1, deposit: 2, withdrawal: 3, balance: 4 },
};
const DATE_RE = /^\d{2}-\d{2}$/;

let state = {
  hasLoaded: false,
  bankRowsByCompany: groupBankRowsByCompany(loadBankRowsFlat()),
  bankMonth: 'all',
  transfers: loadRecurringItems(),
  company: COMPANIES[0],
  year: null,
  chart: null,
  activeView: 'recurring',
  recurringEditingId: null,
  voucherMonth: 'all',
  voucherEntries: [],
  voucherVendorSelections: {},
  voucherMatchedCount: 0,
  voucherTotalCount: 0,
  summaryMonth: 'all',
  yearRows: [],
  currentTransfers: [],
  bankFile: loadBankFile(),
};

// "확정"을 누른 적요/거래처 선택은 새로고침(구글시트 재조회)해도 유지되어야 하므로 브라우저
// localStorage에 회사+연도별로 저장해둔다. 통장내역 원본이 아니라 여기 저장된 값이라 이 브라우저를
// 벗어나면(다른 PC 등) 안 보인다는 한계는 있다.
function voucherConfirmStorageKey(company, year) {
  return `voucherConfirmed_${company}_${year}`;
}
function loadConfirmedVoucherMap(company, year) {
  try {
    return JSON.parse(localStorage.getItem(voucherConfirmStorageKey(company, year)) || '{}');
  } catch (e) {
    return {};
  }
}
function saveConfirmedVoucherMap(company, year, map) {
  localStorage.setItem(voucherConfirmStorageKey(company, year), JSON.stringify(map));
}

// file:// 로 직접 열면 fetch()는 Origin: null 때문에 구글 쪽 CORS 체크에서 막힌다.
// <script> 태그로 불러오는 방식(JSONP)은 CORS 제약을 받지 않으므로 이 방식을 쓴다.
let jsonpCounter = 0;
function loadSheetJsonp(sheetName, spreadsheetId = SPREADSHEET_ID) {
  return new Promise((resolve, reject) => {
    const cbName = '__gsheet_cb_' + jsonpCounter++;
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`'${sheetName}' 시트 응답이 없습니다 (인터넷 연결을 확인해주세요)`));
    }, 15000);
    const script = document.createElement('script');
    function cleanup() {
      clearTimeout(timeoutId);
      delete window[cbName];
      script.remove();
    }
    window[cbName] = (response) => {
      cleanup();
      if (!response || response.status === 'error') {
        const msg = (response && response.errors && response.errors[0] && response.errors[0].detailed_message)
          || `'${sheetName}' 시트를 찾을 수 없습니다`;
        reject(new Error(msg));
        return;
      }
      resolve(response.table);
    };
    script.src = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json;responseHandler:${cbName}&sheet=${encodeURIComponent(sheetName)}`;
    script.onerror = () => { cleanup(); reject(new Error(`'${sheetName}' 시트 로드 실패 (네트워크 또는 공유 설정 확인)`)); };
    document.body.appendChild(script);
  });
}

function cellText(cell) {
  if (!cell) return '';
  if (cell.f !== undefined && cell.f !== null) return cell.f;
  if (cell.v === null || cell.v === undefined) return '';
  return String(cell.v);
}

function tableToRows(table) {
  return table.rows.map((row) => row.c.map(cellText));
}

function tableHeader(table) {
  return table.cols.map((c) => (c.label || '').trim());
}

function parseAmount(text) {
  if (text === null || text === undefined) return 0;
  const s = String(text).trim().replace(/,/g, '').replace(/[₩원]/g, '').replace(/^약/, '');
  if (s === '' || s === '-' || s.toLowerCase() === 'nan') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseBankRows(rawRows, companyName) {
  const offsets = BANK_ROW_OFFSETS[companyName];
  const out = [];
  let year = new Date().getFullYear();
  let lastMonth = null;
  for (const row of rawRows) {
    let dateIdx = -1;
    for (let i = 0; i < row.length; i++) {
      if (DATE_RE.test((row[i] || '').trim())) { dateIdx = i; break; }
    }
    if (dateIdx === -1) continue; // 헤더 행이나 잉여 계산용 행은 건너뜀
    const cellAt = (off) => (row[dateIdx + off] !== undefined ? row[dateIdx + off] : '');
    const dateCell = row[dateIdx].trim();
    const month = parseInt(dateCell.split('-')[0], 10);
    if (lastMonth !== null && month < lastMonth) year += 1;
    lastMonth = month;
    out.push({
      date: dateCell,
      year,
      memo: (cellAt(offsets.memo) || '').trim(),
      deposit: parseAmount(cellAt(offsets.deposit)),
      withdrawal: parseAmount(cellAt(offsets.withdrawal)),
      balance: parseAmount(cellAt(offsets.balance)),
    });
  }
  return out;
}

// "약100만원대", "19,040*8" 처럼 자동이체 리스트의 금액칸은 정확한 숫자가 아닌 경우가 많아서,
// 대략적인 근사치라도 뽑아내서 실제 통장 출금액과 가장 가까운 후보를 고르는 데 쓴다.
function parseApproxAmount(text) {
  if (!text) return null;
  const s = String(text).replace(/약/g, '').trim();
  const mul = s.match(/^([\d,]+)\s*\*\s*(\d+)/);
  if (mul) return parseFloat(mul[1].replace(/,/g, '')) * parseFloat(mul[2]);
  const man = s.match(/^(\d+)\s*만\s*원?\s*대?/);
  if (man) return parseFloat(man[1]) * 10000;
  const plain = s.replace(/,/g, '');
  if (/^\d+(\.\d+)?$/.test(plain)) return parseFloat(plain);
  return null;
}

// 같은 통장적요 패턴을 여러 자동이체 항목이 공유하는 경우(예: 한국전력공사 "전기요금"이 4곳)
// 패턴 길이로는 구분이 안 되므로, 실제 출금액과 자동이체 리스트의 금액칸이 가장 가까운 쪽을 고른다.
function findBestMatch(memo, transfers, actualAmount) {
  let candidates = transfers.filter((t) => t.pattern && memo.includes(t.pattern));
  if (!candidates.length) return null;
  const maxLen = Math.max(...candidates.map((t) => t.pattern.length));
  candidates = candidates.filter((t) => t.pattern.length === maxLen);
  if (candidates.length > 1 && actualAmount) {
    let best = null, bestDiff = Infinity;
    for (const t of candidates) {
      const approx = parseApproxAmount(t.amount);
      if (approx === null) continue;
      const diff = Math.abs(approx - actualAmount);
      if (diff < bestDiff) { bestDiff = diff; best = t; }
    }
    if (best) return best;
  }
  return candidates[0];
}

// "(주)엘지유플러스"/"(주)케이티"처럼 (주)/(사) 같은 법인 표시가 앞에 붙으면 그것만으로
// 서로 다른 회사가 앞 3글자만 보고 한 그룹으로 묶여버리므로, 표시부호를 지우고 나서 앞 3글자를 취한다.
function vendorGroupKey(vendorName) {
  const cleaned = vendorName.replace(/\(주\)|\(사\)|주식회사/g, '').trim();
  return (cleaned || vendorName).slice(0, 3);
}

const RECURRING_LIST_COLUMNS = [
  { key: 'vendor', label: '거래처명' },
  { key: 'vendorCode', label: '거래처코드' },
  { key: 'pattern', label: '통장적요' },
  { key: 'amount', label: '금액' },
  { key: 'costAccount', label: '차변 계정과목' },
  { key: 'costAccountCode', label: '차변 계정과목 코드' },
  { key: 'dueDate', label: '납부일' },
  { key: 'user', label: '사용자' },
  { key: 'creditAccount', label: '대변계정과목' },
  { key: 'creditAccountCode', label: '대변계정과목코드' },
  { key: 'bankName', label: '출금은행' },
  { key: 'bankAccount', label: '출금통장' },
  { key: 'creditVendorCode', label: '거래처코드' },
];

const RECURRING_FORM_FIELDS = [
  ['rfVendor', 'vendor'], ['rfVendorCode', 'vendorCode'], ['rfPattern', 'pattern'], ['rfAmount', 'amount'], ['rfCostAccount', 'costAccount'],
  ['rfCostAccountCode', 'costAccountCode'],
  ['rfDueDate', 'dueDate'], ['rfUser', 'user'], ['rfCreditAccount', 'creditAccount'], ['rfCreditAccountCode', 'creditAccountCode'],
  ['rfBankName', 'bankName'], ['rfBankAccount', 'bankAccount'],
];

function renderRecurringList(transfers) {
  document.getElementById('recurringListTitle').textContent = `자동이체 리스트 - ${state.company}`;
  document.getElementById('recurringTableHead').innerHTML =
    `<tr><th>순번</th>${RECURRING_LIST_COLUMNS.map((c) => `<th>${c.label}</th>`).join('')}<th>수정</th><th>삭제</th></tr>`;
  document.getElementById('recurringTableBody').innerHTML = transfers.length
    ? transfers.map((t, i) => `<tr${t.id === state.recurringEditingId ? ' class="editing"' : ''}><td>${i + 1}</td>${RECURRING_LIST_COLUMNS.map((c) => `<td>${t[c.key] || '-'}</td>`).join('')}<td><button type="button" class="btn small secondary recurring-edit-btn" data-id="${t.id}">수정</button></td><td><button type="button" class="btn small secondary recurring-delete-btn" data-id="${t.id}">삭제</button></td></tr>`).join('')
    : `<tr><td colspan="${RECURRING_LIST_COLUMNS.length + 3}">등록된 자동이체가 없습니다.</td></tr>`;
  document.querySelectorAll('.recurring-delete-btn').forEach((btn) => {
    btn.onclick = () => {
      if (confirm('이 항목을 삭제할까요?')) deleteRecurringItem(btn.dataset.id);
    };
  });
  document.querySelectorAll('.recurring-edit-btn').forEach((btn) => {
    btn.onclick = () => startEditRecurringItem(btn.dataset.id);
  });
}

function startEditRecurringItem(id) {
  const item = state.transfers.find((t) => t.id === id);
  if (!item) return;
  state.recurringEditingId = id;
  for (const [inputId, key] of RECURRING_FORM_FIELDS) document.getElementById(inputId).value = item[key] || '';
  document.getElementById('rfAddBtn').textContent = '수정 완료';
  document.getElementById('rfCancelBtn').style.display = '';
  renderRecurringList(state.transfers.filter((t) => t.company === state.company));
}

function cancelEditRecurringItem() {
  state.recurringEditingId = null;
  for (const [inputId] of RECURRING_FORM_FIELDS) document.getElementById(inputId).value = '';
  document.getElementById('rfAddBtn').textContent = '추가';
  document.getElementById('rfCancelBtn').style.display = 'none';
  renderRecurringList(state.transfers.filter((t) => t.company === state.company));
}

const BANK_NARROW_COLS = ['월', '일'];
const BANK_AMOUNT_COLS = ['입금액', '출금액', '잔액'];
const BANK_MEMO_COLS = ['적요'];
function bankColClass(label) {
  const clean = String(label).replace(/\s/g, '');
  if (BANK_NARROW_COLS.includes(clean)) return ' class="col-narrow"';
  if (BANK_AMOUNT_COLS.includes(clean)) return ' class="col-amount"';
  if (BANK_MEMO_COLS.includes(clean)) return ' class="col-memo"';
  return '';
}
function formatAmountCell(value) {
  const s = String(value).trim();
  if (s === '' || s === '-') return value;
  const n = parseFloat(s.replace(/,/g, ''));
  return isNaN(n) ? value : n.toLocaleString('ko-KR');
}

// 통장내역 탭에 업로드해둔 엑셀(state.bankFile)을 자동전표/통계에서 쓰는 {date, year, memo,
// deposit, withdrawal, balance} 행 모양으로 바꾼다. 날짜는 "월/일" 열에서 그대로 뽑고(연도가
// 없으므로 올해를 기준으로 시작해서, 월이 이전 달보다 작아지는 지점마다 해를 하나씩 올린다),
// 금액/적요 열은 헤더 이름("적요"/"입금액"/"출금액"/"잔액")으로 찾는다.
function bankFileToYearRows(company) {
  const data = state.bankFile[company];
  if (!data || !data.rows.length) return [];
  const dateColIdx = findDateColumnIndex(data.header);
  if (dateColIdx === -1) return [];
  const findCol = (label) => data.header.findIndex((h) => String(h).replace(/\s/g, '') === label);
  const memoColIdx = findCol('적요');
  const depositColIdx = findCol('입금액');
  const withdrawalColIdx = findCol('출금액');
  const balanceColIdx = findCol('잔액');
  let year = new Date().getFullYear();
  let lastMonth = null;
  const out = [];
  for (const row of data.rows) {
    const parsed = splitMonthDay(row[dateColIdx]);
    if (!parsed) continue; // 날짜가 없는 합계/요약 행은 건너뜀
    const month = parseInt(parsed.month, 10);
    if (lastMonth !== null && month < lastMonth) year += 1;
    lastMonth = month;
    out.push({
      date: `${parsed.month}-${parsed.day}`,
      year,
      memo: memoColIdx === -1 ? '' : String(row[memoColIdx] || '').trim(),
      deposit: depositColIdx === -1 ? 0 : parseAmount(row[depositColIdx]),
      withdrawal: withdrawalColIdx === -1 ? 0 : parseAmount(row[withdrawalColIdx]),
      balance: balanceColIdx === -1 ? 0 : parseAmount(row[balanceColIdx]),
    });
  }
  return out;
}

// 엑셀에서 업로드한 그대로의 컬럼 구성으로 보여주되, "월/일" 열은 월/일 두 칸으로 나누고
// 위쪽 드롭다운으로 고른 달의 행만 걸러서 보여준다 (월은 값 자체에서 뽑아낸 것이라 잘못 태그될 일이 없다).
function renderBankList() {
  const data = state.bankFile[state.company];
  const monthLabel = state.bankMonth === 'all' ? '' : ` ${parseInt(state.bankMonth, 10)}월`;
  document.getElementById('bankListTitle').textContent = `통장내역 - ${state.company}${monthLabel}`;
  if (!data || !data.rows.length) {
    document.getElementById('bankTableHead').innerHTML = '<tr><th>순번</th></tr>';
    document.getElementById('bankTableBody').innerHTML = '<tr><td>업로드된 엑셀 파일이 없습니다. 위에서 파일을 선택해주세요.</td></tr>';
    return;
  }
  const dateColIdx = findDateColumnIndex(data.header);
  const headCells = [];
  data.header.forEach((h, i) => {
    if (i === dateColIdx) headCells.push('월', '일');
    else headCells.push(h);
  });
  const filteredRows = data.rows.filter((row) => {
    if (state.bankMonth === 'all' || dateColIdx === -1) return true;
    const parsed = splitMonthDay(row[dateColIdx]);
    return parsed && parsed.month === state.bankMonth;
  });
  document.getElementById('bankTableHead').innerHTML =
    `<tr><th>순번</th>${headCells.map((h) => `<th${bankColClass(h)}>${h || '-'}</th>`).join('')}</tr>`;
  document.getElementById('bankTableBody').innerHTML = filteredRows.length
    ? filteredRows.map((row, i) => {
        const cells = [];
        row.forEach((c, ci) => {
          if (ci === dateColIdx) {
            const parsed = splitMonthDay(c);
            cells.push(parsed ? `${parseInt(parsed.month, 10)}월` : c, parsed ? parsed.day : '');
          } else {
            cells.push(c);
          }
        });
        return `<tr><td>${i + 1}</td>${cells.map((c, ci) => {
          const label = headCells[ci];
          const value = BANK_AMOUNT_COLS.includes(String(label).replace(/\s/g, '')) ? formatAmountCell(c) : c;
          return `<td${bankColClass(label)}>${value || '-'}</td>`;
        }).join('')}</tr>`;
      }).join('')
    : `<tr><td colspan="${headCells.length + 1}">해당 월에 데이터가 없습니다.</td></tr>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const VOUCHER_MEMO_COL = VOUCHER_HEADER.indexOf('적요명');
const VOUCHER_VENDOR_CODE_COL = 5; // '거래처명' 바로 앞 거래처코드 칸
const VOUCHER_VENDOR_COL = VOUCHER_HEADER.indexOf('거래처명');
const VOUCHER_ACCOUNT_COL = VOUCHER_HEADER.indexOf('계정과목명');
const VOUCHER_ACCOUNT_CODE_COL = VOUCHER_HEADER.indexOf('계정과목코드');

// 대변(보통예금) 거래처코드는 자동이체 리스트의 거래처코드(창 옆 필드) 값을 그대로 쓰고,
// 거래처명만 회사별 고정 계좌명으로 채운다 (자동이체 리스트에는 거래처명 필드가 따로 없어서).
const CREDIT_BANK_ACCOUNT = {
  '한백':      { name: '농협2(000484)' },
  '한백이엔씨': { name: '농협자동이체(4356-01)' },
};

// 같은 통장적요(패턴)를 여러 자동이체 항목이 공유하면(전기요금 4곳, 가스비 4곳, 아파트관리비 3곳처럼)
// 텍스트만으로는 어느 등록 건인지 확신할 수 없으므로 그 패턴 그룹은 적요를 드롭다운으로 고르게 한다.
// 거래처명까지 서로 다르면(아파트관리비처럼 실제 등록된 건물 자체가 다른 경우) 거래처/거래처코드도
// 같이 고르게 하고, 거래처명이 같으면(전기/가스처럼 항상 한전·해양에너지인 경우) 거래처는 고정해두고
// 적요만 고르게 한다. 패턴이 하나뿐이면(KT/LG유플러스 개별회선, 기부금 등) 그대로 확정 표시한다.
// ── 사택관리비 시트 연동: 전기/가스/수도/관리비 자동 매칭 ──────────────────────
// "한백 사택관리비" 구글시트(18Zje…)의 관리비 계산표에서 뽑은 사택별·월별 요금 스냅샷.
// 통장적요가 겹치는 전기요금/가스요금/아파트관리비 그룹에서, 실제 출금액이 이 표의 특정 사택
// 금액과 (해당 월 ±1개월 안에서) 일치하면 그 사택 건으로 자동 확정한다("시트" 배지 표시).
// 값은 입주자 제출 영수증 기준이라 통장 실제 출금액과 대부분 같지만 항상 100%는 아니다.
// (수원 사택은 이 시트에 없어 자동 매칭 대상이 아니라 그대로 수동으로 남는다.)
const SATAEK_FEE_TABLE = {"중흥-102-301":{"관리비":{"2025-01":[130730],"2025-03":[125700],"2025-02":[130720],"2025-04":[126470],"2025-05":[126140],"2025-06":[126560],"2025-07":[135060],"2025-08":[134280],"2025-09":[138380],"2025-10":[129060],"2025-11":[133670],"2025-12":[131590]},"도시가스":{"2025-01":[173700],"2025-03":[138400],"2025-04":[38720],"2025-05":[13030],"2025-06":[3860],"2025-07":[2850],"2025-09":[1840],"2025-10":[22890],"2025-11":[89360],"2025-12":[105080]},"수도요금":{"2025-01":[5880],"2025-03":[4710],"2025-02":[9410],"2025-04":[5880],"2025-05":[5880],"2025-06":[5880],"2025-07":[5880],"2025-09":[7060],"2025-10":[2350],"2025-11":[5120],"2025-12":[3840]},"전기요금":{"2025-02":[15430],"2025-03":[17100],"2025-04":[15590],"2025-05":[18610],"2025-06":[38970],"2025-07":[81110],"2025-08":[73410],"2025-09":[36630],"2025-10":[19680],"2025-11":[17410],"2025-12":[11970]}},"중흥-111-701":{"관리비":{"2025-01":[109730],"2025-02":[110330],"2025-04":[114690],"2025-03":[107230],"2025-06":[109307],"2026-05":[114880],"2025-07":[107050],"2025-08":[118270],"2025-09":[109190],"2025-10":[111630],"2025-11":[121930],"2025-12":[116310],"2026-01":[120050]},"도시가스":{"2025-01":[196410],"2025-02":[118470],"2025-03":[121120],"2025-04":[115900],"2025-05":[103160],"2025-06":[8930],"2026-05":[2850],"2025-08":[8740],"2025-09":[5930],"2025-10":[112960],"2025-11":[224420],"2025-12":[324790],"2026-01":[233380]},"전기요금":{"2025-01":[19530],"2025-02":[9060],"2025-03":[10570],"2025-05":[21190],"2025-04":[17860],"2025-06":[16480],"2025-07":[27440],"2025-08":[41000],"2025-09":[14910],"2025-10":[21860],"2025-11":[30310],"2025-12":[39210],"2026-01":[30310]},"수도요금":{"2025-01":[5880],"2025-02":[3530],"2025-04":[15320],"2025-06":[140],"2026-05":[1620],"2025-07":[10460],"2025-08":[11790],"2025-09":[3530],"2025-10":[8250],"2025-11":[14070],"2025-12":[12790],"2026-01":[12790]}},"호반-101-1605":{"관리비":{"2025-01":[121800],"2025-04":[132260],"2025-05":[132260],"2025-06":[130460]},"도시가스":{"2025-01":[249670],"2025-02":[219270],"2025-03":[182570],"2025-04":[82600],"2025-05":[24830],"2025-06":[9940],"2025-07":[11990],"2025-08":[10970],"2025-09":[10970],"2025-10":[71690],"2025-11":[133980],"2025-12":[215460]},"수도요금":{"2025-01":[11500],"2025-04":[10610]}},"호반-103-1005":{"관리비":{"2025-01":[128140],"2025-02":[121530],"2025-03":[127030],"2025-04":[138210],"2025-05":[135930],"2025-06":[138700],"2025-07":[188260],"2025-08":[215980],"2025-09":[150870],"2025-10":[134270],"2025-11":[123460],"2025-12":[135340]},"도시가스":{"2025-01":[125950],"2025-02":[159370],"2025-03":[121080],"2025-04":[83740],"2025-05":[35550],"2025-06":[15100],"2025-07":[13000],"2025-08":[10970],"2025-09":[5930],"2025-10":[6980],"2025-11":[34940],"2025-12":[65060]},"전기요금":{"2025-01":[16400],"2025-02":[12210],"2025-03":[16900],"2025-04":[20870],"2025-05":[18470],"2025-06":[19220],"2025-07":[59330],"2025-08":[94340],"2025-09":[37190],"2025-10":[18080],"2025-11":[10680],"2025-12":[18680]},"수도요금":{"2025-01":[4710],"2025-02":[3540],"2025-03":[4720],"2025-04":[9430],"2025-05":[9430],"2025-06":[11790],"2025-07":[12970],"2025-08":[14150],"2025-09":[4720],"2025-10":[3540],"2025-11":[2560],"2025-12":[5120]}},"동아-105-106":{"관리비":{"2025-01":[121800],"2025-02":[121480],"2025-04":[116520],"2025-03":[122980],"2025-05":[117330],"2025-06":[119500],"2025-07":[125850],"2025-08":[146260],"2025-09":[144740],"2025-10":[131150],"2025-11":[135100],"2025-12":[132550],"2026-01":[139760]},"도시가스":{"2025-01":[268150],"2025-02":[252660],"2025-03":[149110],"2025-04":[94370],"2025-05":[69900],"2025-06":[16160],"2025-07":[11980],"2025-08":[16230],"2025-09":[16230],"2025-10":[93440],"2025-11":[224100],"2025-12":[285580],"2026-01":[257090]},"전기요금":{"2025-01":[20590],"2025-02":[19530],"2025-03":[16650],"2025-04":[16190],"2025-05":[18470],"2025-07":[36810],"2025-06":[25130],"2025-08":[51130],"2025-09":[35610],"2025-10":[28130],"2025-11":[25710],"2025-12":[25260],"2026-01":[20280]},"수도요금":{"2025-01":[11500],"2025-02":[14870],"2025-04":[11250],"2025-03":[16060],"2025-05":[12330],"2025-06":[12420],"2025-07":[19770],"2025-08":[39080],"2025-09":[36830],"2025-10":[24000],"2025-11":[27430],"2025-12":[25160],"2026-01":[28480]}},"센트럴-201-507":{"관리비":{"2025-01":[118320],"2025-02":[114730],"2025-03":[107020],"2025-04":[96320],"2025-05":[92080],"2025-06":[92130],"2025-07":[101510],"2025-09":[94420],"2025-10":[90050],"2025-11":[86890],"2025-12":[88320]},"도시가스":{"2025-01":[60900],"2025-02":[38830],"2025-03":[24970],"2025-04":[11990],"2025-05":[3870],"2025-06":[1830],"2025-07":[2850],"2025-08":[820],"2025-09":[820],"2025-12":[820]},"전기요금":{"2025-01":[21040],"2025-02":[21800],"2025-03":[18010],"2025-04":[9970],"2025-05":[8300],"2025-06":[12850],"2025-07":[20260],"2025-09":[15520],"2025-10":[11740],"2025-11":[10080],"2025-12":[9630]},"수도요금":{"2025-01":[9410],"2025-02":[8250],"2025-03":[7070],"2025-04":[4710],"2025-05":[2350],"2025-07":[2350],"2025-10":[1170]}},"동부-103-1504":{"관리비":{"2025-01":[316750],"2025-02":[305150],"2025-03":[252760],"2025-04":[215200],"2025-05":[203400],"2025-06":[211150],"2025-07":[213100],"2025-08":[240450],"2025-09":[274750],"2025-10":[226360],"2025-11":[219120],"2025-12":[220710]},"도시가스":{"2025-01":[186690],"2025-02":[159100],"2025-03":[125350],"2025-04":[56900],"2025-05":[60240],"2025-06":[22580],"2025-07":[7920],"2025-08":[23720],"2025-09":[23720],"2025-10":[59810],"2025-11":[113220],"2025-12":[194820]},"전기요금":{"2025-01":[165270],"2025-02":[155090],"2025-03":[110350],"2025-04":[67360],"2025-05":[49220],"2025-06":[54910],"2025-07":[53570],"2025-08":[96150],"2025-09":[117830],"2025-10":[65230],"2025-11":[46680],"2025-12":[51320]},"수도요금":{"2025-01":[18470],"2025-02":[23580],"2025-03":[15330],"2025-04":[25940],"2025-05":[23580],"2025-06":[25940],"2025-07":[23580],"2025-08":[15330],"2025-09":[22400],"2025-10":[24760],"2025-11":[34200],"2025-12":[34540]}}};
const SATAEK_BUILDINGS = ['중흥', '호반', '동아', '센트럴', '동부', '수원'];
// 사용자칸/사택주소 → "건물-동-호" 키 (예: "동아아파트 105-106" / "동아 105동 106호" → "동아-105-106")
function normalizeSataekKey(text) {
  if (!text) return null;
  const b = SATAEK_BUILDINGS.find((x) => text.includes(x));
  const nums = (String(text).match(/\d+/g) || []).filter((n) => n.length >= 2);
  return (b && nums.length >= 2) ? `${b}-${nums[0]}-${nums[1]}` : null;
}
// 자동이체 항목이 어느 요금인지 판정 (수도를 가스보다 먼저 봐야 "수원상수도"가 가스로 안 샌다)
function sataekUtility(t) {
  const s = `${t.vendor || ''} ${t.pattern || ''} ${t.costAccount || ''}`;
  if (/상수도|수도/.test(s)) return '수도요금';
  if (/가스|해양에너지|삼천리/.test(s)) return '도시가스';
  if (/전기|전력|한국전력/.test(s)) return '전기요금';
  if (/관리비/.test(s)) return '관리비';
  return null;
}
// year-month에서 delta개월 이동한 "YYYY-MM" (연말/연초 넘어가는 것도 자동 처리)
function shiftYm(year, month, delta) {
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
// 이 항목의 (사택,요금)이 해당 월(±1개월) 시트 금액과 실제 출금액이 일치하는지
function sataekAmountMatches(t, year, month, actualAmount) {
  const key = normalizeSataekKey(t.user);
  const util = sataekUtility(t);
  if (!key || !util) return false;
  const byUtil = (SATAEK_FEE_TABLE[key] || {})[util];
  if (!byUtil) return false;
  for (const delta of [0, -1, 1]) {
    const arr = byUtil[shiftYm(year, month, delta)];
    if (arr && arr.includes(actualAmount)) return true;
  }
  return false;
}
// 그룹 후보 중 사택관리비 표 금액으로 유일하게 맞는 항목을 확정 (없거나 여럿이면 null → 수동)
function resolveGroupBySheet(group, actualAmount, year, month) {
  const amt = Math.round(actualAmount);
  const hits = group.filter((t) => sataekAmountMatches(t, year, month, amt));
  return hits.length === 1 ? hits[0] : null;
}

function buildPatternGroups(transfers) {
  const groups = {};
  for (const t of transfers) {
    if (!groups[t.pattern]) groups[t.pattern] = [];
    groups[t.pattern].push(t);
  }
  return groups;
}

// 전기요금/가스요금/관리비는 실제 청구액이 매달 달라서, 등록해둔 "약OOO" 금액과 우연히 가장
// 가깝다는 이유로 자동 확정해버리면 엉뚱한 후보가 골라지기 쉽다. 그래서 이 세 종류는 금액으로
// 자동 확정하지 않고 항상 직접 골라야 하는 후보로 남겨둔다(후보가 하나뿐이면 그대로 쓴다).
function isAlwaysManualGroup(item) {
  const text = `${item.pattern || ''}${item.vendor || ''}${item.costAccount || ''}`;
  return /전기요금|한국전력|가스|관리비/.test(text);
}

// 통신비/전기/렌터카처럼 매달 같은 고정 금액이 등록되어 있으면, 그룹 안에서 실제 출금액과 등록 금액
// (약OOO 근사치 포함)이 유일하게 가장 가까운 후보로 확정할 수 있다. 그룹 중 금액을 못 읽는 항목이
// 하나라도 있으면(아파트관리비의 "관리비시트"처럼) 전체 그룹을 후보로 남기고, 최솟값이 여러 후보에
// 걸치면(같은 거래처에 등록 금액까지 같은 경우, 예: sk렌터카 575,000원이 4대) 그 겹치는 후보만
// 드롭다운에 남긴다 (금액이 뚜렷하게 다른 나머지 후보는 애초에 후보에서 제외).
function resolveGroupCandidates(group, actualAmount) {
  const withAmounts = group.map((t) => ({ t, approx: parseApproxAmount(t.amount) }));
  if (withAmounts.some((x) => x.approx === null)) return { resolved: null, candidates: group };
  let minDiff = Infinity;
  for (const x of withAmounts) minDiff = Math.min(minDiff, Math.abs(x.approx - actualAmount));
  const closest = withAmounts.filter((x) => Math.abs(x.approx - actualAmount) === minDiff).map((x) => x.t);
  return closest.length === 1 ? { resolved: closest[0], candidates: closest } : { resolved: null, candidates: closest };
}

// 아파트관리비처럼 등록된 거래처명 자체가 다른 경우나, 한국전력공사처럼 거래처명은 같지만
// 사용자(위치)가 다른 경우나, 거래처명+사용자 조합으로 후보를 구분한다.
function buildVoucherVendorOptions(group) {
  const map = new Map();
  for (const t of group) {
    const dedupeKey = `${t.vendor}||${t.user}`;
    if (!map.has(dedupeKey)) {
      const label = t.user ? `${t.vendor} (${t.user})` : t.vendor;
      map.set(dedupeKey, { label, dedupeKey, item: t });
    }
  }
  return Array.from(map.values());
}

// 적요/차변/대변 행을 항상 "고른 등록 항목(item)" 하나로부터 일관되게 조립한다 - 계정과목코드/
// 계정과목명/거래처코드/거래처명/적요가 서로 다른 후보에서 섞여 나오는 일이 없도록 하기 위해서다.
function voucherMemoFor(item) {
  return ['자동이체', item.vendor, item.user].filter(Boolean).join('/');
}
function voucherDebitRow(item, month, day, amount) {
  return [month, day, '3', item.costAccountCode || '', item.costAccount || '', item.vendorCode || '', item.vendor, voucherMemoFor(item), amount, '', '', ''];
}
function voucherCreditRow(item, month, day, amount) {
  const bankAcct = CREDIT_BANK_ACCOUNT[state.company];
  const creditVendorName = bankAcct ? bankAcct.name : item.vendor;
  return [month, day, '4', item.creditAccountCode || '', item.creditAccount || '', item.creditVendorCode || '', creditVendorName, voucherMemoFor(item), '', amount, '', ''];
}

// 통장내역 출금 거래를 자동이체 리스트와 매칭해서 차변(비용)/대변(보통예금) 2행씩 전표를 만든다.
// 돈이 나가면: 차변 = 나간 이유(자동이체 리스트의 차변 계정과목/코드/거래처코드),
// 대변 = 보통예금(고정 계정과목코드 + 회사별 고정 계좌). 월/일/적요는 통장내역 그대로 쓰고,
// 금액도 항상 통장의 실제 출금액을 쓴다 (리스트의 "약OOO" 금액은 매칭용 참고치일 뿐 전표에는 안 들어간다).
function buildVoucherRows(yearRows, transfers) {
  const patternGroups = buildPatternGroups(transfers);
  const confirmedMap = loadConfirmedVoucherMap(state.company, state.year);
  const occurrenceCount = {};

  // 통장내역 출금 거래를 하나도 빠뜨리지 않고 전부 반영한다 - 매칭이 안 된 거래도
  // 계정과목/거래처는 비운 채로 목록에 올려서 "미분류"로 표시하고, 나중에 자동이체 리스트에
  // 등록하면 다음 새로고침부터 자동으로 채워지게 한다.
  const withdrawals = yearRows.filter((r) => r.withdrawal).sort((a, b) => a.date.localeCompare(b.date));
  const entries = [];
  let matchedCount = 0;
  for (const r of withdrawals) {
    const matched = findBestMatch(r.memo, transfers, r.withdrawal);
    const [month, day] = r.date.split('-');
    const amount = String(Math.round(r.withdrawal));
    // 날짜+적요+금액으로 이 거래를 특정하는 안정적인 키 (같은 조합이 하루에 여럿이면 순번을 붙여 구분)
    const baseKey = `${r.date}::${r.memo}::${amount}`;
    occurrenceCount[baseKey] = (occurrenceCount[baseKey] || 0) + 1;
    const persistKey = `${baseKey}::${occurrenceCount[baseKey]}`;

    if (!matched) {
      entries.push({
        key: `${r.year}-${r.date}-${entries.length}`,
        persistKey,
        vendorEditable: false,
        unmatched: true,
        vendorOptions: [],
        locked: false,
        debit: [month, day, '3', '', '', '', '', r.memo, amount, '', '', ''],
        credit: [month, day, '4', '', '', '', '', r.memo, '', amount, '', ''],
      });
      continue;
    }

    matchedCount++;
    const group = patternGroups[matched.pattern] || [matched];
    let resolved = matched;
    let vendorEditable = false;
    let vendorOptions = [];
    let sheetMatched = false;
    if (group.length > 1) {
      // 1순위: 사택관리비 시트 금액으로 유일 확정 (전기/가스/수도/관리비 변동 항목)
      const bySheet = resolveGroupBySheet(group, r.withdrawal, r.year, parseInt(month, 10));
      if (bySheet) {
        resolved = bySheet;
        sheetMatched = true;
      } else {
        const forceManual = isAlwaysManualGroup(matched);
        const { resolved: byAmount, candidates } = forceManual
          ? { resolved: null, candidates: group }
          : resolveGroupCandidates(group, r.withdrawal);
        if (byAmount) {
          resolved = byAmount; // 실제 출금액으로 유일하게 확정된 후보
        } else {
          vendorOptions = buildVoucherVendorOptions(candidates);
          vendorEditable = vendorOptions.length > 1;
          resolved = vendorOptions[0] ? vendorOptions[0].item : matched; // 확정 전 미리보기 기본값
        }
      }
    }

    // 예전에 "확정"으로 저장해둔 선택이 있으면 새로고침 후에도 그 값으로 고정하고 드롭다운을 다시 띄우지 않는다.
    let locked = false;
    const confirmed = confirmedMap[persistKey];
    if (confirmed) {
      if (vendorEditable && confirmed.dedupeKey) {
        const chosen = vendorOptions.find((o) => o.dedupeKey === confirmed.dedupeKey);
        if (chosen) resolved = chosen.item;
        vendorEditable = false;
        vendorOptions = [];
      }
      locked = true;
    }

    // 계정과목/거래처/적요는 항상 최종 확정된(혹은 아직 여럿 중 미리보기용 기본값인) 등록 항목 하나로부터 조립한다.
    const debit = voucherDebitRow(resolved, month, day, amount);
    const credit = voucherCreditRow(resolved, month, day, amount);

    entries.push({
      key: `${r.year}-${r.date}-${entries.length}`,
      persistKey,
      vendorEditable,
      unmatched: false,
      vendorOptions,
      locked,
      sheetMatched,
      debit,
      credit,
    });
  }
  return { entries, matchedCount, totalCount: withdrawals.length };
}

function filterVoucherEntriesByMonth(entries, month) {
  if (!month || month === 'all') return entries;
  return entries.filter((entry) => entry.debit[0] === month);
}

// 통장내역/자동이체 리스트가 바뀔 때만 다시 계산 (달 필터는 이 결과를 그냥 걸러서 보여주기만 함)
function renderVoucherList(yearRows, transfers) {
  const { entries, matchedCount, totalCount } = buildVoucherRows(yearRows, transfers);
  state.voucherEntries = entries;
  state.voucherMatchedCount = matchedCount;
  state.voucherTotalCount = totalCount;
  state.voucherVendorSelections = {}; // 데이터가 바뀌면 드롭다운 선택값도 초기화
  displayVoucherRows();
}

// 드롭다운에서 지금 고른 후보(아직 확정 전)가 있으면 그 항목을 돌려준다.
function selectedVoucherItem(entry) {
  const selectedIdx = state.voucherVendorSelections[entry.key];
  const opt = selectedIdx ? entry.vendorOptions[parseInt(selectedIdx, 10)] : null;
  return opt ? opt.item : null;
}

// 후보를 고르는 중일 때, 계정과목코드/계정과목명/거래처코드/거래처명/적요명 칸이 원래 값(value) 대신
// 지금 고른 후보 기준으로 보이게 한다. 대변의 거래처코드/거래처명은 회사 고정값이라 이 대상에서 뺀다.
function liveVoucherCellValue(item, colIndex, isCredit, fallback) {
  if (!isCredit) {
    if (colIndex === VOUCHER_ACCOUNT_CODE_COL) return item.costAccountCode || '';
    if (colIndex === VOUCHER_ACCOUNT_COL) return item.costAccount || '';
    if (colIndex === VOUCHER_VENDOR_CODE_COL) return item.vendorCode || '';
    if (colIndex === VOUCHER_VENDOR_COL) return item.vendor || '';
    if (colIndex === VOUCHER_MEMO_COL) return voucherMemoFor(item);
    return fallback;
  }
  if (colIndex === VOUCHER_ACCOUNT_CODE_COL) return item.creditAccountCode || '';
  if (colIndex === VOUCHER_ACCOUNT_COL) return item.creditAccount || '';
  if (colIndex === VOUCHER_MEMO_COL) return voucherMemoFor(item);
  return fallback;
}

function renderVoucherCell(entry, colIndex, value, isCredit) {
  if (entry.unmatched && colIndex === VOUCHER_ACCOUNT_COL) {
    return `<td><span class="badge">미분류</span></td>`;
  }

  // 대변(보통예금) 거래처/거래처코드는 회사 고정값이라 거래처 드롭다운 선택에 영향받지 않고 항상 그대로 표시한다.
  if (isCredit && (colIndex === VOUCHER_VENDOR_COL || colIndex === VOUCHER_VENDOR_CODE_COL)) {
    return `<td>${value || '-'}</td>`;
  }

  const selectedItem = entry.vendorEditable ? selectedVoucherItem(entry) : null;
  const liveValue = selectedItem ? liveVoucherCellValue(selectedItem, colIndex, isCredit, value) : value;

  if (colIndex === VOUCHER_MEMO_COL) {
    const confirmBtn = entry.vendorEditable && !entry.locked
      ? ` <button type="button" class="btn small secondary voucher-confirm-btn" data-key="${entry.key}">확정</button>`
      : '';
    const sheetBadge = entry.sheetMatched ? '<span class="badge ok">시트</span>' : '';
    return `<td>${liveValue || '-'}${entry.locked ? '<span class="badge ok">확정</span>' : ''}${sheetBadge}${confirmBtn}</td>`;
  }

  if (!entry.vendorEditable) {
    return `<td>${value || '-'}</td>`;
  }

  if (colIndex === VOUCHER_VENDOR_COL) {
    const selectedIdx = state.voucherVendorSelections[entry.key];
    if (entry.locked) return `<td>${liveValue || value || '-'}</td>`;
    const options = entry.vendorOptions
      .map((o, i) => `<option value="${i}" ${String(i) === selectedIdx ? 'selected' : ''}>${escapeHtml(o.label)}</option>`)
      .join('');
    return `<td><select class="voucher-vendor-select" data-key="${entry.key}"><option value="">${escapeHtml(value) || '(선택 안 함)'}</option>${options}</select></td>`;
  }

  return `<td>${liveValue || '-'}</td>`;
}

// 그 행(차변/대변 한 쌍)만 확정 - 지금 선택된 값을 굳혀서 더 이상 못 바꾸게 한다
function confirmVoucherEntry(key) {
  const entry = state.voucherEntries.find((e) => e.key === key);
  if (!entry) return;
  entry.locked = true;

  // 선택한 후보를 localStorage에 저장해서 새로고침 후에도 다시 드롭다운으로 안 뜨고 그 후보 값으로 고정된다.
  const confirmed = {};
  if (entry.vendorEditable) {
    // 드롭다운을 안 건드리고 바로 확정을 누르면 화면에 보이던 첫 번째 후보로 고정한다.
    const selectedItem = selectedVoucherItem(entry) || (entry.vendorOptions[0] && entry.vendorOptions[0].item);
    if (selectedItem) confirmed.dedupeKey = `${selectedItem.vendor}||${selectedItem.user}`;
  }
  if (Object.keys(confirmed).length) {
    const map = loadConfirmedVoucherMap(state.company, state.year);
    map[entry.persistKey] = confirmed;
    saveConfirmedVoucherMap(state.company, state.year, map);
  }

  displayVoucherRows();
}

function displayVoucherRows() {
  const filtered = filterVoucherEntriesByMonth(state.voucherEntries, state.voucherMonth);
  const monthLabel = state.voucherMonth === 'all' ? '전체' : `${parseInt(state.voucherMonth, 10)}월`;
  const reconciled = state.voucherEntries.length === state.voucherTotalCount;
  const checkBadge = reconciled
    ? '<span class="badge ok">통장내역 출금건수와 일치 ✓</span>'
    : `<span class="badge">통장내역 ${state.voucherTotalCount}건 ≠ 전표 ${state.voucherEntries.length}건 - 확인 필요</span>`;
  const unmatchedCount = state.voucherTotalCount - state.voucherMatchedCount;
  const yearLabel = state.year ? `${state.year}년 ` : '';
  document.getElementById('voucherSummary').innerHTML =
    `${state.company} ${yearLabel}${monthLabel} - 통장내역 출금 ${state.voucherTotalCount}건 중 ${state.voucherMatchedCount}건 매칭 / ${unmatchedCount}건 미분류, 전표 ${state.voucherEntries.length * 2}행(${state.voucherEntries.length}건) 생성, 지금 ${filtered.length * 2}행 표시 중 ${checkBadge} (아직 구글시트에는 반영하지 않은 미리보기입니다)`;
  document.getElementById('voucherTableHead').innerHTML =
    `<tr>${VOUCHER_HEADER.map((h) => `<th>${h}</th>`).join('')}</tr>`;
  document.getElementById('voucherTableBody').innerHTML = filtered.length
    ? filtered.map((entry) => `
        <tr>${entry.debit.map((v, i) => renderVoucherCell(entry, i, v, false)).join('')}</tr>
        <tr>${entry.credit.map((v, i) => renderVoucherCell(entry, i, v, true)).join('')}</tr>
      `).join('')
    : `<tr><td colspan="${VOUCHER_HEADER.length}">해당 월에 생성된 전표가 없습니다.</td></tr>`;

  document.querySelectorAll('.voucher-vendor-select').forEach((sel) => {
    sel.onchange = (e) => {
      state.voucherVendorSelections[e.target.dataset.key] = e.target.value;
      displayVoucherRows(); // 거래처코드 칸은 별도 <td>라서 전체 다시 그려야 같이 바뀐다
    };
  });
  document.querySelectorAll('.voucher-confirm-btn').forEach((btn) => {
    btn.onclick = () => confirmVoucherEntry(btn.dataset.key);
  });
}

function flattenVoucherEntries(entries) {
  const rows = [];
  for (const entry of entries) {
    let debit = entry.debit;
    let credit = entry.credit;

    // 아직 확정 안 누르고 드롭다운만 고른 상태로 내보내도, 화면에 보이는 그 후보 기준으로 나가게 한다.
    if (entry.vendorEditable) {
      const selectedItem = selectedVoucherItem(entry);
      if (selectedItem) {
        const amount = entry.debit[8];
        debit = voucherDebitRow(selectedItem, entry.debit[0], entry.debit[1], amount);
        credit = voucherCreditRow(selectedItem, entry.credit[0], entry.credit[1], amount);
      }
    }
    rows.push(debit, credit);
  }
  return rows;
}

function exportVoucherExcel() {
  const filtered = filterVoucherEntriesByMonth(state.voucherEntries, state.voucherMonth);
  if (!filtered.length) {
    alert('내보낼 전표가 없습니다. 먼저 월을 선택하거나 매칭된 전표가 있는지 확인해주세요.');
    return;
  }
  const rows = flattenVoucherEntries(filtered);
  const ws = XLSX.utils.aoa_to_sheet([VOUCHER_HEADER, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '자동전표');
  const monthLabel = state.voucherMonth === 'all' ? '전체' : `${parseInt(state.voucherMonth, 10)}월`;
  XLSX.writeFile(wb, `자동전표_${state.company}_${state.year}년_${monthLabel}.xlsx`);
}

async function loadAll() {
  document.getElementById('loading').style.display = 'block';
  document.getElementById('app').style.display = 'none';
  document.getElementById('errorBox').innerHTML = '';
  try {
    const bankCompanies = Object.keys(BANK_SHEET_NAMES);
    const bankTables = await Promise.all(bankCompanies.map((c) => loadSheetJsonp(BANK_SHEET_NAMES[c])));

    bankCompanies.forEach((c, i) => {
      state.bankRowsByCompany[c] = parseBankRows(tableToRows(bankTables[i]), c);
    });

    // 자동이체 리스트는 구글시트에서 자동으로 가져오지 않고, localStorage에 저장된 것만 쓴다.
    state.transfers = loadRecurringItems();
    state.hasLoaded = true;

    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    renderCompanyTabs();
    renderYearSelect();
    renderSubTabs();
    render();
  } catch (e) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('errorBox').innerHTML =
      `<div class="flash error">구글시트를 불러오지 못했습니다: ${e.message}<br>
      인터넷 연결과 구글시트 공유 설정("링크가 있는 모든 사용자"로 열람 가능해야 함)을 확인해주세요.</div>`;
  }
}

function renderCompanyTabs() {
  const el = document.getElementById('companyTabs');
  el.innerHTML = '';
  for (const c of COMPANIES) {
    const pending = !state.bankFile[c] || !state.bankFile[c].rows.length;
    const btn = document.createElement('div');
    btn.className = 'company-tab' + (c === state.company ? ' active' : '') + (pending ? ' pending' : '');
    btn.innerHTML = pending ? `${c}<span class="pending-label">통장내역 업로드 필요</span>` : c;
    btn.onclick = () => { state.company = c; state.year = null; renderCompanyTabs(); renderYearSelect(); render(); };
    el.appendChild(btn);
  }
}

const VIEWS = [
  { key: 'recurring', label: '자동이체 리스트' },
  { key: 'bank', label: '통장내역' },
  { key: 'voucher', label: '자동전표' },
];

function renderSubTabs() {
  const el = document.getElementById('themeTabs');
  el.innerHTML = '';
  for (const v of VIEWS) {
    const btn = document.createElement('div');
    btn.className = 'sub-tab' + (v.key === state.activeView ? ' active' : '');
    btn.textContent = v.label;
    btn.onclick = () => { state.activeView = v.key; renderSubTabs(); updatePanelVisibility(); };
    el.appendChild(btn);
  }
}

function updatePanelVisibility() {
  for (const v of VIEWS) {
    document.getElementById('panel-' + v.key).style.display = v.key === state.activeView ? 'block' : 'none';
  }
}

function renderYearSelect() {
  const bankRows = bankFileToYearRows(state.company);
  const sel = document.getElementById('yearSelect');
  const years = Array.from(new Set(bankRows.map((r) => r.year))).sort((a, b) => b - a);
  if (state.year === null || !years.includes(state.year)) state.year = years[0] || null;
  sel.innerHTML = years.map((y) => `<option value="${y}" ${y === state.year ? 'selected' : ''}>${y}년</option>`).join('');
  sel.onchange = () => { state.year = parseInt(sel.value, 10); render(); };
}

function render() {
  const bankRows = bankFileToYearRows(state.company);
  const transfers = state.transfers.filter((t) => t.company === state.company);
  const yearRows = bankRows.filter((r) => r.year === state.year);
  state.yearRows = yearRows;
  state.currentTransfers = transfers;

  renderRecurringList(transfers);
  renderBankList();
  renderVoucherList(yearRows, transfers);
  updatePanelVisibility();
}

// 그래프는 항상 연간 추이를 보여준다 (월 필터는 통계 카드/항목별 표에만 적용)
function displaySummary() {
  const yearRows = state.yearRows;
  const transfers = state.currentTransfers;

  const monthlyTotals = Object.fromEntries(MONTHS.map((m) => [m, 0]));
  for (const r of yearRows) {
    if (r.withdrawal) monthlyTotals[r.date.split('-')[0]] += r.withdrawal;
  }
  const monthlySeries = MONTHS.map((m) => Math.round(monthlyTotals[m] || 0));
  if (state.chart) state.chart.destroy();
  state.chart = new Chart(document.getElementById('monthlyChart'), {
    type: 'bar',
    data: {
      labels: MONTHS,
      datasets: [{ label: `${state.year}년 ${state.company} 월별 지출`, data: monthlySeries, backgroundColor: '#2563eb' }],
    },
    options: { responsive: true, plugins: { legend: { display: false } } },
  });

  const filteredRows = state.summaryMonth === 'all'
    ? yearRows
    : yearRows.filter((r) => r.date.split('-')[0] === state.summaryMonth);

  const itemMonthly = {}; // 앞 3글자(groupKey) -> {month: 합계}
  const groupDisplayName = {}; // groupKey -> 대표 표시명
  let totalSpend = 0, totalCount = 0, unmatchedCount = 0;

  for (const r of filteredRows) {
    if (!r.withdrawal) continue;
    const month = r.date.split('-')[0];
    const matched = findBestMatch(r.memo, transfers, r.withdrawal);
    const groupKey = matched ? vendorGroupKey(matched.vendor) : '미분류'; // 거래처명 앞 3글자가 같으면 같은 항목으로 묶는다
    if (!itemMonthly[groupKey]) itemMonthly[groupKey] = {};
    itemMonthly[groupKey][month] = (itemMonthly[groupKey][month] || 0) + r.withdrawal;
    if (!groupDisplayName[groupKey]) groupDisplayName[groupKey] = matched ? matched.vendor : '미분류';
    totalSpend += r.withdrawal;
    totalCount += 1;
    if (!matched) unmatchedCount += 1;
  }

  const monthLabel = state.summaryMonth === 'all' ? '' : ` ${parseInt(state.summaryMonth, 10)}월`;
  document.getElementById('totalLabel').textContent = `${state.year}년${monthLabel} 총 지출 (${state.company})`;
  document.getElementById('totalValue').textContent = Math.round(totalSpend).toLocaleString('ko-KR') + '원';
  document.getElementById('countValue').textContent = totalCount + '건';
  document.getElementById('unmatchedValue').textContent = unmatchedCount + '건';

  const thead = document.getElementById('itemTableHead');
  const tbody = document.getElementById('itemTableBody');

  if (state.summaryMonth === 'all') {
    thead.innerHTML = `<tr><th>항목</th>${MONTHS.map((m) => `<th>${parseInt(m, 10)}월</th>`).join('')}<th>합계</th></tr>`;
    const itemRows = Object.entries(itemMonthly)
      .map(([groupKey, monthsObj]) => {
        const label = groupDisplayName[groupKey] || groupKey;
        const monthVals = MONTHS.map((m) => Math.round(monthsObj[m] || 0));
        return { label, unmatched: label === '미분류', months: monthVals, total: monthVals.reduce((a, b) => a + b, 0) };
      })
      .sort((a, b) => b.total - a.total);
    tbody.innerHTML = itemRows.map((row) => `
      <tr>
        <td>${row.label}${row.unmatched ? '<span class="badge">미분류</span>' : ''}</td>
        ${row.months.map((v) => `<td>${v ? v.toLocaleString('ko-KR') : '-'}</td>`).join('')}
        <td><strong>${row.total.toLocaleString('ko-KR')}</strong></td>
      </tr>
    `).join('') || `<tr><td colspan="${MONTHS.length + 2}">데이터가 없습니다.</td></tr>`;
  } else {
    thead.innerHTML = `<tr><th>항목</th><th>금액</th></tr>`;
    const itemRows = Object.entries(itemMonthly)
      .map(([groupKey, monthsObj]) => {
        const label = groupDisplayName[groupKey] || groupKey;
        return { label, unmatched: label === '미분류', amount: Math.round(monthsObj[state.summaryMonth] || 0) };
      })
      .filter((row) => row.amount)
      .sort((a, b) => b.amount - a.amount);
    tbody.innerHTML = itemRows.map((row) => `
      <tr>
        <td>${row.label}${row.unmatched ? '<span class="badge">미분류</span>' : ''}</td>
        <td>${row.amount.toLocaleString('ko-KR')}</td>
      </tr>
    `).join('') || '<tr><td colspan="2">해당 월에 데이터가 없습니다.</td></tr>';
  }
}

// ── 한백이엔씨 자동이체 리스트 시드 ────────────────────────────────────────────
// 사용자가 준 "자동이체출금 관리시트"(2026-09) 기준 한백이엔씨 18개 항목.
// code 시트의 계정과목/거래처코드(외상매입금=251, 관리비_세금과공과금=61702,
// 기타_차량유지비=62204, 보통예금=103, 대변거래처 98007)로 교차 검증했다.
// 자동이체 리스트는 localStorage에 저장되므로, 아직 한 번도 안 심은 브라우저에서만
// 딱 한 번(아래 flag) 채워 넣는다. 이미 한백이엔씨 항목을 직접 넣어둔 브라우저는 건드리지 않는다.
const HANBAEK_ENC_SEED = [
  {"company": "한백이엔씨", "vendor": "한국전력공사", "vendorCode": "000277", "pattern": "전기요금", "amount": "관리비 시트", "costAccount": "외상매입금", "costAccountCode": "251", "dueDate": "5일", "user": "무정전 수원 사택", "creditAccount": "보통예금", "creditAccountCode": "103", "bankName": "농협", "bankAccount": "301-0177-4356-01", "creditVendorCode": "98007"},
  {"company": "한백이엔씨", "vendor": "한국전력공사", "vendorCode": "000277", "pattern": "전기요금", "amount": "관리비 시트", "costAccount": "외상매입금", "costAccountCode": "251", "dueDate": "25일", "user": "동아아파트 105-106", "creditAccount": "보통예금", "creditAccountCode": "103", "bankName": "농협", "bankAccount": "301-0177-4356-01", "creditVendorCode": "98007"},
  {"company": "한백이엔씨", "vendor": "(주)삼천리", "vendorCode": "001461", "pattern": "가스요금", "amount": "", "costAccount": "외상매입금", "costAccountCode": "251", "dueDate": "25", "user": "무정전 수원 사택", "creditAccount": "보통예금", "creditAccountCode": "103", "bankName": "농협", "bankAccount": "301-0177-4356-01", "creditVendorCode": "98007"},
  {"company": "한백이엔씨", "vendor": "(주)해양에너지", "vendorCode": "001318", "pattern": "가스요금", "amount": "관리비 시트", "costAccount": "외상매입금", "costAccountCode": "251", "dueDate": "말일", "user": "동아아파트 105-106", "creditAccount": "보통예금", "creditAccountCode": "103", "bankName": "농협", "bankAccount": "301-0177-4356-01", "creditVendorCode": "98007"},
  {"company": "한백이엔씨", "vendor": "(주)해양에너지", "vendorCode": "001318", "pattern": "가스요금", "amount": "관리비 시트", "costAccount": "외상매입금", "costAccountCode": "251", "dueDate": "말일", "user": "호반아파트 101-1605", "creditAccount": "보통예금", "creditAccountCode": "103", "bankName": "농협", "bankAccount": "301-0177-4356-01", "creditVendorCode": "98007"},
  {"company": "한백이엔씨", "vendor": "수원시상수도사업소", "vendorCode": "000260", "pattern": "가스요금", "amount": "", "costAccount": "외상매입금", "costAccountCode": "251", "dueDate": "말일", "user": "무정전 수원 사택", "creditAccount": "보통예금", "creditAccountCode": "103", "bankName": "농협", "bankAccount": "301-0177-4356-01", "creditVendorCode": "98007"},
  {"company": "한백이엔씨", "vendor": "(주)케이티", "vendorCode": "000260", "pattern": "KT", "amount": "37400", "costAccount": "외상매입금", "costAccountCode": "251", "dueDate": "21일", "user": "무정전 수원 사택", "creditAccount": "보통예금", "creditAccountCode": "103", "bankName": "농협", "bankAccount": "301-0177-4356-01", "creditVendorCode": "98007"},
  {"company": "한백이엔씨", "vendor": "(주)케이티", "vendorCode": "000260", "pattern": "KT", "amount": "69970", "costAccount": "외상매입금", "costAccountCode": "251", "dueDate": "21일", "user": "본사", "creditAccount": "보통예금", "creditAccountCode": "103", "bankName": "농협", "bankAccount": "301-0177-4356-01", "creditVendorCode": "98007"},
  {"company": "한백이엔씨", "vendor": "(주)케이티", "vendorCode": "000260", "pattern": "KT", "amount": "2720", "costAccount": "외상매입금", "costAccountCode": "251", "dueDate": "말일", "user": "본사", "creditAccount": "보통예금", "creditAccountCode": "103", "bankName": "농협", "bankAccount": "301-0177-4356-01", "creditVendorCode": "98007"},
  {"company": "한백이엔씨", "vendor": "(주)케이티", "vendorCode": "000260", "pattern": "KT", "amount": "5170", "costAccount": "외상매입금", "costAccountCode": "251", "dueDate": "25 일", "user": "본사", "creditAccount": "보통예금", "creditAccountCode": "103", "bankName": "농협", "bankAccount": "301-0177-4356-01", "creditVendorCode": "98007"},
  {"company": "한백이엔씨", "vendor": "(주)케이티", "vendorCode": "000260", "pattern": "KT", "amount": "1080", "costAccount": "외상매입금", "costAccountCode": "251", "dueDate": "말일", "user": "본사", "creditAccount": "보통예금", "creditAccountCode": "103", "bankName": "농협", "bankAccount": "301-0177-4356-01", "creditVendorCode": "98007"},
  {"company": "한백이엔씨", "vendor": "(주)케이티", "vendorCode": "000260", "pattern": "KT", "amount": "5140", "costAccount": "외상매입금", "costAccountCode": "251", "dueDate": "25일", "user": "본사", "creditAccount": "보통예금", "creditAccountCode": "103", "bankName": "농협", "bankAccount": "301-0177-4356-01", "creditVendorCode": "98007"},
  {"company": "한백이엔씨", "vendor": "(주)케이티", "vendorCode": "000260", "pattern": "KT", "amount": "22000", "costAccount": "외상매입금", "costAccountCode": "251", "dueDate": "25일", "user": "본사", "creditAccount": "보통예금", "creditAccountCode": "103", "bankName": "농협", "bankAccount": "301-0177-4356-01", "creditVendorCode": "98007"},
  {"company": "한백이엔씨", "vendor": "(주)엘지유플러스", "vendorCode": "000259", "pattern": "LG", "amount": "22000", "costAccount": "외상매입금", "costAccountCode": "251", "dueDate": "26일", "user": "본사", "creditAccount": "보통예금", "creditAccountCode": "103", "bankName": "농협", "bankAccount": "301-0177-4356-01", "creditVendorCode": "98007"},
  {"company": "한백이엔씨", "vendor": "코웨이", "vendorCode": "005601", "pattern": "코웨이렌탈", "amount": "30500", "costAccount": "외상매입금", "costAccountCode": "251", "dueDate": "20일", "user": "무정전 수원 사택", "creditAccount": "보통예금", "creditAccountCode": "103", "bankName": "농협", "bankAccount": "301-0177-4356-01", "creditVendorCode": "98007"},
  {"company": "한백이엔씨", "vendor": "호반아파트입주자대표회의", "vendorCode": "004497", "pattern": "아파트관리비", "amount": "관리비 시트", "costAccount": "관리비_세금과공과금", "costAccountCode": "61702", "dueDate": "말일", "user": "호반아파트 101-1605", "creditAccount": "보통예금", "creditAccountCode": "103", "bankName": "농협", "bankAccount": "301-0177-4356-01", "creditVendorCode": "98007"},
  {"company": "한백이엔씨", "vendor": "동아아파트", "vendorCode": "004494", "pattern": "아파트관리비", "amount": "관리비 시트", "costAccount": "관리비_세금과공과금", "costAccountCode": "61702", "dueDate": "29", "user": "동아아파트 105-106", "creditAccount": "보통예금", "creditAccountCode": "103", "bankName": "광주", "bankAccount": "1107-021-281411", "creditVendorCode": "98007"},
  {"company": "한백이엔씨", "vendor": "하이플러스-하이패스", "vendorCode": "000967", "pattern": "HIPASS", "amount": "", "costAccount": "기타_차량유지비", "costAccountCode": "62204", "dueDate": "수시", "user": "송전", "creditAccount": "보통예금", "creditAccountCode": "103", "bankName": "농협", "bankAccount": "301-0177-4356-01", "creditVendorCode": "98007"},
];
const HANBAEK_ENC_SEED_FLAG_KEY = 'autoTransferHanbaekEncSeeded_v1';
function seedHanbaekEncItems() {
  try {
    if (localStorage.getItem(HANBAEK_ENC_SEED_FLAG_KEY)) return; // 이미 한 번 심었으면 다시 안 함
    const items = loadRecurringItems(); // 여기서 스키마 마이그레이션/버전 세팅이 끝난 상태
    const hasEnc = items.some((it) => it.company === '한백이엔씨');
    if (!hasEnc) {
      // 최종 형태 그대로 넣는다(버전이 이미 최신이라 다음 로드 때 마이그레이션이 다시 건드리지 않음)
      const seeded = HANBAEK_ENC_SEED.map((it) => ({ id: makeItemId(), ...it }));
      saveRecurringItems([...items, ...seeded]);
    }
    localStorage.setItem(HANBAEK_ENC_SEED_FLAG_KEY, '1');
  } catch (e) { /* localStorage 접근 불가 시 조용히 무시 */ }
}

function initAutoTransferModule() {
  seedHanbaekEncItems();
  state.transfers = loadRecurringItems();
  document.getElementById('refreshBtn').onclick = loadAll;

  const MONTH_SELECT_OPTIONS =
    `<option value="all">전체 월</option>` + MONTHS.map((m) => `<option value="${m}">${parseInt(m, 10)}월</option>`).join('');

  document.getElementById('voucherMonthSelect').innerHTML = MONTH_SELECT_OPTIONS;
  document.getElementById('voucherMonthSelect').onchange = (e) => {
    state.voucherMonth = e.target.value;
    displayVoucherRows();
  };
  document.getElementById('voucherExportBtn').onclick = exportVoucherExcel;

  document.getElementById('summaryMonthSelect').innerHTML = MONTH_SELECT_OPTIONS;
  document.getElementById('summaryMonthSelect').onchange = (e) => {
    state.summaryMonth = e.target.value;
    displaySummary();
  };

  document.getElementById('bankMonthSelect').innerHTML = MONTH_SELECT_OPTIONS;
  document.getElementById('bankMonthSelect').onchange = (e) => {
    state.bankMonth = e.target.value;
    renderBankList();
  };

  document.getElementById('bankFileInput').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      const header = (aoa[0] || []).map((h) => String(h));
      const rows = aoa.slice(1)
        .filter((row) => row.some((c) => String(c).trim() !== ''))
        .map((row) => row.map((c) => String(c)));
      setBankFileForCompany(state.company, header, rows);
      e.target.value = '';
    };
    reader.onerror = () => alert('파일을 읽지 못했습니다.');
    reader.readAsArrayBuffer(file);
  };

  document.getElementById('bankResetBtn').onclick = () => {
    if (confirm(`${state.company}의 통장내역을 전체 삭제할까요? 되돌릴 수 없습니다.`)) {
      resetBankFileForCompany(state.company);
    }
  };

  document.getElementById('rfAddBtn').onclick = () => {
    const vendor = document.getElementById('rfVendor').value.trim();
    if (!vendor) {
      alert('거래처명은 꼭 입력해주세요.');
      return;
    }
    const values = {
      vendor,
      vendorCode: document.getElementById('rfVendorCode').value.trim(),
      pattern: document.getElementById('rfPattern').value.trim(),
      amount: document.getElementById('rfAmount').value.trim(),
      costAccount: document.getElementById('rfCostAccount').value.trim(),
      costAccountCode: document.getElementById('rfCostAccountCode').value.trim(),
      dueDate: document.getElementById('rfDueDate').value.trim(),
      user: document.getElementById('rfUser').value.trim(),
      creditAccount: document.getElementById('rfCreditAccount').value.trim(),
      creditAccountCode: document.getElementById('rfCreditAccountCode').value.trim(),
      bankName: document.getElementById('rfBankName').value.trim(),
      bankAccount: document.getElementById('rfBankAccount').value.trim(),
      creditVendorCode: '98007', // 대변(보통예금) 거래처코드는 고정값이라 폼에서 입력받지 않는다
    };
    if (state.recurringEditingId) {
      updateRecurringItem(state.recurringEditingId, values);
      cancelEditRecurringItem();
    } else {
      addRecurringItem({ company: state.company, ...values });
      ['rfVendor', 'rfPattern', 'rfAmount', 'rfCostAccount', 'rfCostAccountCode', 'rfDueDate', 'rfUser', 'rfBankName', 'rfBankAccount'].forEach((id) => {
        document.getElementById(id).value = '';
      });
    }
  };

  document.getElementById('rfCancelBtn').onclick = cancelEditRecurringItem;

  // 법인 목록/탭 구조는 구글시트 데이터 없이도 바로 보여주고, 실제 데이터는 "새로고침"을
  // 눌러야 그때 불러온다 (페이지를 열자마자 자동으로 구글시트를 조회하지 않는다).
  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  renderCompanyTabs();
  renderYearSelect();
  renderSubTabs();
  render();
}

initAutoTransferModule();
