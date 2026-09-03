import { supabase, getTeacherProfile, getCurrentTeacherEmail, fetchPresets } from './api.js';
import { API_CONFIG } from './config.js';
import { extractDriveId, getThumbnailUrl } from './utils.js';
import * as XLSX from 'xlsx';

let currentTeacher = null;
let allStudents = [];
let allRecords = [];
let badBehaviorPresets = [];
let currentSortMode = 'id'; // 'id' or 'latest'

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 교사 인증 확인 (기존 index.html 방식과 통일)
    const email = getCurrentTeacherEmail();
    console.log("Current Teacher Email from Token:", email);
    if (!email) {
        alert('로그인이 필요합니다.');
        location.href = 'index.html';
        return;
    }

    try {
        const teacher = await getTeacherProfile(email);
        console.log("Teacher Profile Result:", teacher);
        if (!teacher) {
            alert(`교사 정보를 찾을 수 없습니다. (${email})`);
            location.href = 'index.html';
            return;
        }
        currentTeacher = teacher;
    } catch (e) {
        console.error("Auth check failed", e);
        alert('인증 확인 중 오류가 발생했습니다: ' + e.message);
        location.href = 'index.html';
        return;
    }

    await initUI();
    setupEventListeners();
});

async function initUI() {
    const scopeSelect = document.getElementById('scope-select');
    const classSelect = document.getElementById('class-select');
    const studentSelect = document.getElementById('student-select');
    const isAdmin = currentTeacher.role === 'admin' || currentTeacher.role === 'counselor'
        || Object.values(currentTeacher.permissions?.admin || {}).some(Boolean);

    // 권한에 따른 범위 제한
    if (!isAdmin) {
        // 담임이면 자기 반, 특정 학생만 기본 허용
        const allowed = ['class', 'student'];
        Array.from(scopeSelect.options).forEach(opt => {
            if (!allowed.includes(opt.value)) opt.disabled = true;
        });
        scopeSelect.value = 'class';
    }

    // [M2] 학년/과/반 옵션을 학교 설정에서 생성
    const S = await import('./school.js');
    classSelect.innerHTML = S.classOptions().map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
    const gradeSel = document.getElementById('grade-select');
    if (gradeSel) gradeSel.innerHTML = S.levels().map((l) => `<option value="${l.order}">${l.label}</option>`).join('');
    const deptSel = document.getElementById('dept-select');
    if (deptSel) {
        const majors = [...new Set(S.units().map((u) => u.major).filter(Boolean))];
        deptSel.innerHTML = majors.length
            ? majors.map((m) => `<option value="${m}">${m}</option>`).join('')
            : '<option value="">(학과 미설정)</option>';
    }

    // 담임이면 자기 반 기본 선택
    if (currentTeacher.assigned_class) {
        classSelect.value = currentTeacher.assigned_class;
    }

    // URL 파라미터 읽기
    const urlParams = new URLSearchParams(window.location.search);
    const paramScope = urlParams.get('scope');
    const paramClass = urlParams.get('class');
    const paramStudentId = urlParams.get('student_id');

    if (paramScope === 'student') {
        scopeSelect.value = 'student';
        if (paramClass) {
            classSelect.value = paramClass;
        }
        updateScopeSelectors();
        // 학생 목록을 로딩한 후 지정된 학생을 기본 선택
        await loadClassStudents(classSelect.value);
        if (paramStudentId) {
            studentSelect.value = paramStudentId;
            // 자동으로 조회 실행
            setTimeout(() => handleQuery(), 200);
        }
    } else {
        updateScopeSelectors();
    }

    initBadSubItems();
}

