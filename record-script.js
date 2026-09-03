document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(location.search);
  const student_id = urlParams.get("student_id");

  console.log("📌 student_id:", student_id);

  const tableBody = document.querySelector("#recordTable tbody");
  if (tableBody) {
    tableBody.innerHTML = `<tr><td colspan="7">불러오는 중...</td></tr>`;
  }

  fetch(`/student25/api/get-records.php?student_id=${student_id}`)
    .then(response => response.json())
    .then(data => {
      console.log("✅ 받은 데이터:", data);

      if (!Array.isArray(data) || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7">기록 없음</td></tr>`;
        return;
      }

      const rowsHtml = data.map(record => {
        return `
          <tr>
            <td>${record.student_id || "-"}</td>
            <td>${record.name || "-"}</td>
            <td class="good">${record.good || "-"}</td>
            <td class="bad">${record.bad || "-"}</td>
            <td>${record.teacher || "-"}</td>
            <td class="time">${record.time || "-"}</td>
            <td>${record.detail || "-"}</td>
          </tr>
        `;
      }).join("");

      tableBody.innerHTML = rowsHtml;
    })
    .catch(error => {
      console.error("❌ 오류 발생:", error);
      tableBody.innerHTML = `<tr><td colspan="7">데이터 불러오기 실패</td></tr>`;
    });
});
