// Ride Film Studio add-on ports: effects and overlays adapted from MIT-licensed open-source
// shader libraries into the rydr-studio-addon/1 signature (vec4 effect(vec2 uv), getColor(uv),
// resolution, time). Each keeps its original author, licence and source link. Pixel-space inputs
// in the originals (centres, sizes) are expressed as fractions of the frame here.

const GLFX = { author: "Evan Wallace (glfx.js)", license: "MIT", source: "https://github.com/evanw/glfx.js" };
const PIXI = { author: "PixiJS filters contributors", license: "MIT", source: "https://github.com/pixijs/filters" };

const RAND = "float random(vec3 scale, float seed){return fract(sin(dot(gl_FragCoord.xyz + seed, scale)) * 43758.5453 + seed);}\n";

export const GLFX_PACK = {
  id: "glfx-effects",
  name: "glfx.js effects",
  description: "Colour adjustments, blurs, warps and stylised looks from Evan Wallace's glfx.js.",
  ...GLFX,
  addons: [
    {
      id: "glfx-brightness-contrast", kind: "effect", name: "Brightness / contrast", tags: ["colour", "adjust"],
      description: "Lift or drop the brightness and stretch or flatten the contrast.",
      params: [
        { name: "brightness", label: "Brightness", type: "float", default: 0.05, min: -1, max: 1 },
        { name: "contrast", label: "Contrast", type: "float", default: 0.15, min: -1, max: 0.95 },
      ],
      glsl: `uniform float brightness;
uniform float contrast;
vec4 effect(vec2 uv){
  vec4 color = getColor(uv);
  color.rgb += brightness;
  if (contrast > 0.0) color.rgb = (color.rgb - 0.5) / (1.0 - contrast) + 0.5;
  else color.rgb = (color.rgb - 0.5) * (1.0 + contrast) + 0.5;
  return color;
}`,
    },
    {
      id: "glfx-hue-saturation", kind: "effect", name: "Hue / saturation", tags: ["colour", "adjust"],
      description: "Rotate the hues and boost or wash out the colour.",
      params: [
        { name: "hue", label: "Hue", type: "float", default: 0, min: -1, max: 1 },
        { name: "saturation", label: "Saturation", type: "float", default: 0.25, min: -1, max: 0.95 },
      ],
      glsl: `uniform float hue;
uniform float saturation;
vec4 effect(vec2 uv){
  vec4 color = getColor(uv);
  float angle = hue * 3.14159265;
  float s = sin(angle), c = cos(angle);
  vec3 weights = (vec3(2.0 * c, -sqrt(3.0) * s - c, sqrt(3.0) * s - c) + 1.0) / 3.0;
  color.rgb = vec3(dot(color.rgb, weights.xyz), dot(color.rgb, weights.zxy), dot(color.rgb, weights.yzx));
  float average = (color.r + color.g + color.b) / 3.0;
  if (saturation > 0.0) color.rgb += (average - color.rgb) * (1.0 - 1.0 / (1.001 - saturation));
  else color.rgb += (average - color.rgb) * (-saturation);
  return color;
}`,
    },
    {
      id: "glfx-vibrance", kind: "effect", name: "Vibrance", tags: ["colour", "adjust"],
      description: "Boosts the dull colours more than the already-saturated ones.",
      params: [{ name: "amount", label: "Amount", type: "float", default: 0.5, min: -1, max: 1 }],
      glsl: `uniform float amount;
vec4 effect(vec2 uv){
  vec4 color = getColor(uv);
  float average = (color.r + color.g + color.b) / 3.0;
  float mx = max(color.r, max(color.g, color.b));
  float amt = (mx - average) * (-amount * 3.0);
  color.rgb = mix(color.rgb, vec3(mx), amt);
  return color;
}`,
    },
    {
      id: "glfx-sepia", kind: "effect", name: "Sepia", tags: ["colour", "vintage"],
      description: "Warm brown vintage tone.",
      params: [{ name: "amount", label: "Amount", type: "float", default: 1, min: 0, max: 1 }],
      glsl: `uniform float amount;
vec4 effect(vec2 uv){
  vec4 color = getColor(uv);
  float r = color.r, g = color.g, b = color.b;
  color.r = min(1.0, (r * (1.0 - (0.607 * amount))) + (g * (0.769 * amount)) + (b * (0.189 * amount)));
  color.g = min(1.0, (r * 0.349 * amount) + (g * (1.0 - (0.314 * amount))) + (b * 0.168 * amount));
  color.b = min(1.0, (r * 0.272 * amount) + (g * 0.534 * amount) + (b * (1.0 - (0.869 * amount))));
  return color;
}`,
    },
    {
      id: "glfx-tilt-shift", kind: "effect", name: "Tilt-shift", tags: ["blur", "miniature"],
      description: "Blurs the top and bottom of the frame so the ride looks like a miniature model.",
      params: [
        { name: "focus", label: "Focus line (height)", type: "float", default: 0.5, min: 0, max: 1 },
        { name: "blurRadius", label: "Blur", type: "float", default: 15, min: 0, max: 50 },
        { name: "gradientRadius", label: "Sharp band", type: "float", default: 0.18, min: 0.02, max: 0.6 },
      ],
      glsl: `uniform float focus;
uniform float blurRadius;
uniform float gradientRadius;
${RAND}vec4 effect(vec2 uv){
  vec4 color = vec4(0.0);
  float total = 0.0;
  float offset = random(vec3(12.9898, 78.233, 151.7182), 0.0);
  float radius = smoothstep(0.0, 1.0, abs(uv.y - focus) / gradientRadius) * blurRadius;
  for (float t = -30.0; t <= 30.0; t++) {
    float percent = (t + offset - 0.5) / 30.0;
    float weight = 1.0 - abs(percent);
    vec2 d = vec2(percent * radius) / resolution;
    vec4 s = getColor(uv + vec2(d.x, 0.0)) * 0.5 + getColor(uv + vec2(0.0, d.y)) * 0.5;
    color += s * weight;
    total += weight;
  }
  return color / total;
}`,
    },
    {
      id: "glfx-zoom-blur", kind: "effect", name: "Zoom blur", tags: ["blur", "speed"],
      description: "Streaks everything toward a point, like a hard launch.",
      params: [
        { name: "center", label: "Centre", type: "vec2", default: [0.5, 0.5] },
        { name: "strength", label: "Strength", type: "float", default: 0.18, min: 0, max: 1 },
      ],
      glsl: `uniform vec2 center;
uniform float strength;
${RAND}vec4 effect(vec2 uv){
  vec4 color = vec4(0.0);
  float total = 0.0;
  vec2 toCenter = center - uv;
  float offset = random(vec3(12.9898, 78.233, 151.7182), 0.0);
  for (float t = 0.0; t <= 40.0; t++) {
    float percent = (t + offset) / 40.0;
    float weight = 4.0 * (percent - percent * percent);
    color += getColor(uv + toCenter * percent * strength) * weight;
    total += weight;
  }
  return color / total;
}`,
    },
    {
      id: "glfx-ink", kind: "effect", name: "Ink", tags: ["stylise", "edges"],
      description: "Darkens the edges like an ink drawing.",
      params: [{ name: "strength", label: "Strength", type: "float", default: 0.25, min: 0, max: 1 }],
      glsl: `uniform float strength;
vec4 effect(vec2 uv){
  vec2 dx = vec2(1.0 / resolution.x, 0.0);
  vec2 dy = vec2(0.0, 1.0 / resolution.y);
  vec4 color = getColor(uv);
  float bigTotal = 0.0, smallTotal = 0.0;
  vec3 bigAverage = vec3(0.0), smallAverage = vec3(0.0);
  for (float x = -2.0; x <= 2.0; x += 1.0) {
    for (float y = -2.0; y <= 2.0; y += 1.0) {
      vec3 s = getColor(uv + dx * x + dy * y).rgb;
      bigAverage += s; bigTotal += 1.0;
      if (abs(x) + abs(y) < 2.0) { smallAverage += s; smallTotal += 1.0; }
    }
  }
  vec3 edge = max(vec3(0.0), bigAverage / bigTotal - smallAverage / smallTotal);
  float k = strength * strength * strength * strength * strength;
  return vec4(color.rgb - dot(edge, edge) * k * 100000.0, color.a);
}`,
    },
    {
      id: "glfx-hex-pixelate", kind: "effect", name: "Hexagon pixelate", tags: ["stylise", "pixel"],
      description: "Turns the picture into a honeycomb of flat hexagons.",
      params: [{ name: "scale", label: "Cell size (px)", type: "float", default: 14, min: 2, max: 60 }],
      glsl: `uniform float scale;
vec4 effect(vec2 uv){
  vec2 center = resolution * 0.5;
  vec2 tex = (uv * resolution - center) / scale;
  tex.y /= 0.866025404;
  tex.x -= tex.y * 0.5;
  vec2 a;
  if (tex.x + tex.y - floor(tex.x) - floor(tex.y) < 1.0) a = vec2(floor(tex.x), floor(tex.y));
  else a = vec2(ceil(tex.x), ceil(tex.y));
  vec2 b = vec2(ceil(tex.x), floor(tex.y));
  vec2 c = vec2(floor(tex.x), ceil(tex.y));
  vec3 TEX = vec3(tex.x, tex.y, 1.0 - tex.x - tex.y);
  vec3 A = vec3(a.x, a.y, 1.0 - a.x - a.y);
  vec3 B = vec3(b.x, b.y, 1.0 - b.x - b.y);
  vec3 C = vec3(c.x, c.y, 1.0 - c.x - c.y);
  float alen = length(TEX - A), blen = length(TEX - B), clen = length(TEX - C);
  vec2 choice;
  if (alen < blen) { if (alen < clen) choice = a; else choice = c; }
  else { if (blen < clen) choice = b; else choice = c; }
  choice.x += choice.y * 0.5;
  choice.y *= 0.866025404;
  choice *= scale / resolution;
  return getColor(choice + center / resolution);
}`,
    },
    {
      id: "glfx-color-halftone", kind: "effect", name: "Colour halftone", tags: ["stylise", "print"],
      description: "CMYK print dots, like a comic or a magazine.",
      params: [
        { name: "angle", label: "Angle", type: "float", default: 0.25, min: 0, max: 1.57 },
        { name: "size", label: "Dot size (px)", type: "float", default: 4, min: 1, max: 20 },
      ],
      glsl: `uniform float angle;
uniform float size;
float pattern(vec2 uv, float a){
  float scale = 3.14159265 / size;
  float s = sin(a), c = cos(a);
  vec2 tex = uv * resolution - resolution * 0.5;
  vec2 point = vec2(c * tex.x - s * tex.y, s * tex.x + c * tex.y) * scale;
  return (sin(point.x) * sin(point.y)) * 4.0;
}
vec4 effect(vec2 uv){
  vec4 color = getColor(uv);
  vec3 cmy = 1.0 - color.rgb;
  float k = min(cmy.x, min(cmy.y, cmy.z));
  cmy = (cmy - k) / (1.0 - k + 0.00001);
  cmy = clamp(cmy * 10.0 - 3.0 + vec3(pattern(uv, angle + 0.26179), pattern(uv, angle + 1.30899), pattern(uv, angle)), 0.0, 1.0);
  k = clamp(k * 10.0 - 5.0 + pattern(uv, angle + 0.78539), 0.0, 1.0);
  return vec4(1.0 - cmy - k, color.a);
}`,
    },
    {
      id: "glfx-dot-screen", kind: "effect", name: "Dot screen", tags: ["stylise", "print", "mono"],
      description: "Black-and-white newspaper dots.",
      params: [
        { name: "angle", label: "Angle", type: "float", default: 1.1, min: 0, max: 1.57 },
        { name: "size", label: "Dot size (px)", type: "float", default: 3, min: 1, max: 20 },
      ],
      glsl: `uniform float angle;
uniform float size;
vec4 effect(vec2 uv){
  float scale = 3.14159265 / size;
  float s = sin(angle), c = cos(angle);
  vec2 tex = uv * resolution - resolution * 0.5;
  vec2 point = vec2(c * tex.x - s * tex.y, s * tex.x + c * tex.y) * scale;
  float pattern = (sin(point.x) * sin(point.y)) * 4.0;
  vec4 color = getColor(uv);
  float average = (color.r + color.g + color.b) / 3.0;
  return vec4(vec3(average * 10.0 - 5.0 + pattern), color.a);
}`,
    },
    {
      id: "glfx-swirl", kind: "effect", name: "Swirl", tags: ["warp"],
      description: "Twists the middle of the frame around its centre.",
      params: [
        { name: "radius", label: "Radius", type: "float", default: 0.4, min: 0.05, max: 1 },
        { name: "angle", label: "Twist", type: "float", default: 2.5, min: -12, max: 12 },
      ],
      glsl: `uniform float radius;
uniform float angle;
vec4 effect(vec2 uv){
  vec2 asp = vec2(resolution.x / resolution.y, 1.0);
  vec2 coord = (uv - 0.5) * asp;
  float distance = length(coord);
  if (distance < radius) {
    float percent = (radius - distance) / radius;
    float theta = percent * percent * angle;
    float s = sin(theta), c = cos(theta);
    coord = vec2(coord.x * c - coord.y * s, coord.x * s + coord.y * c);
  }
  return getColor(coord / asp + 0.5);
}`,
    },
    {
      id: "glfx-bulge-pinch", kind: "effect", name: "Bulge / pinch", tags: ["warp", "lens"],
      description: "A fisheye bulge (or pinch) in the middle of the frame.",
      params: [
        { name: "radius", label: "Radius", type: "float", default: 0.45, min: 0.05, max: 1 },
        { name: "strength", label: "Strength", type: "float", default: 0.45, min: -1, max: 1 },
      ],
      glsl: `uniform float radius;
uniform float strength;
vec4 effect(vec2 uv){
  vec2 asp = vec2(resolution.x / resolution.y, 1.0);
  vec2 coord = (uv - 0.5) * asp;
  float distance = length(coord);
  if (distance < radius && distance > 0.0) {
    float percent = distance / radius;
    if (strength > 0.0) coord *= mix(1.0, smoothstep(0.0, radius / distance, percent), strength * 0.75);
    else coord *= mix(1.0, pow(percent, 1.0 + strength * 0.75) * radius / distance, 1.0 - percent);
  }
  return getColor(coord / asp + 0.5);
}`,
    },
    {
      id: "glfx-vignette", kind: "overlay", name: "Vignette", tags: ["light", "frame"],
      description: "Darkens the corners to pull the eye to the rider.",
      params: [
        { name: "size", label: "Size", type: "float", default: 0.5, min: 0, max: 1 },
        { name: "amount", label: "Amount", type: "float", default: 0.5, min: 0, max: 1 },
      ],
      glsl: `uniform float size;
uniform float amount;
vec4 effect(vec2 uv){
  vec4 color = getColor(uv);
  float dist = distance(uv, vec2(0.5, 0.5));
  color.rgb *= smoothstep(0.8, size * 0.799, dist * (amount + size));
  return color;
}`,
    },
    {
      id: "glfx-noise", kind: "overlay", name: "Film grain", tags: ["grain", "texture"],
      description: "Moving grain over the whole frame.",
      params: [{ name: "amount", label: "Amount", type: "float", default: 0.12, min: 0, max: 1 }],
      glsl: `uniform float amount;
float rand(vec2 co){ return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453); }
vec4 effect(vec2 uv){
  vec4 color = getColor(uv);
  float diff = (rand(uv + fract(time * 7.13)) - 0.5) * amount;
  color.rgb += diff;
  return color;
}`,
    },
  ],
};

