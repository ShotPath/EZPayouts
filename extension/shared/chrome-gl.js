// Liquid chrome, drawn on the GPU. The fragment shader is the EZPayouts
// site's own page background (nav.js, CHROME_FS), copied line for line so
// the skin looks exactly like the site; keep the two in step.
var EZChrome = (function () {
  var FS = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
    "uniform vec2 uRes;",
    "uniform float uTime;",
    "uniform vec2 uLight;",
    "uniform vec3 uView; // zoom, then pan x/y (0.5 = centered)",
    "float field(vec2 p, float t){",
    "  vec2 q = p;",
    "  q += 0.42 * vec2(sin(q.y * 1.35 + t * 0.50), cos(q.x * 1.15 - t * 0.42));",
    "  q += 0.26 * vec2(sin(q.y * 2.30 - t * 0.36 + 1.7), cos(q.x * 2.05 + t * 0.55 + 0.4));",
    "  q += 0.12 * vec2(sin(q.y * 3.90 + t * 0.70 + 2.3), cos(q.x * 3.60 - t * 0.62 + 1.1));",
    "  return sin(q.x * 1.7) * cos(q.y * 1.9) + 0.4 * sin(q.x * 2.6 + q.y * 1.4 + t * 0.22);",
    "}",
    "// Rounded tubes along the field's zero lines. Smooth everywhere (no",
    "// abs/min creases), so the surface never breaks into jagged pixels.",
    "float height(vec2 p, float t){",
    "  float v = field(p, t);",
    "  return 0.9 * exp(-v * v * 7.5) + 0.2 * v;",
    "}",
    "float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }",
    "void main(){",
    "  vec2 uv = gl_FragCoord.xy / uRes;",
    "  float s = 3.1 / uRes.y / uView.x;",
    "  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) * s + vec2(0.6, -0.2) + (uView.yz - 0.5) * 2.0;",
    "  float t = uTime;",
    "  float e = max(s, 0.0025);",
    "  float h = height(p, t);",
    "  float hx = (height(p + vec2(e, 0.0), t) - height(p - vec2(e, 0.0), t)) / (2.0 * e);",
    "  float hy = (height(p + vec2(0.0, e), t) - height(p - vec2(0.0, e), t)) / (2.0 * e);",
    "  vec3 n = normalize(vec3(-hx * 0.5, -hy * 0.5, 1.0));",
    "  vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);",
    "  vec3 key = normalize(vec3(-0.35 + uLight.x, 0.75 + uLight.y, 0.55));",
    "  float env = 0.16;",
    "  env += 1.1 * smoothstep(0.57, 0.97, dot(r, key));",
    "  env += 0.5 * smoothstep(0.60, 0.96, dot(r, normalize(vec3(0.85, -0.15, 0.55))));",
    "  env += 0.2 * smoothstep(0.70, 0.98, dot(r, normalize(vec3(-0.2, -0.85, 0.5))));",
    "  env *= 0.75 + 0.35 * (0.5 + 0.5 * sin((r.x * 2.4 - r.y * 3.2) * 3.0 + 1.3));",
    "  env += 1.05 * pow(max(dot(r, normalize(vec3(-0.45 + uLight.x, 0.55 + uLight.y, 0.70))), 0.0), 36.0);",
    "  env += pow(1.0 - n.z, 3.0) * 0.3;",
    "  vec3 col = vec3(env) * vec3(0.86, 0.89, 0.95);",
    "  col *= 0.55 + 0.45 * smoothstep(-0.25, 0.7, h);",
    "  col *= 0.5 + 0.5 * smoothstep(1.25, 0.1, length((uv - vec2(0.55, 0.55)) * vec2(1.2, 1.0)));",
    "  col *= 0.6;",
    "  col = col / (1.0 + 0.35 * col);",
    "  col = pow(col, vec3(0.95));",
    "  col += (hash(gl_FragCoord.xy) + hash(gl_FragCoord.xy + 19.19) - 1.0) / 255.0;",
    "  gl_FragColor = vec4(col, 1.0);",
    "}"

  ].join("\n");
  var VS = "attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}";

  // Shader time for a moment in the motion: the site's starting point and
  // pace (ms = milliseconds of motion, already scaled by any speed setting).
  function time(ms) { return 4.0 + ms / 1000 * 0.24; }

  // Sets the shader up on a canvas. Returns { draw(ms, w, h), lose() }, or
  // null without WebGL.
  function create(canvas, keepPixels) {
    var gl;
    try {
      gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, powerPreference: "low-power", preserveDrawingBuffer: !!keepPixels });
      if (!gl) return null;
      var compile = function (type, src) {
        var sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        return sh;
      };
      var prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(prog, "a");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    } catch (err) {
      return null;
    }
    var uRes = gl.getUniformLocation(prog, "uRes");
    var uTime = gl.getUniformLocation(prog, "uTime");
    var uLight = gl.getUniformLocation(prog, "uLight");
    var uView = gl.getUniformLocation(prog, "uView");
    gl.uniform2f(uLight, 0, 0);
    gl.uniform3f(uView, 1, 0.5, 0.5);
    return {
      gl: gl,
      draw: function (ms, w, h) {
        if (gl.isContextLost()) return false;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        gl.viewport(0, 0, w, h);
        gl.uniform2f(uRes, w, h);
        gl.uniform1f(uTime, time(ms));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return true;
      },
      lose: function () {
        var ext = gl.getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
      }
    };
  }

  // A still frame as an image URL (popup thumbnail).
  function still(w, h) {
    var c = document.createElement("canvas");
    var r = create(c, true);
    if (!r) return "";
    r.draw(0, w, h);
    var url = c.toDataURL("image/jpeg", 0.9);
    r.lose();
    return url;
  }

  return { create: create, still: still };
})();
