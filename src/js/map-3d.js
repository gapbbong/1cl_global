import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// Global Constants
const ROOM_WIDTH = 10;
const ROOM_DEPTH = 12; // Slightly adjusted for diagram proportions
const FLOOR_HEIGHT = 24; 
const WALL_HEIGHT = 8;
const FLOOR_THICKNESS = 2;

// Updated Room Data based on 4F diagram logic
// Horizontal Body (Right): X axis (0 to 80)
// Vertical Wing (Up): Z axis (0 to 60)
const roomData = [
  // 1F
  { floor: 1, room: "101호", name: "전기기능부실", x: 70, z: 0 },
  { floor: 1, room: "102호", name: "전기드림팩토리", x: 50, z: 0 },
  { floor: 1, room: "103호", name: "지능형실습실", x: 30, z: 0 },
  { floor: 1, room: "104호", name: "창고", x: 10, z: 0 },
  
  // 2F
  { floor: 2, room: "201호", name: "비전그래픽스튜디오", x: 70, z: 0 },
  { floor: 2, room: "203호", name: "아이디어팩토리", x: 50, z: 0 },
  { floor: 2, room: "204호", name: "디자인메이커스페이스", x: 35, z: 0 },
  { floor: 2, room: "206호", name: "특성화교육부", x: 20, z: 0 },
  { floor: 2, room: "207호", name: "전기기능부실", x: 5, z: 0 },
  { floor: 2, room: "208호", name: "위클래스", x: 0, z: 20 },
  { floor: 2, room: "209호", name: "IoT메이커실", x: 0, z: 35 },
  { floor: 2, room: "210호", name: "도제교육부", x: 0, z: 50 },
  
  // 3F
  { floor: 3, room: "301호", name: "인공지능연구실", x: 70, z: 0 },
  { floor: 3, room: "302호", name: "코드상상실", x: 55, z: 0 },
  { floor: 3, room: "304호", name: "코딩라운지", x: 40, z: 0 },
  { floor: 3, room: "306호", name: "행정실", x: 25, z: 0 },
  { floor: 3, room: "307호", name: "교장실", x: 10, z: 0 },
  { floor: 3, room: "310호", name: "교사식당", x: 0, z: 20 },
  { floor: 3, room: "314호", name: "학생식당", x: 0, z: 40 },
  { floor: 3, room: "317호", name: "AI스튜디오", x: 0, z: 55 },
  
  // 4F (Detailed mapping from diagram)
  { floor: 4, room: "401호", name: "3학년 6반", x: 75, z: 0 },
  { floor: 4, room: "402호", name: "3학년 5반", x: 65, z: 0 },
  { floor: 4, room: "403호", name: "3학년 4반", x: 55, z: 0 },
  { floor: 4, room: "404호", name: "3학년 3반", x: 45, z: 0 },
  { floor: 4, room: "405호", name: "멀티미디어실", x: 30, z: 0 },
  { floor: 4, room: "407호", name: "영어전용실", x: 15, z: 0 },
  { floor: 4, room: "413호", name: "방송실", x: -5, z: 5 }, // Near the turn
  { floor: 4, room: "414호", name: "보건실", x: -5, z: 15 },
  { floor: 4, room: "415호", name: "도서실", x: -5, z: 30 },
  { floor: 4, room: "416호", name: "교무실", x: -5, z: 45 },
  { floor: 4, room: "417호", name: "진로상담실", x: -5, z: 60 },
  
  // 5F
  { floor: 5, room: "502호", name: "자동제어시스템", x: 40, z: 0 },
  { floor: 5, room: "503호", name: "지능형과학실", x: 20, z: 0 },
  { floor: 5, room: "508호", name: "학생지도실", x: 0, z: 30 },
  
  // 6F
  { floor: 6, room: "603호", name: "3학년 1반", x: 60, z: 0 },
  { floor: 6, room: "604호", name: "3학년 2반", x: 45, z: 0 },
  { floor: 6, room: "605호", name: "전기공사실습실", x: 0, z: 20 },
  { floor: 6, room: "607호", name: "전기기능부실", x: 0, z: 40 },
  
  // 8F
  { floor: 8, room: "801호", name: "펜싱부", x: 30, z: 0 }
];

let scene, camera, renderer, labelRenderer, controls;
let floors = [];
let roomLabels = [];
let currentFloorMode = '1';

init();
animate();

function init() {
    const container = document.getElementById('map-container');
    
    // Scene
    scene = new THREE.Scene();
    scene.background = null; 

    // Camera
    camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 1, 3000);
    camera.position.set(150, 200, 250);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    // Label Renderer
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(labelRenderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(50, 150, 100);
    scene.add(dirLight);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.minDistance = 30;
    controls.maxDistance = 600;
    controls.target.set(30, 0, 25);
    controls.update();

    // Build Building
    createBuilding();

    // Event Listeners
    window.addEventListener('resize', onWindowResize);
    
    document.querySelectorAll('.floor-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            currentFloorMode = e.target.getAttribute('data-floor');
            updateFloorVisibility();
            
            document.querySelectorAll('.floor-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
        });
    });

    document.getElementById('reset-view').addEventListener('click', () => {
        camera.position.set(150, 200, 250);
        controls.target.set(30, 0, 25);
        controls.update();
    });

    document.getElementById('close-panel').addEventListener('click', () => {
        document.getElementById('room-info-panel').style.display = 'none';
    });

    updateFloorVisibility();
}

