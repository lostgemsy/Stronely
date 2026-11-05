import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import { Octree } from 'three/addons/math/Octree.js';
import { createAccount, logOut, signInWithUsername, watchSession } from './auth.js';
import { connectRoom } from './network.js';

const $ = (selector) => document.querySelector(selector);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080808);
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.1, 2000);
scene.add(camera);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x676767, 2.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(-90, 170, 65);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -180;
sun.shadow.camera.right = 180;
sun.shadow.camera.top = 180;
sun.shadow.camera.bottom = -180;
scene.add(sun);

const controls = new PointerLockControls(camera, renderer.domElement);
const loader = new GLTFLoader();
const remotes = new Map();
const keys = new Set();
const clock = new THREE.Clock();
const velocity = new THREE.Vector3();
const moveDirection = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const bounds = new THREE.Box3();
let cityOctree = null;
let playerCollider = null;
let spawnFloor = new THREE.Vector3();
let network = null;
let activeUid = null;
let authMode = 'signin';
let sendTimer = 0;
let isGrounded = false;

const cityReady = loader.loadAsync('/assets/city/scene.gltf').then(({ scene: city }) => {
  city.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.side = THREE.DoubleSide;
      }
    }
  });
  city.updateMatrixWorld(true);
  scene.add(city);
  bounds.setFromObject(city);
  scene.fog = new THREE.Fog(0x080808, bounds.getSize(new THREE.Vector3()).length() * 0.65, bounds.getSize(new THREE.Vector3()).length() * 1.6);
  cityOctree = new Octree().fromGraphNode(city);
  chooseSpawn(city);
  return city;
}).catch((error) => {
  console.error('Could not load city scene', error);
  $('#auth-error').textContent = 'The city model did not load. Check that the asset files are in assets/city.';
  throw error;
});

function chooseSpawn(city) {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const raycaster = new THREE.Raycaster();
  raycaster.far = size.y + 100;
  const groundCeiling = bounds.min.y + Math.min(12, size.y * 0.28);
  const candidates = [[center.x, center.z]];
  for (let ring = 1; ring <= 6; ring++) {
    const radius = ring * Math.min(size.x, size.z) * 0.035;
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 + ring * 0.17;
      candidates.push([center.x + Math.cos(angle) * radius, center.z + Math.sin(angle) * radius]);
    }
  }
  const normalMatrix = new THREE.Matrix3();
  for (const [x, z] of candidates) {
    if (x < bounds.min.x || x > bounds.max.x || z < bounds.min.z || z > bounds.max.z) continue;
    raycaster.set(new THREE.Vector3(x, bounds.max.y + 5, z), new THREE.Vector3(0, -1, 0));
    const hits = raycaster.intersectObject(city, true);
    for (const hit of hits) {
      if (hit.point.y > groundCeiling || !hit.face) continue;
      const normal = hit.face.normal.clone().applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld));
      if (normal.y < 0.78) continue;
      const floor = hit.point.y + 0.05;
      const candidate = new Capsule(
        new THREE.Vector3(x, floor + 0.34, z),
        new THREE.Vector3(x, floor + 1.31, z),
        0.34,
      );
      const overlap = cityOctree.capsuleIntersect(candidate);
      if (overlap && overlap.normal.y < 0.55 && overlap.depth > 0.025) continue;
      if (overlap) candidate.translate(overlap.normal.multiplyScalar(overlap.depth + 0.015));
      playerCollider = candidate;
      spawnFloor.set(x, floor, z);
      camera.position.set(x, floor + 1.66, z);
      return;
    }
  }
  const x = center.x;
  const z = center.z;
  const floor = bounds.min.y + 0.1;
  spawnFloor.set(x, floor, z);
  playerCollider = new Capsule(new THREE.Vector3(x, floor + 0.34, z), new THREE.Vector3(x, floor + 1.31, z), 0.34);
  camera.position.set(x, floor + 1.66, z);
}

loader.load('/assets/weapons/tommy_gun.glb', ({ scene: gun }) => {
  gun.position.set(0.34, -0.32, -0.62);
  gun.rotation.set(0, Math.PI, 0);
  gun.scale.setScalar(0.22);
  gun.traverse((object) => { if (object.isMesh) { object.frustumCulled = false; object.renderOrder = 2; } });
  camera.add(gun);
}, undefined, (error) => console.error('Could not load Tommy gun model', error));

