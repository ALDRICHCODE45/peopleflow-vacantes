"use client";

import * as React from "react";
import { Mesh, Program, Renderer, Triangle } from "ogl";
import { FLOATING_LINES_VARIANTS } from "@/components/auth/floating-lines-shaders";

/**
 * Hero aurora — faithful OGL/WebGL port of the reference landing's inline
 * aurora module (design/landing-preview/index.html, the `type="module"` block
 * at the end of <body>).
 *
 * Fidelity contract:
 * - The vertex and fragment shader sources below are copied VERBATIM from the
 *   reference. The opaque-output + `mix-blend-mode` approach (screen in dark,
 *   multiply in light) is preserved because it is what the reference uses to
 *   composite the canvas with the page.
 * - Uniform values, palettes and the `uLightBlend` branch match the reference.
 * - The reference reads `window.PFTheme.current()` and listens for
 *   `pf:themechange`. This app's shared theme system (theme-preferences.ts)
 *   does not dispatch that event, so the same signal is derived from the
 *   resolved root state (`<html class="dark">` + `data-theme`) with a
 *   MutationObserver instead. No new theme state or persistence is created.
 *
 * Progressive enhancement / safety:
 * - Reduced motion disables the renderer; the host keeps a static ambient
 *   gradient via `data-static="true"`.
 * - A WebGL failure is contained and leaves the same static fallback visible.
 * - Every listener, the RAF handle, the observer and the GL context are
 *   cleaned up on unmount or when motion is reduced.
 */

const VERTEX = `
      attribute vec2 uv;
      attribute vec2 position;
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position, 0, 1); }
    `;

