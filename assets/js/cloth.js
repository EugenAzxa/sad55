/* ==========================================================================
   cloth.js - hang a block of text on a piece of fabric and let the wind take it.

   A vanilla-JS port of the canvasui.dev <Cloth> component (David Haz), with
   one substitution. The original captures the live DOM through html-in-canvas
   (canvas layoutsubtree + ctx.drawElementImage), which today needs an
   experimental Chrome flag; without it the component quietly renders plain
   content and never starts. This rasterises the element's own text onto a 2D
   canvas instead, so the effect runs in every browser shipping WebGL.

   The physics are the original's: a wave equation solved on a grid, gusts,
   damping, a pointer that springs along behind the cursor and lifts the
   fabric where it passes, fold gathering measured by arc length, and real
   perspective. Amplitudes are in CSS pixels, so a wide banner and a tall
   card fold by the same physical amount.

   Dropped from the original, because they describe an opaque sheet and these
   hosts are transparent text: the contact shadow, the rounded fabric edge and
   the sampled backing colour.

   Usage - markup only:
     <div data-cloth data-cloth-wind="2.4">   <-- auto-mounted once fonts load
       <h2>Some heading</h2>
     </div>

   Usage - explicit:
     var c = Cloth.mount('#banner', { wind: 3, pin: 'top' });
     c.repaint();   // after the text changes
     c.destroy();

   Only mount on a wrapper holding nothing but text: every direct child of the
   host is made transparent, so a button inside would go invisible while
   staying clickable.

   Degrades safely: no WebGL, a failed shader, a lost context or
   prefers-reduced-motion all leave the original markup visible and untouched.
   The real text always stays in the DOM, for screen readers and for search.
   ========================================================================== */
