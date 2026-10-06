/**
 * Cinematic post-processing: render (4x MSAA, half-float) -> subtle bloom on
 * specular highlights -> tone mapping / sRGB (OutputPass) -> vignette + grain.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.012 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAspect;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      float vignette = smoothstep(1.05, 0.25, length(d) * 1.1);
      color.rgb *= mix(1.0 - uVignette, 1.0, vignette);
      float grain = hash(gl_FragCoord.xy + fract(uTime * 7.31) * 613.0) - 0.5;
      color.rgb += grain * uGrain;
      gl_FragColor = color;
    }`,
};

export function createPostFX(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(renderer.getPixelRatio());

  composer.addPass(new RenderPass(scene, camera));
  // High threshold: only real specular glints and the screen bloom, never the white panels.
  const bloom = new UnrealBloomPass(size.clone(), 0.2, 0.5, 1.15);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const finish = new ShaderPass(FinishShader);
  finish.uniforms.uAspect.value = size.x / size.y;
  composer.addPass(finish);

  return {
    render(seconds) {
      finish.uniforms.uTime.value = seconds;
      composer.render();
    },
    setSize(width, height) {
      composer.setSize(width, height);
      finish.uniforms.uAspect.value = width / height;
    },
  };
}
