# 구글 앱스 스크립트(GAS) 업데이트 가이드 — 생활기록 이관

생활기록 데이터를 Supabase로 옮기려면, GAS에서 전체 생활기록을 한 번에 조회할 수 있는 엔드포인트가 필요합니다.

## 1. GAS 편집기 열기

1. 구글 스프레드시트 열기 (기록 시트가 있는 파일)
2. 메뉴: **확장 프로그램 > Apps Script**

## 2. `doGet` 함수에 코드 추가

기존 `doGet` 함수를 찾아서 아래 조건을 추가합니다.

```javascript
function doGet(e) {
  const action = e.parameter.action;
  
  if (action == "login") {
    return checkLogin(e.parameter.id);
  } else if (action == "getSettings") {
    return getSettings();
  } else if (action == "log") {
    return recordLog(e.parameter);
  } else if (action == "getStudentRecords") {
    return getStudentRecords(e.parameter.num);
  
  // ✅ 아래 두 줄을 추가하세요
  } else if (action == "getAllRecords") {
    return getAllRecords();
  }
  
  return getAllStudents();
}
```

## 3. `getAllRecords` 함수를 파일 끝에 추가

```javascript
// [추가] 전체 생활기록 일괄 조회 (Supabase 이관용)
function getAllRecords() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName("생활기록");
  
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
  }
  
  const data = sheet.getDataRange().getValues();
  const records = [];
  
  // 데이터 구조: [시간, 학번, 이름, 교사, 잘한일, 못한일, 상세]
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row[1]) continue; // 학번 없으면 스킵
    
    records.push({
      time: row[0] ? new Date(row[0]).toISOString() : null,
      num: String(row[1]),
      name: row[2] || "",
      teacher: row[3] || "",
      good: row[4] || "",
      bad: row[5] || "",
      detail: row[6] || ""
    });
  }
  
  return ContentService.createTextOutput(JSON.stringify(records)).setMimeType(ContentService.MimeType.JSON);
}
```

## 4. 배포 (필수!)

코드 수정 후 **[배포] > [배포 관리] > ✏️ 편집 > 버전: 새 버전** 선택 후 배포

> 기존 URL은 그대로 유지되므로 `.env` 파일 수정 불필요합니다.
