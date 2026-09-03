import { API_CONFIG } from './config.js';
import { supabase } from './supabase.js';
import CryptoJS from 'crypto-js';

// Game State
let allStudents = [];
let quizPool = [];
let currentIndex = 0;
let score = 0;
let wrongStudents = [];
let currentTeacherEmail = "";
let currentTeacherId = "선생님";

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Auth Check - get teacher email
    const encrypted = localStorage.getItem('teacher_auth_token');
    if (!encrypted) {
        alert("인증이 필요합니다.");
        location.href = "index.html";
        return;
    }

    try {
        const bytes = CryptoJS.AES.decrypt(encrypted, API_CONFIG.SECRET_KEY);
        currentTeacherEmail = bytes.toString(CryptoJS.enc.Utf8).trim().toLowerCase();
        currentTeacherId = currentTeacherEmail.split('@')[0];
        console.log("Teacher Authenticated:", currentTeacherEmail);
    } catch (e) {
        console.error("Auth Decrypt Error:", e);
    }

    // 2. Fetch all students initially (cached)
    await loadInitialData();

    // 3. Render Class Grid
    renderClassGrid();

    // 4. Ranking & My Score
    if (currentTeacherEmail) {
        await updateMyTotalScore();
    }
    showRanking();

    // 5. Score Guide Modal (Reset once to show warm message)
    localStorage.removeItem('hideScoreGuide_v1');
    const hideGuide = localStorage.getItem('hideScoreGuide_v1');
    if (!hideGuide) {
        document.getElementById("score-guide-modal").style.display = 'flex';
    }
});

window.closeScoreGuide = function () {
    const isChecked = document.getElementById("hide-guide-checkbox").checked;
    if (isChecked) {
        localStorage.setItem('hideScoreGuide_v1', 'true');
    }
    document.getElementById("score-guide-modal").style.display = 'none';
}

async function updateMyTotalScore() {
    if (!currentTeacherEmail) return;
    try {
        const { data, error } = await supabase
            .from('quiz_scores')
            .select('score')
            .eq('teacher_email', currentTeacherEmail)
            .maybeSingle();

        if (error) {
            console.error("Fetch Personal Score Error:", error);
            document.getElementById("my-total-score").innerText = "Error";
            return;
        }

        if (data && data.score !== undefined) {
            document.getElementById("my-total-score").innerText = data.score.toLocaleString();
        } else {
            document.getElementById("my-total-score").innerText = "0";
        }
    } catch (e) {
        console.error("updateMyTotalScore Exception:", e);
        document.getElementById("my-total-score").innerText = "0";
    }
}

window.showRankingModal = function () {
    document.getElementById("ranking-modal").style.display = 'flex';
    showRanking();
}

function showCustomConfirm(message) {
    return new Promise((resolve) => {
        document.getElementById('custom-confirm-message').innerHTML = message;
        document.getElementById('custom-confirm-modal').style.display = 'flex';

        window.closeCustomConfirm = function (result) {
            document.getElementById('custom-confirm-modal').style.display = 'none';
            resolve(result);
        };
    });
}

function showCustomAlert(message) {
    document.getElementById('custom-alert-message').innerHTML = message;
    document.getElementById('custom-alert-modal').style.display = 'flex';
}

window.closeCustomAlert = function () {
    document.getElementById('custom-alert-modal').style.display = 'none';
}

// [추가] 뒤로가기 제어
window.handleBack = async function () {
    const gameScreen = document.getElementById("game-screen");
    const resultScreen = document.getElementById("result-screen");
    const selectionScreen = document.getElementById("selection-screen");

    if (gameScreen.style.display === 'flex' || resultScreen.style.display === 'flex') {
        const confirmed = await showCustomConfirm("지금까지의 진행 상황을 저장하고 종료하시겠습니까?<br><br><span style='font-size:0.85rem; color:#64748b;'>메인 화면으로 이동 시 자동 저장됩니다.</span>");
        if (!confirmed) return;

        if (score > 0 && gameScreen.style.display === 'flex') {
            await saveScore(score, currentIndex, quizPool.length);
        }

        gameScreen.style.display = 'none';
        resultScreen.style.display = 'none';
        selectionScreen.style.display = 'flex';
        await updateMyTotalScore();
        return;
    }
    location.href = "index.html";
};

async function loadInitialData() {
    try {
        const { data, error } = await supabase
            .from('students')
            .select('*')
            .eq('academic_year', API_CONFIG.CURRENT_ACADEMIC_YEAR)
            .neq('status', 'graduated')  // 다시 추가: 졸업생 필드 제거
            .order('student_id', { ascending: true });

        if (error) throw error;
        allStudents = data;
    } catch (error) {
        console.error("Fetch Students Error:", error);
    }
}