function createBuilding() {
    // 8 floors
    for (let f = 1; f <= 8; f++) {
        const floorGroup = new THREE.Group();
        floorGroup.userData = { floor: f };
        
        // --- 1. Thick Floor Slab ---
        const slabShape = createLStoreyShape();
        const slabGeom = new THREE.ExtrudeGeometry(slabShape, { depth: FLOOR_THICKNESS, bevelEnabled: false });
        slabGeom.rotateX(Math.PI / 2);
        const slabMat = new THREE.MeshStandardMaterial({ 
            color: 0xffffff,
            roughness: 0.8,
            metalness: 0.1,
            transparent: true,
            opacity: 1
        });
        const slab = new THREE.Mesh(slabGeom, slabMat);
        slab.position.y = (f - 1) * FLOOR_HEIGHT;
        floorGroup.add(slab);

        // --- 2. Internal Partition Walls for Rooms ---
        const wallMat = new THREE.MeshStandardMaterial({
            color: 0xcfdce6,
            roughness: 0.4,
            metalness: 0.1,
            transparent: true,
            opacity: 0.85
        });

        const floorRooms = roomData.filter(r => r.floor === f);
        floorRooms.forEach(room => {
            // Room Walls
            const wallThickness = 0.6;
            const roomWallGeom = createRoomWallGeometry(ROOM_WIDTH, WALL_HEIGHT, ROOM_DEPTH, wallThickness);
            const roomWall = new THREE.Mesh(roomWallGeom, wallMat);
            roomWall.position.set(room.x, (f - 1) * FLOOR_HEIGHT + FLOOR_THICKNESS, room.z);
            floorGroup.add(roomWall);

            // Room Interior Area
            const areaGeom = new THREE.PlaneGeometry(ROOM_WIDTH - 0.2, ROOM_DEPTH - 0.2);
            const areaMat = new THREE.MeshStandardMaterial({
                color: 0xd1d5db,
                side: THREE.DoubleSide
            });
            const area = new THREE.Mesh(areaGeom, areaMat);
            area.rotation.x = -Math.PI / 2;
            area.position.set(room.x, (f - 1) * FLOOR_HEIGHT + FLOOR_THICKNESS + 0.02, room.z);
            floorGroup.add(area);

            // --- 3. Floating Labels ---
            const div = document.createElement('div');
            div.className = 'room-label';
            div.innerHTML = `<span class="room-no">${room.room}</span><br><span class="room-fn">${room.name}</span>`;
            div.onclick = () => showRoomInfo(room);
            
            const label = new CSS2DObject(div);
            label.position.set(room.x, (f - 1) * FLOOR_HEIGHT + FLOOR_THICKNESS + WALL_HEIGHT + 3, room.z);
            floorGroup.add(label);
            roomLabels.push({ label, floor: f });
        });

        scene.add(floorGroup);
        floors.push(floorGroup);
    }
}

function createRoomWallGeometry(w, h, d, t) {
    const shape = new THREE.Shape();
    shape.moveTo(-w/2, -d/2);
    shape.lineTo(w/2, -d/2);
    shape.lineTo(w/2, d/2);
    shape.lineTo(-w/2, d/2);
    shape.lineTo(-w/2, -d/2);

    const hole = new THREE.Path();
    hole.moveTo(-w/2 + t, -d/2 + t);
    hole.lineTo(w/2 - t, -d/2 + t);
    hole.lineTo(w/2 - t, d/2 - t);
    hole.lineTo(-w/2 + t, d/2 - t);
    hole.lineTo(-w/2 + t, -d/2 + t);
    shape.holes.push(hole);

    const extrudeSettings = { depth: h, bevelEnabled: false };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.rotateX(Math.PI / 2);
    return geometry;
}

// Strictly Orthogonal L-Shape (Main Body: Right, Wing: Up)
function createLStoreyShape() {
    const shape = new THREE.Shape();
    // Start from outer turn corner
    shape.moveTo(-15, -10);
    // Eastwards (Body)
    shape.lineTo(85, -10);
    shape.lineTo(85, 10);
    shape.lineTo(10, 10);
    // Northwards (Wing)
    shape.lineTo(10, 75);
    shape.lineTo(-15, 75);
    // Back to turn
    shape.lineTo(-15, -10);
    return shape;
}

function updateFloorVisibility() {
    const isAllMode = currentFloorMode === 'all';
    const targetFloor = parseInt(currentFloorMode);

    // 1. Manage 3D Floor Visibility
    floors.forEach(group => {
        const floor = group.userData.floor;
        if (isAllMode) {
            group.visible = true;
            fadeGroup(group, 0.4);
        } else {
            const isTarget = (floor === targetFloor);
            group.visible = isTarget;
            if (isTarget) {
                fadeGroup(group, 1);
                controls.target.set(30, (floor - 1) * FLOOR_HEIGHT, 25);
                controls.update();
            }
        }
    });

    // 2. Manage 2D Label Visibility (Using Three.js visible property)
    roomLabels.forEach(item => {
        if (isAllMode) {
            item.label.visible = false;
        } else {
            item.label.visible = (item.floor === targetFloor);
        }
    });
}

function fadeGroup(group, opacity) {
    group.traverse(child => {
        if (child.material && child.material.transparent) {
            child.material.opacity = opacity;
        }
    });
}

function showRoomInfo(room) {
    const panel = document.getElementById('room-info-panel');
    document.getElementById('room-title').textContent = room.room;
    document.getElementById('room-desc').textContent = room.name;
    panel.style.display = 'block';
    
    document.querySelectorAll('.room-label').forEach(el => {
        el.classList.remove('active');
        if (el.textContent.includes(room.room)) el.classList.add('active');
    });
}

function onWindowResize() {
    const container = document.getElementById('map-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
}
