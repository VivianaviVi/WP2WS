let params = {
  fps: 0,
  density: 0.7,
  particleCount: 40,
  walkSpeed: 150,
  runMultiplier: 1.75,
  lookSensitivity: 0.002,
  offPathResponse: 0.8,
};

const ARM = 920;
const PATH_WIDTH = 190;
const EYE_HEIGHT = 96;
const PLAYER_RADIUS = 28;

const CANDY = [0xffb7ce, 0xc9f5df, 0xb7dcff, 0xe4d4ff, 0xffe29a, 0xffc7a8, 0xff9eb8];

let blocks = [];
let colliders = [];
let pathSegments = [];
let pathGuides = [];
let escapeStrikes = 0;
let boundaryHeld = false;
let pointerDragged = false;
let secrets = [];
let core = null;
let ring = [];
let debris = [];
let shatterTime = -1;
let centerSpin = 0;
let markReady = false;
let stuckTime = 0;
const lastStuckPos = new THREE.Vector3();
const lastMark = new THREE.Vector3();

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const keys = { w: false, a: false, s: false, d: false, shift: false };
const lookForward = new THREE.Vector3();
const lookRight = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);

function candyColor() {
  return CANDY[floor(random(CANDY.length))];
}

function setupThree() {
  randomSeed(1909);
  noiseSeed(1909);

  scene.background = new THREE.Color(0xfff4f8);
  scene.fog = null;

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = Math.PI / 2 + 0.2;

  createPathVisuals();
  rebuildSpace();
  resetPlayer();
  setupGUI();
  setupInteractionEvents();
}

function updateThree() {
  const step = Math.min(delta > 0 ? delta : 0.016, 0.05);
  updateMovement(step);
  updateStuck(step);
  holdLook();
  updateCenter(step);
  updateHidden(step);
  updateSway(step);
  updateSkyBars(step);
  updateField();

  for (let b of blocks) {
    if (b.drifts) {
      b.updatePosition();
      b.updateRotation();
      b.wrapInSpace();
    }
  }
}

function createPathVisuals() {
  const floorMat = new THREE.MeshBasicMaterial({ color: 0xffe4ef });
  const pathMat = new THREE.MeshBasicMaterial({
    color: 0xfff3c4,
    side: THREE.DoubleSide,
  });

  addFixedBox(0, -2, 0, ARM * 2.3, 4, ARM * 2.3, floorMat);
  pathSegments = [];
  pathGuides = [];

  const main = layPath([
    [0, 1020],
    [-4, 820],
    [14, 640],
    [40, 460],
    [62, 280],
    [48, 100],
    [14, -80],
    [-18, -260],
    [-40, -460],
    [-32, -660],
    [-8, -860],
    [0, -1040],
  ], pathMat, 2);

  layBranch(main, [-40, -460], [
    [-70, -580],
    [-100, -740],
    [-112, -920],
  ], pathMat, 2.2);
}

function layBranch(samples, anchor, rest, pathMat, y) {
  let start = samples[0];
  let best = Infinity;
  for (const point of samples) {
    const distance = (point.x - anchor[0]) ** 2 + (point.z - anchor[1]) ** 2;
    if (distance < best) {
      best = distance;
      start = point;
    }
  }
  layPath([[start.x, start.z], ...rest], pathMat, y);
}

