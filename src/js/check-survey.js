import { fetchStudentsByClass, getTeacherProfile, getCurrentTeacherEmail } from './api.js';
import { supabase, supabaseRealtime } from './supabase.js';
import CryptoJS from 'crypto-js';
import { API_CONFIG } from './config.js';
import { loadSchool, fillClassSelect } from './school.js';

let currentClassData = []; // { student: {...}, survey: {...} | null }
let currentFilter = 'all'; // 'all', 'submitted', 'pending'

document.addEventListener('DOMContentLoaded', async () => {
    initClassDropdown();
    setupEventListeners();
});

// 학급 드롭다운 초기화
async function initClassDropdown() {
    const dropdown = document.getElementById('class-dropdown');

    // [M2] 학교 설정(school_units)으로 학급 목록 생성
    await loadSchool().catch(() => {});
    fillClassSelect(dropdown, { placeholder: '학급을 선택하세요' });

    // 선생님 정보 확인 및 본인 반 자동 선택
    try {
        const teacherEmail = getCurrentTeacherEmail();
        if (teacherEmail) {
            const teacherData = await getTeacherProfile(teacherEmail);
                if (teacherData) {
                    const isAdmin = teacherData.role === 'admin' || teacherData.role === 'counselor'
                        || Object.values(teacherData.permissions?.admin || {}).some(Boolean);

                    if (isAdmin) {
                        document.getElementById('all-pending-btn').style.display = 'inline-block';
                    }

                    if (teacherData.assigned_class) {
                        dropdown.value = teacherData.assigned_class;

                        // 관리자가 아닌 일반 교사는 다른 반을 조회할 수 없도록 드롭다운 비활성화
                        if (!isAdmin) {
                            dropdown.disabled = true;
                            document.getElementById('prev-class-btn').disabled = true;
                            document.getElementById('next-class-btn').disabled = true;
                        }

                        // 바로 조회 실행
                        loadClassSurveyStatus();
                    }
                }
        }
    } catch (err) {
        console.error("선생님 정보 호출 실패:", err);
    }

    // 선택 감지 시 바로 조회 (관리자/소유자용)
    dropdown.addEventListener('change', () => {
        if (dropdown.value) {
            loadClassSurveyStatus();
        }
    });
}

function setupEventListeners() {
    // 반 이동 버튼
    document.getElementById('prev-class-btn').addEventListener('click', () => navigateClass(-1));
    document.getElementById('next-class-btn').addEventListener('click', () => navigateClass(1));

    // 전교생 미제출자 버튼
    document.getElementById('all-pending-btn').addEventListener('click', loadAllPendingStudents);

    // 필터 탭 이벤트
    const tabs = document.querySelectorAll('.filter-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            tabs.forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.dataset.filter;
            renderStudentList();
        });
    });
}

function navigateClass(direction) {
    const dropdown = document.getElementById('class-dropdown');
    const currentIndex = dropdown.selectedIndex;
    if (currentIndex === -1) return;

    let nextIndex = currentIndex + direction;
    // 범위 체크 (0번째는 "학급을 선택하세요")
    if (nextIndex < 1) nextIndex = dropdown.options.length - 1;
    if (nextIndex >= dropdown.options.length) nextIndex = 1;

    dropdown.selectedIndex = nextIndex;
    loadClassSurveyStatus();
}

