/* ABYSSAL TETHER 3D — textStylePreview.js
 * DEV ONLY (not imported by the game): mock-ups of ways to put words into the world WITHOUT a slab or a plate, to look at in the real
 * lighting before one is chosen (docs/abyssal-tether-3d/plans/TEXT_IN_THE_WORLD.md). Each builder returns an Object3D to place on a wall:
 *
 *   carved(THREE, text, w)     letters cut straight into the stone, no slab: a height field turned into a normal map, so the
 *                              lantern rakes the bevels; a darker, dusty groove; worn gaps; hand-chiselled irregular baseline and size
 *   scrawled(THREE, text, w)   written by a hand: thin double strokes, retraced letters, a struck-through word, grainy chalk
 *   tag(THREE, text)           a small rusted iron tag on a wire from a nail, the words stamped into it
 *   revealed(THREE, text, w)   the carving is almost invisible to the lantern; the glow is a paint that only the night vision shows
 *                              (mesh.userData.glow(k) drives its emissive with the goggles' ramp)
 *
 * All use lit MeshStandardMaterial decals (the scene's lantern and ambient light them) 1-2 cm off the wall.
 */

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function wrapWords(ctx, text, maxW) {
  const words = text.split(' ');
  const rows = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(t).width > maxW) {
      rows.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) rows.push(cur);
  return rows;
}

