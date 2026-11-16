console.log("three.js Version: " + THREE.REVISION);

let container, pane;
let scene, camera, renderer;
let controls;
const timer = new THREE.Timer();
let frame = 0;
let delta = 0;

function initThree() {
  scene = new THREE.Scene();

  const fov = 55;
  const aspectRatio = window.innerWidth / window.innerHeight;
  const near = 0.1;
  const far = 10000;
  camera = new THREE.PerspectiveCamera(fov, aspectRatio, near, far);
  camera.position.set(0, 96, 700);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0xfff4f8, 1);

  container = document.getElementById("container-three");
  container.appendChild(renderer.domElement);

  pane = new Pane();
  pane.addBinding(params, "fps", {
    label: "FPS",
    readonly: true,
    format: (value) => Number(value).toFixed(2),
  });
  pane.addBinding(params, "fps", {
    label: "FPS Graph",
    readonly: true,
    view: "graph",
    min: 0,
    max: 120,
  });
  pane.addBlade({ view: "separator" });

  setupThree();

  timer.connect(document);
  timer.reset();
  renderer.setAnimationLoop(animate);
}

function animate() {
  timer.update();
  delta = timer.getDelta();
  frame++;
  params.fps = delta > 0 ? 1 / delta : 0;

  updateThree();

  pane.refresh();

  renderer.render(scene, camera);
}

window.addEventListener("resize", function () {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