// 1. 학급 명단과 제출 데이터 로드 및 병합
async function loadClassSurveyStatus() {
    const classInfo = document.getElementById('class-dropdown').value;
    if (!classInfo) return;

    // 전교생 미제출자 결과창 열려있으면 닫기
    document.getElementById('all-pending-result').style.display = 'none';

    // UI 상태 변경
    document.getElementById('welcome-view').style.display = 'none';
    document.getElementById('result-view').style.display = 'none';
    document.getElementById('summary-dashboard').style.display = 'none';
    document.getElementById('loading-view').style.display = 'block';

    const [grade, classNum] = classInfo.split('-');

    try {
        // 1. 학생 명단 로드 (api.js 활용)
        const students = await fetchStudentsByClass(grade, classNum);

        // 2. 해당 학급 학생들의 PID 추출
        const pids = students.map(s => s.pid);

        // 3. surveys 테이블에서 해당 PID들의 제출 내역 로드
        let surveyMap = {};
        if (pids.length > 0) {
            const { data: surveys, error } = await supabase
                .from('surveys')
                .select('student_pid, submitted_at')
                .in('student_pid', pids);

            if (error) throw error;

            surveys.forEach(survey => {
                surveyMap[survey.student_pid] = survey;
            });
        }

        // 4. 데이터 병합 (학생 + 설문)
        currentClassData = students
            .filter(student => {
                const status = String(student["학적"] || "").trim();
                return !status.includes("전출") && !status.includes("자퇴") && !status.includes("위탁") && !status.includes("퇴학");
            })
            .map(student => {
                // PID를 문자열로 변환하고 양 끝 공백 제거 후 비교 (안정성 강화)
                const studentPid = String(student.pid || '').trim().toLowerCase();
                const survey = Object.values(surveyMap).find(s => String(s.student_pid || '').trim().toLowerCase() === studentPid) || null;

                return {
                    student: student,
                    survey: survey
                };
            });

        console.log(`[Data Merge] ${classInfo}: ${currentClassData.filter(d => d.survey).length}/${currentClassData.length} 제출됨`);

        // 5. 완료 후 렌더링
        document.getElementById('loading-view').style.display = 'none';
        document.getElementById('summary-dashboard').style.display = 'grid';
        document.getElementById('result-view').style.display = 'block';

        renderSummary();
        renderStudentList();

        // 6. 실시간 업데이트 구독 및 폴백 설정
        setupRealtimeSubscription(classInfo, pids);
        setupPollingFallback();

    } catch (error) {
        console.error("데이터 로드 오류:", error);
        alert("데이터를 불러오는 중 오류가 발생했습니다.");
        document.getElementById('loading-view').style.display = 'none';
        document.getElementById('welcome-view').style.display = 'block';
    }
}

let surveySubscription = null;
let pollingInterval = null;

// 실시간 구독 설정 함수
function setupRealtimeSubscription(classInfo, pids) {
    if (!supabaseRealtime) return; // realtime disabled (no anon key configured)
    if (surveySubscription) {
        supabaseRealtime.removeChannel(surveySubscription);
    }

    if (pids.length === 0) return;

    // 채널 생성 (유니크한 이름으로)
    const channelName = `surveys-realtime-${Date.now()}`;
    surveySubscription = supabaseRealtime.channel(channelName)
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'surveys' },
            async (payload) => {
                const { eventType, new: newSurvey, old: oldSurvey } = payload;
                console.log(`실시간 변경 감지 [${eventType}]`, payload);

                // INSERT, UPDATE 시 처리
                if (eventType === 'INSERT' || eventType === 'UPDATE') {
                    const sid = String(newSurvey.student_pid);
                    if (pids.map(String).includes(sid)) {
                        const targetIndex = currentClassData.findIndex(d => String(d.student.pid) === sid);
                        if (targetIndex !== -1) {
                            currentClassData[targetIndex].survey = newSurvey;
                            renderSummary();
                            renderStudentList();
                        }
                    }
                }
                // DELETE 시 처리
                else if (eventType === 'DELETE') {
                    // DELETE payload의 old에는 PK(id)만 있는 경우가 많으므로, 
                    // currentClassData에서 survey.id가 일치하는 항목을 찾아 비웁니다.
                    const targetIndex = currentClassData.findIndex(d => d.survey && String(d.survey.id) === String(oldSurvey.id));
                    if (targetIndex !== -1) {
                        currentClassData[targetIndex].survey = null;
                        renderSummary();
                        renderStudentList();
                    }
                }
            }
        )
        .subscribe((status) => {
            console.log(`실시간 구독 상태 [${classInfo}]:`, status);
        });
}

// 폴백: 실시간이 불안정할 경우를 대비해 60초마다 백그라운드에서 동기화 (서버 부하 최소화)
function setupPollingFallback() {
    if (pollingInterval) clearInterval(pollingInterval);

    pollingInterval = setInterval(async () => {
        // [최적화] 브라우저 탭이 백그라운드에 있으면 통신하지 않음
        if (document.hidden) return;

        const classInfo = document.getElementById('class-dropdown').value;
        if (!classInfo) return;

        const pids = currentClassData.map(d => d.student.pid);
        if (pids.length === 0) return;

        try {
            console.log("[Safety Sync] 최신 데이터 동기화 체크 중...");
            // surveys 테이블에서 최신 정보만 다시 가져옴 (백그라운드)
            const { data: surveys, error } = await supabase
                .from('surveys')
                .select('student_pid, submitted_at, id, data')
                .in('student_pid', pids);

            if (error) throw error;

            let updated = false;
            const surveyMap = {};
            surveys.forEach(s => { surveyMap[String(s.student_pid)] = s; });

            // currentClassData와 비교하여 변경 사항 반영
            currentClassData.forEach(item => {
                const pidStr = String(item.student.pid);
                const currentSurvey = item.survey;
                const latestSurvey = surveyMap[pidStr] || null;

                // 변경 여부 확인 (있던 게 없어지거나, 없던 게 생기거나, ID가 바뀌었거나)
                if (JSON.stringify(currentSurvey) !== JSON.stringify(latestSurvey)) {
                    item.survey = latestSurvey;
                    updated = true;
                }
            });

            if (updated) {
                console.log("폴백 데이터 업데이트 반영: UI 갱신");
                renderSummary();
                renderStudentList();
            }
        } catch (e) {
            console.warn("폴백 동기화 실패:", e);
        }
    }, 30000); // 30초 주기로 변경 (사용자 경험과 서버 부하 조절)
}

