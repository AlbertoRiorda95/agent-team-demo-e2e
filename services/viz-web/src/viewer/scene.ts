import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PlaybackState } from './interpolate';
import { Sample_Phase, type Sample } from '@albertoriorda95/trajectory-proto';

export interface SceneApi {
  setTrajectory(samples: readonly Sample[]): void;
  setState(s: PlaybackState): void;
  resetView(): void;
  resize(): void;
  dispose(): void;
}

const css = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ENU (x east, y north, z up) to three.js (y up): east = +x, north = -z, up = +y
const toScene = (s: Sample): [number, number, number] => [s.xM, s.zM, -s.yM];

function label(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  g.fillStyle = color;
  g.font = `bold 40px ${css('--font-mono') || 'monospace'}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 32);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sprite.scale.set(2, 1, 1);
  return sprite;
}

/** Throws when WebGL is unavailable: the caller shows the error state. */
export function createScene(host: HTMLElement): SceneApi {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(new THREE.Color(css('--color-bg')));
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1e7);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  const dynamic = new THREE.Group();
  scene.add(dynamic);

  const accent = new THREE.Color(css('--color-accent'));
  const burn = new THREE.Color(css('--color-burn'));
  const fg = css('--color-fg-muted');
  const marker = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(css('--color-fg')) }));
  scene.add(marker);

  let points: Float32Array = new Float32Array(0);
  let trail: THREE.Line | null = null;
  let trailBuf: Float32Array = new Float32Array(0);
  let lastSlot = -1;
  let center = new THREE.Vector3();
  let radius = 1;
  let disposed = false;

  const render = (): void => {
    if (!disposed) renderer.render(scene, camera);
  };
  controls.addEventListener('change', render);

  function clear(): void {
    for (const o of [...dynamic.children]) {
      dynamic.remove(o);
      (o as THREE.Mesh).geometry?.dispose();
    }
    trail = null;
  }

  function line(arr: Float32Array, color: THREE.Color): THREE.Line {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color }));
  }

  function fit(): void {
    const dir = new THREE.Vector3(1, 0.8, 1).normalize();
    const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.1;
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.near = Math.max(radius / 1000, 0.01);
    camera.far = dist + radius * 20;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
    render();
  }

  return {
    setTrajectory(samples) {
      clear();
      const n = samples.length;
      points = new Float32Array(n * 3);
      const box = new THREE.Box3();
      samples.forEach((s, i) => {
        const p = toScene(s);
        points.set(p, i * 3);
        box.expandByPoint(new THREE.Vector3(...p));
      });
      box.expandByPoint(new THREE.Vector3(0, 0, 0));
      center = box.getCenter(new THREE.Vector3());
      radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);

      // burn part, then ballistic part (one sample overlaps so there is no gap)
      let firstBallistic = samples.findIndex(s => s.phase !== Sample_Phase.BURN);
      if (firstBallistic < 0) firstBallistic = n;
      const burnEnd = Math.min(n, firstBallistic + 1);
      if (burnEnd > 1) dynamic.add(line(points.slice(0, burnEnd * 3), burn));
      if (n - firstBallistic > 0 && n > 1) dynamic.add(line(points.slice(Math.max(0, firstBallistic - 1) * 3), accent));

      const extent = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 1);
      const size = Math.ceil(extent * 1.2 / 10) * 10 || 10;
      const grid = new THREE.GridHelper(size, 10, new THREE.Color(css('--color-border')), new THREE.Color(css('--color-border')));
      grid.position.set(box.getCenter(new THREE.Vector3()).x, 0, box.getCenter(new THREE.Vector3()).z);
      dynamic.add(grid);

      const axisLen = size / 2;
      const axes: Array<[string, THREE.Vector3]> = [
        ['E', new THREE.Vector3(axisLen, 0, 0)],
        ['N', new THREE.Vector3(0, 0, -axisLen)],
        ['Up', new THREE.Vector3(0, axisLen, 0)],
      ];
      for (const [name, v] of axes) {
        dynamic.add(line(new Float32Array([0, 0, 0, v.x, v.y, v.z]), new THREE.Color(fg)));
        const l = label(name, fg);
        l.position.copy(v).multiplyScalar(1.05);
        l.scale.multiplyScalar(axisLen / 8);
        dynamic.add(l);
      }

      const t = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: new THREE.Color(css('--color-fg')) }));
      // one extra slot at the end of the buffer holds the interpolated point
      lastSlot = -1;
      trailBuf = new Float32Array((n + 1) * 3);
      trailBuf.set(points);
      t.geometry.setAttribute('position', new THREE.BufferAttribute(trailBuf, 3));
      t.geometry.setDrawRange(0, 1);
      trail = t;
      dynamic.add(t);
      marker.scale.setScalar(radius / 60);
      fit();
    },
    setState(st) {
      const n = points.length / 3;
      if (n === 0) return;
      const [x, y, z] = [st.x, st.z, -st.y];
      marker.position.set(x, y, z);
      // the trail: samples 0..index, then the interpolated point (the slot after them)
      const k = Math.min(st.index, n - 1);
      const attr = trail?.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (attr) {
        // restore the slot the previous state overwrote, then write the current one
        if (lastSlot >= 0 && lastSlot < n) trailBuf.set(points.subarray(lastSlot * 3, lastSlot * 3 + 3), lastSlot * 3);
        trailBuf.set([x, y, z], (k + 1) * 3);
        lastSlot = k + 1;
        attr.needsUpdate = true;
        trail?.geometry.setDrawRange(0, k + 2);
      }
      render();
    },
    resetView: fit,
    resize() {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    },
    dispose() {
      disposed = true;
      controls.dispose();
      clear();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
