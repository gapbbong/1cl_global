import { API_CONFIG } from './config.js';
import { fetchAllTeachers } from './api.js';

const assignments2025 = [
    { class_info: "1-1", homeroom: "최희락", assistant: "김태경" },
    { class_info: "1-2", homeroom: "최현정", assistant: "김동길" },
    { class_info: "1-3", homeroom: "전지훈", assistant: "구동후" },
    { class_info: "1-4", homeroom: "이혜영", assistant: "신승현" },
    { class_info: "1-5", homeroom: "정혜인", assistant: "김웅환" },
    { class_info: "1-6", homeroom: "정유리", assistant: "이상수" },
    { class_info: "2-1", homeroom: "황태겸", assistant: "김선옥" },
    { class_info: "2-2", homeroom: "정민주", assistant: "김덕원" },
    { class_info: "2-3", homeroom: "이민희", assistant: "하미경" },
    { class_info: "2-4", homeroom: "백승민", assistant: "이갑종" },
    { class_info: "2-5", homeroom: "양지원", assistant: "정필구" },
    { class_info: "2-6", homeroom: "권대호", assistant: "황철현" },
    { class_info: "3-1", homeroom: "이관태", assistant: "박성환" },
    { class_info: "3-2", homeroom: "손주희", assistant: "박창우" },
    { class_info: "3-3", homeroom: "손수곤", assistant: "한현숙" },
    { class_info: "3-4", homeroom: "이효상", assistant: "김현희" },
    { class_info: "3-5", homeroom: "김민경", assistant: "이경미" },
    { class_info: "3-6", homeroom: "홍지아", assistant: "최지은" }
];

document.addEventListener("DOMContentLoaded", async () => {
    if (!localStorage.getItem('teacher_auth_token')) {
        alert("로그인이 필요합니다.");
        location.href = "index.html";
        return;
    }

    // 현재 재직 중인 선생님 목록 가져오기
    const currentTeachers = await fetchAllTeachers();
    const currentTeacherNames = currentTeachers.map(t => t.name);

    const container = document.getElementById("class-list");
    renderGrid(container, currentTeacherNames);
});

function renderGrid(container, currentTeacherNames) {
    container.innerHTML = "";

    for (let grade = 1; grade <= 3; grade++) {
        const col = document.createElement("div");
        col.className = "grade-column";

        for (let classNum = 1; classNum <= 6; classNum++) {
            const info = assignments2025.find(c => c.class_info === `${grade}-${classNum}`);
            if (!info) continue;

            const box = document.createElement("div");
            box.className = "class-box";

            let hue = grade === 1 ? 150 : (grade === 2 ? 210 : 30);
            let light = 90 - (classNum * 12);
            const bgColor = `hsl(${hue}, 60%, ${light}%)`;

            // 올해 재직 여부에 따른 시각적 표시
            const isHomeroomStillHere = currentTeacherNames.includes(info.homeroom);
            const isAssistantStillHere = currentTeacherNames.includes(info.assistant);

            box.innerHTML = `
                <section class="class-section" 
                         style="background-color: ${bgColor}; ${light < 55 ? 'color: #fff;' : ''}; cursor: pointer; -webkit-tap-highlight-color: transparent;">
                    <h3 class="class-title" style="${light < 55 ? 'color: #fff;' : ''}; pointer-events: none;">
                        <span class="class-label">${grade}-${classNum}반</span>
                    </h3>
                    <div class="teacher-line" style="pointer-events: none;">
                        <div><strong style="${!isHomeroomStillHere ? 'opacity: 0.6; font-weight: normal;' : ''}">${info.homeroom}</strong></div>
                        <div><strong style="${!isAssistantStillHere ? 'opacity: 0.6; font-weight: normal;' : ''}">${info.assistant}</strong></div>
                    </div>
                </section>
            `;

            const section = box.querySelector(".class-section");
            section.addEventListener("click", () => {
                location.href = `stu-list.html?grade=${grade}&class=${classNum}&year=2025`;
            });

            col.appendChild(box);
        }
        container.appendChild(col);
    }
}
