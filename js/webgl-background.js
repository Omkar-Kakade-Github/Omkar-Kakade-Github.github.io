// webgl-background.js

const canvas = document.createElement("canvas");
canvas.id = "webgl-canvas";
document.body.prepend(canvas);
const gl = canvas.getContext("webgl");

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

const vertexShaderSource = `
    attribute vec2 position;
    void main() {
        gl_Position = vec4(position, 0.0, 1.0);
    }
`;

const fragmentShaderSource = `
    precision mediump float;
    uniform float time;
    uniform vec2 resolution;
    
    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }
    
    float circuitPattern(vec2 uv) {
        uv *= 10.0;
        vec2 grid = fract(uv) - 0.5;
        vec2 id = floor(uv);
        float line = smoothstep(0.02, 0.04, abs(grid.x) - 0.2) +
                     smoothstep(0.02, 0.04, abs(grid.y) - 0.2);
        return line * 0.5 + 0.5 * hash(id);
    }
    
    float sparkEffect(vec2 uv) {
        float t = mod(time * 0.5, 1.0);
        float spark = smoothstep(0.1, 0.15, sin(uv.x * 15.0 + t * 10.0) * sin(uv.y * 15.0 - t * 10.0));
        return spark * 1.5;
    }
    
    void main() {
        vec2 uv = (gl_FragCoord.xy - resolution.xy * 0.5) / resolution.y;
        float circuit = circuitPattern(uv);
        float sparks = sparkEffect(uv);
        
        vec3 chipColor = vec3(0.1, 0.3, 0.2) + circuit * vec3(0.1, 0.5, 0.3);
        vec3 sparkColor = vec3(0.0, 1.0, 1.0) * sparks;
        
        vec3 finalColor = chipColor + sparkColor;
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
}

const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
const program = gl.createProgram();
gl.attachShader(program, vertexShader);
gl.attachShader(program, fragmentShader);
gl.linkProgram(program);
gl.useProgram(program);

const vertices = new Float32Array([
    -1, -1,
    1, -1,
    -1, 1,
    -1, 1,
    1, -1,
    1, 1
]);

const buffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
const positionLocation = gl.getAttribLocation(program, "position");
gl.enableVertexAttribArray(positionLocation);
gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

const timeLocation = gl.getUniformLocation(program, "time");
const resolutionLocation = gl.getUniformLocation(program, "resolution");

function render(time) {
    gl.uniform1f(timeLocation, time * 0.001);
    gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(render);
}
requestAnimationFrame(render);