(function () {
'use strict';

/* ------------------------------------------------------------------ shaders */

/* WebGL 1, so: attribute/varying rather than in/out, texture2D, gl_FragColor,
   and attribute slots looked up by name instead of layout(location). */

var VERT = [
'attribute vec2 aGrid;',
'attribute vec4 aData;',
'attribute vec2 aOffset;',
'uniform vec2 uRes;',       /* the element, in CSS px */
'uniform vec2 uOut;',       /* the canvas, which overhangs it by uBleed */
'uniform float uBleed,uFocal;',
'varying vec2 vUV;',
'varying vec3 vN;',
'varying float vFold;',
'void main(){',
'  vUV=aGrid;',
'  float z=aData.x;',
/* the sim stores the two lateral components; rebuild the third, never letting
   it collapse to zero or the lighting flips inside out on a hard crease */
'  vN=vec3(aData.yz,sqrt(max(1.0-dot(aData.yz,aData.yz),0.04)));',
'  vFold=aData.w;',
'  vec2 px=aGrid*uRes+aOffset+vec2(uBleed);',
'  vec2 ndc=(px/uOut)*2.0-1.0;',
'  ndc.y=-ndc.y;',
/* a real perspective divide: fabric nearer the viewer comes out larger */
'  float w=(uFocal-z)/uFocal;',
'  gl_Position=vec4(ndc,-z/uFocal,w);',
'}'].join('\n');

var FRAG = [
'precision mediump float;',
'uniform sampler2D uTex;',
'uniform float uLight,uSheen;',
'varying vec2 vUV;',
'varying vec3 vN;',
'varying float vFold;',
'void main(){',
'  vec4 c=texture2D(uTex,clamp(vUV,vec2(0.0005),vec2(0.9995)));',
'  if(c.a<0.003) discard;',
'  vec3 n=normalize(vN);',
'  vec3 L=normalize(vec3(-0.3,0.42,0.86));',
/* normalise against a flat sheet, so light=1 does not just darken everything */
'  float flat_=0.58+0.42*L.z;',
'  float diff=0.58+0.42*dot(n,L);',
'  float shade=mix(1.0,(diff/flat_)*vFold,uLight);',
/* the texture arrives premultiplied, so un-premultiply, shade, re-premultiply */
'  vec3 rgb=c.a>0.0?c.rgb/c.a:c.rgb;',
'  rgb*=shade;',
'  vec3 H=normalize(L+vec3(0.0,0.0,1.0));',
'  float sFlat=pow(H.z,34.0);',
'  float spec=max(pow(max(dot(n,H),0.0),34.0)-sFlat,0.0)/(1.0-sFlat);',
'  rgb+=uSheen*spec;',
'  gl_FragColor=vec4(clamp(rgb,0.0,1.0)*c.a,c.a);',
'}'].join('\n');

/* ---------------------------------------------------------------- stylesheet */

/* the canvas overhangs the element by BLEED so a billowing fold is not
   guillotined at the edge of its own box */
var BLEED = 48;

var CSS = '.cloth-host{position:relative}' +
          '.cloth-canvas{position:absolute;inset:-' + BLEED + 'px;' +
            'display:block;pointer-events:none}' +
          /* the source markup stays in the DOM for screen readers and as the
             fallback, and is only hidden once the fabric really rendered */
          '.cloth-on>*:not(.cloth-canvas){opacity:0}' +
          /* a host's own text nodes are not elements, so the rule above never
             reaches them - they inherit the host's colour instead */
          '.cloth-on{color:transparent;-webkit-text-stroke-color:transparent}';

var styled = false;
function injectCSS() {
  if (styled) return;
  styled = true;
  var s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* -------------------------------------------------------------------- engine */

var DT = 1 / 120;          /* the sim runs on its own fixed clock */
var WAVE_SPEED = 30;
var STIFFNESS = 0.55;
var FORCE_GAIN = 5.0;

var DEFAULTS = {
  pin: 'top',         // edge the fabric hangs from: top|bottom|left|right
  wind: 3,            // force driving the waves (0 lets them die away)
  speed: 0.5,         // playback speed
  amplitude: 18,      // fold height, in CSS pixels
  drape: 12,          // CSS pixels the sheet billows toward the viewer
  brush: 2.05,        // strength of the wave the cursor brushes across it
  brushSize: 150,     // radius of the cursor's influence, in CSS pixels
  damping: 1,         // how fast waves settle (higher calms it sooner)
  light: 0.5,         // directional shading on the folds, 0 to 1
  sheen: 0.1,         // specular glint on the crests, 0 to 1
  perspective: 1200,  // focal length in CSS px; lower exaggerates the depth
  seg: 0,             // mesh resolution; 0 picks one from the element size
  panel: false        // paint a light gradient panel behind the text
};

function compile(gl, type, src) {
  var s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) return null;
  return s;
}

function Cloth(host, opts) {
  var self = this;
  this.host = host;
  this.o = {};
  for (var k in DEFAULTS) this.o[k] = DEFAULTS[k];
  if (opts) for (k in opts) if (opts[k] !== undefined) this.o[k] = opts[k];

  var cv = document.createElement('canvas');
  cv.className = 'cloth-canvas';
  cv.setAttribute('aria-hidden', 'true');

  /* get a context before touching the DOM, so a browser without WebGL is
     never left with an empty canvas sitting in the page */
  var gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, depth: false })
        || cv.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: true, depth: false });
  if (!gl) throw new Error('cloth: no webgl');
  host.appendChild(cv);
  this.cv = cv;
  this.gl = gl;

  var vs = compile(gl, gl.VERTEX_SHADER, VERT),
      fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) throw new Error('cloth: shader');
  var pr = gl.createProgram();
  gl.attachShader(pr, vs);
  gl.attachShader(pr, fs);
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('cloth: link');
  gl.useProgram(pr);
  this.pr = pr;

  /* One node per ~9 CSS px of the longer side. Finer than that only buys
     detail the type cannot show, and the sim is O(n^2) per step. */
  var box = host.getBoundingClientRect();
  var seg = this.o.seg || Math.round(Math.max(box.width, box.height) / 9);
  seg = Math.max(20, Math.min(84, seg));
  var SEG = this.SEG = seg, N = this.N = seg + 1, NN = N * N;

  var grid = new Float32Array(NN * 2);
  for (var y = 0; y < N; y++) {
    for (var x = 0; x < N; x++) {
      grid[(y * N + x) * 2] = x / SEG;
      grid[(y * N + x) * 2 + 1] = y / SEG;
    }
  }
  /* SEG caps at 84, so 85*85 = 7225 nodes: comfortably inside a Uint16 index
     and no need for the OES_element_index_uint extension */
  var idx = new Uint16Array(SEG * SEG * 6), o = 0;
  for (y = 0; y < SEG; y++) {
    for (x = 0; x < SEG; x++) {
      var a = y * N + x, b = a + 1, c = a + N, d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b;
      idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
  }
  this.idxCount = idx.length;

  this.aGrid = gl.getAttribLocation(pr, 'aGrid');
  this.aData = gl.getAttribLocation(pr, 'aData');
  this.aOffset = gl.getAttribLocation(pr, 'aOffset');

  this.bGrid = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.bGrid);
  gl.bufferData(gl.ARRAY_BUFFER, grid, gl.STATIC_DRAW);
  this.bData = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.bData);
  gl.bufferData(gl.ARRAY_BUFFER, NN * 4 * 4, gl.DYNAMIC_DRAW);
  this.bOffset = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.bOffset);
  gl.bufferData(gl.ARRAY_BUFFER, NN * 2 * 4, gl.DYNAMIC_DRAW);
  this.bIdx = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bIdx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

  this.u = {};
  ['uRes', 'uOut', 'uBleed', 'uFocal', 'uLight', 'uSheen', 'uTex'].forEach(function (n) {
    self.u[n] = gl.getUniformLocation(pr, n);
  });

  this.tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, this.tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  /* the mesh warps the texture, so samples are taken at an angle; without
     anisotropic filtering the glyph edges break up into visible pixels */
  var aniso = gl.getExtension('EXT_texture_filter_anisotropic')
           || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic')
           || gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
  if (aniso) {
    gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT,
      Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  }
  this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  /* ---- simulation state ---- */
  this.hCur = new Float32Array(NN);
  this.hPrev = new Float32Array(NN);
  this.hNext = new Float32Array(NN);
  this.zField = new Float32Array(NN);
  this.vdata = new Float32Array(NN * 4);
  this.odata = new Float32Array(NN * 2);
  this.rowForce = new Float32Array(N);
  this.colForce = new Float32Array(N);
  this.hang = new Float32Array(N);
  for (var i = 0; i < N; i++) this.hang[i] = Math.pow(i / SEG, 1.3);

  /* a random start so two sheets on one page are never in lockstep */
  this.simTime = Math.random() * 60;
  this.gust = 0.5;
  this.energy = 1;
  this.debt = 0;
  this.pointer = { x: -1e5, y: -1e5, inside: false };
  this.touch = { x: -1e5, y: -1e5, vx: 0, vy: 0, s: 0 };
  this.last = 0;
  this.running = false;

  this.onMove = function (e) {
    var r = host.getBoundingClientRect();
    var px = e.clientX - r.left, py = e.clientY - r.top;
    /* jump the follower to the cursor on first contact, so it does not come
       streaking in across the whole sheet from wherever it was left */
    if (self.touch.s < 0.01) {
      self.touch.x = px; self.touch.y = py; self.touch.vx = 0; self.touch.vy = 0;
    }
    self.pointer.x = px; self.pointer.y = py; self.pointer.inside = true;
  };
  this.onLeave = function () { self.pointer.inside = false; };
  host.addEventListener('pointermove', this.onMove, { passive: true });
  host.addEventListener('pointerleave', this.onLeave, { passive: true });

  this.resizes = 0;
  this.onResize = function () { self.resizes++; self.resize(); };
  /* the observer catches a host that reflows on its own; the window event
     catches the plain viewport change. Both, because a missed resize leaves
     an old texture stretched across a new box. */
  if (window.ResizeObserver) {
    this.ro = new ResizeObserver(this.onResize);
    this.ro.observe(host);
  }
  window.addEventListener('resize', this.onResize);

  cv.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    self.stop();
    if (typeof self.onLost === 'function') self.onLost();
  });
}

