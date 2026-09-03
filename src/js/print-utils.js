import { supabase } from './api.js';
import { API_CONFIG } from './config.js';

let currentGrade = null;
let currentClassNum = null;

export async function openPrintModal(grade, classNum, currentStudentId = null) {
    currentGrade = grade;
    currentClassNum = classNum;

    const popup = document.getElementById("popup");
    const overlay = document.getElementById("overlay");
    if (!popup || !overlay) return;

    // 만약 window.allStudents_Cache가 없거나 다른 반의 캐시인 경우, DB에서 학생 목록을 가져옵니다.
    if (!window.allStudents_Cache || window.allStudents_Cache.length === 0 || window.allStudents_Cache[0].class_info !== `${grade}-${classNum}`) {
        try {
            const { data, error } = await supabase
                .from('students')
                .select('pid, name, student_id, class_info, photo_url, status')
                .eq('academic_year', API_CONFIG.CURRENT_ACADEMIC_YEAR)
                .eq('class_info', `${grade}-${classNum}`)
                .neq('status', 'graduated')
                .order('student_id');
            
            if (error) throw error;
            
            window.allStudents_Cache = data.map(s => ({
                ...s,
                "학번": s.student_id,
                "번호": parseInt(s.student_id.slice(-2)),
                "이름": s.name,
                "학적": s.status || "재학"
            }));
        } catch (err) {
            console.error("Failed to load class students for print modal:", err);
            alert("학생 목록을 불러오지 못했습니다.");
            return;
        }
    }

    // 모달 내용 렌더링
    popup.className = "print-modal-wrapper"; // 다이얼로그 전용으로 오버라이드
    popup.innerHTML = `
        <div class="print-dialog" style="position: relative;">
            <button class="popup-close-x" id="print-close-btn" style="position: absolute; top: 0px; right: 0px; background: #f1f5f9; border: none; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1rem; color: #64748b; cursor: pointer; transition: all 0.2s; z-index: 10;">✕</button>
            <h3>🖨️ 인쇄 및 내보내기 설정</h3>
            
            <!-- 1. 인쇄할 내용 선택 -->
            <div class="setting-group">
                <label class="group-title">1. 인쇄할 내용</label>
                <div class="radio-group">
                    <label class="btn-radio"><input type="radio" name="print-content" value="all" checked style="display:none;"><span>모두</span></label>
                    <label class="btn-radio"><input type="radio" name="print-content" value="counsel" style="display:none;"><span>상담</span></label>
                    <label class="btn-radio"><input type="radio" name="print-content" value="attendance" style="display:none;"><span>근태</span></label>
                    <label class="btn-radio"><input type="radio" name="print-content" value="life" style="display:none;"><span>생활기록</span></label>
                </div>
            </div>

            <!-- 2. 범위 선택 -->
            <div class="setting-group">
                <label class="group-title">2. 범위 선택</label>
                <div class="radio-group">
                    <label class="btn-radio"><input type="radio" name="print-range" value="all" checked style="display:none;"><span>모든 학생</span></label>
                    <label class="btn-radio"><input type="radio" name="print-range" value="specific" style="display:none;"><span>특정 학생</span></label>
                </div>
                <!-- 특정 학생 목록 체크박스 컨테이너 -->
                <div id="specific-students-container" class="students-check-list" style="display: none;"></div>
            </div>

            <!-- 3. 정렬 기준 -->
            <div class="setting-group">
                <label class="group-title">3. 정렬 기준</label>
                <div class="radio-group">
                    <label class="btn-radio"><input type="radio" name="print-sort" value="number" checked style="display:none;"><span>번호순</span></label>
                    <label class="btn-radio"><input type="radio" name="print-sort" value="latest" style="display:none;"><span>최신순</span></label>
                </div>
            </div>

            <!-- 4. 출력 형식 -->
            <div class="setting-group">
                <label class="group-title">4. 출력 형식</label>
                <div class="radio-group">
                    <label class="btn-radio"><input type="radio" name="print-format" value="pdf" checked style="display:none;"><span>PDF 파일</span></label>
                    <label class="btn-radio"><input type="radio" name="print-format" value="csv" style="display:none;"><span>CSV 파일</span></label>
                    <label class="btn-radio"><input type="radio" name="print-format" value="txt" style="display:none;"><span>메모장 (TXT)</span></label>
                    <label class="btn-radio"><input type="radio" name="print-format" value="printer" style="display:none;"><span>프린터 출력</span></label>
                </div>
            </div>

            <!-- 액션 실행 버튼 -->
            <button id="print-action-btn" style="width: 100%; padding: 12px; border-radius: 8px; border: none; font-weight: 700; font-size: 1rem; color: white; background: #3b82f6; cursor: pointer; transition: 0.2s; box-shadow: 0 4px 6px rgba(59,130,246,0.2);">저장</button>
        </div>
    `;

    // 모든 플로팅 버튼 숨기기
    const floaters = ["#home-btn", "#print-btn", "#survey-viewer-btn", "#contact-download-btn", ".floating-controls"];
    floaters.forEach(selector => {
        const el = document.querySelector(selector);
        if (el) {
            el.dataset.prevDisplay = window.getComputedStyle(el).display;
            el.style.display = "none";
        }
    });

    // 뒷배경 스크롤 방지 추가
    document.body.style.overflow = "hidden";

    popup.style.display = "block";
    overlay.style.display = "block";

    // 2단계: 특정 학생 목록 체크박스 생성
    const specificContainer = document.getElementById("specific-students-container");
    if (specificContainer && window.allStudents_Cache) {
        specificContainer.innerHTML = window.allStudents_Cache.map(s => {
            const isTarget = currentStudentId && s.student_id === currentStudentId;
            return `
                <label class="student-check-item">
                    <input type="checkbox" name="selected-student" value="${s.pid}" ${isTarget ? 'checked' : ''}>
                    <span>${s["번호"] ? s["번호"] + '번' : ''} ${s["이름"]} (${s["학번"] || ''})</span>
                </label>
            `;
        }).join('');
    }

    const closePrintModal = () => {
        popup.style.display = "none";
        overlay.style.display = "none";
        popup.className = "";
        document.body.style.overflow = "";
        floaters.forEach(selector => {
            const el = document.querySelector(selector);
            if (el && el.dataset.prevDisplay) {
                el.style.display = el.dataset.prevDisplay;
            }
        });
        overlay.onclick = null;
    };

    // 닫기 버튼 및 오버레이 클릭 이벤트 바인딩
    const closeBtn = document.getElementById("print-close-btn");
    if (closeBtn) closeBtn.onclick = closePrintModal;
    overlay.onclick = closePrintModal;

    // 범위 변경 토글
    const rangeRadios = popup.querySelectorAll('input[name="print-range"]');
    rangeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'specific') {
                specificContainer.style.display = 'block';
            } else {
                specificContainer.style.display = 'none';
            }
        });
    });

    // 특정 학생이 지정되었다면 라디오 버튼도 활성화
    if (currentStudentId) {
        const specificRadio = popup.querySelector('input[name="print-range"][value="specific"]');
        if (specificRadio) {
            specificRadio.checked = true;
            specificContainer.style.display = 'block';
        }
    }

    // 출력 형식 변경 토글 (저장 vs 출력 버튼)
    const formatRadios = popup.querySelectorAll('input[name="print-format"]');
    const actionBtn = document.getElementById("print-action-btn");
    formatRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'printer') {
                actionBtn.textContent = '출력';
                actionBtn.style.background = '#6366f1'; // indigo
                actionBtn.style.boxShadow = '0 4px 6px rgba(99,102,241,0.2)';
            } else {
                actionBtn.textContent = '저장';
                actionBtn.style.background = '#3b82f6'; // blue
                actionBtn.style.boxShadow = '0 4px 6px rgba(59,130,246,0.2)';
            }
        });
    });

    // 액션 실행 버튼 클릭
    actionBtn.addEventListener('click', executePrintAction);
}

