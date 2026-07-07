/* PeopleFlow — Soft Aurora background (OGL / WebGL), reusable across screens.
   Usage: import { initAurora } from './assets/aurora.js';
          initAurora('elementId', { color1, color2, brightness, speed, scale }); */
import { Renderer, Program, Mesh, Triangle } from 'https://esm.sh/ogl@1.0.11';

const vertex = `attribute vec2 uv; attribute vec2 position; varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position,0,1); }`;

const fragment = `precision highp float;
uniform float uTime; uniform vec3 uResolution; uniform float uSpeed; uniform float uScale; uniform float uBrightness;
uniform vec3 uColor1; uniform vec3 uColor2; uniform float uNoiseFreq; uniform float uNoiseAmp; uniform float uBandHeight;
uniform float uBandSpread; uniform float uOctaveDecay; uniform float uLayerOffset; uniform float uColorSpeed;
uniform vec2 uMouse; uniform float uMouseInfluence; uniform bool uEnableMouse;
#define TAU 6.28318
vec3 gradientHash(vec3 p){ p=vec3(dot(p,vec3(127.1,311.7,234.6)),dot(p,vec3(269.5,183.3,198.3)),dot(p,vec3(169.5,283.3,156.9))); vec3 h=fract(sin(p)*43758.5453123); float phi=acos(2.0*h.x-1.0); float theta=TAU*h.y; return vec3(cos(theta)*sin(phi),sin(theta)*cos(phi),cos(phi)); }
float quinticSmooth(float t){ float t2=t*t; float t3=t*t2; return 6.0*t3*t2-15.0*t2*t2+10.0*t3; }
vec3 cosineGradient(float t,vec3 a,vec3 b,vec3 c,vec3 d){ return a+b*cos(TAU*(c*t+d)); }
float perlin3D(float amplitude,float frequency,float px,float py,float pz){ float x=px*frequency; float y=py*frequency; float fx=floor(x); float fy=floor(y); float fz=floor(pz); float cx=ceil(x); float cy=ceil(y); float cz=ceil(pz); vec3 g000=gradientHash(vec3(fx,fy,fz)); vec3 g100=gradientHash(vec3(cx,fy,fz)); vec3 g010=gradientHash(vec3(fx,cy,fz)); vec3 g110=gradientHash(vec3(cx,cy,fz)); vec3 g001=gradientHash(vec3(fx,fy,cz)); vec3 g101=gradientHash(vec3(cx,fy,cz)); vec3 g011=gradientHash(vec3(fx,cy,cz)); vec3 g111=gradientHash(vec3(cx,cy,cz)); float d000=dot(g000,vec3(x-fx,y-fy,pz-fz)); float d100=dot(g100,vec3(x-cx,y-fy,pz-fz)); float d010=dot(g010,vec3(x-fx,y-cy,pz-fz)); float d110=dot(g110,vec3(x-cx,y-cy,pz-fz)); float d001=dot(g001,vec3(x-fx,y-fy,pz-cz)); float d101=dot(g101,vec3(x-cx,y-fy,pz-cz)); float d011=dot(g011,vec3(x-fx,y-cy,pz-cz)); float d111=dot(g111,vec3(x-cx,y-cy,pz-cz)); float sx=quinticSmooth(x-fx); float sy=quinticSmooth(y-fy); float sz=quinticSmooth(pz-fz); float lx00=mix(d000,d100,sx); float lx10=mix(d010,d110,sx); float lx01=mix(d001,d101,sx); float lx11=mix(d011,d111,sx); float ly0=mix(lx00,lx10,sy); float ly1=mix(lx01,lx11,sy); return amplitude*mix(ly0,ly1,sz); }
float auroraGlow(float t,vec2 shift){ vec2 uv=gl_FragCoord.xy/uResolution.y; uv+=shift; float noiseVal=0.0; float freq=uNoiseFreq; float amp=uNoiseAmp; vec2 samplePos=uv*uScale; for(float i=0.0;i<3.0;i+=1.0){ noiseVal+=perlin3D(amp,freq,samplePos.x,samplePos.y,t); amp*=uOctaveDecay; freq*=2.0; } float yBand=uv.y*10.0-uBandHeight*10.0; return 0.3*max(exp(uBandSpread*(1.0-1.1*abs(noiseVal+yBand))),0.0); }
void main(){ vec2 uv=gl_FragCoord.xy/uResolution.xy; float t=uSpeed*0.4*uTime; vec2 shift=vec2(0.0); if(uEnableMouse){ shift=(uMouse-0.5)*uMouseInfluence; } vec3 col=vec3(0.0); col+=0.99*auroraGlow(t,shift)*cosineGradient(uv.x+uTime*uSpeed*0.2*uColorSpeed,vec3(0.5),vec3(0.5),vec3(1.0),vec3(0.3,0.20,0.20))*uColor1; col+=0.99*auroraGlow(t+uLayerOffset,shift)*cosineGradient(uv.x+uTime*uSpeed*0.1*uColorSpeed,vec3(0.5),vec3(0.5),vec3(2.0,1.0,0.0),vec3(0.5,0.20,0.25))*uColor2; col*=uBrightness; float alpha=clamp(length(col),0.0,1.0); gl_FragColor=vec4(col,alpha); }`;

const hexToVec3 = (hex) => { const h = hex.replace('#',''); return [parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255]; };

export function initAurora(id, opts = {}) {
  const container = typeof id === 'string' ? document.getElementById(id) : id;
  if (!container) return;
  const { color1 = '#C89BFF', color2 = '#9336EA', brightness = 1.0, speed = 0.5, scale = 1.5, mouseInfluence = 0.2 } = opts;

  const renderer = new Renderer({ alpha: true, premultipliedAlpha: false });
  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 0);

  let program;
  const currentMouse = [0.5, 0.5];
  let targetMouse = [0.5, 0.5];

  const resize = () => {
    renderer.setSize(container.offsetWidth, container.offsetHeight);
    if (program) program.uniforms.uResolution.value = [gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height];
  };

  const geometry = new Triangle(gl);
  program = new Program(gl, {
    vertex, fragment,
    uniforms: {
      uTime: { value: 0 }, uResolution: { value: [1, 1, 1] },
      uSpeed: { value: speed }, uScale: { value: scale }, uBrightness: { value: brightness },
      uColor1: { value: hexToVec3(color1) }, uColor2: { value: hexToVec3(color2) },
      uNoiseFreq: { value: 2.5 }, uNoiseAmp: { value: 1.0 }, uBandHeight: { value: 0.5 }, uBandSpread: { value: 1.0 },
      uOctaveDecay: { value: 0.1 }, uLayerOffset: { value: 0.0 }, uColorSpeed: { value: 1.0 },
      uMouse: { value: new Float32Array([0.5, 0.5]) }, uMouseInfluence: { value: mouseInfluence }, uEnableMouse: { value: true },
    },
  });

  const mesh = new Mesh(gl, { geometry, program });
  container.appendChild(gl.canvas);
  window.addEventListener('resize', resize);
  resize();
  window.addEventListener('mousemove', (e) => {
    const r = container.getBoundingClientRect();
    targetMouse = [(e.clientX - r.left) / r.width, 1.0 - (e.clientY - r.top) / r.height];
  }, { passive: true });

  const update = (time) => {
    requestAnimationFrame(update);
    program.uniforms.uTime.value = time * 0.001;
    currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0]);
    currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1]);
    program.uniforms.uMouse.value[0] = currentMouse[0];
    program.uniforms.uMouse.value[1] = currentMouse[1];
    renderer.render({ scene: mesh });
  };
  requestAnimationFrame(update);
}