const FRAGMENT = `
      precision highp float;
      uniform float uTime; uniform vec3 uResolution;
      uniform float uSpeed; uniform float uScale; uniform float uBrightness;
      uniform vec3 uColor1; uniform vec3 uColor2;
      uniform float uNoiseFreq; uniform float uNoiseAmp; uniform float uBandHeight; uniform float uBandSpread;
      uniform float uOctaveDecay; uniform float uLayerOffset; uniform float uColorSpeed;
      uniform vec2 uMouse; uniform float uMouseInfluence; uniform bool uEnableMouse;
      uniform float uLightBlend;
      #define TAU 6.28318
      vec3 gradientHash(vec3 p){
        p = vec3(dot(p, vec3(127.1,311.7,234.6)), dot(p, vec3(269.5,183.3,198.3)), dot(p, vec3(169.5,283.3,156.9)));
        vec3 h = fract(sin(p) * 43758.5453123);
        float phi = acos(2.0*h.x-1.0); float theta = TAU*h.y;
        return vec3(cos(theta)*sin(phi), sin(theta)*cos(phi), cos(phi));
      }
      float quinticSmooth(float t){ float t2=t*t; float t3=t*t2; return 6.0*t3*t2 - 15.0*t2*t2 + 10.0*t3; }
      vec3 cosineGradient(float t, vec3 a, vec3 b, vec3 c, vec3 d){ return a + b*cos(TAU*(c*t+d)); }
      float perlin3D(float amplitude, float frequency, float px, float py, float pz){
        float x=px*frequency; float y=py*frequency;
        float fx=floor(x); float fy=floor(y); float fz=floor(pz);
        float cx=ceil(x); float cy=ceil(y); float cz=ceil(pz);
        vec3 g000=gradientHash(vec3(fx,fy,fz)); vec3 g100=gradientHash(vec3(cx,fy,fz));
        vec3 g010=gradientHash(vec3(fx,cy,fz)); vec3 g110=gradientHash(vec3(cx,cy,fz));
        vec3 g001=gradientHash(vec3(fx,fy,cz)); vec3 g101=gradientHash(vec3(cx,fy,cz));
        vec3 g011=gradientHash(vec3(fx,cy,cz)); vec3 g111=gradientHash(vec3(cx,cy,cz));
        float d000=dot(g000,vec3(x-fx,y-fy,pz-fz)); float d100=dot(g100,vec3(x-cx,y-fy,pz-fz));
        float d010=dot(g010,vec3(x-fx,y-cy,pz-fz)); float d110=dot(g110,vec3(x-cx,y-cy,pz-fz));
        float d001=dot(g001,vec3(x-fx,y-fy,pz-cz)); float d101=dot(g101,vec3(x-cx,y-fy,pz-cz));
        float d011=dot(g011,vec3(x-fx,y-cy,pz-cz)); float d111=dot(g111,vec3(x-cx,y-cy,pz-cz));
        float sx=quinticSmooth(x-fx); float sy=quinticSmooth(y-fy); float sz=quinticSmooth(pz-fz);
        float lx00=mix(d000,d100,sx); float lx10=mix(d010,d110,sx);
        float lx01=mix(d001,d101,sx); float lx11=mix(d011,d111,sx);
        float ly0=mix(lx00,lx10,sy); float ly1=mix(lx01,lx11,sy);
        return amplitude*mix(ly0,ly1,sz);
      }
      float auroraGlow(float t, vec2 shift){
        vec2 uv = gl_FragCoord.xy / uResolution.y; uv += shift;
        float noiseVal=0.0; float freq=uNoiseFreq; float amp=uNoiseAmp; vec2 samplePos=uv*uScale;
        for(float i=0.0;i<3.0;i+=1.0){ noiseVal+=perlin3D(amp,freq,samplePos.x,samplePos.y,t); amp*=uOctaveDecay; freq*=2.0; }
        float yBand = uv.y*10.0 - uBandHeight*10.0;
        return 0.3 * max(exp(uBandSpread*(1.0-1.1*abs(noiseVal+yBand))), 0.0);
      }
      void main(){
        vec2 uv = gl_FragCoord.xy / uResolution.xy;
        float t = uSpeed*0.4*uTime;
        vec2 shift = vec2(0.0);
        if(uEnableMouse){ shift = (uMouse-0.5)*uMouseInfluence; }
        vec3 col = vec3(0.0);
        col += 0.99 * auroraGlow(t, shift) * cosineGradient(uv.x + uTime*uSpeed*0.2*uColorSpeed, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.3,0.20,0.20)) * uColor1;
        col += 0.99 * auroraGlow(t + uLayerOffset, shift) * cosineGradient(uv.x + uTime*uSpeed*0.1*uColorSpeed, vec3(0.5), vec3(0.5), vec3(2.0,1.0,0.0), vec3(0.5,0.20,0.25)) * uColor2;
        col *= uBrightness;

        /* ---- OPAQUE OUTPUT + CSS mix-blend-mode ------------------------------
           This mirrors the login screens' FloatingLines, which render flawlessly
           in Safari: an OPAQUE WebGL canvas (alpha:false, alpha=1.0) blended with
           the page through CSS mix-blend-mode, NOT a transparent canvas.
           Safari/WebKit mis-composites transparent WebGL canvases (that was the
           real root cause of the black/white boxes AND the invisible aurora), but
           handles opaque canvas + mix-blend-mode correctly.

           Coverage: aurora intensity, feathered by a gentle corner vignette so the
           opaque canvas edges never show a hard rectangle after blending. */
        float intensity = clamp(length(col), 0.0, 1.0);
        vec2 vig = vec2((uv.x - 0.5) / 0.78, (uv.y - 0.5) / 0.70);
        float mask = 1.0 - smoothstep(0.85, 1.25, length(vig));
        float g = intensity * mask;

        vec3 outCol;
        if (uLightBlend > 0.5) {
          /* LIGHT: container uses mix-blend-mode multiply. White pixels leave
             the page untouched; where the aurora glows we output its (normalized)
             hue so multiply tints the warm off-white page with brand purple. */
          vec3 hue = col / max(intensity, 1e-4);
          outCol = mix(vec3(1.0), hue, g);
        } else {
          /* DARK: container uses mix-blend-mode screen. Black pixels leave the
             page untouched; the glow adds over the near-black background. */
          outCol = col * mask;
        }
        gl_FragColor = vec4(outCol, 1.0);
      }
    `;

const hexToVec3 = (hex: string): number[] => {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
};

/* Dark palette — identical to the reference so the dark theme is unchanged. */
const DARK_PALETTE = {
  color1: "#C89BFF",
  color2: "#9336EA",
  brightness: 0.95,
  bandHeight: 0.5,
  bandSpread: 1.0,
};
/* Light palette: deeper purples + tighter bands (controlled brand wash). */
const LIGHT_PALETTE = {
  color1: "#7B22C9",
  color2: "#5B1899",
  brightness: 0.7,
  bandHeight: 0.55,
  bandSpread: 0.85,
};

// Only the two color uniforms differ: the shader, timing and band geometry
// stay identical to the employer hero. Reuse the candidate login's accent pair.
const CANDIDATE_DARK_PALETTE = {
  ...DARK_PALETTE,
  color1: FLOATING_LINES_VARIANTS.candidate.darkGradient[0],
  color2: FLOATING_LINES_VARIANTS.candidate.darkGradient[1],
};
const CANDIDATE_LIGHT_PALETTE = {
  ...LIGHT_PALETTE,
  color1: FLOATING_LINES_VARIANTS.candidate.lightPalette[0],
  color2: FLOATING_LINES_VARIANTS.candidate.lightPalette[1],
};