async function initBadSubItems() {
    try {
        const presets = await fetchPresets();
        badBehaviorPresets = presets.bad || [];
        
        const container = document.getElementById('bad-sub-items');
        container.innerHTML = '';
        
        badBehaviorPresets.forEach(item => {
            const label = document.createElement('label');
            label.innerHTML = `<input type="checkbox" class="bad-sub-check" value="${item}"> ${item}`;
            container.appendChild(label);
        });

        // "못한 일" 메인 체크박스 상태에 따라 초기 표시 여부 결정
        const badMain = document.getElementById('bad-main-check');
        const badAll = document.getElementById('bad-all-check');
        
        badAll.checked = false; // 기본 해제
        document.getElementById('bad-sub-container').style.display = badMain.checked ? 'block' : 'none';

    } catch (e) {
        console.error("Failed to load presets", e);
    }
}

function updateScopeSelectors() {
    const val = document.getElementById('scope-select').value;
    document.getElementById('grade-select').style.display = (val === 'grade' || val === 'grade_dept') ? 'inline-block' : 'none';
    document.getElementById('dept-select').style.display = (val === 'dept' || val === 'grade_dept') ? 'inline-block' : 'none';
    document.getElementById('class-select').style.display = (val === 'class' || val === 'student') ? 'inline-block' : 'none';
    document.getElementById('student-select').style.display = (val === 'student') ? 'inline-block' : 'none';
}

async function loadClassStudents(targetClass) {
    const studentSelect = document.getElementById('student-select');
    if (!studentSelect) return;
    studentSelect.innerHTML = '<option value="">학생 선택</option>';
    
    if (!targetClass) return;
    
    try {
        const { data, error } = await supabase
            .from('students')
            .select('student_id, name')
            .eq('academic_year', API_CONFIG.CURRENT_ACADEMIC_YEAR)
            .eq('class_info', targetClass)
            .neq('status', 'graduated')
            .order('student_id');
        
        if (error) throw error;
        
        data.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.student_id;
            opt.textContent = `${parseInt(s.student_id.slice(-2))}번 ${s.name}`;
            studentSelect.appendChild(opt);
        });
    } catch (err) {
        console.error("Failed to load class students for select:", err);
    }
}

