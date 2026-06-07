/* Cube Tac Toe
 * A 3x3 Rubik's Cube fused with Tic-Tac-Toe.
 *
 * Each turn the active player:
 *   1. clicks an empty white sticker to place their mark (X = P1, O = P2), then
 *   2. makes exactly one standard cube move (a 90 degree layer turn).
 * Marks are children of their sticker, so they travel with the cube as it twists.
 * A player wins with 3 marks in a row on a single face -- checked only AFTER the
 * move animation completes, and only for the player who just moved.
 */
(function () {
  'use strict';

  // ----- Tunables ---------------------------------------------------------
  var SPACING = 1.0;          // distance between cubie centres
  var CUBIE_SIZE = 0.95;      // black body cube size
  var STICKER_OFFSET = 0.5;   // how far the white sticker sits from cubie centre
  var STICKER_SIZE = 0.86;
  var TURN_SPEED = Math.PI;   // radians per second for layer animation
  var CLICK_TOLERANCE = 6;    // px of pointer travel still counted as a "click"

  // ----- Game / turn state ------------------------------------------------
  var STATE = { PLACE: 'PLACE', MOVE: 'MOVE', ANIM: 'ANIM', OVER: 'OVER' };
  var state = STATE.PLACE;
  var currentPlayer = 'X';    // 'X' (player 1) or 'O' (player 2)

  // ----- Three.js objects -------------------------------------------------
  var scene, camera, renderer, controls, raycaster, pointer;
  var cubeRoot;               // holds all cubies (and the temporary pivot)
  var cubies = [];            // every small cube
  var stickers = [];          // every white facelet (Mesh) with userData.mark
  var xTexture, oTexture;
  var anim = null;            // active layer animation, or null
  var hovered = null;         // sticker currently highlighted

  // DOM
  var turnEl, turnPlayerEl, turnPhaseEl, movesButtons, resultEl, resultText;

  // ----- Move table: name -> {axis, value, dir} ---------------------------
  // axis: 'x'|'y'|'z'; value: which layer (-1|0|1); dir: +1|-1 rotation sign.
  var MOVES = {
    "U":  { axis: 'y', value:  1, dir: -1 },
    "U'": { axis: 'y', value:  1, dir:  1 },
    "D":  { axis: 'y', value: -1, dir:  1 },
    "D'": { axis: 'y', value: -1, dir: -1 },
    "R":  { axis: 'x', value:  1, dir: -1 },
    "R'": { axis: 'x', value:  1, dir:  1 },
    "L":  { axis: 'x', value: -1, dir:  1 },
    "L'": { axis: 'x', value: -1, dir: -1 },
    "F":  { axis: 'z', value:  1, dir: -1 },
    "F'": { axis: 'z', value:  1, dir:  1 },
    "B":  { axis: 'z', value: -1, dir:  1 },
    "B'": { axis: 'z', value: -1, dir: -1 }
  };

  // ======================================================================
  // Setup
  // ======================================================================
  function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e0f13);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(4.2, 4.0, 5.6);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('app').appendChild(renderer.domElement);

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    var key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(6, 9, 7);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-6, -3, -5);
    scene.add(fill);

    // Orbit controls -> drag anywhere to inspect all sides
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.minDistance = 5;
    controls.maxDistance = 14;
    controls.rotateSpeed = 0.9;

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();

    xTexture = makeMarkTexture('X', '#ff5470');
    oTexture = makeMarkTexture('O', '#41b6ff');

    cubeRoot = new THREE.Group();
    scene.add(cubeRoot);
    buildCube();

    cacheDom();
    wireEvents();
    updateHud();

    window.addEventListener('resize', onResize);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointermove', onPointerMove);

    animate();
  }

  // Build the 27 cubies and their outward white stickers.
  function buildCube() {
    var bodyMat = new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.55, metalness: 0.1 });
    var bodyGeo = new THREE.BoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE);
    var stickerGeo = new THREE.PlaneGeometry(STICKER_SIZE, STICKER_SIZE);

    for (var x = -1; x <= 1; x++) {
      for (var y = -1; y <= 1; y++) {
        for (var z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue; // hidden core
          var cubie = new THREE.Mesh(bodyGeo, bodyMat);
          cubie.position.set(x * SPACING, y * SPACING, z * SPACING);
          cubeRoot.add(cubie);
          cubies.push(cubie);

          if (x === 1)  addSticker(cubie, stickerGeo, 'px');
          if (x === -1) addSticker(cubie, stickerGeo, 'nx');
          if (y === 1)  addSticker(cubie, stickerGeo, 'py');
          if (y === -1) addSticker(cubie, stickerGeo, 'ny');
          if (z === 1)  addSticker(cubie, stickerGeo, 'pz');
          if (z === -1) addSticker(cubie, stickerGeo, 'nz');
        }
      }
    }
  }

  // Add one white sticker to a cubie, oriented so its +Z normal points outward.
  function addSticker(cubie, geo, face) {
    var mat = new THREE.MeshStandardMaterial({
      color: 0xf7f7f7, roughness: 0.4, metalness: 0.0,
      emissive: 0x000000
    });
    var s = new THREE.Mesh(geo, mat);
    var h = STICKER_OFFSET;
    switch (face) {
      case 'px': s.position.set(h, 0, 0);  s.rotation.y =  Math.PI / 2; break;
      case 'nx': s.position.set(-h, 0, 0); s.rotation.y = -Math.PI / 2; break;
      case 'py': s.position.set(0, h, 0);  s.rotation.x = -Math.PI / 2; break;
      case 'ny': s.position.set(0, -h, 0); s.rotation.x =  Math.PI / 2; break;
      case 'pz': s.position.set(0, 0, h);  break;
      case 'nz': s.position.set(0, 0, -h); s.rotation.y =  Math.PI; break;
    }
    s.userData.mark = null;
    cubie.add(s);
    stickers.push(s);
  }

  // Canvas texture for an X or O glyph on a transparent background.
  function makeMarkTexture(glyph, color) {
    var size = 256;
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 0.16;
    var m = size * 0.26; // margin
    if (glyph === 'X') {
      ctx.beginPath();
      ctx.moveTo(m, m); ctx.lineTo(size - m, size - m);
      ctx.moveTo(size - m, m); ctx.lineTo(m, size - m);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - m, 0, Math.PI * 2);
      ctx.stroke();
    }
    var tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  // ======================================================================
  // Placing marks
  // ======================================================================
  function placeMark(sticker) {
    sticker.userData.mark = currentPlayer;
    var mat = new THREE.MeshBasicMaterial({
      map: currentPlayer === 'X' ? xTexture : oTexture,
      transparent: true
    });
    var glyph = new THREE.Mesh(new THREE.PlaneGeometry(STICKER_SIZE * 0.92, STICKER_SIZE * 0.92), mat);
    glyph.position.set(0, 0, 0.02); // float just above the sticker face
    glyph.userData.isMark = true;
    sticker.add(glyph);
    clearHover();
  }

  // ======================================================================
  // Cube moves (layer rotation with animation + bake)
  // ======================================================================
  function doMove(name) {
    var def = MOVES[name];
    if (!def) return;

    var axisVec = new THREE.Vector3(
      def.axis === 'x' ? 1 : 0,
      def.axis === 'y' ? 1 : 0,
      def.axis === 'z' ? 1 : 0
    );

    var pivot = new THREE.Group();
    cubeRoot.add(pivot);

    var layer = [];
    for (var i = 0; i < cubies.length; i++) {
      var c = cubies[i];
      if (Math.round(c.position[def.axis] / SPACING) === def.value) {
        layer.push(c);
        pivot.attach(c); // preserves world transform
      }
    }

    anim = {
      pivot: pivot,
      axisVec: axisVec,
      layer: layer,
      target: def.dir * Math.PI / 2,
      current: 0
    };
    setState(STATE.ANIM);
  }

  function updateAnim(dt) {
    if (!anim) return;
    var step = TURN_SPEED * dt * (anim.target >= 0 ? 1 : -1);
    anim.current += step;
    var done = Math.abs(anim.current) >= Math.abs(anim.target);
    if (done) anim.current = anim.target;
    anim.pivot.setRotationFromAxisAngle(anim.axisVec, anim.current);
    if (done) finishMove();
  }

  function finishMove() {
    // Bake: return cubies to cubeRoot and snap to the integer grid.
    for (var i = 0; i < anim.layer.length; i++) {
      var c = anim.layer[i];
      cubeRoot.attach(c);
      c.position.set(
        Math.round(c.position.x / SPACING) * SPACING,
        Math.round(c.position.y / SPACING) * SPACING,
        Math.round(c.position.z / SPACING) * SPACING
      );
      snapQuaternion(c);
    }
    cubeRoot.remove(anim.pivot);
    anim = null;

    // Victory is checked only now, after the rotation completes.
    if (checkWin(currentPlayer)) {
      setState(STATE.OVER);
      showResult('Player ' + currentPlayer + ' wins!');
      return;
    }

    // Swap players; a full board with no winner is a draw.
    currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
    if (countEmpty() === 0) {
      setState(STATE.OVER);
      showResult("It's a draw!");
      return;
    }
    setState(STATE.PLACE);
  }

  // Round an object's rotation to the nearest axis-aligned 90 degree orientation.
  function snapQuaternion(obj) {
    var m = new THREE.Matrix4().makeRotationFromQuaternion(obj.quaternion);
    var e = m.elements;
    for (var i = 0; i < 16; i++) e[i] = Math.round(e[i]);
    obj.quaternion.setFromRotationMatrix(m);
  }

  // ======================================================================
  // Win / draw detection
  // ======================================================================
  // Map every sticker to (face, row, col) using its world position + outward
  // normal, build six 3x3 grids, then test all 8 lines per face.
  function checkWin(player) {
    var faces = {}; // faceId -> 3x3 grid of marks
    function grid() {
      return [[null, null, null], [null, null, null], [null, null, null]];
    }

    var cubieWorld = new THREE.Vector3();
    var stickerWorld = new THREE.Vector3();

    for (var i = 0; i < stickers.length; i++) {
      var s = stickers[i];
      s.getWorldPosition(stickerWorld);
      s.parent.getWorldPosition(cubieWorld);

      // Outward normal = direction from cubie centre to sticker.
      var nx = stickerWorld.x - cubieWorld.x;
      var ny = stickerWorld.y - cubieWorld.y;
      var nz = stickerWorld.z - cubieWorld.z;

      var faceId, a, b;
      var px = Math.round(cubieWorld.x / SPACING);
      var py = Math.round(cubieWorld.y / SPACING);
      var pz = Math.round(cubieWorld.z / SPACING);

      if (Math.abs(nx) > Math.abs(ny) && Math.abs(nx) > Math.abs(nz)) {
        faceId = nx > 0 ? 'px' : 'nx'; a = py; b = pz;
      } else if (Math.abs(ny) > Math.abs(nz)) {
        faceId = ny > 0 ? 'py' : 'ny'; a = px; b = pz;
      } else {
        faceId = nz > 0 ? 'pz' : 'nz'; a = px; b = py;
      }

      if (!faces[faceId]) faces[faceId] = grid();
      faces[faceId][a + 1][b + 1] = s.userData.mark;
    }

    for (var id in faces) {
      if (faces.hasOwnProperty(id) && faceHasLine(faces[id], player)) return true;
    }
    return false;
  }

  function faceHasLine(g, p) {
    for (var i = 0; i < 3; i++) {
      if (g[i][0] === p && g[i][1] === p && g[i][2] === p) return true; // row
      if (g[0][i] === p && g[1][i] === p && g[2][i] === p) return true; // col
    }
    if (g[0][0] === p && g[1][1] === p && g[2][2] === p) return true;   // diag
    if (g[0][2] === p && g[1][1] === p && g[2][0] === p) return true;   // anti-diag
    return false;
  }

  function countEmpty() {
    var n = 0;
    for (var i = 0; i < stickers.length; i++) if (!stickers[i].userData.mark) n++;
    return n;
  }

  // ======================================================================
  // Pointer interaction (click to place, drag to orbit)
  // ======================================================================
  var downX = 0, downY = 0;

  function onPointerDown(e) {
    downX = e.clientX;
    downY = e.clientY;
  }

  function onPointerUp(e) {
    var moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (moved > CLICK_TOLERANCE) return;     // it was an orbit drag
    if (state !== STATE.PLACE) return;       // not the placing phase
    var hit = pickSticker(e);
    if (hit && !hit.userData.mark) {
      placeMark(hit);
      setState(STATE.MOVE);
    }
  }

  function onPointerMove(e) {
    if (state !== STATE.PLACE) { clearHover(); return; }
    var hit = pickSticker(e);
    if (hit === hovered) return;
    clearHover();
    if (hit && !hit.userData.mark) {
      hovered = hit;
      hovered.material.emissive.setHex(0x2f6f3f);
    }
  }

  function clearHover() {
    if (hovered) {
      hovered.material.emissive.setHex(0x000000);
      hovered = null;
    }
  }

  function pickSticker(e) {
    var rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    var hits = raycaster.intersectObjects(stickers, false);
    return hits.length ? hits[0].object : null;
  }

  // ======================================================================
  // UI / state plumbing
  // ======================================================================
  function cacheDom() {
    turnEl = document.getElementById('turn');
    turnPlayerEl = document.getElementById('turn-player');
    turnPhaseEl = document.getElementById('turn-phase');
    resultEl = document.getElementById('result');
    resultText = document.getElementById('result-text');
    movesButtons = Array.prototype.slice.call(document.querySelectorAll('.move-btn'));
  }

  function wireEvents() {
    movesButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (state !== STATE.MOVE) return;
        doMove(btn.getAttribute('data-move'));
      });
    });
    document.getElementById('reset').addEventListener('click', resetGame);
    document.getElementById('result-reset').addEventListener('click', resetGame);
  }

  function setState(s) {
    state = s;
    updateHud();
  }

  function updateHud() {
    turnPlayerEl.textContent = 'Player ' + currentPlayer;
    turnEl.classList.toggle('turn-x', currentPlayer === 'X');
    turnEl.classList.toggle('turn-o', currentPlayer === 'O');

    if (state === STATE.PLACE) turnPhaseEl.textContent = 'place your mark';
    else if (state === STATE.MOVE) turnPhaseEl.textContent = 'make a cube move';
    else if (state === STATE.ANIM) turnPhaseEl.textContent = 'rotating...';
    else turnPhaseEl.textContent = 'game over';

    var enableMoves = (state === STATE.MOVE);
    movesButtons.forEach(function (b) { b.disabled = !enableMoves; });
  }

  function showResult(text) {
    resultText.textContent = text;
    resultEl.classList.remove('hidden');
  }

  function resetGame() {
    // Tear down the current cube and rebuild a solved one.
    clearHover();
    if (anim) { cubeRoot.remove(anim.pivot); anim = null; }
    while (cubeRoot.children.length) cubeRoot.remove(cubeRoot.children[0]);
    cubies = [];
    stickers = [];
    buildCube();
    currentPlayer = 'X';
    resultEl.classList.add('hidden');
    setState(STATE.PLACE);
  }

  // ======================================================================
  // Render loop
  // ======================================================================
  var clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    var dt = clock.getDelta();
    if (state === STATE.ANIM) updateAnim(dt);
    controls.update();
    renderer.render(scene, camera);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // Kick things off.
  if (typeof THREE === 'undefined') {
    document.body.innerHTML = '<p style="color:#fff;padding:24px;font-family:sans-serif">' +
      'Failed to load Three.js from the CDN. Check your internet connection and reload.</p>';
  } else {
    init();
  }
})();
