// scripts.js (minimal) — renders a single lit box on <canvas id="gl">
(() => {
  // ---- DOM ----
  const canvas = document.getElementById("gl");
  if (!canvas) {
    console.error("Canvas #gl not found in the DOM");
    return;
  }

  // ---- WebGL setup (WebGL2 -> WebGL1 fallback) ----
  const opts = { antialias: true, alpha: true };
  const gl =
    canvas.getContext("webgl2", opts) ||
    canvas.getContext("webgl", opts) ||
    canvas.getContext("experimental-webgl", opts);

  if (!gl) {
    const hud = document.getElementById("hud");
    if (hud) hud.textContent = "WebGL context could not be created.";
    console.error("WebGL context creation failed");
    return;
  }

  const isWebGL2 =
    typeof WebGL2RenderingContext !== "undefined" &&
    gl instanceof WebGL2RenderingContext;

  // ---- Tiny mat4 helpers (column-major) ----
  const M4 = {
    ident: () =>
      new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]),
    mul: (a, b) => {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
          o[c * 4 + r] =
            a[0 * 4 + r] * b[c * 4 + 0] +
            a[1 * 4 + r] * b[c * 4 + 1] +
            a[2 * 4 + r] * b[c * 4 + 2] +
            a[3 * 4 + r] * b[c * 4 + 3];
        }
      }
      return o;
    },
    rotateY: (m, a) => {
      const c = Math.cos(a), s = Math.sin(a);
      const r = new Float32Array([
        c, 0, -s, 0,
        0, 1,  0, 0,
        s, 0,  c, 0,
        0, 0,  0, 1,
      ]);
      return M4.mul(m, r);
    },
    rotateX: (m, a) => {
      const c = Math.cos(a), s = Math.sin(a);
      const r = new Float32Array([
        1, 0, 0, 0,
        0, c, s, 0,
        0,-s, c, 0,
        0, 0, 0, 1,
      ]);
      return M4.mul(m, r);
    },
    perspective: (fovy, aspect, near, far) => {
      const f = 1 / Math.tan(fovy / 2);
      const nf = 1 / (near - far);
      const o = new Float32Array(16);
      o[0] = f / aspect;
      o[5] = f;
      o[10] = (far + near) * nf;
      o[11] = -1;
      o[14] = (2 * far * near) * nf;
      return o;
    },
    lookAt: (eye, ctr, up) => {
      let [ex, ey, ez] = eye, [cx, cy, cz] = ctr, [ux, uy, uz] = up;

      let zx = ex - cx, zy = ey - cy, zz = ez - cz;
      let zl = 1 / (Math.hypot(zx, zy, zz) || 1);
      zx *= zl; zy *= zl; zz *= zl;

      let xx = uy * zz - uz * zy;
      let xy = uz * zx - ux * zz;
      let xz = ux * zy - uy * zx;
      let xl = 1 / (Math.hypot(xx, xy, xz) || 1);
      xx *= xl; xy *= xl; xz *= xl;

      let yx = zy * xz - zz * xy;
      let yy = zz * xx - zx * xz;
      let yz = zx * xy - zy * xx;

      const o = M4.ident();
      o[0] = xx; o[4] = xy; o[8]  = xz;
      o[1] = yx; o[5] = yy; o[9]  = yz;
      o[2] = zx; o[6] = zy; o[10] = zz;

      o[12] = -(xx * ex + xy * ey + xz * ez);
      o[13] = -(yx * ex + yy * ey + yz * ez);
      o[14] = -(zx * ex + zy * ey + zz * ez);
      return o;
    },
  };

  // ---- Shaders ----
  const VERT_300 = `#version 300 es
  in vec3 aPosition;
  in vec3 aNormal;
  uniform mat4 uProjection, uView, uModel;
  out vec3 vN;
  void main() {
    vN = mat3(uModel) * aNormal;
    gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
  }`;

  const FRAG_300 = `#version 300 es
  precision highp float;
  in vec3 vN;
  uniform vec3 uColor;
  out vec4 outColor;
  void main() {
    vec3 N = normalize(vN);
    vec3 L = normalize(vec3(-0.6, 1.0, 0.4));
    float diff = max(dot(N, L), 0.0);
    vec3 c = uColor * (0.25 + 0.75 * diff);
    outColor = vec4(c, 1.0);
  }`;

  const VERT_100 = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  uniform mat4 uProjection, uView, uModel;
  varying vec3 vN;
  void main() {
    vN = mat3(uModel) * aNormal;
    gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
  }`;

  const FRAG_100 = `
  precision highp float;
  varying vec3 vN;
  uniform vec3 uColor;
  void main() {
    vec3 N = normalize(vN);
    vec3 L = normalize(vec3(-0.6, 1.0, 0.4));
    float diff = max(dot(N, L), 0.0);
    vec3 c = uColor * (0.25 + 0.75 * diff);
    gl_FragColor = vec4(c, 1.0);
  }`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const msg = gl.getShaderInfoLog(s) || "Shader compile failed";
      gl.deleteShader(s);
      throw new Error(msg);
    }
    return s;
  }

  function link(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const msg = gl.getProgramInfoLog(p) || "Program link failed";
      gl.deleteProgram(p);
      throw new Error(msg);
    }
    return p;
  }

  const vs = compile(gl.VERTEX_SHADER, isWebGL2 ? VERT_300 : VERT_100);
  const fs = compile(gl.FRAGMENT_SHADER, isWebGL2 ? FRAG_300 : FRAG_100);
  const program = link(vs, fs);
  gl.useProgram(program);

  // ---- Geometry: 1 box (24 verts, 36 indices) ----
  const P = new Float32Array([
    // +Z
    -0.5,-0.5, 0.5,   0.5,-0.5, 0.5,   0.5, 0.5, 0.5,  -0.5, 0.5, 0.5,
    // -Z
    -0.5,-0.5,-0.5,  -0.5, 0.5,-0.5,   0.5, 0.5,-0.5,   0.5,-0.5,-0.5,
    // -X
    -0.5,-0.5,-0.5,  -0.5,-0.5, 0.5,  -0.5, 0.5, 0.5,  -0.5, 0.5,-0.5,
    // +X
     0.5,-0.5,-0.5,   0.5, 0.5,-0.5,   0.5, 0.5, 0.5,   0.5,-0.5, 0.5,
    // +Y
    -0.5, 0.5,-0.5,  -0.5, 0.5, 0.5,   0.5, 0.5, 0.5,   0.5, 0.5,-0.5,
    // -Y
    -0.5,-0.5,-0.5,   0.5,-0.5,-0.5,   0.5,-0.5, 0.5,  -0.5,-0.5, 0.5,
  ]);

  const N = new Float32Array([
    // +Z
     0,0,1,  0,0,1,  0,0,1,  0,0,1,
    // -Z
     0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
    // -X
    -1,0,0, -1,0,0, -1,0,0, -1,0,0,
    // +X
     1,0,0,  1,0,0,  1,0,0,  1,0,0,
    // +Y
     0,1,0,  0,1,0,  0,1,0,  0,1,0,
    // -Y
     0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
  ]);

  const I = new Uint16Array([
     0, 1, 2,  0, 2, 3,
     4, 5, 6,  4, 6, 7,
     8, 9,10,  8,10,11,
    12,13,14, 12,14,15,
    16,17,18, 16,18,19,
    20,21,22, 20,22,23,
  ]);

  // ---- Buffers / VAO ----
  const vao = isWebGL2 ? gl.createVertexArray() : null;
  if (vao) gl.bindVertexArray(vao);

  const posB = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posB);
  gl.bufferData(gl.ARRAY_BUFFER, P, gl.STATIC_DRAW);

  const aPosition = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);

  const norB = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, norB);
  gl.bufferData(gl.ARRAY_BUFFER, N, gl.STATIC_DRAW);

  const aNormal = gl.getAttribLocation(program, "aNormal");
  gl.enableVertexAttribArray(aNormal);
  gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);

  const idxB = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxB);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW);

  if (vao) gl.bindVertexArray(null);

  // ---- Uniforms ----
  const uProjection = gl.getUniformLocation(program, "uProjection");
  const uView = gl.getUniformLocation(program, "uView");
  const uModel = gl.getUniformLocation(program, "uModel");
  const uColor = gl.getUniformLocation(program, "uColor");

  // ---- GL state ----
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0.06, 0.07, 0.08, 1.0);

  // ---- Resize ----
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, (canvas.clientWidth * dpr) | 0);
    const h = Math.max(1, (canvas.clientHeight * dpr) | 0);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);

    const proj = M4.perspective((45 * Math.PI) / 180, w / h, 0.05, 100.0);
    gl.useProgram(program);
    gl.uniformMatrix4fv(uProjection, false, proj);
  }
  window.addEventListener("resize", resize);
  resize();

  // ---- Camera ----
  const view = M4.lookAt([1.6, 1.1, 2.6], [0, 0, 0], [0, 1, 0]);
  gl.uniformMatrix4fv(uView, false, view);

  // ---- Render loop ----
  function frame(t) {
    resize();

    let model = M4.ident();
    model = M4.rotateY(model, t * 0.0006);
    model = M4.rotateX(model, 0.35);
    gl.uniformMatrix4fv(uModel, false, model);

    gl.uniform3f(uColor, 0.75, 0.78, 0.82);

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(program);
    if (vao) {
      gl.bindVertexArray(vao);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, posB);
      gl.enableVertexAttribArray(aPosition);
      gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, norB);
      gl.enableVertexAttribArray(aNormal);
      gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxB);
    }

    gl.drawElements(gl.TRIANGLES, I.length, gl.UNSIGNED_SHORT, 0);

    if (vao) gl.bindVertexArray(null);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
