// 열린구매 자동전표 모듈
// 입력: 열린구매/재무포탈에서 내려받은 자금집행 엑셀 (화면에서 업로드)
// 전표: 지급 전표만 — (차) 비용/자산 계정 · (대) 보통예금
// 저장: 업로드한 데이터는 이 브라우저 localStorage 에만 저장된다.

const UPLOAD_STORAGE_KEY = 'yeollinGumaeUpload';

// 자동전표 내보내기 형식 — 자동이체 자동전표와 동일한 컬럼 구성을 쓴다.
const VOUCHER_HEADER = ['월', '일', '구분', '계정과목코드', '계정과목명', '거래처코드', '거래처명', '적요명', '차변(출금)', '대변(대변)', 'CODE', '부서'];

let state = {
  activeView: 'upload',
  upload: loadUpload(), // { sheetName, header, rows } | null
};

// ---------- 저장/불러오기 ----------
function loadUpload() {
  try {
    const raw = localStorage.getItem(UPLOAD_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function saveUpload(data) {
  if (data) {
    localStorage.setItem(UPLOAD_STORAGE_KEY, JSON.stringify(data));
  } else {
    localStorage.removeItem(UPLOAD_STORAGE_KEY);
  }
  state.upload = data;
}

// ---------- 유틸 ----------
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function showError(msg) {
  const box = document.getElementById('errorBox');
  box.innerHTML = msg ? `<div class="flash error">${escapeHtml(msg)}</div>` : '';
}
function renderTable(headEl, bodyEl, header, rows, emptyMsg) {
  if (!header || !header.length) {
    headEl.innerHTML = '';
    bodyEl.innerHTML = `<tr><td>${escapeHtml(emptyMsg || '데이터가 없습니다.')}</td></tr>`;
    return;
  }
  headEl.innerHTML = `<tr>${header.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
  bodyEl.innerHTML = rows.length
    ? rows.map((r) => `<tr>${header.map((_, i) => `<td>${escapeHtml(r[i])}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${header.length}">${escapeHtml(emptyMsg || '데이터가 없습니다.')}</td></tr>`;
}

// ---------- 엑셀 업로드 ----------
function handleFile(file) {
  showError('');
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      // 첫 번째 비어있지 않은 행을 헤더로 본다.
      const headerIdx = aoa.findIndex((row) => row.some((c) => String(c).trim() !== ''));
      if (headerIdx === -1) {
        showError('엑셀에서 읽을 데이터를 찾지 못했습니다.');
        return;
      }
      const header = aoa[headerIdx].map((c) => String(c).trim());
      const rows = aoa.slice(headerIdx + 1).filter((row) => row.some((c) => String(c).trim() !== ''));
      saveUpload({ sheetName, header, rows, fileName: file.name });
      state.activeView = 'list';
      render();
    } catch (err) {
      showError('엑셀을 읽는 중 오류가 발생했습니다: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderUploadPanel() {
  const status = document.getElementById('uploadStatus');
  const u = state.upload;
  if (u) {
    status.textContent = `업로드됨: ${u.fileName || '(파일명 없음)'} · 시트 "${u.sheetName}" · ${u.rows.length}행`;
    renderTable(document.getElementById('uploadTableHead'), document.getElementById('uploadTableBody'), u.header, u.rows.slice(0, 200), '데이터가 없습니다.');
  } else {
    status.textContent = '아직 업로드된 파일이 없습니다.';
    renderTable(document.getElementById('uploadTableHead'), document.getElementById('uploadTableBody'), [], [], '파일을 올리면 여기에 미리보기가 표시됩니다.');
  }
}

// ---------- 자금집행 목록 / 결과 ----------
// (엑셀 컬럼 구성을 확정한 뒤, 목록/결과를 구분해서 채웁니다. 지금은 업로드 원본을 그대로 보여줍니다.)
function renderListPanel() {
  const u = state.upload;
  renderTable(
    document.getElementById('listTableHead'),
    document.getElementById('listTableBody'),
    u ? u.header : [],
    u ? u.rows : [],
    '먼저 "엑셀 업로드"에서 자금집행 파일을 올려주세요.'
  );
}
function renderResultPanel() {
  const u = state.upload;
  renderTable(
    document.getElementById('resultTableHead'),
    document.getElementById('resultTableBody'),
    u ? u.header : [],
    u ? u.rows : [],
    '먼저 "엑셀 업로드"에서 자금집행 파일을 올려주세요.'
  );
}

// ---------- 자금전표 ----------
// (지급 전표: (차) 비용/자산 · (대) 보통예금. 엑셀 컬럼 → 전표 매핑 규칙은 샘플 확정 후 채웁니다.)
function buildVoucherRows() {
  // TODO: state.upload.rows 를 VOUCHER_HEADER 형식으로 변환.
  return [];
}
function renderVoucherPanel() {
  const rows = buildVoucherRows();
  const summary = document.getElementById('voucherSummary');
  if (!state.upload) {
    summary.textContent = '먼저 "엑셀 업로드"에서 자금집행 파일을 올려주세요.';
  } else if (!rows.length) {
    summary.textContent = '전표 변환 규칙은 엑셀 컬럼 확정 후 채웁니다. (지급 전표: 차변 비용/자산 · 대변 보통예금)';
  } else {
    summary.textContent = `전표 ${rows.length}행 생성 (아직 구글시트에는 반영하지 않은 미리보기)`;
  }
  renderTable(document.getElementById('voucherTableHead'), document.getElementById('voucherTableBody'), VOUCHER_HEADER, rows, '아직 생성된 전표가 없습니다.');
}
function exportVoucherExcel() {
  const rows = buildVoucherRows();
  if (!rows.length) {
    alert('내보낼 전표가 없습니다. 전표 변환 규칙이 아직 설정되지 않았어요.');
    return;
  }
  const ws = XLSX.utils.aoa_to_sheet([VOUCHER_HEADER, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '자금전표');
  XLSX.writeFile(wb, `열린구매_자금전표.xlsx`);
}

// ---------- 화면 전환 ----------
function render() {
  document.querySelectorAll('#navTabs .company-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === state.activeView);
  });
  const panels = { upload: 'panel-upload', list: 'panel-list', result: 'panel-result', voucher: 'panel-voucher' };
  Object.entries(panels).forEach(([view, id]) => {
    document.getElementById(id).style.display = view === state.activeView ? '' : 'none';
  });
  if (state.activeView === 'upload') renderUploadPanel();
  else if (state.activeView === 'list') renderListPanel();
  else if (state.activeView === 'result') renderResultPanel();
  else if (state.activeView === 'voucher') renderVoucherPanel();
}

// ---------- 초기화 ----------
document.getElementById('navTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.company-tab');
  if (!tab) return;
  state.activeView = tab.dataset.view;
  render();
});
document.getElementById('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
  e.target.value = '';
});
document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('업로드한 데이터를 모두 삭제할까요?')) {
    saveUpload(null);
    render();
  }
});
document.getElementById('voucherExportBtn').addEventListener('click', exportVoucherExcel);

render();