async function executePrintAction() {
    const actionBtn = document.getElementById("print-action-btn");
    if (!actionBtn || actionBtn.disabled) return;

    // 선택 옵션 값 수집
    const content = document.querySelector('input[name="print-content"]:checked')?.value || 'all';
    const range = document.querySelector('input[name="print-range"]:checked')?.value || 'all';
    const sort = document.querySelector('input[name="print-sort"]:checked')?.value || 'number';
    const format = document.querySelector('input[name="print-format"]:checked')?.value || 'pdf';

    // 대상 학생 PIDs 수집
    let selectedPids = [];
    if (range === 'all') {
        if (window.allStudents_Cache) {
            selectedPids = window.allStudents_Cache.map(s => s.pid);
        }
    } else {
        const checkedInputs = document.querySelectorAll('input[name="selected-student"]:checked');
        selectedPids = Array.from(checkedInputs).map(input => input.value);
    }

    if (selectedPids.length === 0) {
        alert('출력할 학생을 선택해 주세요.');
        return;
    }

    // 로딩 상태 표시
    const originalText = actionBtn.textContent;
    actionBtn.disabled = true;
    actionBtn.textContent = '데이터 조회 중...';
    actionBtn.style.background = '#94a3b8'; // gray
    actionBtn.style.boxShadow = 'none';

    try {
        // Supabase에서 해당 학생들의 기록 조회
        const { data: records, error } = await supabase
            .from('life_records')
            .select('*')
            .in('student_pid', selectedPids);

        if (error) throw error;

        // 내용 필터링
        let filteredRecords = records || [];
        if (content === 'counsel') {
            filteredRecords = filteredRecords.filter(r => r.category === '상담');
        } else if (content === 'attendance') {
            filteredRecords = filteredRecords.filter(r => r.category === '근태');
        } else if (content === 'life') {
            filteredRecords = filteredRecords.filter(r => r.category !== '상담' && r.category !== '근태');
        }

        // 정렬
        if (sort === 'number') {
            const pidToIndex = {};
            if (window.allStudents_Cache) {
                window.allStudents_Cache.forEach((s, idx) => {
                    pidToIndex[s.pid] = idx;
                });
            }
            filteredRecords.sort((a, b) => {
                const idxA = pidToIndex[a.student_pid] ?? 9999;
                const idxB = pidToIndex[b.student_pid] ?? 9999;
                if (idxA !== idxB) {
                    return idxA - idxB;
                }
                return new Date(a.created_at) - new Date(b.created_at);
            });
        } else {
            // 최신순
            filteredRecords.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }

        // 파일명 생성에 필요한 라벨들
        const contentLabels = { all: '전체', counsel: '상담', attendance: '근태', life: '생활기록' };
        const contentLabel = contentLabels[content] || '기록';
        const dateStr = new Date().toISOString().slice(0, 10);
        let studentPrefix = `[${currentGrade}학년_${currentClassNum}반]`;

        if (selectedPids.length === 1 && window.allStudents_Cache) {
            const targetStudent = window.allStudents_Cache.find(s => String(s.pid) === String(selectedPids[0]));
            if (targetStudent) {
                const stuNum = targetStudent["학번"] || targetStudent.student_id || "";
                const stuName = targetStudent["이름"] || targetStudent.name || "";
                if (stuNum && stuName) {
                    studentPrefix = `[${stuNum}_${stuName}]`;
                } else if (stuName) {
                    studentPrefix = `[${stuName}]`;
                }
            }
        }
        const fileName = `${studentPrefix}_${contentLabel}_${dateStr}`;

        // 출력 처리
        if (format === 'csv') {
            exportToCSV(filteredRecords, fileName);
        } else if (format === 'txt') {
            exportToTXT(filteredRecords, fileName);
        } else if (format === 'pdf') {
            actionBtn.textContent = 'PDF 생성 중...';
            await exportToPDF(filteredRecords, fileName, contentLabel, range, sort);
        } else {
            // printer (브라우저 인쇄 창 이용)
            exportToPrintHTML(filteredRecords, fileName, contentLabel, range, sort, format);
        }

        if (typeof window.closePopup === 'function') {
            window.closePopup();
        } else {
            const popup = document.getElementById("popup");
            const overlay = document.getElementById("overlay");
            popup.style.display = "none";
            overlay.style.display = "none";
            document.body.style.overflow = "";
            const floaters = ["#home-btn", "#print-btn", "#survey-viewer-btn", "#contact-download-btn", ".floating-controls"];
            floaters.forEach(selector => {
                const el = document.querySelector(selector);
                if (el && el.dataset.prevDisplay) {
                    el.style.display = el.dataset.prevDisplay;
                }
            });
        }
    } catch (err) {
        console.error(err);
        alert('데이터를 조회하거나 출력하는 데 실패했습니다: ' + err.message);
    } finally {
        actionBtn.disabled = false;
        actionBtn.textContent = originalText;
        if (format === 'printer') {
            actionBtn.style.background = '#6366f1';
            actionBtn.style.boxShadow = '0 4px 6px rgba(99,102,241,0.2)';
        } else {
            actionBtn.style.background = '#3b82f6';
            actionBtn.style.boxShadow = '0 4px 6px rgba(59,130,246,0.2)';
        }
    }
}