export const PIXI_PACK = {
  id: "pixi-filters",
  name: "PixiJS filters",
  description: "Old film, CRT scanlines, god rays, RGB split and more from the PixiJS filters collection.",
  ...PIXI,
  addons: [
    {
      id: "pixi-old-film", kind: "overlay", name: "Old film", tags: ["vintage", "grain", "scratches"],
      description: "Sepia, flickering grain, scratches and a soft vignette.",
      params: [
        { name: "sepia", label: "Sepia", type: "float", default: 0.3, min: 0, max: 1 },
        { name: "noise", label: "Grain", type: "float", default: 0.3, min: 0, max: 1 },
        { name: "noiseSize", label: "Grain size (px)", type: "float", default: 1, min: 1, max: 10 },
        { name: "scratch", label: "Scratches", type: "float", default: 0.5, min: -1, max: 1 },
        { name: "scratchDensity", label: "Scratch density", type: "float", default: 0.3, min: 0, max: 1 },
        { name: "scratchWidth", label: "Scratch width", type: "float", default: 1, min: 1, max: 20 },
        { name: "vignetting", label: "Vignette", type: "float", default: 0.3, min: 0, max: 1 },
        { name: "vignettingAlpha", label: "Vignette strength", type: "float", default: 1, min: 0, max: 1 },
        { name: "vignettingBlur", label: "Vignette softness", type: "float", default: 0.3, min: 0, max: 1 },
      ],
      glsl: `uniform float sepia;
uniform float noise;
uniform float noiseSize;
uniform float scratch;
uniform float scratchDensity;
uniform float scratchWidth;
uniform float vignetting;
uniform float vignettingAlpha;
uniform float vignettingBlur;
const float SQRT_2 = 1.414213;
const vec3 SEPIA_RGB = vec3(112.0 / 255.0, 66.0 / 255.0, 20.0 / 255.0);
float rand(vec2 co){ return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 Overlay(vec3 src, vec3 dst){
  return vec3((dst.x <= 0.5) ? (2.0 * src.x * dst.x) : (1.0 - 2.0 * (1.0 - dst.x) * (1.0 - src.x)),
              (dst.y <= 0.5) ? (2.0 * src.y * dst.y) : (1.0 - 2.0 * (1.0 - dst.y) * (1.0 - src.y)),
              (dst.z <= 0.5) ? (2.0 * src.z * dst.z) : (1.0 - 2.0 * (1.0 - dst.z) * (1.0 - src.z)));
}
vec4 effect(vec2 uv){
  float seed = fract(floor(time * 12.0) * 0.61803398875);
  vec4 c = getColor(uv);
  vec3 color = c.rgb;
  if (sepia > 0.0) {
    float gray = (color.x + color.y + color.z) / 3.0;
    vec3 grayscale = vec3(gray);
    color = Overlay(SEPIA_RGB, grayscale);
    color = grayscale + sepia * (color - grayscale);
  }
  vec2 coord = uv;
  if (vignetting > 0.0) {
    float outter = SQRT_2 - vignetting * SQRT_2;
    vec2 dir = vec2(0.5, 0.5) - coord;
    dir.y *= resolution.y / resolution.x;
    float darker = clamp((outter - length(dir) * SQRT_2) / (0.00001 + vignettingBlur * SQRT_2), 0.0, 1.0);
    color.rgb *= darker + (1.0 - darker) * (1.0 - vignettingAlpha);
  }
  if (scratchDensity > seed && scratch != 0.0) {
    float phase = seed * 256.0;
    float s = mod(floor(phase), 2.0);
    float dist = 1.0 / scratchDensity;
    float d = distance(coord, vec2(seed * dist, abs(s - seed * dist)));
    if (d < seed * 0.6 + 0.4) {
      float period = scratchDensity * 10.0;
      float xx = coord.x * period + phase;
      float aa = abs(mod(xx, 0.5) * 4.0);
      float bb = mod(floor(xx / 0.5), 2.0);
      float yy = (1.0 - bb) * aa + bb * (2.0 - aa);
      float kk = 2.0 * period;
      float dw = scratchWidth / resolution.x * (0.75 + seed);
      float dh = dw * kk;
      float tine = (yy - (2.0 - dh));
      if (tine > 0.0) {
        float _sign = sign(scratch);
        tine = s * tine / period + scratch + 0.1;
        tine = clamp(tine + 1.0, 0.5 + _sign * 0.5, 1.5 + _sign * 0.5);
        color.rgb *= tine;
      }
    }
  }
  if (noise > 0.0 && noiseSize > 0.0) {
    vec2 pixelCoord = floor(uv * resolution / noiseSize);
    float n = rand(pixelCoord * noiseSize * (seed + 0.01)) - 0.5;
    color += n * noise;
  }
  return vec4(color, 1.0);
}`,
    },
    {
      id: "pixi-crt", kind: "overlay", name: "CRT scanlines", tags: ["retro", "scanlines"],
      description: "Rolling scanlines, a little noise and a tube vignette.",
      params: [
        { name: "curvature", label: "Curvature", type: "float", default: 1, min: 0, max: 10 },
        { name: "lineWidth", label: "Line width", type: "float", default: 1, min: 0, max: 5 },
        { name: "lineContrast", label: "Line contrast", type: "float", default: 0.25, min: 0, max: 1 },
        { name: "verticalLine", label: "Vertical lines", type: "bool", default: false },
        { name: "noise", label: "Noise", type: "float", default: 0.15, min: 0, max: 1 },
        { name: "noiseSize", label: "Noise size (px)", type: "float", default: 1, min: 1, max: 10 },
        { name: "vignetting", label: "Vignette", type: "float", default: 0.3, min: 0, max: 1 },
        { name: "vignettingAlpha", label: "Vignette strength", type: "float", default: 1, min: 0, max: 1 },
        { name: "vignettingBlur", label: "Vignette softness", type: "float", default: 0.3, min: 0, max: 1 },
      ],
      glsl: `uniform float curvature;
uniform float lineWidth;
uniform float lineContrast;
uniform bool verticalLine;
uniform float noise;
uniform float noiseSize;
uniform float vignetting;
uniform float vignettingAlpha;
uniform float vignettingBlur;
const float SQRT_2 = 1.414213;
float rand(vec2 co){ return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453); }
vec4 effect(vec2 uv){
  float seed = fract(floor(time * 12.0) * 0.61803398875);
  vec4 c = getColor(uv);
  vec3 color = c.rgb;
  if (noise > 0.0 && noiseSize > 0.0) {
    vec2 pixelCoord = floor(uv * resolution / noiseSize);
    color += (rand(pixelCoord * noiseSize * (seed + 0.01)) - 0.5) * noise;
  }
  if (vignetting > 0.0) {
    float outter = SQRT_2 - vignetting * SQRT_2;
    vec2 dir = vec2(0.5) - uv;
    dir.y *= resolution.y / resolution.x;
    float darker = clamp((outter - length(dir) * SQRT_2) / (0.00001 + vignettingBlur * SQRT_2), 0.0, 1.0);
    color *= darker + (1.0 - darker) * (1.0 - vignettingAlpha);
  }
  if (lineWidth > 0.0) {
    vec2 dir = uv - 0.5;
    float _c = curvature > 0.0 ? curvature : 1.0;
    float k = curvature > 0.0 ? (length(dir * dir) * 0.25 * _c * _c + 0.935 * _c) : 1.0;
    vec2 v2 = dir * k;
    float v = verticalLine ? v2.x * resolution.x : v2.y * resolution.y;
    v *= min(1.0, 2.0 / lineWidth) / _c;
    float j = 1.0 + cos(v * 1.2 - time * 4.0) * 0.5 * lineContrast;
    color *= j;
    float segment = verticalLine ? mod((dir.x + 0.5) * resolution.x, 4.0) : mod((dir.y + 0.5) * resolution.y, 4.0);
    color *= 0.99 + ceil(segment) * 0.015;
  }
  return vec4(color, 1.0);
}`,
    },
    {
      id: "pixi-godray", kind: "overlay", name: "God rays", tags: ["light", "sun", "atmosphere"],
      description: "Drifting shafts of light from the top of the frame.",
      params: [
        { name: "angle", label: "Angle (degrees)", type: "float", default: 30, min: -60, max: 60 },
        { name: "gain", label: "Gain", type: "float", default: 0.5, min: 0, max: 1 },
        { name: "lacunarity", label: "Detail", type: "float", default: 2.5, min: 0, max: 5 },
        { name: "alpha", label: "Strength", type: "float", default: 0.6, min: 0, max: 1 },
        { name: "speed", label: "Drift speed", type: "float", default: 0.4, min: 0, max: 3 },
      ],
      glsl: `uniform float angle;
uniform float gain;
uniform float lacunarity;
uniform float alpha;
uniform float speed;
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
vec3 fade(vec3 t){ return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
float pnoise(vec3 P, vec3 rep){
  vec3 Pi0 = mod(floor(P), rep);
  vec3 Pi1 = mod(Pi0 + vec3(1.0), rep);
  Pi0 = mod289(Pi0); Pi1 = mod289(Pi1);
  vec3 Pf0 = fract(P); vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz; vec4 iz1 = Pi1.zzzz;
  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0); vec4 ixy1 = permute(ixy + iz1);
  vec4 gx0 = ixy0 * (1.0 / 7.0);
  vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5); gy0 -= sz0 * (step(0.0, gy0) - 0.5);
  vec4 gx1 = ixy1 * (1.0 / 7.0);
  vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5); gy1 -= sz1 * (step(0.0, gy1) - 0.5);
  vec3 g000 = vec3(gx0.x, gy0.x, gz0.x); vec3 g100 = vec3(gx0.y, gy0.y, gz0.y);
  vec3 g010 = vec3(gx0.z, gy0.z, gz0.z); vec3 g110 = vec3(gx0.w, gy0.w, gz0.w);
  vec3 g001 = vec3(gx1.x, gy1.x, gz1.x); vec3 g101 = vec3(gx1.y, gy1.y, gz1.y);
  vec3 g011 = vec3(gx1.z, gy1.z, gz1.z); vec3 g111 = vec3(gx1.w, gy1.w, gz1.w);
  vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
  g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
  float n000 = dot(g000, Pf0);
  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
  float n111 = dot(g111, Pf1);
  vec3 fade_xyz = fade(Pf0);
  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
  return 2.2 * mix(n_yz.x, n_yz.y, fade_xyz.x);
}
float turb(vec3 P, vec3 rep, float lac, float g){
  float sum = 0.0, sc = 1.0, totalgain = 1.0;
  for (float i = 0.0; i < 6.0; i++) { sum += totalgain * pnoise(P * sc, rep); sc *= lac; totalgain *= g; }
  return abs(sum);
}
vec4 effect(vec2 uv){
  vec2 coord = vec2(uv.x, 1.0 - uv.y);
  float rad = radians(angle);
  float aspect = resolution.y / resolution.x;
  float d = (cos(rad) * coord.x) + (sin(rad) * coord.y * aspect);
  float t = time * speed;
  vec3 dir = vec3(d, d, 0.0);
  float n = turb(dir + vec3(t, 0.0, 62.1 + t) * 0.05, vec3(480.0, 320.0, 480.0), lacunarity, gain);
  n = mix(n, 0.0, 0.3);
  vec3 mist = vec3(n) * (1.0 - coord.y) * alpha;
  return vec4(getColor(uv).rgb + mist, 1.0);
}`,
    },
    {
      id: "pixi-rgb-split", kind: "effect", name: "RGB split", tags: ["glitch", "lens"],
      description: "Shifts the red, green and blue channels apart.",
      params: [
        { name: "red", label: "Red offset (px)", type: "vec2", default: [-6, 0] },
        { name: "green", label: "Green offset (px)", type: "vec2", default: [0, 3] },
        { name: "blue", label: "Blue offset (px)", type: "vec2", default: [0, 0] },
      ],
      glsl: `uniform vec2 red;
uniform vec2 green;
uniform vec2 blue;
vec4 effect(vec2 uv){
  float r = getColor(uv + red / resolution).r;
  float g = getColor(uv + green / resolution).g;
  float b = getColor(uv + blue / resolution).b;
  return vec4(r, g, b, 1.0);
}`,
    },
    {
      id: "pixi-emboss", kind: "effect", name: "Emboss", tags: ["stylise", "mono"],
      description: "A grey relief, as if the map were pressed into metal.",
      params: [{ name: "strength", label: "Strength", type: "float", default: 5, min: 0, max: 20 }],
      glsl: `uniform float strength;
vec4 effect(vec2 uv){
  vec2 onePixel = 1.0 / resolution;
  vec4 color = vec4(0.5, 0.5, 0.5, 1.0);
  color -= getColor(uv - onePixel) * strength;
  color += getColor(uv + onePixel) * strength;
  return vec4(vec3((color.r + color.g + color.b) / 3.0), 1.0);
}`,
    },
    {
      id: "pixi-cross-hatch", kind: "effect", name: "Cross-hatch", tags: ["stylise", "sketch", "mono"],
      description: "A pen-and-ink cross-hatched sketch.",
      params: [],
      glsl: `vec4 effect(vec2 uv){
  float lum = length(getColor(uv).rgb);
  vec4 o = vec4(1.0);
  vec2 f = floor(gl_FragCoord.xy);
  if (lum < 1.00 && mod(f.x + f.y, 10.0) == 0.0) o = vec4(0.0, 0.0, 0.0, 1.0);
  if (lum < 0.75 && mod(f.x - f.y, 10.0) == 0.0) o = vec4(0.0, 0.0, 0.0, 1.0);
  if (lum < 0.50 && mod(f.x + f.y - 5.0, 10.0) == 0.0) o = vec4(0.0, 0.0, 0.0, 1.0);
  if (lum < 0.30 && mod(f.x - f.y - 5.0, 10.0) == 0.0) o = vec4(0.0, 0.0, 0.0, 1.0);
  return o;
}`,
    },
    {
      id: "pixi-grayscale", kind: "effect", name: "Black and white", tags: ["colour", "mono"],
      description: "Luminance-weighted greyscale.",
      params: [],
      glsl: `vec4 effect(vec2 uv){
  vec4 c = getColor(uv);
  float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  return vec4(vec3(g), 1.0);
}`,
    },
  ],
};