async function renderClassGrid() {
    const grid = document.getElementById("class-grid");
    if (!grid) return;

    const { loadSchool, levels } = await import('./school.js');
    await loadSchool().catch(() => {});

    let html = '';
    // [M2] school_units 기반 격자 (학년=열)
    const lvls = levels();
    const maxClasses = Math.max(1, ...lvls.map((l) => l.units.length));
    for (let ci = 0; ci < maxClasses; ci++) {
        lvls.forEach((lvl, li) => {
            const u = lvl.units[ci];
            if (!u) return;
            const classTarget = `${u.level_order}-${u.class_order}`;
            const hue = [150, 210, 30, 280, 0, 190][li % 6];
            const light = Math.max(35, 90 - (ci + 1) * 12);
            const bgColor = `hsl(${hue}, 60%, ${light}%)`;
            const textColor = light < 55 ? '#ffffff' : '#1f2937';
            const borderColor = `hsl(${hue}, 60%, ${light - 15}%)`;
            html += `<button class="option-btn" style="background-color: ${bgColor}; color: ${textColor}; border-color: ${borderColor}; text-shadow: ${light < 55 ? '0 1px 2px rgba(0,0,0,0.5)' : 'none'};" onclick="startQuiz('class-${classTarget}')">${classTarget}</button>`;
        });
    }
    grid.innerHTML = html;

    // Adjust button text tracking and sizes dynamically
    document.querySelectorAll('.option-btn').forEach(btn => {
        const textLen = btn.innerText.trim().length;
        if (textLen >= 8) {
            btn.style.letterSpacing = '-1.5px';
            btn.style.fontSize = '0.9rem';
        } else if (textLen >= 6) {
            btn.style.letterSpacing = '-1px';
            btn.style.fontSize = '0.95rem';
        } else {
            btn.style.letterSpacing = '-0.3px';
        }
    });
}

let currentPointsPerQuestion = 10;

window.startQuiz = function (range) {
    let pool = [];

    if (range === 'all') {
        pool = [...allStudents];
    } else if (range.startsWith('grade')) {
        const g = range.replace('grade', '');
        pool = allStudents.filter(s => s.class_info && s.class_info.startsWith(g + '-'));
    } else if (range === 'dept1-iot') {
        pool = allStudents.filter(s => s.class_info && ['1-1', '1-2', '1-3'].includes(s.class_info));
    } else if (range === 'dept1-game') {
        pool = allStudents.filter(s => s.class_info && ['1-4', '1-5', '1-6'].includes(s.class_info));
    } else if (range === 'dept2-iot') {
        pool = allStudents.filter(s => s.class_info && ['2-1', '2-2', '2-3'].includes(s.class_info));
    } else if (range === 'dept2-game') {
        pool = allStudents.filter(s => s.class_info && ['2-4', '2-5', '2-6'].includes(s.class_info));
    } else if (range === 'dept3-iot') {
        pool = allStudents.filter(s => s.class_info && ['3-1', '3-2', '3-3'].includes(s.class_info));
    } else if (range === 'dept3-game') {
        pool = allStudents.filter(s => s.class_info && ['3-4', '3-5', '3-6'].includes(s.class_info));
    } else if (range.startsWith('class-')) {
        const target = range.replace('class-', '');
        pool = allStudents.filter(s => s.class_info === target);
    }

    // Filter students with photos
    quizPool = pool.filter(s => s.photo_url && s.photo_url.trim() !== "");

    if (quizPool.length < 4) {
        showCustomAlert("사진이 있는 학생이 부족하여 퀴즈를 진행할 수 없습니다.<br>(최소 4명 필요)");
        return;
    }

    // 점수는 해당 범위의 사진 있는 실제 사람 수(quizPool.length)와 비례하게!
    currentPointsPerQuestion = quizPool.length;

    // Shuffle
    shuffleArray(quizPool);

    // Quiz Config
    currentIndex = 0;
    score = 0;
    wrongStudents = [];

    // Switch UI
    document.getElementById("selection-screen").style.display = 'none';
    document.getElementById("game-screen").style.display = 'flex';

    showNextQuestion();
};

function showNextQuestion() {
    if (currentIndex >= quizPool.length) {
        endQuiz();
        return;
    }

    const currentStudent = quizPool[currentIndex];

    // Update Score & Progress
    document.getElementById("quiz-progress").innerText = `${currentIndex + 1} / ${quizPool.length}`;
    document.getElementById("quiz-score").innerText = `Score: ${score}`;

    // Show Photo
    document.getElementById("quiz-photo").src = currentStudent.photo_url;
    document.getElementById("name-overlay").classList.remove('show');
    document.getElementById("name-overlay").innerText = currentStudent.name;

    // Pick Options
    const options = [currentStudent.name];
    const otherNames = allStudents
        .filter(s => s.name !== currentStudent.name)
        .map(s => s.name);

    const uniqueOtherNames = [...new Set(otherNames)]; // No duplicate names
    shuffleArray(uniqueOtherNames);

    options.push(...uniqueOtherNames.slice(0, 3));
    shuffleArray(options);

    // Render Options
    const answerGrid = document.getElementById("answer-grid");
    answerGrid.innerHTML = '';
    options.forEach((name, idx) => {
        const btn = document.createElement('button');
        btn.className = 'answer-btn';
        btn.innerText = name;
        btn.onclick = () => window.checkAnswer(name, currentStudent.name, btn);
        answerGrid.appendChild(btn);
    });
}