function updateRemotePlayers(players) {
  for (const [id, data] of Object.entries(players)) {
    if (id === activeUid || !Number.isFinite(data.x) || !Number.isFinite(data.z)) continue;
    let avatar = remotes.get(id);
    if (!avatar) {
      avatar = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.34, 0.96, 5, 10),
        new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.8 }),
      );
      avatar.castShadow = true;
      scene.add(avatar);
      remotes.set(id, avatar);
    }
    avatar.position.set(data.x, Number.isFinite(data.y) ? data.y + 0.83 : 0.83, data.z);
    avatar.rotation.y = data.yaw || 0;
  }
  for (const [id, avatar] of remotes) {
    if (!(id in players)) {
      scene.remove(avatar);
      avatar.geometry.dispose();
      avatar.material.dispose();
      remotes.delete(id);
    }
  }
}

function showChat(messages) {
  const list = $('#chat-messages');
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 36;
  list.replaceChildren();
  for (const message of messages) {
    const row = document.createElement('div');
    row.className = 'chat-message';
    const name = document.createElement('strong');
    name.textContent = `${message.username || 'Player'} `;
    const text = document.createElement('span');
    text.textContent = message.text || '';
    row.append(name, text);
    list.append(row);
  }
  if (nearBottom) list.scrollTop = list.scrollHeight;
}

async function enterGame(user) {
  if (activeUid === user.uid) return;
  await cityReady;
  if (activeUid === user.uid) return;
  activeUid = user.uid;
  $('#auth-overlay').classList.add('hidden');
  $('#game-hud').classList.remove('hidden');
  $('#status').textContent = `Signed in as ${user.displayName || 'Player'} · connecting…`;
  $('#room-label').textContent = new URLSearchParams(location.search).get('room') || 'lobby';
  try {
    network = await connectRoom(user, {
      players: updateRemotePlayers,
      chat: showChat,
      error: (error) => { console.error('Room connection error', error); $('#status').textContent = 'Connection issue · check Firebase setup'; },
    });
    if (activeUid === user.uid) $('#status').textContent = `ROOM ${network.roomId.toUpperCase()} · ${user.displayName || 'PLAYER'}`;
  } catch (error) {
    console.error('Could not join room', error);
    $('#status').textContent = 'Could not join room · publish database.rules.json in Firebase';
  }
}

watchSession((user) => {
  if (user) {
    enterGame(user).catch((error) => console.error(error));
  } else {
    activeUid = null;
    if (network) { network.disconnect(); network = null; }
    $('#game-hud').classList.add('hidden');
    $('#auth-overlay').classList.remove('hidden');
    $('#auth-error').textContent = '';
    $('#password').value = '';
  }
});

$('#auth-room').textContent = new URLSearchParams(location.search).get('room') || 'lobby';
for (const tab of document.querySelectorAll('.auth-tab')) {
  tab.addEventListener('click', () => {
    authMode = tab.dataset.mode;
    document.querySelectorAll('.auth-tab').forEach((button) => button.classList.toggle('active', button === tab));
    $('#auth-submit').textContent = authMode === 'signup' ? 'Create account' : 'Sign in';
    $('#password').autocomplete = authMode === 'signup' ? 'new-password' : 'current-password';
    $('#auth-error').textContent = '';
  });
}

$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#auth-submit');
  button.disabled = true;
  $('#auth-error').textContent = authMode === 'signup' ? 'Creating account…' : 'Signing in…';
  try {
    if (authMode === 'signup') await createAccount($('#username').value, $('#password').value);
    else await signInWithUsername($('#username').value, $('#password').value);
    $('#auth-error').textContent = '';
  } catch (error) {
    const messages = {
      'auth/email-already-in-use': 'That username already has an account. Sign in or choose another username.',
      'auth/invalid-credential': 'Username or password is incorrect.',
      'auth/weak-password': 'Use a password with at least 6 characters.',
      'auth/operation-not-allowed': 'Enable Email/Password sign-in in Firebase Authentication settings.',
      'auth/network-request-failed': 'Could not reach Firebase. Check your internet connection.',
    };
    $('#auth-error').textContent = messages[error.code] || error.message || 'Could not sign in. Check your Firebase setup.';
  } finally {
    button.disabled = false;
  }
});

$('#logout').addEventListener('click', async () => {
  controls.unlock();
  await logOut();
});