/** A height canvas -> a tangent-space normal canvas (Sobel on a lightly blurred copy). */
function normalFromHeight(canvas, strength) {
  const w = canvas.width;
  const h = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const hgt = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hgt[i] = src[i * 4] / 255;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const at = (x, y) => hgt[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength;
      let ny = dy * strength;
      const l = Math.hypot(nx, ny, 1);
      nx /= l;
      ny /= l;
      const nz = 1 / l;
      const o = (y * w + x) * 4;
      img.data[o] = (nx * 0.5 + 0.5) * 255;
      img.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[o + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** One blurred copy of a canvas (a filter per glyph made a 2048 px canvas take 45 s). */
function blurred(c, px) {
  const o = canvas(c.width, c.height);
  const x = o.getContext('2d');
  x.filter = `blur(${px}px)`;
  x.drawImage(c, 0, 0);
  return o;
}

function tex(THREE, c, srgb) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Per-letter chiselled layout: irregular baseline and size, wide tracking. Calls draw(ch, x, y, size, rot) for every glyph. */
function layoutLetters(ctx, text, W, H, opts, draw) {
  const size0 = opts.size;
  ctx.font = `${opts.weight || 700} ${size0}px ${opts.font || 'Georgia, serif'}`;
  const rows = wrapWords(ctx, text, W * 0.9);
  const lh = size0 * 1.25;
  let y = H / 2 - ((rows.length - 1) * lh) / 2 + size0 * 0.34;
  let n = 0;
  for (const row of rows) {
    ctx.font = `${opts.weight || 700} ${size0}px ${opts.font || 'Georgia, serif'}`;
    let rw = 0;
    for (const ch of row) rw += ctx.measureText(ch).width + opts.track;
    let x = W / 2 - rw / 2 + (opts.xjit ? (hash(n * 7.1) - 0.5) * opts.xjit : 0);
    for (const ch of row) {
      const s = size0 * (1 + (hash(n * 3.3) - 0.5) * (opts.sizeJit || 0));
      const yy = y + (hash(n * 5.9) - 0.5) * (opts.baseJit || 0) + Math.sin(x * 0.01) * (opts.wave || 0);
      const rot = (hash(n * 9.7) - 0.5) * (opts.rotJit || 0);
      ctx.font = `${opts.weight || 700} ${s}px ${opts.font || 'Georgia, serif'}`;
      draw(ch, x, yy, s, rot, n);
      x += ctx.measureText(ch).width + opts.track;
      n++;
    }
    y += lh;
  }
}

export function carved(THREE, text, w = 3.4) {
  const W = 2048;
  const H = Math.round(W * 0.34);
  const hc = canvas(W, H); // height: white = proud, black = cut
  const hx = hc.getContext('2d');
  hx.fillStyle = '#808080';
  hx.fillRect(0, 0, W, H);
  const ac = canvas(W, H); // albedo (rgb) + alpha
  const ax = ac.getContext('2d');
  const draw = (cx, ch, x, y, s, rot, n, dark) => {
    cx.save();
    cx.translate(x, y);
    cx.rotate(rot);
    cx.fillStyle = dark;
    cx.fillText(ch, 0, 0);
    cx.restore();
  };
  layoutLetters(hx, text, W, H, { size: 118, track: 26, baseJit: 5, sizeJit: 0.07, rotJit: 0.03, xjit: 20, weight: 700 }, (ch, x, y, s, rot, n) => {
    draw(hx, ch, x, y, s, rot, n, '#101010');
  });
  // weathering: chips of the wall break the cut edges, a few letters worn to nothing
  for (let i = 0; i < 900; i++) {
    hx.fillStyle = hash(i * 1.7) > 0.5 ? 'rgba(128,128,128,0.55)' : 'rgba(150,150,150,0.4)';
    hx.fillRect(hash(i * 2.9) * W, hash(i * 6.1) * H, 3 + hash(i) * 14, 2 + hash(i * 4.1) * 8);
  }
  layoutLetters(ax, text, W, H, { size: 118, track: 26, baseJit: 5, sizeJit: 0.07, rotJit: 0.03, xjit: 20, weight: 700 }, (ch, x, y, s, rot, n) => {
    draw(ax, ch, x, y, s, rot, n, 'rgba(32,28,24,0.78)');
  });
  ax.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 700; i++) {
    ax.fillStyle = `rgba(0,0,0,${0.35 + 0.4 * hash(i * 3.7)})`;
    ax.fillRect(hash(i * 1.3) * W, hash(i * 8.7) * H, 4 + hash(i * 2.1) * 20, 3 + hash(i * 9.1) * 10);
  }
  const nm = normalFromHeight(blurred(hc, 2.5), 5.5);
  const mat = new THREE.MeshStandardMaterial({ map: tex(THREE, ac, true), normalMap: tex(THREE, nm, false), transparent: true, depthWrite: false, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mat.normalScale.set(1.6, 1.6);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, (w * H) / W), mat);
  m.name = 'preview-carved';
  return m;
}

export function scrawled(THREE, text, w = 2.6) {
  const W = 2048;
  const H = Math.round(W * 0.4);
  const c = canvas(W, H);
  const cx = c.getContext('2d');
  cx.lineCap = 'round';
  cx.lineJoin = 'round';
  const words = text.split(' ');
  // a hand: each word a little crooked, each letter retraced once, a struck-through word
  let x = 150;
  let y = H * 0.4;
  let n = 0;
  const strike = Math.floor(words.length * 0.55);
  words.forEach((word, wi) => {
    const size = 112 + hash(wi * 2.2) * 26;
    cx.font = `italic 600 ${size}px "DejaVu Sans", Arial, sans-serif`;
    const ww = cx.measureText(word).width + 26;
    if (x + ww > W - 130) {
      x = 150 + hash(wi * 5.5) * 60;
      y += size * 1.2;
    }
    const slope = (hash(wi * 7.7) - 0.5) * 0.09;
    const startX = x;
    for (const ch of word) {
      for (let pass = 0; pass < 2; pass++) {
        cx.save();
        cx.translate(x + (hash(n * 1.1 + pass) - 0.5) * 4, y + (x - startX) * slope + (hash(n * 3.1 + pass) - 0.5) * 6);
        cx.rotate((hash(n * 9.1) - 0.5) * 0.12);
        cx.fillStyle = pass ? 'rgba(236,232,220,0.5)' : 'rgba(244,240,228,0.82)';
        cx.fillText(ch, 0, 0);
        cx.strokeStyle = 'rgba(240,236,224,0.35)';
        cx.lineWidth = 2.2;
        cx.strokeText(ch, 0, 0);
        cx.restore();
      }
      x += cx.measureText(ch).width + 2;
      n++;
    }
    if (wi === strike) {
      cx.strokeStyle = 'rgba(240,236,224,0.8)';
      cx.lineWidth = 7;
      cx.beginPath();
      cx.moveTo(startX - 8, y - size * 0.3 + 6);
      cx.lineTo(x + 8, y - size * 0.34 - 8);
      cx.stroke();
    }
    x += 34;
  });
  // chalk grain and smears
  const g = cx.getImageData(0, 0, W, H);
  for (let i = 0; i < W * H; i++) {
    if (hash(i * 0.37) > 0.62) g.data[i * 4 + 3] *= 0.35 + 0.4 * hash(i * 1.13);
  }
  cx.putImageData(g, 0, 0);
  cx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 40; i++) {
    cx.fillStyle = `rgba(0,0,0,${0.15 + 0.3 * hash(i * 4.4)})`;
    cx.fillRect(hash(i * 2.1) * W, hash(i * 7.3) * H, 40 + hash(i) * 160, 10 + hash(i * 3.3) * 30);
  }
  const mat = new THREE.MeshStandardMaterial({ map: tex(THREE, c, true), transparent: true, depthWrite: false, roughness: 1, metalness: 0, color: 0xd9d4c4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, (w * H) / W), mat);
  m.name = 'preview-scrawled';
  return m;
}

export function tag(THREE, text) {
  const W = 1024;
  const H = 384;
  const hc = canvas(W, H);
  const hx = hc.getContext('2d');
  hx.fillStyle = '#707070';
  hx.fillRect(0, 0, W, H);
  hx.strokeStyle = '#b0b0b0';
  hx.lineWidth = 14;
  hx.strokeRect(14, 14, W - 28, H - 28);
  layoutLetters(hx, text, W, H, { size: 104, track: 12, baseJit: 4, sizeJit: 0.04, rotJit: 0.02, weight: 800, font: 'Georgia, serif' }, (ch, x, y, s, rot) => {
    hx.save();
    hx.translate(x, y);
    hx.rotate(rot);
    hx.fillStyle = '#e0e0e0'; // stamped letters stand proud
    hx.fillText(ch, 0, 0);
    hx.restore();
  });
  const nm = normalFromHeight(blurred(hc, 1.5), 4);
  const ac = canvas(W, H);
  const ax = ac.getContext('2d');
  ax.fillStyle = '#5d3a28';
  ax.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    const v = hash(i * 1.9);
    ax.fillStyle = v > 0.6 ? `rgba(140,78,40,${0.25 + 0.3 * hash(i)})` : `rgba(26,16,12,${0.2 + 0.4 * hash(i * 3.3)})`;
    ax.fillRect(hash(i * 2.7) * W, hash(i * 6.7) * H, 4 + hash(i * 4.1) * 30, 3 + hash(i * 8.1) * 20);
  }
  const g = new THREE.Group();
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.128, 0.012),
    new THREE.MeshStandardMaterial({ map: tex(THREE, ac, true), normalMap: tex(THREE, nm, false), roughness: 0.78, metalness: 0.55 }),
  );
  plate.material.normalScale.set(1.4, 1.4);
  g.add(plate);
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.7, metalness: 0.7 });
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.2, 6), iron);
  wire.position.set(0, 0.164, 0.004);
  g.add(wire);
  const nail = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.003, 0.05, 6), iron);
  nail.rotation.x = Math.PI / 2;
  nail.position.set(0, 0.27, 0.022);
  g.add(nail);
  const hole = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0035, 6, 12), iron);
  hole.position.set(0, 0.066, 0.008);
  g.add(hole);
  g.name = 'preview-tag';
  g.userData.hang = true;
  return g;
}