/* which way is "away from the pinned edge"? a runs along it, b across. */
Cloth.prototype.axis = function (x, y, out) {
  var p = this.o.pin, S = this.SEG;
  if (p === 'bottom') { out[0] = S - y; out[1] = x; }
  else if (p === 'left') { out[0] = x; out[1] = y; }
  else if (p === 'right') { out[0] = S - x; out[1] = y; }
  else { out[0] = y; out[1] = x; }              /* top */
};

Cloth.prototype.step = function (dt) {
  var o = this.o, N = this.N, SEG = this.SEG;
  var hCur = this.hCur, hPrev = this.hPrev, hNext = this.hNext;
  this.simTime += dt * Math.max(o.speed, 0);
  var t = this.simTime;
  var windAmp = FORCE_GAIN * Math.max(o.wind, 0) * this.gust;

  /* two travelling waves along the pinned edge, one slow and one quick, in
     opposite directions. Nothing divides evenly, so it never visibly loops. */
  var kb1 = (Math.PI * 2) / (SEG / 1.5),
      kb2 = (Math.PI * 2) / (SEG / 3.8),
      ka  = (Math.PI * 2) / (SEG / 2.2);
  var w1 = WAVE_SPEED * kb1, w2 = WAVE_SPEED * kb2;
  var drift = 1.8 * Math.sin(0.23 * t);
  var rf = this.rowForce, cf = this.colForce, hang = this.hang, i;
  for (i = 0; i < N; i++) {
    rf[i] = Math.sin(kb1 * i - w1 * t + drift)
          + 0.45 * Math.sin(kb2 * i + w2 * t * 0.8 + 3.0);
  }
  for (i = 0; i < N; i++) {
    cf[i] = (0.7 + 0.3 * Math.sin(ka * i - 1.7 * t)) * hang[i];
  }

  /* an explicit wave equation: acceleration from the laplacian, pulled back
     toward flat by the stiffness, pushed by the wind */
  var c2 = WAVE_SPEED * WAVE_SPEED, dt2 = dt * dt;
  var decay = Math.exp(-Math.min(Math.max(o.damping, 0.05), 8) * dt);
  var ax = this._ax || (this._ax = [0, 0]);
  var pin = o.pin, x, y;
  for (y = 0; y < N; y++) {
    var up = Math.max(y - 1, 0) * N, dn = Math.min(y + 1, SEG) * N, row = y * N;
    for (x = 0; x < N; x++) {
      var ii = row + x;
      var h = hCur[ii];
      var lap = hCur[row + Math.max(x - 1, 0)] + hCur[row + Math.min(x + 1, SEG)]
              + hCur[up + x] + hCur[dn + x] - 4 * h;
      if (pin === 'bottom') { ax[0] = SEG - y; ax[1] = x; }
      else if (pin === 'left') { ax[0] = x; ax[1] = y; }
      else if (pin === 'right') { ax[0] = SEG - x; ax[1] = y; }
      else { ax[0] = y; ax[1] = x; }
      var acc = c2 * lap - STIFFNESS * h + windAmp * rf[ax[1]] * cf[ax[0]];
      var next = 2 * h - hPrev[ii] + dt2 * acc;
      var v = h + (next - h) * decay;
      hNext[ii] = v > 3.5 ? 3.5 : (v < -3.5 ? -3.5 : v);
    }
  }

  /* the pinned edge is nailed down */
  for (i = 0; i < N; i++) {
    x = i; y = 0;
    if (pin === 'bottom') y = SEG;
    else if (pin === 'left') { x = 0; y = i; }
    else if (pin === 'right') { x = SEG; y = i; }
    hNext[y * N + x] = 0;
  }

  this.hPrev = hCur; this.hCur = hNext; this.hNext = hPrev;
};

