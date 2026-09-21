/**
 * CCP-R7D2A — engine-independent reference contract for the two login
 * animations, extracted verbatim from the approved design screens
 * (design/screens/login-candidato.html and login-empresa.html).
 *
 * FROZEN CONTRACT, not a redesign: both screens inline the same FloatingLines
 * program, so the fragment shader and the shape of the animation config are
 * shared, while the gradient/palette are per variant. The parity suite extracts
 * all of it from the committed HTML on every run. Do not reformat shader
 * strings, rename uniforms, or retune constants here.
 */

/**
 * Reference Three.js vertex shader, byte-for-byte. Kept as the parity anchor
 * only: Three injects `projectionMatrix`/`modelViewMatrix`, so this source is
 * NOT what the OGL host (CCP-R7D2B) can compile.
 */
export const FLOATING_LINES_VERTEX_SHADER =
     "void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }";

/**
 * OGL fullscreen vertex shader for the later host. OGL injects NO built-ins, so
 * the attributes it feeds from an ogl `Triangle` (`position`, `uv`) are declared
 * here and the clip-space vertex is written directly, reproducing exactly what
 * the reference plane geometry produces. `uv` is passed through so the driver
 * keeps the attribute active, matching the proven HeroAurora convention.
 */
export const FLOATING_LINES_OGL_VERTEX_SHADER = `attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }`;

/** Reference fragment shader template literal, byte-for-byte (indents included). */
export const FLOATING_LINES_FRAGMENT_SHADER = `precision highp float;
      uniform float iTime; uniform vec3 iResolution; uniform float animationSpeed;
      uniform int topLineCount; uniform int middleLineCount; uniform int bottomLineCount;
      uniform float topLineDistance; uniform float middleLineDistance; uniform float bottomLineDistance;
      uniform vec3 topWavePosition; uniform vec3 middleWavePosition; uniform vec3 bottomWavePosition;
      uniform vec2 iMouse; uniform float bendRadius; uniform float bendStrength; uniform float bendInfluence;
      uniform vec2 parallaxOffset; uniform vec3 lineGradient[8]; uniform int lineGradientCount;
      mat2 rot(float r){ return mat2(cos(r),sin(r),-sin(r),cos(r)); }
      vec3 pickGrad(int index){ vec3 c=lineGradient[0]; for(int k=0;k<8;k++){ if(k>=lineGradientCount) break; if(k==index) c=lineGradient[k]; } return c; }
      vec3 getLineColor(float t){ if(lineGradientCount<=0) return vec3(0.0); if(lineGradientCount==1) return pickGrad(0)*0.5; float ct=clamp(t,0.0,0.9999); float s=ct*float(lineGradientCount-1); int i=int(floor(s)); float f=fract(s); int j=min(i+1,lineGradientCount-1); return mix(pickGrad(i),pickGrad(j),f)*0.5; }
      float wave(vec2 uv,float offset,vec2 su,vec2 mu){ float time=iTime*animationSpeed; float amp=sin(offset+time*0.2)*0.3; float y=sin(uv.x+offset+time*0.1)*amp; vec2 d=su-mu; float infl=exp(-dot(d,d)*bendRadius); y+=(mu.y-su.y)*infl*bendStrength*bendInfluence; float m=uv.y-y; return 0.0175/max(abs(m)+0.01,1e-3)+0.01; }
      void main(){
        vec2 baseUv=(2.0*gl_FragCoord.xy-iResolution.xy)/iResolution.y; baseUv.y*=-1.0; baseUv+=parallaxOffset;
        vec2 mu=(2.0*iMouse-iResolution.xy)/iResolution.y; mu.y*=-1.0;
        vec3 col=vec3(0.0);
        for(int i=0;i<8;++i){ if(i>=bottomLineCount) break; float fi=float(i); float t=fi/max(float(bottomLineCount-1),1.0); float a=bottomWavePosition.z*log(length(baseUv)+1.0); vec2 ruv=baseUv*rot(a); col+=getLineColor(t)*wave(ruv+vec2(bottomLineDistance*fi+bottomWavePosition.x,bottomWavePosition.y),1.5+0.2*fi,baseUv,mu)*0.2; }
        for(int i=0;i<8;++i){ if(i>=middleLineCount) break; float fi=float(i); float t=fi/max(float(middleLineCount-1),1.0); float a=middleWavePosition.z*log(length(baseUv)+1.0); vec2 ruv=baseUv*rot(a); col+=getLineColor(t)*wave(ruv+vec2(middleLineDistance*fi+middleWavePosition.x,middleWavePosition.y),2.0+0.15*fi,baseUv,mu); }
        for(int i=0;i<8;++i){ if(i>=topLineCount) break; float fi=float(i); float t=fi/max(float(topLineCount-1),1.0); float a=topWavePosition.z*log(length(baseUv)+1.0); vec2 ruv=baseUv*rot(a); ruv.x*=-1.0; col+=getLineColor(t)*wave(ruv+vec2(topLineDistance*fi+topWavePosition.x,topWavePosition.y),1.0+0.2*fi,baseUv,mu)*0.1; }
        gl_FragColor=vec4(col,1.0);
      }`;