// 2. 대시보드 요약 렌더링
function renderSummary() {
    const total = currentClassData.length;
    const submitted = currentClassData.filter(d => d.survey !== null).length;
    const pending = total - submitted;

    document.getElementById('summary-total').textContent = `${total}명`;
    document.getElementById('summary-submitted').textContent = `${submitted}명`;
    document.getElementById('summary-pending').textContent = `${pending}명`;
}

// 3. 학생 리스트 렌더링
function renderStudentList(targetTbodyId = 'student-tbody', data = currentClassData) {
    const tbody = document.getElementById(targetTbodyId);
    if (!tbody) return;

    tbody.innerHTML = '';

    // 필터링 적용 (학급 조회용일 때만 필터 적용)
    let filteredData = data;
    if (targetTbodyId === 'student-tbody') {
        filteredData = data.filter(d => {
            if (currentFilter === 'all') return true;
            if (currentFilter === 'submitted') return d.survey !== null;
            if (currentFilter === 'pending') return d.survey === null;
            return true;
        });
    }

    if (filteredData.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="4" style="text-align:center; padding: 40px; color:#94a3b8;">해당하는 학생이 없습니다.</td>`;
        tbody.appendChild(tr);
        return;
    }

    filteredData.forEach(item => {
        const student = item.student;
        const isSubmitted = item.survey !== null;

        const tr = document.createElement('tr');
        if (!isSubmitted) {
            tr.classList.add('miss'); // 배경색 연한 빨강 처리용 클래스
        }

        // 상태 뱃지
        const statusBadge = isSubmitted
            ? `<span class="badge submitted">제출 완료</span>`
            : `<span class="badge pending">미제출</span>`;

        // 이름 렌더링 (이름 밑에 연락처)
        // 미제출자인데 연락처가 미리 보이는 것은 어색하므로, 제출 완료된 경우에만 노출되거나 강조 표시
        const contactInfo = isSubmitted ? (student['연락처'] || student.contact || '-') : '-';
        const nameHtml = `<div style="font-weight:bold; line-height:1.2;">${student['이름'] || student.name}</div>
                          <div style="font-size:0.75rem; color:${isSubmitted ? '#64748b' : '#cbd5e1'}; margin-top:2px;">${contactInfo}</div>`;

        // 학번/반 정보 표시 최적화
        let idDisplay = student['학번'] || student.student_id || '';
        if (student.class_info && !idDisplay.includes(student.class_info)) {
            idDisplay = `<span style="font-weight:normal; color:#64748b; font-size:0.82em;">${student.class_info}</span><br>${idDisplay}`;
        }

        // 제출 시간 포맷팅 (2줄 고정)
        let timeStr = '-';
        if (isSubmitted && item.survey.submitted_at) {
            const date = new Date(item.survey.submitted_at);
            const monthDay = `${date.getMonth() + 1}월 ${date.getDate()}일`;
            const hourMin = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
            timeStr = `<div style="line-height:1.3;">${monthDay}<br><span style="font-size:0.8em; opacity:0.8;">${hourMin}</span></div>`;
        }

        tr.innerHTML = `
            <td><strong>${idDisplay}</strong></td>
            <td>${nameHtml}</td>
            <td>${statusBadge}</td>
            <td class="submit-time">${timeStr}</td>
        `;

        tbody.appendChild(tr);
    });
}

/**
 * 전교생 중 미제출자 명단을 한꺼번에 가져옵니다.
 */
async function loadAllPendingStudents() {
    const resultContainer = document.getElementById('all-pending-result');

    // 이미 열려있으면 닫기 (토글 방식)
    if (resultContainer.style.display === 'block') {
        resultContainer.style.display = 'none';
        return;
    }

    resultContainer.innerHTML = '<div class="loading-dots" style="padding: 20px;">데이터 분석 중...</div>';
    resultContainer.style.display = 'block';

    try {
        // 1. 전교생 명단 가져오기
        const { data: allStudents, error: sError } = await supabase
            .from('students')
            .select('pid, student_id, name, class_info, contact, status')
            .eq('academic_year', API_CONFIG.CURRENT_ACADEMIC_YEAR)
            .neq('status', 'graduated')
            .order('student_id', { ascending: true });

        if (sError) throw sError;

        // [추가] 전출/자퇴/위탁/퇴학생 제외 (학적 필드 기준)
        const activeStudents = allStudents.filter(s => {
            const status = String(s.status || '').trim().toLowerCase();
            // DB의 status 값이 English일 수도 있으므로 둘 다 체크
            return !status.includes('전출') && !status.includes('자퇴') && !status.includes('위탁') && !status.includes('퇴학') && 
                   status !== 'transferred' && status !== 'withdrawn' && status !== 'dropout' && status !== 'consigned' && status !== 'expelled';
        });

        // 2. 전체 설문 데이터의 student_pid 목록 가져오기
        const { data: surveys, error: surveyError } = await supabase
            .from('surveys')
            .select('student_pid');

        if (surveyError) throw surveyError;

        const submittedPids = new Set(surveys.map(s => String(s.student_pid)));

        // 3. 미제출자 필터링
        const pendingStudents = activeStudents.filter(s => !submittedPids.has(String(s.pid)));

        // 4. 반별 미제출 인원 통계 계산
        const classStats = {};
        pendingStudents.forEach(s => {
            const cInfo = s.class_info || '미배정';
            classStats[cInfo] = (classStats[cInfo] || 0) + 1;
        });

        // 학급 순서대로 정렬 (1-1, 1-2...)
        const sortedClasses = Object.keys(classStats).sort((a, b) => {
            if (a === '미배정') return 1;
            if (b === '미배정') return -1;
            const splitA = a.split('-');
            const splitB = b.split('-');
            const gA = parseInt(splitA[0]), cA = parseInt(splitA[1]);
            const gB = parseInt(splitB[0]), cB = parseInt(splitB[1]);
            return gA !== gB ? gA - gB : cA - cB;
        });

        // 5. 통계 요약 HTML 생성
        let statsHtml = `
            <div class="class-summary-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 10px; margin-bottom: 30px;">
        `;
        sortedClasses.forEach(cInfo => {
            statsHtml += `
                <div style="background: white; border: 1.5px solid #fee2e2; padding: 12px 6px; border-radius: 14px; box-shadow: 0 4px 6px rgba(0,0,0,0.02); text-align: center;">
                    <div style="font-size: 0.75rem; color: #64748b; font-weight: 600; margin-bottom: 5px;">${cInfo}</div>
                    <div style="font-size: 1.2rem; font-weight: 800; color: #ef4444;">${classStats[cInfo]}<span style="font-size: 0.75rem; font-weight: normal; margin-left:2px;">명</span></div>
                </div>
            `;
        });
        statsHtml += `</div>`;

        // 6. 전체 결과 HTML 조합
        resultContainer.innerHTML = `
            <div class="student-list-box" style="margin-top: 15px; border-top: 1px solid var(--border-color); padding: 30px 10px;">
                <h3 style="font-size: 1.15rem; margin-bottom: 20px; color: var(--text-main); font-weight: 800; display: flex; align-items: center; gap: 10px;">
                    <span style="background: #fee2e2; color: #ef4444; padding: 5px 12px; border-radius: 10px; font-size: 0.85rem;">요약</span>
                    반별 미제출 현황
                </h3>
                
                ${statsHtml}

                <h3 style="font-size: 1.15rem; margin: 40px 0 20px; color: var(--text-main); font-weight: 800; display: flex; align-items: center; gap: 10px;">
                    <span style="background: #f1f5f9; color: #475569; padding: 5px 12px; border-radius: 10px; font-size: 0.85rem;">목록</span>
                    미제출자 상세 명단 (${pendingStudents.length}명)
                </h3>
                
                <table class="status-table">
                    <thead>
                        <tr>
                            <th>반/학번</th>
                            <th>이름</th>
                            <th>상태</th>
                            <th>제출일시</th>
                        </tr>
                    </thead>
                    <tbody id="all-pending-tbody"></tbody>
                </table>
            </div>
        `;

        // 7. 실등 리스트 렌더링
        const dataForRendering = pendingStudents.map(s => ({
            student: s,
            survey: null
        }));

        renderStudentList('all-pending-tbody', dataForRendering);

        // 결과 영역으로 스크롤 내리기
        resultContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (error) {
        console.error("전체 미제출자 로드 오류:", error);
        resultContainer.innerHTML = '<div style="color: red; padding: 20px;">데이터 로드 오류가 발생했습니다.</div>';
    }
}