/* lift the fabric in a gaussian blob wherever the follower currently is */
Cloth.prototype.imprint = function (dt, W, H) {
  var o = this.o, t = this.touch;
  if (o.brush <= 0 || t.s < 0.01) return;
  var N = this.N, SEG = this.SEG;
  var cw = W / SEG, ch = H / SEG;
  var rad = Math.max(o.brushSize, 12), rx = rad / cw, ry = rad / ch;
  var gx = t.x / cw, gy = t.y / ch;
  var x0 = Math.max(Math.ceil(gx - 2.5 * rx), 0), x1 = Math.min(Math.floor(gx + 2.5 * rx), SEG);
  var y0 = Math.max(Math.ceil(gy - 2.5 * ry), 0), y1 = Math.min(Math.floor(gy + 2.5 * ry), SEG);
  var lift = 1.1 * Math.min(o.brush, 3) * t.s, rate = Math.min(dt * 4, 1);
  var hCur = this.hCur, hPrev = this.hPrev;
  for (var y = y0; y <= y1; y++) {
    var oy = (y - gy) / ry, row = y * N;
    for (var x = x0; x <= x1; x++) {
      var ox = (x - gx) / rx;
      var g = Math.exp(-(ox * ox + oy * oy));
      if (g < 0.02) continue;
      var i = row + x, pull = rate * g, goal = lift * g;
      hCur[i] += (goal - hCur[i]) * pull;
      hPrev[i] += (goal - hPrev[i]) * pull;
    }
  }
};

/* Fabric does not stretch. Where the sheet rises out of the plane it has to
   pull in from the sides to pay for it, and that gathering is what reads as
   cloth rather than a wobbling sheet of rubber. Walk each line out from the
   anchor accumulating the arc length the fold swallowed. */