/**
 * The exact reference `cfg`, WITHOUT the per-variant `linesGradient`: every
 * scalar and every wave vector below is byte-identical in BOTH design screens,
 * so it is shared once. `top`/`mid`/`bot` are the reference's wave-position
 * triples (x offset, y offset, rotation strength).
 */
export const FLOATING_LINES_CONFIG = {
     lineCount: 8,
     lineDistance: 0.08,
     animationSpeed: 1,
     bendRadius: 8,
     bendStrength: -2,
     mouseDamping: 0.05,
     parallaxStrength: 0.2,
     top: [10.0, 0.5, -0.4],
     mid: [5.0, 0.0, 0.2],
     bot: [2.0, -0.7, -1],
} as const;

/** Login route variants carrying the FloatingLines visual panel. */
export type FloatingLinesVariant = "employer" | "candidate";

/**
 * Per-variant reference palettes, each extracted from its OWN design screen
 * (the candidate gradient is NOT the employer one):
 *
 * - employer dark:  '#9336ea' → '#6f6f6f' → '#6a6a6a'  (login-empresa.html cfg)
 * - employer light: '#9336EA' → '#7B22C9' → '#5B1899'  (login-empresa.html lightPalette)
 * - candidate dark: '#22d3ee' → '#9336ea' → '#6f6f6f'  (login-candidato.html cfg)
 * - candidate light:'#0E8FA5' → '#7B22C9' → '#5B1899'  (login-candidato.html lightPalette)
 *
 * The screens pair `darkGradient` with a `screen` blend and `lightPalette` with
 * a `multiply` blend; the blend-mode application belongs to the OGL host.
 */
export const FLOATING_LINES_VARIANTS = {
     employer: {
          darkGradient: ["#9336ea", "#6f6f6f", "#6a6a6a"],
          lightPalette: ["#9336EA", "#7B22C9", "#5B1899"],
     },
     candidate: {
          darkGradient: ["#22d3ee", "#9336ea", "#6f6f6f"],
          lightPalette: ["#0E8FA5", "#7B22C9", "#5B1899"],
     },
} as const satisfies Record<
     FloatingLinesVariant,
     { darkGradient: readonly string[]; lightPalette: readonly string[] }
>;

/**
 * Reduced-motion static frame time of the UNCHANGED shader. The references
 * handle no motion preference; the OGL leaf renders this single representative
 * mid-animation frame once, with no RAF loop and no pointer influence, because
 * t=0 renders an overexposed frame. Value frozen here so both routes share it.
 */
export const FLOATING_LINES_REDUCED_MOTION_FRAME_TIME = 4;

/**
 * Media queries the OGL host must use, both traceable to repository sources:
 * the app's own stylesheet declares the reduced-motion contract, and both
 * design screens gate the `#floatingLines` panel with `hidden lg:block`, i.e.
 * Tailwind's `lg` breakpoint (64rem at a 16px root = 1024px).
 */
export const FLOATING_LINES_MEDIA_QUERIES = {
     reducedMotion: "(prefers-reduced-motion: reduce)",
     desktop: "(min-width: 1024px)",
} as const;