function setupEventListeners() {
    document.getElementById('scope-select').addEventListener('change', async () => {
        updateScopeSelectors();
        const scope = document.getElementById('scope-select').value;
        if (scope === 'student') {
            await loadClassStudents(document.getElementById('class-select').value);
        }
    });
    document.getElementById('class-select').addEventListener('change', async () => {
        const scope = document.getElementById('scope-select').value;
        if (scope === 'student') {
            await loadClassStudents(document.getElementById('class-select').value);
        }
    });
    document.getElementById('query-btn').addEventListener('click', handleQuery);

    // v4.64: 사진 저장 버튼 리스너
    const photoSaveBtn = document.getElementById('photo-save-btn');
    if (photoSaveBtn) {
        photoSaveBtn.addEventListener('click', downloadAllPhotos);
    }
    // v4.60: print-btn -> export-dropdown 상위 요소 제어로 변경
    const exportDropdown = document.querySelector('.export-dropdown');
    if (exportDropdown) {
        // 별도 리스너 없이 HTML의 onclick으로 처리하거나 필요시 추가
    }
    
    if (document.getElementById('download-btn')) {
        document.getElementById('download-btn').addEventListener('click', downloadExcel);
    }

    // 못한 일 처리
    const badMain = document.getElementById('bad-main-check');
    badMain.addEventListener('change', () => {
        document.getElementById('bad-sub-container').style.display = badMain.checked ? 'block' : 'none';
    });

    const badAll = document.getElementById('bad-all-check');
    badAll.addEventListener('change', () => {
        const subs = document.querySelectorAll('.bad-sub-check');
        subs.forEach(s => s.checked = badAll.checked);
    });

    const modal = document.getElementById('photo-modal');
    document.getElementById('close-modal').addEventListener('click', () => {
        modal.style.display = 'none';
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });

    // v4.67: 사진 저장 안내 모달 제어
    const infoModal = document.getElementById('photo-info-modal');
    const closeInfoBtn = document.getElementById('close-info-modal');
    const startDownloadBtn = document.getElementById('start-download-btn');

    if (closeInfoBtn) {
        closeInfoBtn.addEventListener('click', () => infoModal.style.display = 'none');
    }
    if (infoModal) {
        infoModal.addEventListener('click', (e) => {
            if (e.target === infoModal) infoModal.style.display = 'none';
        });
    }
    if (startDownloadBtn) {
        startDownloadBtn.addEventListener('click', async () => {
            infoModal.style.display = 'none';
            await executeDownloadProcess();
        });
    }

    // v4.51: 항목(상단)과 명렬/사진(하단) 상호 배제 로직
    const topRowChecks = document.querySelectorAll('#category-checks input[type="checkbox"]');
    const bottomRowChecks = [document.getElementById('check-student-info'), document.getElementById('check-photo')];

    const updateExclusivity = (changedGroup) => {
        if (changedGroup === 'top') {
            const anyTopChecked = Array.from(topRowChecks).some(c => c.checked);
            if (anyTopChecked) {
                bottomRowChecks.forEach(c => {
                    c.checked = false;
                    c.disabled = true;
                });
            } else {
                bottomRowChecks.forEach(c => c.disabled = false);
            }
        } else {
            const anyBottomChecked = bottomRowChecks.some(c => c.checked);
            if (anyBottomChecked) {
                topRowChecks.forEach(c => {
                    c.checked = false;
                    c.disabled = true;
                });
                // '못한 일' 상세 박스도 숨김 처리
                document.getElementById('bad-sub-container').style.display = 'none';
            } else {
                topRowChecks.forEach(c => c.disabled = false);
            }
        }
    };

    topRowChecks.forEach(c => {
        c.addEventListener('change', () => updateExclusivity('top'));
    });
    bottomRowChecks.forEach(c => {
        c.addEventListener('change', () => updateExclusivity('bottom'));
    });

    // 초기 상태 체크
    updateExclusivity('top');
    updateExclusivity('bottom');

    // 정렬 버튼 처리
    const sortIdBtn = document.getElementById('sort-id-btn');
    const sortLatestBtn = document.getElementById('sort-latest-btn');

    sortIdBtn.addEventListener('click', () => {
        currentSortMode = 'id';
        sortIdBtn.classList.add('active');
        sortLatestBtn.classList.remove('active');
        if (allStudents.length > 0) handleQuery(); // 다시 렌더링을 위해 쿼리 재실행 (또는 캐시된 데이터 활용 가능하나 안전하게 재실행)
    });

    sortLatestBtn.addEventListener('click', () => {
        currentSortMode = 'latest';
        sortLatestBtn.classList.add('active');
        sortIdBtn.classList.remove('active');
        if (allStudents.length > 0) handleQuery();
    });
}

function downloadExcel() {
    const table = document.getElementById('report-table');
    const wb = XLSX.utils.table_to_book(table, { sheet: "학생기록현황" });
    const now = new Date();
    const dateStr = `${now.getFullYear()}${now.getMonth()+1}${now.getDate()}`;
    XLSX.writeFile(wb, `학생기록현황_${dateStr}.xlsx`);
}