Cloth.prototype.foreshorten = function (stride, lineStride, ds, anchor, comp) {
  var N = this.N, z = this.zField, off = this.odata, ds2 = ds * ds;
  for (var l = 0; l < N; l++) {
    var base = l * lineStride;
    off[(base + anchor * stride) * 2 + comp] = 0;
    var cum = 0, k, i, dz;
    for (k = anchor + 1; k < N; k++) {
      i = base + k * stride;
      dz = z[i] - z[i - stride];
      cum += ds - Math.sqrt(Math.max(ds2 - dz * dz, 0));
      off[i * 2 + comp] = -cum;
    }
    cum = 0;
    for (k = anchor - 1; k >= 0; k--) {
      i = base + k * stride;
      dz = z[i] - z[i + stride];
      cum += ds - Math.sqrt(Math.max(ds2 - dz * dz, 0));
      off[i * 2 + comp] = cum;
    }
  }
};

Cloth.prototype.compose = function (W, H) {
  var o = this.o, N = this.N, SEG = this.SEG;
  var amp = Math.max(o.amplitude, 0);
  var drape = o.drape * (0.3 + 0.7 * this.gust);
  var cw = W / SEG, ch = H / SEG;
  var hCur = this.hCur, z = this.zField, v = this.vdata, hang = this.hang;
  var pin = o.pin, energy = 0, x, y, i, row;

  for (y = 0; y < N; y++) {
    row = y * N;
    for (x = 0; x < N; x++) {
      i = row + x;
      var h = hCur[i];
      var ah = h < 0 ? -h : h;
      if (ah > energy) energy = ah;
      var a = pin === 'bottom' ? SEG - y : pin === 'left' ? x : pin === 'right' ? SEG - x : y;
      /* tanh keeps a violent gust from folding the sheet through itself */
      z[i] = amp * Math.tanh(h) + drape * hang[a];
    }
  }
  this.energy = energy;

  for (y = 0; y < N; y++) {
    var up = Math.max(y - 1, 0) * N, dn = Math.min(y + 1, SEG) * N;
    row = y * N;
    for (x = 0; x < N; x++) {
      i = row + x;
      var l = row + Math.max(x - 1, 0), r = row + Math.min(x + 1, SEG);
      var dzdx = (z[r] - z[l]) / (2 * cw), dzdy = (z[dn + x] - z[up + x]) / (2 * ch);
      var inv = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      /* curvature darkens the inside of a crease and brightens its ridge */
      var curve = z[l] + z[r] + z[up + x] + z[dn + x] - 4 * z[i];
      var fold = 1 - curve * 0.01;
      if (fold < 0.86) fold = 0.86; else if (fold > 1.06) fold = 1.06;
      var q = i * 4;
      v[q] = z[i]; v[q + 1] = -dzdx * inv; v[q + 2] = -dzdy * inv; v[q + 3] = fold;
    }
  }

  var mid = SEG >> 1;
  if (pin === 'top' || pin === 'bottom') {
    this.foreshorten(N, 1, ch, pin === 'top' ? 0 : SEG, 1);
    this.foreshorten(1, N, cw, mid, 0);
  } else {
    this.foreshorten(1, N, cw, pin === 'left' ? 0 : SEG, 0);
    this.foreshorten(N, 1, ch, mid, 1);
  }
};

/* draw(ctx, w, h) fills the 2D canvas that becomes the fabric. It is
   rendered above the display resolution: the mesh stretches and compresses
   the texture, and without spare detail the type shows its pixels wherever
   the fabric is pulled. */
Cloth.prototype.paint = function (draw) {
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var r = this.host.getBoundingClientRect();
  if (!r.width || !r.height) return;
  var ss = 2, cap = this.maxTex || 2048;
  while (ss > 1 && (r.width * dpr * ss > cap || r.height * dpr * ss > cap)) ss -= 0.5;
  var scale = dpr * ss;
  /* a wide host - a drifting headline, say - can still overflow the GPU's
     texture limit at ss = 1, and texImage2D then uploads nothing at all and
     leaves a blank sheet. Drop below CSS resolution rather than render empty. */
  var over = Math.max(r.width * scale, r.height * scale) / cap;
  if (over > 1) scale /= over;
  var c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(r.width * scale));
  c.height = Math.max(2, Math.round(r.height * scale));
  var ctx = c.getContext('2d');
  try { ctx.textRendering = 'geometricPrecision'; } catch (e) {}
  ctx.scale(scale, scale);
  /* Once mounted the host hides its own text, and a repaint would then read
     that back and rasterise nothing. Drop the class for the duration: the
     draw is synchronous, so the page never gets a chance to show the gap. */
  var on = this.host.classList.contains('cloth-on');
  if (on) this.host.classList.remove('cloth-on');
  try { draw(ctx, r.width, r.height); }
  finally { if (on) this.host.classList.add('cloth-on'); }
  var gl = this.gl;
  gl.bindTexture(gl.TEXTURE_2D, this.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  this.srcW = r.width;
  this.srcH = r.height;
  this.drawFn = draw;
  this.resize();
};