renderer.domElement.addEventListener('click', () => {
  if (activeUid && !controls.isLocked && !document.activeElement.matches('input')) controls.lock();
});
$('#play-hint').addEventListener('click', () => { if (activeUid) controls.lock(); });

$('#chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text || !network) return;
  input.disabled = true;
  try {
    await network.sendChat(text);
    input.value = '';
  } catch (error) {
    console.error('Could not send chat message', error);
    $('#status').textContent = 'Chat send failed · check Firebase rules';
  } finally {
    input.disabled = false;
    input.focus();
  }
});

addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  keys.add(event.code);
  if (event.code === 'Space') event.preventDefault();
});
addEventListener('keyup', (event) => keys.delete(event.code));
addEventListener('blur', () => keys.clear());

function movePlayer(dt) {
  if (!playerCollider || !cityOctree) return;
  if (!controls.isLocked) {
    velocity.set(0, 0, 0);
    camera.position.set(playerCollider.end.x, playerCollider.end.y + 0.35, playerCollider.end.z);
    return;
  }
  {
    moveDirection.set(Number(keys.has('KeyD')) - Number(keys.has('KeyA')), 0, Number(keys.has('KeyW')) - Number(keys.has('KeyS')));
    if (moveDirection.lengthSq() > 0) {
      moveDirection.normalize();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.crossVectors(forward, up).normalize();
      const wish = new THREE.Vector3().addScaledVector(right, moveDirection.x).addScaledVector(forward, moveDirection.z).normalize();
      const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 9 : 6;
      velocity.x = wish.x * speed;
      velocity.z = wish.z * speed;
    } else {
      velocity.x = 0;
      velocity.z = 0;
    }
    if (keys.has('Space') && isGrounded) {
      velocity.y = 7.2;
      isGrounded = false;
    }
  }
  velocity.y -= 19.6 * dt;
  playerCollider.translate(velocity.clone().multiplyScalar(dt));
  isGrounded = false;
  for (let i = 0; i < 4; i++) {
    const contact = cityOctree.capsuleIntersect(playerCollider);
    if (!contact) break;
    playerCollider.translate(contact.normal.clone().multiplyScalar(contact.depth + 0.001));
    if (contact.normal.y > 0.55) {
      isGrounded = true;
      if (velocity.y < 0) velocity.y = 0;
    } else if (contact.normal.y < -0.55 && velocity.y > 0) {
      velocity.y = 0;
    } else {
      const intoWall = velocity.dot(contact.normal);
      if (intoWall < 0) velocity.addScaledVector(contact.normal, -intoWall);
    }
  }
  const radius = playerCollider.radius;
  playerCollider.start.x = THREE.MathUtils.clamp(playerCollider.start.x, bounds.min.x + radius, bounds.max.x - radius);
  playerCollider.start.z = THREE.MathUtils.clamp(playerCollider.start.z, bounds.min.z + radius, bounds.max.z - radius);
  playerCollider.end.x = THREE.MathUtils.clamp(playerCollider.end.x, bounds.min.x + radius, bounds.max.x - radius);
  playerCollider.end.z = THREE.MathUtils.clamp(playerCollider.end.z, bounds.min.z + radius, bounds.max.z - radius);
  if (playerCollider.end.y < bounds.min.y - 20) {
    playerCollider.translate(spawnFloor.clone().sub(new THREE.Vector3(playerCollider.start.x, playerCollider.start.y - radius, playerCollider.start.z)));
    velocity.set(0, 0, 0);
  }
  camera.position.set(playerCollider.end.x, playerCollider.end.y + 0.35, playerCollider.end.z);
  if (network && controls.isLocked && (sendTimer += dt) >= 0.1) {
    sendTimer = 0;
    network.publish({ x: camera.position.x, y: camera.position.y - 1.66, z: camera.position.z, yaw: camera.rotation.y });
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (activeUid) {
    movePlayer(dt);
  } else if (bounds.isEmpty() === false) {
    const target = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) * 0.72;
    const angle = performance.now() * 0.000045;
    camera.position.set(target.x + Math.cos(angle) * radius, target.y + size.y * 0.6 + radius * 0.22, target.z + Math.sin(angle) * radius);
    camera.lookAt(target.x, target.y + size.y * 0.12, target.z);
  }
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
addEventListener('beforeunload', () => network?.disconnect());