window.checkAnswer = function (selectedName, correctName, btn) {
    const btns = document.querySelectorAll('.answer-btn');
    btns.forEach(b => b.disabled = true);

    console.log(`Checking Answer: Selected=${selectedName}, Correct=${correctName}`);
    if (selectedName === correctName) {
        score += currentPointsPerQuestion;
        console.log("Correct! New Session Score:", score);
        document.getElementById("quiz-score").innerText = `Score: ${score}`;
        btn.classList.add('correct');
        // Fireworks
        confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 }
        });

        setTimeout(() => {
            currentIndex++;
            showNextQuestion();
        }, 800);
    } else {
        btn.classList.add('wrong');
        wrongStudents.push(quizPool[currentIndex]);

        // Incorrect state: Show correct name on top for 1.2s
        const overlay = document.getElementById("name-overlay");
        overlay.classList.add('show');

        // Highlight correct button
        btns.forEach(b => {
            if (b.innerText === correctName) b.classList.add('correct');
        });

        setTimeout(() => {
            currentIndex++;
            showNextQuestion();
        }, 1200);
    }
};

async function endQuiz() {
    document.getElementById("game-screen").style.display = 'none';
    document.getElementById("result-screen").style.display = 'flex';
    document.getElementById("final-score").innerText = score;

    // Save Score
    await saveScore(score, currentIndex, quizPool.length);

    // Review Button
    const reviewBtn = document.getElementById("btn-review");
    if (wrongStudents.length > 0) {
        reviewBtn.style.display = 'block';
        reviewBtn.onclick = () => {
            const list = document.getElementById("review-list");
            list.innerHTML = '';
            wrongStudents.forEach(s => {
                list.innerHTML += `
                    <div class="review-item">
                        <img src="${s.photo_url}" alt="${s.name}">
                        <div>
                            <strong>${s.name}</strong> (${s.student_id})<br>
                            <span style="font-size:0.8rem; color:#64748b;">${s.class_info} 반</span>
                        </div>
                    </div>
                `;
            });
            document.getElementById("review-container").style.display = 'flex';
        };
    } else {
        reviewBtn.style.display = 'none';
    }

    await showRanking();
    await updateMyTotalScore();
}

async function saveScore(score, correctCount, totalCount) {
    if (!currentTeacherEmail) return;
    try {
        // Try to update or insert
        const { data: existing, error: eError } = await supabase
            .from('quiz_scores')
            .select('*')
            .eq('teacher_email', currentTeacherEmail)
            .maybeSingle();

        if (eError) throw eError;

        if (existing) {
            const newScore = (existing.score || 0) + score;
            const newCorrect = (existing.correct_count || 0) + (score / currentPointsPerQuestion);
            const newTotal = (existing.total_count || 0) + totalCount;

            const { error: uError } = await supabase
                .from('quiz_scores')
                .update({
                    score: newScore,
                    correct_count: newCorrect,
                    total_count: newTotal,
                    last_played_at: new Date().toISOString()
                })
                .eq('id', existing.id);
            if (uError) throw uError;
        } else {
            const { error: iError } = await supabase
                .from('quiz_scores')
                .insert({
                    teacher_email: currentTeacherEmail,
                    score: score,
                    correct_count: (score / currentPointsPerQuestion),
                    total_count: totalCount,
                    academic_year: String(API_CONFIG.CURRENT_ACADEMIC_YEAR)
                });
            if (iError) throw iError;
        }
    } catch (error) {
        console.error("Save Score Error:", error);
    }
}

async function showRanking() {
    try {
        const { data, error } = await supabase
            .from('quiz_scores')
            .select('*')
            .gt('score', 0) // 점수가 1점이라도 있는 사람만
            .order('score', { ascending: false })
            .limit(50);

        if (error) throw error;

        const listResult = document.getElementById("ranking-list-result");
        const listModal = document.getElementById("ranking-list-modal");

        if (!listResult && !listModal) return;

        let htmlString = "";

        if (!data || data.length === 0) {
            htmlString = '<p style="text-align:center; color:#94a3b8;">아직 기록이 없습니다.</p>';
        } else {
            htmlString = data.map((item, idx) => {
                const id = item.teacher_email.split('@')[0];
                const maskedId = maskId(id);
                return `
                    <div class="ranking-item">
                        <div class="rank-info">
                            <span class="rank-num">${idx + 1}</span>
                            <span class="rank-id">${maskedId}</span>
                        </div>
                        <div style="font-weight: 800; color: var(--quiz-primary);">${item.score.toLocaleString()}점</div>
                    </div>
                `;
            }).join('');
        }

        if (listResult) listResult.innerHTML = htmlString;
        if (listModal) listModal.innerHTML = htmlString;
    } catch (e) {
        console.warn("Ranking failed", e);
    }
}

function maskId(id) {
    if (!id) return "***";
    if (id.length <= 2) return "**";
    return "**" + id.substring(2);
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}
