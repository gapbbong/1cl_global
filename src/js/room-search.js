const roomData = [
  { floor: 1, room: "101호", name: "전기기능부실" },
  { floor: 1, room: "102호", name: "전기드림팩토리" },
  { floor: 1, room: "103호", name: "지능형실습실" },
  { floor: 1, room: "104호", name: "창고" },
  { floor: 2, room: "201호", name: "비전그래픽스튜디오" },
  { floor: 2, room: "203호", name: "아이디어팩토리" },
  { floor: 2, room: "204호", name: "디자인메이커스페이스" },
  { floor: 2, room: "205호", name: "변전실" },
  { floor: 2, room: "206호", name: "특성화교육부" },
  { floor: 2, room: "207호", name: "전기기능부실" },
  { floor: 2, room: "208호", name: "위클래스" },
  { floor: 2, room: "209호", name: "IoT메이커실" },
  { floor: 2, room: "210호", name: "도제교육부 전기제어부" },
  { floor: 2, room: "210-1호", name: "리프트기계실" },
  { floor: 2, room: "-", name: "경성In가배" },
  { floor: 3, room: "301호", name: "인공지능연구실" },
  { floor: 3, room: "302호", name: "코드상상실" },
  { floor: 3, room: "304호", name: "코딩라운지" },
  { floor: 3, room: "305호", name: "정보부 / 교육" },
  { floor: 3, room: "306호", name: "행정실" },
  { floor: 3, room: "307호", name: "교장실" },
  { floor: 3, room: "308호", name: "학부모상담실" },
  { floor: 3, room: "309호", name: "인쇄실" },
  { floor: 3, room: "310호", name: "교사식당" },
  { floor: 3, room: "311호", name: "창고" },
  { floor: 3, room: "312호", name: "학부모회의실" },
  { floor: 3, room: "313호", name: "복합문화공간" },
  { floor: 3, room: "313-1호", name: "취미공간" },
  { floor: 3, room: "314호", name: "학생식당" },
  { floor: 3, room: "317호", name: "AI스튜디오" },
  { floor: 4, room: "401호", name: "3학년 6반" },
  { floor: 4, room: "402호", name: "3학년 5반" },
  { floor: 4, room: "403호", name: "3학년 4반" },
  { floor: 4, room: "404호", name: "3학년 3반" },
  { floor: 4, room: "405호", name: "멀티미디어실" },
  { floor: 4, room: "406호", name: "영어카페" },
  { floor: 4, room: "407호", name: "영어전용실" },
  { floor: 4, room: "408호", name: "영어교사실" },
  { floor: 4, room: "410호", name: "여직원휴게실" },
  { floor: 4, room: "411호", name: "여학생탈의실" },
  { floor: 4, room: "412호", name: "학생휴게실" },
  { floor: 4, room: "413호", name: "방송실" },
  { floor: 4, room: "414호", name: "보건실" },
  { floor: 4, room: "415호", name: "도서실" },
  { floor: 4, room: "416호", name: "교무실" },
  { floor: 4, room: "417호", name: "진로상담실" },
  { floor: 4, room: "419호", name: "휴게실" },
  { floor: 5, room: "502호", name: "자동제어시스템 운용실(II)" },
  { floor: 5, room: "503호", name: "지능형과학실" },
  { floor: 5, room: "508호", name: "학생지도실" },
  { floor: 6, room: "601호", name: "디자인실" },
  { floor: 6, room: "602호", name: "미술실" },
  { floor: 6, room: "603호", name: "3학년 1반" },
  { floor: 6, room: "604호", name: "3학년 2반" },
  { floor: 6, room: "605호", name: "전기공사실습실" },
  { floor: 6, room: "606호", name: "전력전자실습실" },
  { floor: 6, room: "607호", name: "전기기능부실" },
  { floor: 6, room: "612호", name: "문서보존서고" },
  { floor: 7, room: "705호", name: "창고" },
  { floor: 8, room: "801호", name: "펜싱부" }
];

document.addEventListener('DOMContentLoaded', () => {
    const listContainer = document.getElementById('room-list-container');
    const searchInput = document.getElementById('room-search-input');
    
    function renderList(filterText = '') {
        listContainer.innerHTML = '';
        const lowercaseFilter = filterText.toLowerCase();

        // Group by floor
        const grouped = roomData.reduce((acc, room) => {
            const match = room.name.toLowerCase().includes(lowercaseFilter) || room.room.toLowerCase().includes(lowercaseFilter);
            if(match) {
                if(!acc[room.floor]) acc[room.floor] = [];
                acc[room.floor].push(room);
            }
            return acc;
        }, {});

        // Render groups
        let hasResults = false;
        Object.keys(grouped).sort((a,b) => parseInt(a) - parseInt(b)).forEach(floor => {
            hasResults = true;
            const floorGroup = document.createElement('div');
            floorGroup.className = 'floor-group';

            const floorTitle = document.createElement('div');
            floorTitle.className = 'floor-title';
            floorTitle.textContent = `본관 ${floor}층`;
            
            floorGroup.appendChild(floorTitle);

            grouped[floor].forEach(room => {
                const item = document.createElement('div');
                item.className = 'room-item';
                
                const badge = document.createElement('span');
                badge.className = 'room-badge';
                badge.textContent = room.room === '-' ? '' : room.room;
                if(room.room === '-') badge.style.display = 'none';

                const name = document.createElement('span');
                name.className = 'room-name';
                name.textContent = room.name;

                item.appendChild(badge);
                item.appendChild(name);
                floorGroup.appendChild(item);
            });

            listContainer.appendChild(floorGroup);
        });

        if (!hasResults) {
            listContainer.innerHTML = '<div class="no-results">검색 결과가 없습니다.</div>';
        }
    }

    searchInput.addEventListener('input', (e) => {
        renderList(e.target.value);
    });

    renderList();
});