export function revealed(THREE, text, w = 3.4) {
  const m = carved(THREE, text, w);
  // the groove is barely darker than the wall: the lantern shows only a faint bevel
  m.material.map.dispose();
  const c = canvas(2048, Math.round(2048 * 0.34));
  const cx = c.getContext('2d');
  layoutLetters(cx, text, 2048, c.height, { size: 118, track: 26, baseJit: 5, sizeJit: 0.07, rotJit: 0.03, xjit: 20, weight: 700 }, (ch, x, y, s, rot) => {
    cx.save();
    cx.translate(x, y);
    cx.rotate(rot);
    cx.fillStyle = 'rgba(40,36,30,0.16)';
    cx.fillText(ch, 0, 0);
    cx.restore();
  });
  m.material.map = tex(THREE, c, true);
  m.material.normalScale.set(0.5, 0.5);
  // the infrared paint in the grooves: white where the goggles look
  const ec = canvas(2048, c.height);
  const ex = ec.getContext('2d');
  layoutLetters(ex, text, 2048, ec.height, { size: 118, track: 26, baseJit: 5, sizeJit: 0.07, rotJit: 0.03, xjit: 20, weight: 700 }, (ch, x, y, s, rot) => {
    ex.save();
    ex.translate(x, y);
    ex.rotate(rot);
    ex.fillStyle = '#ffffff';
    ex.fillText(ch, 0, 0);
    ex.restore();
  });
  const glowMat = new THREE.MeshBasicMaterial({ map: tex(THREE, ec, true), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const glow = new THREE.Mesh(m.geometry, glowMat);
  glow.position.z = 0.002;
  m.add(glow);
  m.userData.glow = (k) => {
    glowMat.opacity = 0.95 * k;
  };
  m.name = 'preview-revealed';
  return m;
}