/* re-rasterise the current text - call after it changes (i18n, edit, etc.) */
Cloth.prototype.repaint = function () {
  if (this.drawFn) {
    var fn = this.drawFn;
    this.drawFn = null;
    this.paint(fn);
  }
};

Cloth.prototype.resize = function () {
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var r = this.host.getBoundingClientRect();
  if (!r.width || !r.height) return;
  /* the box changed, so the text re-wrapped or re-sized: redraw the texture.
     Height matters as much as width - bumping the type up reflows without
     touching the column width, and a stale texture just gets stretched. */
  if (this.drawFn &&
      ((this.srcW && Math.abs(r.width - this.srcW) > 2) ||
       (this.srcH && Math.abs(r.height - this.srcH) > 2))) {
    this.repaint();
    return;
  }
  this.W = r.width;
  this.H = r.height;
  this.outW = r.width + BLEED * 2;
  this.outH = r.height + BLEED * 2;
  this.cv.width = Math.round(this.outW * dpr);
  this.cv.height = Math.round(this.outH * dpr);
  this.gl.viewport(0, 0, this.cv.width, this.cv.height);
};

Cloth.prototype.draw = function () {
  var gl = this.gl, u = this.u, o = this.o;
  gl.useProgram(this.pr);
  gl.viewport(0, 0, this.cv.width, this.cv.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.bindBuffer(gl.ARRAY_BUFFER, this.bGrid);
  gl.enableVertexAttribArray(this.aGrid);
  gl.vertexAttribPointer(this.aGrid, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, this.bData);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vdata);
  gl.enableVertexAttribArray(this.aData);
  gl.vertexAttribPointer(this.aData, 4, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, this.bOffset);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.odata);
  gl.enableVertexAttribArray(this.aOffset);
  gl.vertexAttribPointer(this.aOffset, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bIdx);

  gl.uniform2f(u.uRes, this.W, this.H);
  gl.uniform2f(u.uOut, this.outW, this.outH);
  gl.uniform1f(u.uBleed, BLEED);
  gl.uniform1f(u.uFocal, Math.max(o.perspective, 200));
  gl.uniform1f(u.uLight, Math.min(Math.max(o.light, 0), 1));
  gl.uniform1f(u.uSheen, Math.max(o.sheen, 0));
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, this.tex);
  gl.uniform1i(u.uTex, 0);

  gl.drawElements(gl.TRIANGLES, this.idxCount, gl.UNSIGNED_SHORT, 0);
};

Cloth.prototype.frame = function (now) {
  if (!this.running) return;
  var dt = this.last ? Math.min((now - this.last) / 1000, 1 / 20) : 0.016;
  this.last = now;
  var W = this.W || 1, H = this.H || 1, o = this.o;

  /* the wind comes and goes, so the sheet breathes rather than buzzing */
  var t = this.simTime;
  var target = Math.max(0.55 + 0.35 * Math.sin(t * 0.31 + 1.3)
    + 0.25 * Math.sin(t * 0.83) * (0.5 + 0.5 * Math.sin(t * 0.17)), 0.15);
  this.gust += (target - this.gust) * Math.min(dt * 2, 1);

  var p = this.pointer, tc = this.touch;
  var sTarget = (p.inside && o.brush > 0) ? 1 : 0;
  tc.s += (sTarget - tc.s) * Math.min(dt * (p.inside ? 8 : 2.5), 1);
  /* a critically damped spring, so the touch trails the cursor and settles
     instead of snapping to it */
  var om = 14;
  tc.vx += ((p.x - tc.x) * om * om - 2 * om * tc.vx) * dt;
  tc.vy += ((p.y - tc.y) * om * om - 2 * om * tc.vy) * dt;
  tc.x += tc.vx * dt;
  tc.y += tc.vy * dt;
  this.imprint(dt, W, H);

  this.debt = Math.min(this.debt + dt, DT * 5);
  while (this.debt >= DT) { this.step(DT); this.debt -= DT; }

  this.compose(W, H);
  this.draw();

  if (this.frameOnly) return;
  /* a calm sheet in no wind is a still image: stop burning frames on it */
  if (o.wind <= 0.001 && this.energy < 0.004 && tc.s < 0.01) {
    this.running = false;
    return;
  }
  var self = this;
  this.raf = requestAnimationFrame(function (n) { self.frame(n); });
};