async function handleQuery() {
    const loading = document.getElementById('loading-msg');
    const resultSec = document.getElementById('print-result');
    const errorMsg = document.getElementById('error-msg');
    
    loading.style.display = 'block';
    resultSec.style.display = 'none';
    errorMsg.style.display = 'none';

    try {
        const scope = document.getElementById('scope-select').value;
        const grade = document.getElementById('grade-select').value;
        const dept = document.getElementById('dept-select').value;
        const targetClass = document.getElementById('class-select').value;
        
        // v4.44: 명렬, 사진 체크박스 추가
        const showStudentInfo = document.getElementById('check-student-info').checked;
        const showPhoto = document.getElementById('check-photo').checked;
        
        const categories = Array.from(document.querySelectorAll('#category-checks input[value]:checked')).map(cb => cb.value);
        const selectedBadSubs = Array.from(document.querySelectorAll('.bad-sub-check:checked')).map(cb => cb.value);
        
        if (categories.length === 0 && !showStudentInfo && !showPhoto) {
            throw new Error('포함할 항목을 최소 하나 선택해주세요.');
        }

        // 1. 학생 데이터 가져오기 (v4.48: 졸업생 제외하고 당해 학년도 학생만 조회)
        let studentQuery = supabase.from('students')
            .select('pid, name, student_id, class_info, photo_url, status')
            .eq('academic_year', API_CONFIG.CURRENT_ACADEMIC_YEAR);
        
        if (scope === 'grade') {
            studentQuery = studentQuery.like('class_info', `${grade}-%`);
        } else if (scope === 'class') {
            studentQuery = studentQuery.eq('class_info', targetClass);
        } else if (scope === 'student') {
            const selectedStudentId = document.getElementById('student-select').value;
            if (!selectedStudentId) {
                throw new Error('인쇄할 학생을 선택해주세요.');
            }
            studentQuery = studentQuery.eq('student_id', selectedStudentId);
        }
        
        const { data: students, error: sErr } = await studentQuery.order('student_id');
        if (sErr) throw sErr;

        // 학과 필터링 (학과 정보가 DB에 따로 없으므로 로직으로 필터링)
        let filteredStudents = students;
        if (scope === 'dept' || scope === 'grade_dept') {
            const { majorOf } = await import('./school.js');
            filteredStudents = students.filter(s => {
                const match = String(s.class_info || '').match(/(\d+)-(\d+)/);
                if (!match) return false;
                const g = parseInt(match[1]);
                const major = majorOf(s.class_info);
                if (scope === 'grade_dept') return g === parseInt(grade) && major === dept;
                return major === dept;
            });
        }

        if (filteredStudents.length === 0) {
            throw new Error('해당 조건의 학생이 없습니다.');
        }

        // 2. 기록 가져오기
        const pids = filteredStudents.map(s => s.pid);
        // Supabase .in 은 최대 1000개 정도가 한계이나 학교 규모에선 무난
        const { data: records, error: rErr } = await supabase
            .from('life_records')
            .select('student_pid, category, content, is_positive, created_at')
            .in('student_pid', pids);
        
        if (rErr) throw rErr;

        renderReport(filteredStudents, records, categories, selectedBadSubs, { showStudentInfo, showPhoto });
        
        resultSec.style.display = 'block';
        
        // v4.64: 사진 선택 여부에 따른 버튼 제어
        const exportDropdown = document.querySelector('.export-dropdown');
        const photoSaveBtn = document.getElementById('photo-save-btn');
        if (showPhoto) {
            if (exportDropdown) exportDropdown.style.display = 'none';
            if (photoSaveBtn) photoSaveBtn.style.display = 'inline-block';
        } else {
            if (exportDropdown) exportDropdown.style.display = 'inline-block';
            if (photoSaveBtn) photoSaveBtn.style.display = 'none';
        }

    } catch (err) {
        console.error("Query Error:", err);
        errorMsg.textContent = err.message || "데이터를 불러오는 중 오류가 발생했습니다.";
        errorMsg.style.display = 'block';
    } finally {
        loading.style.display = 'none';
    }
}