// CSV 파일 내보내기
function exportToCSV(records, fileName) {
    const studentMap = {};
    if (window.allStudents_Cache) {
        window.allStudents_Cache.forEach(s => {
            studentMap[s.pid] = s;
        });
    }

    const headers = ['학년', '반', '번호', '이름', '학번', '기록일시', '기록자', '대분류', '구분', '내용'];
    const rows = [headers];

    records.forEach(r => {
        const student = studentMap[r.student_pid] || {};
        const date = new Date(r.created_at).toLocaleString('ko-KR');
        const roleType = r.category === '상담' ? '상담' : (r.category === '근태' ? '근태' : '생활기록');
        const posType = r.is_positive ? '긍정' : '부정/지도';

        // 내용 필드 쉼표 및 쌍따옴표 이스케이프
        let contentEscaped = (r.content || '').replace(/"/g, '""');
        if (contentEscaped.includes(',') || contentEscaped.includes('\n') || contentEscaped.includes('"')) {
            contentEscaped = `"${contentEscaped}"`;
        }

        rows.push([
            currentGrade,
            currentClassNum,
            student["번호"] || '',
            student["이름"] || '',
            student["학번"] || '',
            date,
            maskTeacherId(r.teacher_email_prefix || ''),
            roleType,
            `${r.category} (${posType})`,
            contentEscaped
        ]);
    });

    const csvContent = "\uFEFF" + rows.map(e => e.join(",")).join("\n");
    downloadFileBlob(csvContent, `${fileName}.csv`, 'text/csv;charset=utf-8;');
}

// 메모장(TXT) 파일 내보내기
function exportToTXT(records, fileName) {
    const studentMap = {};
    if (window.allStudents_Cache) {
        window.allStudents_Cache.forEach(s => {
            studentMap[s.pid] = s;
        });
    }

    let txt = `============================================================\n`;
    txt += `[${currentGrade}학년 ${currentClassNum}반] ${fileName.split('_')[1]} 기록 내보내기\n`;
    txt += `출력일시: ${new Date().toLocaleString('ko-KR')}\n`;
    txt += `============================================================\n\n`;
    txt += `총 ${records.length}건의 기록이 있습니다.\n\n`;
    txt += `------------------------------------------------------------\n`;

    records.forEach(r => {
        const student = studentMap[r.student_pid] || {};
        const date = new Date(r.created_at).toLocaleString('ko-KR');
        const posType = r.is_positive ? '긍정' : '부정/지도';

        txt += `[${student["번호"] ? student["번호"] + '번 ' : ''}${student["이름"] || ''} (학번: ${student["학번"] || ''})]\n`;
        txt += `- 기록일시: ${date}\n`;
        txt += `- 작성교사: ${maskTeacherId(r.teacher_email_prefix || '')}\n`;
        txt += `- 구분/카테고리: ${r.category} (${posType})\n`;
        txt += `- 기록내용:\n${r.content || ''}\n`;
        txt += `------------------------------------------------------------\n`;
    });

    downloadFileBlob(txt, `${fileName}.txt`, 'text/plain;charset=utf-8;');
}

// 파일 다운로드 헬퍼
function downloadFileBlob(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// HTML 프린트 뷰 생성 및 호출
function exportToPrintHTML(records, fileName, contentLabel, range, sort, format) {
    const studentMap = {};
    if (window.allStudents_Cache) {
        window.allStudents_Cache.forEach(s => {
            studentMap[s.pid] = s;
        });
    }

    const rangeLabel = range === 'all' ? '학급 전체 학생' : '선택된 일부 학생';
    const sortLabel = sort === 'number' ? '번호순' : '최신순';

    const recordsHtml = records.map(r => {
        const student = studentMap[r.student_pid] || {};
        const date = new Date(r.created_at).toLocaleString('ko-KR');
        
        let badgeClass = 'badge-positive';
        if (r.category === '상담') badgeClass = 'badge-counsel';
        else if (r.category === '근태') badgeClass = 'badge-attendance';
        else if (!r.is_positive) badgeClass = 'badge-negative';

        const posType = r.is_positive ? '긍정' : '부정/지도';
        const displayCategory = r.category === '상담' || r.category === '근태' ? r.category : `${r.category} (${posType})`;

        return `
            <div class="record-card">
                <div class="record-header">
                    <div class="student-info">
                        <strong>${student["번호"] ? student["번호"] + '번 ' : ''}${student["이름"] || ''}</strong> 
                        <span style="font-size: 0.85em; color: #64748b;">(학번: ${student["학번"] || ''})</span>
                        <span class="category-badge ${badgeClass}">${displayCategory}</span>
                    </div>
                    <div class="record-date">${date}</div>
                </div>
                <div style="font-size: 0.85rem; color: #64748b; margin-bottom: 8px; font-weight: 500;">작성자: ${maskTeacherId(r.teacher_email_prefix || '')}</div>
                <div class="record-content">${escapeHTML(r.content || '')}</div>
            </div>
        `;
    }).join('');

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
        alert('팝업 차단이 활성화되어 있어 인쇄 창을 열지 못했습니다. 팝업 차단을 해제해 주세요.');
        return;
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <title>${fileName}</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    padding: 40px;
                    color: #1e293b;
                    background: #ffffff;
                    line-height: 1.6;
                }
                h1 {
                    text-align: center;
                    font-size: 1.8rem;
                    font-weight: 800;
                    margin-bottom: 5px;
                    color: #0f172a;
                }
                .subtitle {
                    text-align: center;
                    font-size: 0.95rem;
                    color: #64748b;
                    margin-bottom: 30px;
                }
                .meta-table {
                    width: 100%;
                    margin-bottom: 20px;
                    border-collapse: collapse;
                    font-size: 0.9rem;
                    border-bottom: 2px solid #cbd5e1;
                }
                .meta-table td {
                    padding: 6px 0;
                    color: #475569;
                }
                .record-list {
                    margin-top: 20px;
                }
                .record-card {
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    padding: 18px;
                    margin-bottom: 18px;
                    page-break-inside: avoid;
                    background: #f8fafc;
                }
                .record-header {
                    display: flex;
                    justify-content: space-between;
                    border-bottom: 1.5px solid #cbd5e1;
                    padding-bottom: 8px;
                    margin-bottom: 10px;
                    font-weight: 700;
                    font-size: 0.95rem;
                    color: #334155;
                }
                .student-info {
                    font-size: 1.05rem;
                    color: #1e293b;
                }
                .category-badge {
                    display: inline-block;
                    padding: 2px 7px;
                    border-radius: 5px;
                    font-size: 0.72rem;
                    font-weight: 700;
                    margin-left: 6px;
                }
                .badge-positive {
                    background: #eff6ff;
                    color: #1d4ed8;
                    border: 1px solid #bfdbfe;
                }
                .badge-negative {
                    background: #fef2f2;
                    color: #b91c1c;
                    border: 1px solid #fecaca;
                }
                .badge-counsel {
                    background: #fffbeb;
                    color: #d97706;
                    border: 1px solid #fde68a;
                }
                .badge-attendance {
                    background: #f0fdf4;
                    color: #16a34a;
                    border: 1px solid #bbf7d0;
                }
                .record-date {
                    color: #64748b;
                    font-size: 0.85rem;
                    font-weight: 500;
                }
                .record-content {
                    white-space: pre-wrap;
                    font-size: 0.92rem;
                    color: #334155;
                    word-break: break-all;
                }
                @media print {
                    body {
                        padding: 0;
                    }
                    .record-card {
                        border: 1px solid #cbd5e1;
                        background: none;
                    }
                }
            </style>
        </head>
        <body>
            <h1>[${currentGrade}학년 ${currentClassNum}반] ${contentLabel} 기록</h1>
            <div class="subtitle">출력 대상: ${rangeLabel} | 정렬 기준: ${sortLabel}</div>
            <table class="meta-table">
                <tr>
                    <td><strong>학급:</strong> ${currentGrade}학년 ${currentClassNum}반</td>
                    <td style="text-align: right;"><strong>출력일시:</strong> ${new Date().toLocaleString('ko-KR')}</td>
                </tr>
            </table>
            <div class="record-list">
                ${recordsHtml.length > 0 ? recordsHtml : '<div style="text-align:center; padding:50px; color:#94a3b8; font-style:italic;">기록이 없습니다.</div>'}
            </div>
            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(() => window.close(), 1000);
                }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

function maskTeacherId(prefix) {
    if (!prefix) return '';
    const str = String(prefix).trim();
    if (str.length <= 3) return str;
    return str.slice(0, 3) + '*'.repeat(str.length - 3);
}

function escapeHTML(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function loadHtml2Pdf() {
    return new Promise((resolve, reject) => {
        if (window.html2pdf) {
            resolve(window.html2pdf);
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
        script.onload = () => resolve(window.html2pdf);
        script.onerror = () => reject(new Error('PDF 생성 라이브러리를 로드하지 못했습니다.'));
        document.head.appendChild(script);
    });
}

async function exportToPDF(records, fileName, contentLabel, range, sort) {
    try {
        const html2pdf = await loadHtml2Pdf();
        
        // PDF로 변환할 임시 엘리먼트 생성
        const element = document.createElement('div');
        element.style.padding = '20px';
        element.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
        element.style.color = '#1e293b';
        element.style.background = '#ffffff';
        element.style.lineHeight = '1.6';

        const studentMap = {};
        if (window.allStudents_Cache) {
            window.allStudents_Cache.forEach(s => {
                studentMap[s.pid] = s;
            });
        }

        const rangeLabel = range === 'all' ? '학급 전체 학생' : '선택된 일부 학생';
        const sortLabel = sort === 'number' ? '번호순' : '최신순';

        const recordsHtml = records.map(r => {
            const student = studentMap[r.student_pid] || {};
            const date = new Date(r.created_at).toLocaleString('ko-KR');
            
            let badgeClass = 'badge-positive';
            let badgeStyle = 'background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe;';
            if (r.category === '상담') {
                badgeClass = 'badge-counsel';
                badgeStyle = 'background: #fffbeb; color: #d97706; border: 1px solid #fde68a;';
            } else if (r.category === '근태') {
                badgeClass = 'badge-attendance';
                badgeStyle = 'background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0;';
            } else if (!r.is_positive) {
                badgeClass = 'badge-negative';
                badgeStyle = 'background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca;';
            }

            const posType = r.is_positive ? '긍정' : '부정/지도';
            const displayCategory = r.category === '상담' || r.category === '근태' ? r.category : `${r.category} (${posType})`;

            return `
                <div class="record-card" style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin-bottom: 18px; background: #f8fafc; page-break-inside: avoid;">
                    <div class="record-header" style="display: flex; justify-content: space-between; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 8px; margin-bottom: 10px; font-weight: 700; font-size: 0.95rem; color: #334155;">
                        <div class="student-info" style="font-size: 1.05rem; color: #1e293b;">
                            <strong>${student["번호"] ? student["번호"] + '번 ' : ''}${student["이름"] || ''}</strong> 
                            <span style="font-size: 0.85em; color: #64748b;">(학번: ${student["학번"] || ''})</span>
                            <span class="category-badge ${badgeClass}" style="display: inline-block; padding: 2px 7px; border-radius: 5px; font-size: 0.72rem; font-weight: 700; margin-left: 6px; ${badgeStyle}">${displayCategory}</span>
                        </div>
                        <div class="record-date" style="color: #64748b; font-size: 0.85rem; font-weight: 500;">${date}</div>
                    </div>
                    <div style="font-size: 0.85rem; color: #64748b; margin-bottom: 8px; font-weight: 500;">작성자: ${maskTeacherId(r.teacher_email_prefix || '')}</div>
                    <div class="record-content" style="white-space: pre-wrap; font-size: 0.92rem; color: #334155; word-break: break-all;">${escapeHTML(r.content || '')}</div>
                </div>
            `;
        }).join('');

        element.innerHTML = `
            <h1 style="text-align: center; font-size: 1.8rem; font-weight: 800; margin-bottom: 5px; color: #0f172a;">[${currentGrade}학년 ${currentClassNum}반] ${contentLabel} 기록</h1>
            <div class="subtitle" style="text-align: center; font-size: 0.95rem; color: #64748b; margin-bottom: 30px;">출력 대상: ${rangeLabel} | 정렬 기준: ${sortLabel}</div>
            <table class="meta-table" style="width: 100%; margin-bottom: 20px; border-collapse: collapse; font-size: 0.9rem; border-bottom: 2px solid #cbd5e1;">
                <tr>
                    <td style="padding: 6px 0; color: #475569;"><strong>학급:</strong> ${currentGrade}학년 ${currentClassNum}반</td>
                    <td style="text-align: right; padding: 6px 0; color: #475569;"><strong>출력일시:</strong> ${new Date().toLocaleString('ko-KR')}</td>
                </tr>
            </table>
            <div class="record-list" style="margin-top: 20px;">
                ${recordsHtml.length > 0 ? recordsHtml : '<div style="text-align:center; padding:50px; color:#94a3b8; font-style:italic;">기록이 없습니다.</div>'}
            </div>
        `;

        const opt = {
            margin:       15,
            filename:     fileName + '.pdf',
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        await html2pdf().set(opt).from(element).save();
    } catch (err) {
        console.error(err);
        alert('PDF 생성 중 오류가 발생했습니다: ' + err.message);
    }
}