/* draw exactly one frame, so a caller can confirm the fabric actually
   rendered before it hides the fallback markup */
Cloth.prototype.renderOnce = function () {
  this.running = true;
  this.frameOnly = true;
  this.last = 0;
  this.frame(performance.now());
  this.frameOnly = false;
  this.running = false;
};

Cloth.prototype.start = function () {
  if (this.running) return;
  this.running = true;
  this.last = 0;
  var self = this;
  this.raf = requestAnimationFrame(function (t) { self.frame(t); });
};

Cloth.prototype.stop = function () {
  this.running = false;
  if (this.raf) cancelAnimationFrame(this.raf);
};

Cloth.prototype.destroy = function () {
  this.stop();
  this.host.removeEventListener('pointermove', this.onMove);
  this.host.removeEventListener('pointerleave', this.onLeave);
  if (this.ro) this.ro.disconnect();
  window.removeEventListener('resize', this.onResize);
  if (this.io) this.io.disconnect();
  this.host.classList.remove('cloth-on');
  if (this.cv.parentNode) this.cv.parentNode.removeChild(this.cv);
  var gl = this.gl;
  gl.deleteTexture(this.tex);
  gl.deleteProgram(this.pr);
  gl.deleteBuffer(this.bGrid);
  gl.deleteBuffer(this.bData);
  gl.deleteBuffer(this.bOffset);
  gl.deleteBuffer(this.bIdx);
  var i = live.indexOf(this);
  if (i >= 0) live.splice(i, 1);
};

/* ------------------------------------------------------------------- painter */

var CLEAR = /^(transparent|rgba\(\s*0,\s*0,\s*0,\s*0\s*\))$/;

/* Rasterise whatever text the host already contains, at the exact position,
   font and colour the browser laid it out with. Every word is measured with
   a Range, so wrapping, text-align and letter-spacing come out right without
   re-implementing any of it. */
function domPainter(host, o) {
  return function (ctx, W, H) {
    var hb = host.getBoundingClientRect();

    if (o.panel) {
      var inset = Math.min(W * 0.07, 96), top = Math.min(H * 0.10, 44);
      var bw = W - inset * 2, bh = H - top * 2, rad = Math.min(22, bw / 2, bh / 2);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(inset + rad, top);
      ctx.arcTo(inset + bw, top, inset + bw, top + bh, rad);
      ctx.arcTo(inset + bw, top + bh, inset, top + bh, rad);
      ctx.arcTo(inset, top + bh, inset, top, rad);
      ctx.arcTo(inset, top, inset + bw, top, rad);
      ctx.closePath();
      var g = ctx.createLinearGradient(0, top, 0, top + bh);
      g.addColorStop(0, 'rgba(255,255,255,0.92)');
      g.addColorStop(0.55, 'rgba(248,251,255,0.88)');
      g.addColorStop(1, 'rgba(236,243,252,0.86)');
      ctx.fillStyle = typeof o.panel === 'string' ? o.panel : g;
      ctx.fill();
      ctx.restore();
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';

    var walk = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !/\S/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        var el = n.parentElement;
        if (!el || el.classList.contains('cloth-canvas')) return NodeFilter.FILTER_REJECT;
        var cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0)
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    var node;
    while ((node = walk.nextNode())) {
      var el = node.parentElement;
      var cs = getComputedStyle(el);
      var fSize = parseFloat(cs.fontSize) || 16;
      ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + fSize + 'px ' + cs.fontFamily;
      ctx.fillStyle = cs.color;
      /* an outlined headline - color:transparent plus -webkit-text-stroke - is
         a fill of nothing, so honour the stroke too or it rasterises blank */
      var sw = parseFloat(cs.webkitTextStrokeWidth
                       || cs.getPropertyValue('-webkit-text-stroke-width')) || 0;
      var sc = cs.webkitTextStrokeColor
            || cs.getPropertyValue('-webkit-text-stroke-color') || cs.color;
      var fills = !CLEAR.test(cs.color);
      ctx.lineWidth = sw;
      ctx.strokeStyle = sc;
      /* canvas letterSpacing is ignored where unsupported, and the per-word
         Range positions already carry the tracking between words */
      try { ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing; }
      catch (e) {}

      var ascent = fSize * 0.8;
      var m = ctx.measureText('Hg');
      if (m.fontBoundingBoxAscent) ascent = m.fontBoundingBoxAscent;

      var text = node.nodeValue;
      var re = /\S+/g, mm, rng = document.createRange();
      while ((mm = re.exec(text))) {
        rng.setStart(node, mm.index);
        rng.setEnd(node, mm.index + mm[0].length);
        var rects = rng.getClientRects();
        if (!rects.length) continue;
        var r = rects[0];
        /* text sits centred in its line box, so back out the leading */
        var y = r.top - hb.top + (r.height - fSize) / 2 + ascent;
        var x = r.left - hb.left;
        if (fills) ctx.fillText(mm[0], x, y);
        if (sw > 0 && !CLEAR.test(sc)) ctx.strokeText(mm[0], x, y);
      }
    }
    try { ctx.letterSpacing = '0px'; } catch (e) {}
  };
}

