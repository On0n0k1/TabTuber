/*
 * three.js stage: transparent canvas, camera, lights and the render loop.
 *
 * The canvas must stay transparent. The page is composited over game footage
 * in OBS (SPEC.md section 9), so nothing here may set an opaque clear colour.
 * Dev-only backgrounds are a CSS concern on <body>, behind the canvas.
 *
 * Owns no avatar state -- callers register per-frame work with onFrame and
 * add their own objects to `scene`.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** Fallback subject height in metres, from the reference rig (SPEC.md 7.1.1). */
export const SUBJECT_HEIGHT_M = 1.6;

/**
 * Capping device pixel ratio at 2 costs nothing visible and avoids rendering
 * 9x the pixels on a 3x phone display.
 */
const MAX_PIXEL_RATIO = 2;

export interface FrameContext {
  /** Seconds since the previous frame, clamped to survive tab backgrounding. */
  readonly dt: number;
  /** Seconds since start. */
  readonly elapsed: number;
}

export type FrameCallback = (ctx: FrameContext) => void;

export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;

  /** Helpers grouped so they can be hidden in one go for capture. */
  readonly helpers = new THREE.Group();

  /**
   * Framing follows the loaded model rather than the model being rescaled to
   * suit the framing. Rescaling would break spring-bone physics, which are
   * tuned in absolute units at the authored scale, and tracking is
   * scale-free anyway since the solver only writes rotations (SPEC.md 7.2).
   */
  private subjectHeight = SUBJECT_HEIGHT_M;
  private posture: "sitting" | "standing" = "sitting";

  private readonly callbacks: FrameCallback[] = [];
  private readonly clock = new THREE.Clock();
  private elapsed = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      // Left off for performance. Anything grabbing a still off the canvas
      // must do it inside the render callback, before the buffer is cleared.
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setClearAlpha(0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
    // Framed on the upper body: this is a VTubing rig and the torso, arms and
    // head are what viewers see. Legs are never driven anyway (SPEC.md 5.7).
    this.camera.position.set(0, SUBJECT_HEIGHT_M * 0.85, 2.1);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, SUBJECT_HEIGHT_M * 0.78, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.update();

    this.addLights();
    this.addHelpers();
    this.scene.add(this.helpers);

    window.addEventListener("resize", this.handleResize);
    this.handleResize();
  }

  private addLights(): void {
    // Flat, even lighting. The debug rig is colour-coded by body region and
    // strong directional shading would fight that readability.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 2.0));

    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(1.5, 3, 2.5);
    this.scene.add(key);
  }

  private addHelpers(): void {
    const grid = new THREE.GridHelper(4, 16, 0x556070, 0x333a44);
    this.helpers.add(grid);

    // Axes at origin: red +X is the subject's LEFT, blue +Z is toward the
    // camera. The single fastest way to catch a mirrored axis (SPEC.md 5.1).
    const axes = new THREE.AxesHelper(0.4);
    this.helpers.add(axes);
  }

  private readonly handleResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  /**
   * Reframes for the subject's posture (SPEC.md 5.8). Sitting frames the
   * upper body, which is what a desk VTuber's audience sees; standing pulls
   * back far enough for the whole figure.
   */
  frameFor(posture: "sitting" | "standing" = this.posture): void {
    this.posture = posture;
    const h = this.subjectHeight;

    if (posture === "standing") {
      this.camera.position.set(0, h * 0.6, h * 2.125);
      this.controls.target.set(0, h * 0.5, 0);
    } else {
      this.camera.position.set(0, h * 0.85, h * 1.3125);
      this.controls.target.set(0, h * 0.78, 0);
    }
    this.controls.update();
  }

  /** Reframes for a newly loaded model of a different size. */
  setSubjectHeight(height: number): void {
    if (height > 0.1 && height < 100) this.subjectHeight = height;
    this.frameFor();
  }

  onFrame(cb: FrameCallback): void {
    this.callbacks.push(cb);
  }

  set helpersVisible(v: boolean) {
    this.helpers.visible = v;
  }

  get helpersVisible(): boolean {
    return this.helpers.visible;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.renderer.setAnimationLoop(this.tick);
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private readonly tick = (): void => {
    // Clamped: returning to a backgrounded tab otherwise yields a multi-second
    // delta that makes every time-based animation jump.
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.elapsed += dt;

    this.controls.update();
    for (const cb of this.callbacks) cb({ dt, elapsed: this.elapsed });
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.stop();
    window.removeEventListener("resize", this.handleResize);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