function layPath(points, pathMat, y) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    "centripetal",
    0.5
  );
  const sampled = curve.getSpacedPoints(Math.max(points.length * 36, 100));
  const positions = [];
  const indices = [];

  for (let i = 0; i < sampled.length; i++) {
    const prev = sampled[Math.max(0, i - 3)];
    const next = sampled[Math.min(sampled.length - 1, i + 3)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const length = Math.hypot(tx, tz) || 1;
    tx /= length;
    tz /= length;
    const px = -tz;
    const pz = tx;
    const along = i / Math.max(1, sampled.length - 1);
    const half = (PATH_WIDTH / 2) * (0.98 + 0.03 * Math.sin(along * Math.PI * 2));
    const point = sampled[i];
    positions.push(point.x + px * half, y, point.z + pz * half);
    positions.push(point.x - px * half, y, point.z - pz * half);

    if (i < sampled.length - 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      const nextPoint = sampled[i + 1];
      pathSegments.push({ ax: point.x, az: point.z, bx: nextPoint.x, bz: nextPoint.z, half });
      if (i % 5 === 0) {
        pathGuides.push({
          x: (point.x + nextPoint.x) / 2,
          z: (point.z + nextPoint.z) / 2,
          px,
          pz,
        });
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  scene.add(new THREE.Mesh(geometry, pathMat));
  return sampled;
}

function addFixedBox(x, y, z, w, h, d, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

function rebuildSpace() {
  clearBlocks();
  colliders = [];
  secrets = [];
  core = null;
  ring = [];
  debris = [];
  shatterTime = -1;
  centerSpin = 0;
  markReady = false;
  randomSeed(1909);

  buildPathPillars();
  buildOuterField();
  buildCenter();
  buildHidden();
  buildSky();
}

function buildPathPillars() {
  const placed = [];
  for (let i = 0; i < pathGuides.length; i += 9) {
    const guide = pathGuides[i];
    if (guide.x * guide.x + guide.z * guide.z < 180 * 180) continue;
    const side = noise(guide.x * 0.01, guide.z * 0.01) > 0.5 ? 1 : -1;
    const reach = PATH_WIDTH / 2 + 150;
    const x = guide.x + guide.px * reach * side;
    const z = guide.z + guide.pz * reach * side;
    if (nearPath(x, z, PATH_WIDTH / 2 + 40)) continue;
    if ((x * x) + (z - 700) * (z - 700) < 160 * 160) continue;
    if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 380 * 380)) continue;
    placed.push({ x, z });
    pillar(x, z, random(130, 220));
  }
}

function buildOuterField() {
  const step = 210;
  for (let x = -ARM + 40; x <= ARM - 40; x += step) {
    for (let z = -ARM + 40; z <= ARM - 40; z += step) {
      if (nearPath(x, z, PATH_WIDTH / 2 + 90)) continue;
      if (x * x + z * z < 200 * 200) continue;
      const count = floor(map(params.density, 0, 1, 1, 4));
      for (let i = 0; i < count; i++) {
        const h = random(40, 170);
        const px = x + random(-70, 70);
        const pz = z + random(-70, 70);
        if (nearPath(px, pz, PATH_WIDTH / 2 + 70)) continue;
        const column = new Block()
          .setColor(candyColor())
          .setPosition(px, h / 2, pz)
          .setScale(random(10, 28), h, random(10, 36))
          .markSolid();
        column.pillar = true;
      }
    }
  }
}

function buildSky() {
  for (let i = 0; i < 34; i++) {
    const band = i % 3;
    const y = band === 0 ? random(190, 240) : band === 1 ? random(245, 300) : random(300, 360);
    skyBar(random(-ARM + 80, ARM - 80), y, random(-ARM + 80, ARM - 80));
  }

  for (let i = 0; i < params.particleCount; i++) {
    const band = i % 3;
    const y = band === 0 ? random(125, 170) : band === 1 ? random(180, 235) : random(250, 330);
    const size = band === 2 ? random(10, 16) : random(14, 26);
    const x = i < 6 ? random(-240, 240) : random(-ARM, ARM);
    const z = i < 6 ? random(160, 700) : random(-ARM, ARM);
    new Block()
      .setColor(candyColor())
      .setPosition(x, y, z)
      .setScale(size, size, size)
      .setVelocity(random(-0.035, 0.035), random(-0.012, 0.012), random(-0.035, 0.035))
      .setRotationVelocity(random(-0.005, 0.005), random(-0.005, 0.005), random(-0.004, 0.004))
      .enableDrift()
      .markSolid();
  }
}

function pillar(x, z, height) {
  const block = new Block()
    .setColor(candyColor())
    .setPosition(x, height / 2, z)
    .setScale(random(14, 26), height, random(18, 40))
    .markSolid();
  block.pillar = true;
  return block;
}

function skyBar(x, y, z) {
  const chunky = noise(x * 0.02, z * 0.02 + 4) > 0.62;
  const length = chunky ? random(80, 140) : random(150, 240);
  const thickness = chunky ? random(14, 26) : random(5, 10);
  const depth = chunky ? random(12, 22) : random(6, 12);
  const bar = new Block().setColor(candyColor()).setPosition(x, y, z);
  if (random() > 0.5) bar.setScale(length, thickness, depth);
  else bar.setScale(depth, thickness, length);
  bar.rot.y = random(-1.4, 1.4);
  bar.rot.z = random(-0.18, 0.18);
  bar.sky = true;
  bar.restPos = bar.pos.clone();
  bar.restRotY = bar.rot.y;
  bar.restRotZ = bar.rot.z;
  bar.gaze = 0;
  bar.phase = random(Math.PI * 2);
}

function buildCenter() {
  core = new Block()
    .setColor(0xffb7ce)
    .setPosition(0, 68, 0)
    .setScale(120, 120, 120)
    .markMonument();
  colliders.push(core);

  ring = [];
  const count = 16;
  const ringColors = [0xfff3c4, 0xc9f5df, 0xb7dcff, 0xffc7a8];
  for (let i = 0; i < count; i++) {
    const piece = new Block()
      .setColor(ringColors[i % ringColors.length])
      .setScale(12, 12, 12);
    piece.ring = true;
    piece.angle = (i / count) * Math.PI * 2;
    piece.orbit = 100;
    piece.orbitY = 68;
    ring.push(piece);
  }
}

function buildHidden() {
  const spots = [
    [-260, 56, 500],
    [300, 64, 260],
    [-240, 52, -20],
    [260, 70, -300],
    [-320, 48, 160],
  ];
  for (const [x, y, z] of spots) addSecret(x, y, z);
}

function addSecret(x, y, z) {
  const specs = [
    [0, 34, 0, 78, 4, 4],
    [0, -34, 0, 78, 4, 4],
    [-37, 0, 0, 4, 72, 4],
    [37, 0, 0, 4, 72, 4],
    [0, 0, 0, 4, 46, 4],
  ];
  const pieces = [];
  for (const [ox, oy, oz, w, h, d] of specs) {
    const block = new Block()
      .setColor(0xe4d4ff)
      .setPosition(x + ox, y + oy, z + oz)
      .setScale(w, h, d);
    block.mesh.material.transparent = true;
    block.mesh.material.opacity = 0;
    block.secret = true;
    pieces.push(block);
  }
  secrets.push({
    pieces,
    anchor: new THREE.Vector3(x, y, z),
    flash: 0,
    gone: false,
  });
}

function clearBlocks() {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    scene.remove(block.mesh);
    block.mesh.geometry.dispose();
    block.mesh.material.dispose();
  }
  blocks = [];
}

function setupGUI() {
  pane.addBinding(params, "density", {
    label: "Density",
    min: 0.2,
    max: 1,
    step: 0.05,
  }).on("change", () => rebuildSpace());

  pane.addBinding(params, "particleCount", {
    label: "Sky cubes",
    min: 0,
    max: 64,
    step: 1,
  }).on("change", () => rebuildSpace());

  const movement = pane.addFolder({ title: "Human movement" });
  movement.addBinding(params, "walkSpeed", { label: "Walk", min: 40, max: 280, step: 5 });
  movement.addBinding(params, "runMultiplier", { label: "Shift speed", min: 1, max: 2.6, step: 0.05 });
  movement.addBinding(params, "lookSensitivity", { label: "Look", min: 0.0008, max: 0.004, step: 0.0001 })
    .on("change", () => {
      controls.rotateSpeed = params.lookSensitivity * 400;
    });

  const interaction = pane.addFolder({ title: "Interaction" });
  interaction.addBinding(params, "offPathResponse", { label: "Warning", min: 0, max: 1, step: 0.01 });
  pane.addButton({ title: "Reset position" }).on("click", resetPlayer);
  pane.addButton({ title: "Rebuild space" }).on("click", () => rebuildSpace());
}

function setupInteractionEvents() {
  controls.rotateSpeed = params.lookSensitivity * 400;

  window.addEventListener("mousemove", function (event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = map(event.clientY / window.innerHeight, 0, 1, 1, -1);
    if (event.buttons) pointerDragged = true;
  });

  window.addEventListener("mousedown", function () {
    pointerDragged = false;
  });

  window.addEventListener("click", function (event) {
    if (event.target.closest && event.target.closest(".tp-dfwv")) return;
    if (pointerDragged) return;
    recolorFromPointer();
  });

  window.addEventListener("keydown", function (event) {
    if (event.code === "KeyP" && !event.repeat) {
      document.body.classList.toggle("hide-controls");
    }
    if (isTyping()) return;
    setKey(event.code, true);
  });

  window.addEventListener("keyup", function (event) {
    setKey(event.code, false);
  });

  window.addEventListener("blur", function () {
    keys.w = keys.a = keys.s = keys.d = keys.shift = false;
  });
}

function isTyping() {
  const tag = document.activeElement && document.activeElement.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

function setKey(code, pressed) {
  if (code === "KeyW") keys.w = pressed;
  else if (code === "KeyA") keys.a = pressed;
  else if (code === "KeyS") keys.s = pressed;
  else if (code === "KeyD") keys.d = pressed;
  else if (code === "ShiftLeft" || code === "ShiftRight") keys.shift = pressed;
}

function recolorFromPointer() {
  const meshes = [];
  for (const block of blocks) {
    if (block.secret && block.gone) continue;
    meshes.push(block.mesh);
  }
  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (!hit) return;
  const block = hit.object.userData.block;
  if (!block || block.gone) return;
  if (block.secret) {
    const secret = secrets.find((item) => item.pieces.includes(block));
    if (secret && !secret.gone && secret.flash <= 0) secret.flash = 1;
    return;
  }
  if (block === core) {
    if (shatterTime < 0) {
      shatterTime = 0;
      centerSpin = 0.8;
    }
    return;
  }
  block.setColor(candyColor());
}

function resetPlayer() {
  camera.position.set(0, EYE_HEIGHT, 700);
  controls.target.set(0, EYE_HEIGHT - 8, 520);
  escapeStrikes = 0;
  boundaryHeld = false;
  stuckTime = 0;
  lastStuckPos.copy(camera.position);
  controls.update();
}

function updateStuck(step) {
  const trying = keys.w || keys.a || keys.s || keys.d;
  const moved = camera.position.distanceTo(lastStuckPos);
  lastStuckPos.copy(camera.position);
  if (trying && moved < 0.4) stuckTime += step;
  else stuckTime = 0;
  const lost = document.getElementById("lost");
  if (lost) lost.style.opacity = stuckTime > 2.6 ? "1" : "0";
}

function updateMovement(step) {
  camera.getWorldDirection(lookForward);
  lookForward.y = 0;
  if (lookForward.lengthSq() < 0.0001) lookForward.set(0, 0, -1);
  lookForward.normalize();
  lookRight.crossVectors(lookForward, worldUp).normalize();

  const forwardInput = Number(keys.w) - Number(keys.s);
  const sideInput = Number(keys.d) - Number(keys.a);
  const inputLength = Math.hypot(forwardInput, sideInput);
  if (inputLength === 0) return;

  const speed = params.walkSpeed * (keys.shift ? params.runMultiplier : 1);
  const scale = speed * step / inputLength;
  tryMove(
    (lookForward.x * forwardInput + lookRight.x * sideInput) * scale,
    (lookForward.z * forwardInput + lookRight.z * sideInput) * scale
  );
}

function tryMove(moveX, moveZ) {
  const boundary = ARM - 40;
  const oldX = camera.position.x;
  const oldZ = camera.position.z;
  let nextX = THREE.MathUtils.clamp(oldX + moveX, -boundary, boundary);
  let nextZ = THREE.MathUtils.clamp(oldZ + moveZ, -boundary, boundary);
  if (collides(nextX, nextZ)) {
    const allowX = !collides(nextX, oldZ);
    const allowZ = !collides(oldX, nextZ);
    nextX = allowX ? nextX : oldX;
    nextZ = allowZ ? nextZ : oldZ;
    if (collides(nextX, nextZ)) {
      nextX = oldX;
      nextZ = oldZ;
    }
  }

  const leaving = !isOnPath(nextX, nextZ);
  if (leaving && escapeStrikes < 3) {
    if (!boundaryHeld) {
      boundaryHeld = true;
      escapeStrikes += 1;
    }
    if (escapeStrikes < 3) {
      stayOnPath(nextX, nextZ, oldX, oldZ);
      return;
    }
    boundaryHeld = false;
  } else if (!leaving) {
    boundaryHeld = false;
  }

  placePlayer(nextX, nextZ, oldX, oldZ);
  leaveTrace(nextX, nextZ, oldX, oldZ);
}

function stayOnPath(nextX, nextZ, oldX, oldZ) {
  let x = oldX;
  let z = oldZ;
  if (isOnPath(nextX, oldZ) && !collides(nextX, oldZ)) x = nextX;
  if (isOnPath(x, nextZ) && !collides(x, nextZ)) z = nextZ;
  placePlayer(x, z, oldX, oldZ);
  leaveTrace(x, z, oldX, oldZ);
}

function placePlayer(nextX, nextZ, oldX, oldZ) {
  camera.position.x = nextX;
  camera.position.z = nextZ;
  camera.position.y = EYE_HEIGHT;
  controls.target.x += nextX - oldX;
  controls.target.z += nextZ - oldZ;
}

function holdLook() {
  const x = camera.position.x;
  const y = EYE_HEIGHT;
  const z = camera.position.z;
  controls.rotateSpeed = params.lookSensitivity * 400;
  controls.update();
  controls.target.x -= camera.position.x - x;
  controls.target.y -= camera.position.y - y;
  controls.target.z -= camera.position.z - z;
  camera.position.set(x, y, z);
}

function collides(x, z) {
  for (const block of colliders) {
    const dx = x - block.pos.x;
    const dz = z - block.pos.z;
    const radius = Math.max(block.scale.x, block.scale.z) * 0.5 + PLAYER_RADIUS;
    if (dx * dx + dz * dz >= radius * radius) continue;
    const halfH = block.scale.y * 0.5;
    const bottom = block.pos.y - halfH;
    const top = block.pos.y + halfH;
    if (bottom > EYE_HEIGHT || top < 0) continue;
    return true;
  }
  return false;
}

function segmentDistance(x, z, segment) {
  const dx = segment.bx - segment.ax;
  const dz = segment.bz - segment.az;
  const len2 = dx * dx + dz * dz;
  if (len2 < 0.001) return Math.hypot(x - segment.ax, z - segment.az);
  const t = Math.max(0, Math.min(1, ((x - segment.ax) * dx + (z - segment.az) * dz) / len2));
  return Math.hypot(x - (segment.ax + dx * t), z - (segment.az + dz * t));
}

function nearPath(x, z, margin) {
  for (const segment of pathSegments) {
    if (segmentDistance(x, z, segment) < margin) return true;
  }
  return false;
}

function isOnPath(x, z) {
  return pathExcess(x, z) < 14;
}

function updateCenter(step) {
  if (core) {
    if (shatterTime >= 0) {
      shatterTime += step;
      centerSpin += step * 7;
      if (shatterTime >= 2.5) shatterCore();
    }
    if (core && centerSpin > 0) {
      core.rot.x = 0;
      core.rot.z = 0;
      core.rot.y += centerSpin * step;
    }
  }

  const orbitBoost = shatterTime > 0 ? 1 + shatterTime * 2.2 : 1;
  for (const piece of ring) {
    piece.angle += step * 0.45 * orbitBoost;
    piece.pos.set(
      Math.cos(piece.angle) * piece.orbit,
      piece.orbitY,
      Math.sin(piece.angle) * piece.orbit
    );
    piece.rot.x = 0;
    piece.rot.z = 0;
    piece.rot.y += step * 0.8;
  }

  for (const piece of debris) {
    piece.vel.y -= 26 * step;
    piece.vel.multiplyScalar(Math.max(0, 1 - step * 0.45));
    piece.pos.addScaledVector(piece.vel, step);
    const floorY = piece.scale.y * 0.5;
    if (piece.pos.y < floorY) {
      piece.pos.y = floorY;
      piece.vel.y = 0;
      piece.vel.x *= 0.72;
      piece.vel.z *= 0.72;
    }
    piece.rot.x += piece.rotVel.x * step;
    piece.rot.y += piece.rotVel.y * step;
    piece.rot.z += piece.rotVel.z * step;
  }
}

function shatterCore() {
  const origin = core.pos.clone();
  removeBlock(core);
  core = null;
  shatterTime = -1;
  for (const piece of ring) {
    piece.ring = false;
    piece.debris = true;
    piece.vel = new THREE.Vector3(piece.pos.x, random(20, 70), piece.pos.z);
    piece.vel.normalize().multiplyScalar(random(50, 110));
    piece.rotVel.set(random(-4, 4), random(-4, 4), random(-4, 4));
    debris.push(piece);
  }
  ring = [];
  for (let i = 0; i < 32; i++) {
    const size = random(6, 15);
    const block = new Block()
      .setColor(candyColor())
      .setPosition(origin.x + random(-10, 10), origin.y + random(-16, 16), origin.z + random(-10, 10))
      .setScale(size, size, size);
    block.debris = true;
    block.vel = new THREE.Vector3(random(-1, 1), random(0.15, 1.3), random(-1, 1));
    block.vel.normalize().multiplyScalar(random(60, 140));
    block.rotVel = new THREE.Vector3(random(-5, 5), random(-5, 5), random(-5, 5));
    colliders.push(block);
    debris.push(block);
  }
}

function removeBlock(block) {
  scene.remove(block.mesh);
  block.mesh.geometry.dispose();
  block.mesh.material.dispose();
  const blockIndex = blocks.indexOf(block);
  if (blockIndex >= 0) blocks.splice(blockIndex, 1);
  const colliderIndex = colliders.indexOf(block);
  if (colliderIndex >= 0) colliders.splice(colliderIndex, 1);
}

function updateHidden(step) {
  camera.getWorldDirection(lookForward);
  for (const secret of secrets) {
    if (secret.gone) continue;
    if (secret.flash > 0) {
      secret.flash -= step;
      const opacity = secret.flash > 0.35 ? 1 : Math.max(0, secret.flash / 0.35);
      for (const block of secret.pieces) block.mesh.material.opacity = opacity;
      if (secret.flash <= 0) {
        secret.gone = true;
        for (const block of secret.pieces) {
          block.gone = true;
          block.mesh.material.opacity = 0;
        }
      }
      continue;
    }
    const toX = secret.anchor.x - camera.position.x;
    const toY = secret.anchor.y - camera.position.y;
    const toZ = secret.anchor.z - camera.position.z;
    const dist = Math.hypot(toX, toY, toZ) || 1;
    const dot = (lookForward.x * toX + lookForward.y * toY + lookForward.z * toZ) / dist;
    const facing = Math.max(0, (dot - 0.45) / 0.5);
    const near = THREE.MathUtils.clamp(map(dist, 90, 460, 1, 0), 0, 1);
    const opacity = Math.max(near * 0.75, Math.min(1, near * (0.35 + facing)));
    for (const block of secret.pieces) block.mesh.material.opacity = opacity;
  }
}

function leaveTrace(x, z, oldX, oldZ) {
  const moved = Math.hypot(x - oldX, z - oldZ);
  if (moved < 0.4) return;
  if (!markReady) {
    lastMark.set(x, 0, z);
    markReady = true;
    return;
  }
  if (!isOnPath(x, z)) {
    lastMark.set(x, 0, z);
    return;
  }
  if (Math.hypot(x - lastMark.x, z - lastMark.z) < 78) return;
  const len = moved || 1;
  const fx = (x - oldX) / len;
  const fz = (z - oldZ) / len;
  sealBehind(x - fx * 110, z - fz * 110, fx, fz);
  lastMark.set(x, 0, z);
}

function sealBehind(x, z, fx, fz) {
  const px = -fz;
  const pz = fx;
  for (let row = 0; row < 2; row++) {
    for (let i = -2; i <= 2; i++) {
      const height = random(10, 16);
      const block = new Block()
        .setColor(candyColor())
        .setPosition(
          x - fx * row * 24 + px * i * 32,
          3 + height / 2,
          z - fz * row * 24 + pz * i * 32
        )
        .setScale(random(22, 34), height, random(18, 28))
        .markSolid();
      block.rot.y = random(-0.25, 0.25);
      block.seal = true;
    }
  }
}

function updateSway(step) {
  const excess = pathExcess(camera.position.x, camera.position.z);
  const away = excess > 0 ? Math.min(1, excess / 160) : 0;
  const amount = away * params.offPathResponse;
  for (const block of blocks) {
    if (!block.pillar) continue;
    block.sway = (block.sway || 0) + (amount - (block.sway || 0)) * Math.min(1, step * 2.2);
    const sway = block.sway;
    block.rot.z = Math.sin(frame * 0.07 + block.pos.x * 0.02) * sway * 0.75;
    block.rot.x = Math.cos(frame * 0.05 + block.pos.z * 0.02) * sway * 0.4;
  }
}

function updateSkyBars(step) {
  camera.getWorldDirection(lookForward);
  for (const block of blocks) {
    if (!block.sky) continue;
    const toX = block.restPos.x - camera.position.x;
    const toY = block.restPos.y - camera.position.y;
    const toZ = block.restPos.z - camera.position.z;
    const dist = Math.hypot(toX, toY, toZ) || 1;
    const facing = (lookForward.x * toX + lookForward.y * toY + lookForward.z * toZ) / dist;
    const looking = facing > 0.9 && dist < 780 ? 1 : 0;
    block.gaze += (looking - block.gaze) * Math.min(1, step * 1.8);
    const motion = block.gaze;
    const wave = Math.sin(frame * 0.04 + block.phase);
    block.pos.x = block.restPos.x + Math.cos(frame * 0.02 + block.phase) * 16 * motion;
    block.pos.y = block.restPos.y + wave * 22 * motion;
    block.pos.z = block.restPos.z + Math.sin(frame * 0.02 + block.phase) * 16 * motion;
    block.rot.y = block.restRotY + motion * wave * 0.45;
    block.rot.z = block.restRotZ + motion * wave * 0.3;
  }
}

function updateField() {
  const excess = pathExcess(camera.position.x, camera.position.z);
  let amount = 0;
  if (excess > 6) amount = Math.min(1, (excess - 6) / 180);
  if (boundaryHeld) amount = Math.max(amount, 0.62);
  amount *= params.offPathResponse;
  const rule = document.getElementById("rule");
  const flash = document.getElementById("flash");
  if (amount <= 0.02) {
    if (rule) rule.style.opacity = "0";
    if (flash) flash.style.opacity = "0";
    return;
  }
  const flicker = 0.2 + 0.8 * Math.abs(Math.sin(frame * (0.1 + amount * 0.42)));
  const strength = Math.min(1, amount * flicker);
  if (rule) {
    rule.style.opacity = String(Math.min(1, 0.25 + strength));
    rule.style.transform = `translateX(-50%) scale(${1 + amount * 0.22})`;
  }
  if (flash) flash.style.opacity = String(Math.min(0.62, strength * 0.7));
}

function pathExcess(x, z) {
  let best = Infinity;
  let half = PATH_WIDTH / 2;
  for (const segment of pathSegments) {
    const distance = segmentDistance(x, z, segment);
    if (distance < best) {
      best = distance;
      half = segment.half || half;
    }
  }
  return best - half;
}

function getBox(color = 0xffb7ce) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({ color });
  return new THREE.Mesh(geometry, material);
}

class Block {
  constructor() {
    this.mesh = getBox();
    this.mesh.userData.block = this;
    scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.vel = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.rot = this.mesh.rotation;
    this.rotVel = new THREE.Vector3();
    this.rotAcc = new THREE.Vector3();
    this.scale = this.mesh.scale;
    this.drifts = false;
    this.monument = false;
    this.solid = false;
    blocks.push(this);
  }
  setColor(hex) {
    this.mesh.material.color.setHex(hex);
    return this;
  }
  setPosition(x, y, z) {
    this.pos.set(x, y, z);
    return this;
  }
  setVelocity(x, y, z) {
    this.vel.set(x, y, z);
    return this;
  }
  setRotationVelocity(x, y, z) {
    this.rotVel.set(x, y, z);
    return this;
  }
  setScale(w, h = w, d = w) {
    this.scale.set(Math.max(w, 0.01), Math.max(h, 0.01), Math.max(d, 0.01));
    return this;
  }
  enableDrift() {
    this.drifts = true;
    return this;
  }
  markSolid() {
    this.solid = true;
    colliders.push(this);
    return this;
  }
  markMonument() {
    this.monument = true;
    return this;
  }
  updatePosition() {
    this.vel.add(this.acc);
    this.pos.add(this.vel);
    this.acc.set(0, 0, 0);
  }
  updateRotation() {
    this.rotVel.add(this.rotAcc);
    this.rot.x += this.rotVel.x;
    this.rot.y += this.rotVel.y;
    this.rot.z += this.rotVel.z;
    this.rotAcc.set(0, 0, 0);
  }
  wrapInSpace() {
    if (this.pos.x < -ARM) this.pos.x = ARM;
    if (this.pos.x > ARM) this.pos.x = -ARM;
    if (this.pos.z < -ARM) this.pos.z = ARM;
    if (this.pos.z > ARM) this.pos.z = -ARM;
    if (this.pos.y < 110) this.pos.y = 325;
    if (this.pos.y > 345) this.pos.y = 125;
  }
}