/* ---------------------------------------------------------------------- mount */

var live = [];
var ROOT = document.documentElement;

/* Mount on one element or a selector/NodeList. Returns the Cloth instance
   (or an array of them), or null where it could not run. */
Cloth.mount = function (target, opts) {
  var els;
  if (typeof target === 'string') els = [].slice.call(document.querySelectorAll(target));
  else if (target && target.length !== undefined && !target.tagName) els = [].slice.call(target);
  else els = [target];

  var made = els.map(function (host) { return one(host, opts); });
  return made.length === 1 ? made[0] : made.filter(Boolean);
};

var NUMERIC = { wind: 1, speed: 1, amplitude: 1, drape: 1, brush: 1, brushSize: 1,
                damping: 1, light: 1, sheen: 1, perspective: 1, seg: 1 };

function one(host, opts) {
  if (!host || host.classList.contains('cloth-on')) return null;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;

  injectCSS();
  host.classList.add('cloth-host');

  var o = {}, k;
  for (k in DEFAULTS) o[k] = DEFAULTS[k];
  if (opts) for (k in opts) if (opts[k] !== undefined) o[k] = opts[k];
  /* data-cloth-wind="2.4", data-cloth-pin="left" etc. override the JS options */
  for (k in DEFAULTS) {
    var attr = host.getAttribute('data-cloth-' + k.toLowerCase());
    if (attr === null) continue;
    o[k] = NUMERIC[k] ? parseFloat(attr) : (attr === 'false' ? false : attr);
  }

  var cloth;
  try { cloth = new Cloth(host, o); }
  catch (e) { return null; }        /* no WebGL: leave the plain markup alone */

  var draw = typeof o.draw === 'function' ? o.draw : domPainter(host, o);
  cloth.paint(draw);

  /* Prove the fabric renders before hiding the real text. If WebGL is present
     but produces nothing, the element would otherwise just go blank. */
  try { cloth.renderOnce(); }
  catch (e) { cloth.destroy(); return null; }
  if (!cloth.cv.width || !cloth.cv.height) { cloth.destroy(); return null; }

  host.classList.add('cloth-on');

  /* if the GPU context is ever lost, put the markup straight back */
  cloth.onLost = function () { cloth.destroy(); };

  /* only animate while the element is actually on screen */
  if ('IntersectionObserver' in window) {
    cloth.io = new IntersectionObserver(function (es) {
      es.forEach(function (en) { en.isIntersecting ? cloth.start() : cloth.stop(); });
    }, { threshold: 0.05 });
    cloth.io.observe(host);
  } else {
    cloth.start();
  }

  live.push(cloth);
  return cloth;
}

/* --------------------------------------------------- large-print a11y mode */

/* Rippling text is exactly wrong for someone who turned on the site's
   "версия для слабовидящих". Never mount while it is on, and drop the fabric
   the moment it is switched on mid-visit. */
function a11yOn() { return ROOT.classList.contains('a11y'); }

function auto() {
  if (a11yOn()) return;
  var els = document.querySelectorAll('[data-cloth]');
  if (els.length) Cloth.mount(els);
}

if (window.MutationObserver) {
  var was = a11yOn();
  new MutationObserver(function () {
    var now = a11yOn();
    if (now === was) return;
    was = now;
    if (now) { while (live.length) live[0].destroy(); }
    else auto();
  }).observe(ROOT, { attributes: true, attributeFilter: ['class'] });
}

/* wait for webfonts, or the texture bakes in the fallback face */
function ready() {
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(auto);
  else window.addEventListener('load', auto);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
else ready();

Cloth.instances = live;          /* handy from the console, and for tests */
window.Cloth = Cloth;
})();
