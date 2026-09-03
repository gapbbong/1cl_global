// quiz.js (최신 보플 복구 버전)

const photoEl = document.getElementById("photo");
const nameButtons = document.getElementById("nameButtons");
const nameDisplay = document.getElementById("name");
const quitBtn = document.getElementById("quitBtn");
const skipBtn = document.getElementById("skipBtn");
const timerSelect = document.getElementById("timerSelect");
const progressEl = document.getElementById("progress");
const fireworks = document.getElementById("fireworks");

let currentAnswer = null;
let currentStep = 1;
let correctCount = 0;
let totalQuestions = 15;
let quizData = [];
let wrongAnswers = [];

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function showFeedback(isCorrect, correctName) {
  const overlay = document.createElement("div");
  overlay.className = "feedback-overlay";
  overlay.textContent = isCorrect ? "✅" : `❌ ${correctName}`;
  photoEl.parentElement.appendChild(overlay);
  setTimeout(() => {
    overlay.remove();
  }, 1500);
}

function updateProgress() {
  progressEl.textContent = `단계 ${currentStep} / ${totalQuestions}`;
}

function finishQuiz() {
  const score = Math.round((correctCount / totalQuestions) * 100);
  nameDisplay.innerHTML = `🎉 퀴즈 완료!<br>정답률: ${score}% (${correctCount}/${totalQuestions})`;
  nameButtons.innerHTML = "";
  photoEl.src = "";

  if (score >= 95) {
    fireworks.style.display = "block";
    startFireworks();
  }
}

function loadQuiz() {
  if (currentStep > totalQuestions) {
    finishQuiz();
    return;
  }

  fetch("get-quiz-students.php")
    .then((res) => res.json())
    .then((data) => {
      if (data.error) {
        nameDisplay.innerHTML = `❌ 오류: ${data.error}`;
        return;
      }

      const { answer, options } = data;
      currentAnswer = answer;
      updateProgress();

      photoEl.src = answer.photo_path;
      nameDisplay.textContent = "";

      nameButtons.innerHTML = "";
      shuffle(options).forEach((name) => {
        const btn = document.createElement("button");
        btn.textContent = name;
        btn.onclick = () => {
          const isCorrect = name === answer.name;
          if (isCorrect) correctCount++;
          else wrongAnswers.push(answer);

          showFeedback(isCorrect, answer.name);

          setTimeout(() => {
            currentStep++;
            loadQuiz();
          }, parseInt(timerSelect.value));
        };
        nameButtons.appendChild(btn);
      });
    })
    .catch((err) => {
      nameDisplay.innerHTML = `❌ 오류: ${err.message}`;
      nameButtons.innerHTML = "";
    });
}

function skipQuiz() {
  currentStep++;
  loadQuiz();
}

function startFireworks() {
  const duration = 4000;
  const end = Date.now() + duration;
  const colors = ["#bb0000", "#ffffff"];

  (function frame() {
    confetti({
      particleCount: 2,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors: colors,
    });
    confetti({
      particleCount: 2,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors: colors,
    });

    if (Date.now() < end) {
      requestAnimationFrame(frame);
    } else {
      fireworks.style.display = "none";
    }
  })();
}

quitBtn.addEventListener("click", () => {
  location.href = "index.html";
});

skipBtn.addEventListener("click", skipQuiz);

document.addEventListener("DOMContentLoaded", loadQuiz);