export function HeroAurora({ audience = "employer" }: { audience?: "employer" | "candidate" } = {}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [reducedMotion, setReducedMotion] = React.useState(false);

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(media.matches);
    const onChange = () => setReducedMotion(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Authoritative reduced-motion guard: never mount WebGL for a user who
    // asked for less motion, regardless of the state-render timing above.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let renderer: InstanceType<typeof Renderer>;
    try {
      renderer = new Renderer({ alpha: false });
    } catch {
      // WebGL is progressive enhancement; the static fallback stays visible.
      return;
    }

    const gl = renderer.gl;
    // jsdom / a browser without a WebGL context: ogl logs and leaves `gl`
    // unset. Keep the static fallback instead of touching a null context.
    if (!gl) return;
    gl.clearColor(0, 0, 0, 1);

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex: VERTEX,
      fragment: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: [1, 1, 1] },
        uSpeed: { value: 0.5 },
        uScale: { value: 1.4 },
        uBrightness: { value: DARK_PALETTE.brightness },
        uColor1: { value: hexToVec3(DARK_PALETTE.color1) },
        uColor2: { value: hexToVec3(DARK_PALETTE.color2) },
        uNoiseFreq: { value: 2.5 },
        uNoiseAmp: { value: 1.0 },
        uBandHeight: { value: DARK_PALETTE.bandHeight },
        uBandSpread: { value: DARK_PALETTE.bandSpread },
        uOctaveDecay: { value: 0.1 },
        uLayerOffset: { value: 0.0 },
        uColorSpeed: { value: 1.0 },
        uMouse: { value: new Float32Array([0.5, 0.5]) },
        uMouseInfluence: { value: 0.22 },
        uEnableMouse: { value: true },
        uLightBlend: { value: 0.0 },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });
    container.appendChild(gl.canvas);

    const resize = () => {
      renderer.setSize(container.offsetWidth, container.offsetHeight);
      program.uniforms.uResolution.value = [
        gl.canvas.width,
        gl.canvas.height,
        gl.canvas.width / gl.canvas.height,
      ];
    };
    window.addEventListener("resize", resize);
    resize();

    const currentMouse = [0.5, 0.5];
    let targetMouse = [0.5, 0.5];
    const onMouseMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      targetMouse = [
        (event.clientX - rect.left) / rect.width,
        1.0 - (event.clientY - rect.top) / rect.height,
      ];
    };
    window.addEventListener("mousemove", onMouseMove, { passive: true });

    /* Theme binding: same uniforms + blend mode the reference applies in
       applyAuroraTheme(), derived from the resolved root theme. */
    const applyAuroraTheme = () => {
      const isLight = !document.documentElement.classList.contains("dark");
      const palette = audience === "candidate"
        ? (isLight ? CANDIDATE_LIGHT_PALETTE : CANDIDATE_DARK_PALETTE)
        : (isLight ? LIGHT_PALETTE : DARK_PALETTE);
      program.uniforms.uColor1.value = hexToVec3(palette.color1);
      program.uniforms.uColor2.value = hexToVec3(palette.color2);
      program.uniforms.uBrightness.value = palette.brightness;
      program.uniforms.uBandHeight.value = palette.bandHeight;
      program.uniforms.uBandSpread.value = palette.bandSpread;
      program.uniforms.uLightBlend.value = isLight ? 1.0 : 0.0;
      container.style.mixBlendMode = isLight ? "multiply" : "screen";
    };
    applyAuroraTheme();
    const themeObserver = new MutationObserver(applyAuroraTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    let frame = 0;
    const update = (time: number) => {
      frame = requestAnimationFrame(update);
      program.uniforms.uTime.value = time * 0.001;
      currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0]);
      currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1]);
      program.uniforms.uMouse.value[0] = currentMouse[0];
      program.uniforms.uMouse.value[1] = currentMouse[1];
      renderer.render({ scene: mesh });
    };
    frame = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(frame);
      themeObserver.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      if (gl.canvas.parentNode === container) container.removeChild(gl.canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
    // Re-runs when the motion preference flips so the renderer is torn down for
    // reduced motion and restored when motion is allowed again.
  }, [reducedMotion, audience]);

  return (
    <div
      ref={containerRef}
      id="heroAurora"
      data-pf-hero-aurora=""
      data-audience={audience}
      data-static={reducedMotion ? "true" : "false"}
      aria-hidden="true"
      className="aurora pointer-events-none absolute inset-0 overflow-hidden"
    />
  );
}