function renderReport(students, records, categories, selectedBadSubs, options = {}) {
    const { showStudentInfo = true, showPhoto = false } = options;
    const tableHead = document.getElementById('table-head-row');
    const tableBody = document.getElementById('table-body');
    const tableFoot = document.getElementById('table-foot');
    const reportTitle = document.getElementById('report-title');
    const reportDate = document.getElementById('report-date');
    const countDisplay = document.getElementById('student-count-display');

    const now = new Date();
    reportDate.textContent = `출력 일시: ${now.getFullYear()}년 ${now.getMonth()+1}월 ${now.getDate()}일 ${now.getHours()}:${now.getMinutes()}`;

    // v4.53: 학번, 이름 분리. 최근 기록 앞 합계 삭제.
    let headHtml = '<th>학번</th><th>이름</th>'; 
    
    categories.forEach(cat => {
        const headerName = (cat === '못한 일') ? '항목' : cat;
        headHtml += `<th>${headerName}</th>`;
    });

    if (showStudentInfo) {
        headHtml += '<th>학적</th>'; // 학번은 이미 앞에 있으므로 학적만 추가
    }
    if (showPhoto) headHtml += '<th>사진</th>';
    
    headHtml += '<th>최근 기록</th>';
    tableHead.innerHTML = headHtml;

    // 데이터 집계
    const stats = students.map(s => {
        const studentRecs = records.filter(r => r.student_pid === s.pid);
        const row = {
            id: s.student_id,
            pid: s.pid,
            name: s.name,
            counts: {},
            total: 0
        };
        
        categories.forEach(cat => {
            let count = 0;
            if (cat === '조퇴') {
                count = studentRecs.filter(r => /조\s*퇴/.test(r.category || '') || /조\s*퇴/.test(r.content || '')).length;
            } else if (cat === '외출') {
                count = studentRecs.filter(r => /외\s*출/.test(r.category || '') || /외\s*출/.test(r.content || '')).length;
            } else if (cat === '잘한 일') {
                const neutralCats = ['기록', '생활기록', '일반'];
                count = studentRecs.filter(r => 
                    r.is_positive === true && 
                    !(r.category?.includes('근태')) && 
                    !(r.category?.includes('상담')) &&
                    !(neutralCats.includes(r.category))
                ).length;
            } else if (cat === '못한 일') {
                // 세부 항목 필터링 적용
                const badRecs = studentRecs.filter(r => {
                    if (r.is_positive !== false || r.category?.includes('근태') || r.category?.includes('상담')) return false;
                    if (!r.category) return false;
                    // 선택된 세부 항목이 있는지 확인 (쉼표로 구분된 여러 항목 지원)
                    const recordCats = r.category.split(',').map(s => s.trim());
                    return recordCats.some(rc => selectedBadSubs.includes(rc));
                });
                count = badRecs.length;
                // v4.53: 항목명(카테고리)들 중복 제거하여 나열
                const uniqueCats = [...new Set(badRecs.flatMap(r => r.category.split(',').map(s => s.trim())))];
                row.counts[cat] = uniqueCats.filter(c => selectedBadSubs.includes(c)).join(', ') || '';
            } else {
                row.counts[cat] = studentRecs.filter(r => r.category === cat).length;
            }
            if (cat !== '못한 일') row.counts[cat] = count;
            row.total += count;
        });

        // 최근 기록 시간 산출
        if (studentRecs.length > 0) {
            const latest = studentRecs.reduce((max, r) => r.created_at > max ? r.created_at : max, studentRecs[0].created_at);
            row.latest_time = latest;
        } else {
            row.latest_time = null;
        }

        return row;
    }).filter(s => {
        // v4.47: 명렬이나 사진이 체크된 경우 모든 학생 표시, 아니면 기록이 있는 학생만 표시
        if (showStudentInfo || showPhoto) return true;
        return s.total > 0;
    });

    // 정렬 적용
    if (currentSortMode === 'latest') {
        stats.sort((a, b) => {
            if (!a.latest_time) return 1;
            if (!b.latest_time) return -1;
            return b.latest_time.localeCompare(a.latest_time);
        });
    } else {
        // 기본 학번순 (stats 이미 학번순으로 정렬된 학생들로부터 생성됨)
        stats.sort((a, b) => a.id.localeCompare(b.id));
    }

    // 총 인원수 표시
    if (countDisplay) {
        countDisplay.textContent = `총 ${stats.length}명`;
    }

    // 바디 렌더링
    tableBody.innerHTML = '';
    stats.forEach(s => {
        const student = students.find(st => st.pid === s.pid);
        
        // 시간 포맷팅 (MM-DD HH:mm)
        let timeStr = '-';
        if (s.latest_time) {
            const dt = new Date(s.latest_time);
            timeStr = `${(dt.getMonth()+1).toString().padStart(2, '0')}-${dt.getDate().toString().padStart(2, '0')} ${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
        }

        // v4.53: 학번, 이름 분리
        const displayStatus = (student?.status && student.status !== 'active' && student.status !== '재학') ? ` (${student.status})` : '';
        
        let html = `<tr data-pid="${s.pid}">
            <td>${s.id}</td>
            <td class="student-name-link" title="사진 보기" onclick="window.showPhotoModalByPid('${s.pid}')">${s.name}${displayStatus}</td>`;
        
        categories.forEach(cat => {
            html += `<td>${s.counts[cat]}</td>`;
        });

        if (showStudentInfo) {
            html += `<td>${student?.status || '재학'}</td>`;
        }

        if (showPhoto) {
            const driveFileId = extractDriveId(student?.photo_url);
            const thumbUrl = driveFileId ? getThumbnailUrl(driveFileId) : (student?.photo_url || './default.png');
            html += `<td><img src="${thumbUrl}" style="width:40px; height:50px; object-fit:cover; border-radius:4px;" onerror="this.src='./default.png'"></td>`;
        }

        html += `<td>${timeStr}</td></tr>`;
        tableBody.innerHTML += html;
    });

    // 전역 함수로 노출 (onclick 용)
    window.showPhotoModalByPid = (pid) => {
        const student = students.find(st => String(st.pid) === String(pid));
        if (student) showPhotoModal(student);
    };

    // 푸터 (합계) - v4.53: 학번/이름 분리에 맞춰 수정 및 합계 삭제
    tableFoot.innerHTML = '';
    let footHtml = `<tr style="background:#f1f5f9"><td colspan="2">합계</td>`;
    
    categories.forEach(cat => {
        // '못한 일' 항목인 경우 숫자로 합계 계산을 위해 별도 필터링 수행 (s.counts[cat]은 문자열일 수 있음)
        let colSum = 0;
        if (cat === '못한 일') {
            colSum = stats.reduce((acc, obj) => {
                // 이전에 각 학생 객체에 숫자로 된 count를 저장하지 않았으므로, 
                // 임시로 해당 카테고리가 비어있지 않은 학생 수를 세거나, 기존 stats 계산 시의 로직을 참고해야 함.
                // 여기서는 단순히 '항목'에 내용이 있는 학생의 수로 표시하거나, 0으로 둠.
                // 기록 건수로 표시하는 것이 합리적이므로 건수를 계산함.
                const studentRecs = records.filter(r => r.student_pid === obj.pid);
                const badCount = studentRecs.filter(r => {
                    if (r.is_positive !== false || r.category?.includes('근태') || r.category?.includes('상담')) return false;
                    if (!r.category) return false;
                    const recordCats = r.category.split(',').map(s => s.trim());
                    return recordCats.some(rc => selectedBadSubs.includes(rc));
                }).length;
                return acc + badCount;
            }, 0);
        } else {
            colSum = stats.reduce((acc, obj) => acc + (obj.counts[cat] || 0), 0);
        }
        footHtml += `<td>${colSum}</td>`;
    });

    if (showStudentInfo) footHtml += '<td></td>'; // 학적
    if (showPhoto) footHtml += '<td></td>'; // 사진

    footHtml += `<td></td></tr>`;
    tableFoot.innerHTML = footHtml;
}

function showPhotoModal(student) {
    const modal = document.getElementById('photo-modal');
    const photoImg = document.getElementById('modal-photo');
    const infoText = document.getElementById('modal-student-info');

    infoText.textContent = `${student.student_id} ${student.name}`;
    
    if (student.photo_url) {
        let finalUrl = student.photo_url;
        const driveFileId = extractDriveId(finalUrl);
        
        if (finalUrl.startsWith('http') && !finalUrl.includes('drive.google.com')) {
            photoImg.src = finalUrl;
        } else if (driveFileId) {
            photoImg.src = getThumbnailUrl(driveFileId);
        } else {
            // ID만 있거나 기타 경우
            photoImg.src = getThumbnailUrl(finalUrl);
        }
    } else {
        photoImg.src = './default.png';
    }

    modal.style.display = 'flex';
}

// v4.67: 다운로드 프로세스 분리 및 UI 개선
async function downloadAllPhotos() {
    const tableBody = document.getElementById('table-body');
    const rows = tableBody.querySelectorAll('tr');
    
    if (rows.length === 0) {
        alert('조회된 데이터가 없습니다.');
        return;
    }

    const infoModal = document.getElementById('photo-info-modal');
    if (infoModal) {
        infoModal.style.display = 'flex';
    } else {
        await executeDownloadProcess();
    }
}

async function executeDownloadProcess() {
    const tableBody = document.getElementById('table-body');
    const rows = tableBody.querySelectorAll('tr');
    const btn = document.getElementById('photo-save-btn');
    const originalText = btn.textContent;

    // v4.68: 범위에 따른 자동 폴더명 생성
    const scope = document.getElementById('scope-select').value;
    const grade = document.getElementById('grade-select').value;
    const dept = document.getElementById('dept-select').value;
    const targetClass = document.getElementById('class-select').value;
    
    let subDirName = "";
    if (scope === 'all') subDirName = "전체_학생_사진";
    else if (scope === 'grade') subDirName = `${grade}학년_사진`;
    else if (scope === 'dept') subDirName = `${dept}_사진`;
    else if (scope === 'grade_dept') subDirName = `${grade}학년_${dept}_사진`;
    else if (scope === 'class') {
        // v4.70: class-select의 '학년-반' 형식을 파싱하여 정확한 폴더명 생성
        if (targetClass.includes('-')) {
            const [g, c] = targetClass.split('-');
            subDirName = `${g}학년_${c}반_사진`;
        } else {
            subDirName = `${grade}학년_${targetClass}반_사진`;
        }
    } else if (scope === 'student') {
        const selectedStudentId = document.getElementById('student-select').value;
        subDirName = `${selectedStudentId}_사진`;
    }
    
    // 중복 방지를 위한 날짜 추가 (예: 1학년_1반_사진_240314)
    const now = new Date();
    const dateSuffix = `${now.getFullYear().toString().slice(-2)}${(now.getMonth()+1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
    subDirName = `${subDirName}_${dateSuffix}`;

    // v4.65: File System Access API 시도
    let directoryHandle = null;
    let targetFolderHandle = null; // 실제 파일이 담길 하위 폴더
    let useFileSystemAPI = false;

    if ('showDirectoryPicker' in window) {
        try {
            // v4.67: 안내창에서 이미 확인했으므로 바로 피커 실행 시도
            directoryHandle = await window.showDirectoryPicker();
            
            // v4.68: 하위 폴더 자동 생성
            targetFolderHandle = await directoryHandle.getDirectoryHandle(subDirName, { create: true });
            useFileSystemAPI = true;
        } catch (err) {
            console.warn("User cancelled directory picker or error occured:", err);
            if (err.name === 'AbortError') {
                if (!confirm(`폴더 선택이 취소되었습니다.\n대신 브라우저 기본 다운로드 폴더로 파일을 개별 저장하시겠습니까?`)) return;
            }
        }
    }

    btn.disabled = true;
    btn.textContent = '저장 준비 중...';

    try {
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const studentId = row.cells[0].textContent.trim();
            const studentName = row.cells[1].textContent.trim();
            const img = row.querySelector('img');
            
            if (!img || !img.src || img.src.includes('default.png')) {
                continue;
            }

            btn.textContent = `저장 중 (${i+1}/${rows.length})`;
            const fileName = `${studentId} ${studentName}.jpg`;

            try {
                const response = await fetch(img.src);
                const blob = await response.blob();

                if (useFileSystemAPI && targetFolderHandle) {
                    // v4.68: 생성된 하위 폴더(targetFolderHandle)에 저장
                    const fileHandle = await targetFolderHandle.getFileHandle(fileName, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                } else {
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = fileName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            } catch (err) {
                console.error(`Failed to save ${studentId}:`, err);
            }
        }
        alert(`모든 사진이 '${subDirName}' 폴더(또는 기본 폴더)에 저장되었습니다.`);
    } catch (e) {
        console.error("Batch save failed", e);
        alert('저장 중 오류가 발생했습니다.');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}
