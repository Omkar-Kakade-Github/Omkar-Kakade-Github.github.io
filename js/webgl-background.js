// webgl-background.js
const canvas = document.createElement("canvas");
canvas.id = "webgl-canvas";
document.body.prepend(canvas);
const gl = canvas.getContext("webgl");

// Style the canvas to cover the whole background
canvas.style.position = "fixed";
canvas.style.top = "0";
canvas.style.left = "0";
canvas.style.zIndex = "-1";

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
    precision highp float;
    uniform float time;
    uniform vec2 resolution;
    
    // Improved hash function for better randomization
    float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
    }
    
    // Value noise for more organic patterns
    float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f); // Smoothstep
        
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    
    // Circuit pattern with paths and nodes
    float circuitPattern(vec2 uv) {
        // Scale for more detailed circuit
        vec2 scaled = uv * 8.0;
        
        // Grid cells
        vec2 grid = fract(scaled) - 0.5;
        vec2 id = floor(scaled);
        
        // Randomize which grid cells have horizontal and vertical lines
        float h_prob = hash(id * 0.763);
        float v_prob = hash(id * 1.317);
        
        // Create horizontal and vertical circuit traces with varying thickness
        float h_thick = 0.03 + 0.04 * hash(id + 5.0);
        float v_thick = 0.03 + 0.04 * hash(id + 10.0);
        
        float h_line = (h_prob > 0.5) ? smoothstep(h_thick, h_thick * 0.5, abs(grid.y)) : 0.0;
        float v_line = (v_prob > 0.5) ? smoothstep(v_thick, v_thick * 0.5, abs(grid.x)) : 0.0;
        
        // Create connection nodes at intersections
        float node = 0.0;
        if(h_prob > 0.5 && v_prob > 0.5) {
            node = smoothstep(0.15, 0.05, length(grid));
        }
        
        // Create smaller components
        float comp = 0.0;
        if(hash(id + 20.0) > 0.8) {
            vec2 compPos = grid * 2.0;
            comp = smoothstep(0.3, 0.2, max(abs(compPos.x), abs(compPos.y)));
        }
        
        return clamp(h_line + v_line + node * 1.5 + comp, 0.0, 1.0);
    }
    
    // Electric sparks traveling along the circuit
    float sparkEffect(vec2 uv, float circuit) {
        // Multiple sparks with different speeds and paths
        float spark = 0.0;
        
        // First spark path - horizontal movement
        float t1 = fract(time * 0.2);
        vec2 sparkPos1 = uv - vec2(t1 * 2.0 - 1.0, sin(uv.x * 3.0) * 0.2);
        float sparkPath1 = circuit * smoothstep(0.05, 0.0, length(fract(sparkPos1 * 8.0) - 0.5));
        
        // Second spark path - vertical movement
        float t2 = fract(time * 0.15 + 0.5);
        vec2 sparkPos2 = uv - vec2(cos(uv.y * 2.0) * 0.3, t2 * 2.0 - 1.0);
        float sparkPath2 = circuit * smoothstep(0.05, 0.0, length(fract(sparkPos2 * 8.0) - 0.5));
        
        // Combine with pulse effect
        spark = max(
            sparkPath1 * (0.5 + 0.5 * sin(t1 * 6.28)),
            sparkPath2 * (0.5 + 0.5 * sin(t2 * 6.28))
        );
        
        // Additional random sparks
        for(int i = 0; i < 3; i++) {
            float t = fract(time * 0.1 + float(i) * 0.25);
            float progress = fract(t * 2.0);
            vec2 sparkPath = vec2(sin(time * 0.5 + float(i)), cos(time * 0.7 + float(i) * 2.0));
            vec2 sparkPos = uv - mix(sparkPath * 0.5, -sparkPath * 0.5, progress);
            float size = 0.02 + 0.03 * sin(time + float(i));
            spark = max(spark, circuit * smoothstep(size, 0.0, length(sparkPos)) * (1.0 - progress));
        }
        
        return spark;
    }
    
    // Glow effect
    float glow(float value, float intensity) {
        return pow(value, 1.0 / intensity);
    }
    
    void main() {
        vec2 uv = (gl_FragCoord.xy - resolution.xy * 0.5) / resolution.y;
        
        // Add subtle distortion
        uv += vec2(
            noise(uv * 3.0 + time * 0.1) * 0.02,
            noise(uv * 3.0 + vec2(50.0) + time * 0.1) * 0.02
        );
        
        // Generate the circuit pattern
        float circuit = circuitPattern(uv);
        
        // Add subtle background texture
        float bgNoise = noise(uv * 5.0 + time * 0.05) * 0.05;
        
        // Create sparks effect
        float sparks = sparkEffect(uv, circuit);
        
        // Add glow to the sparks
        float sparkGlow = glow(sparks, 2.5) * 0.5;
        
        // Define our color palette
        vec3 darkBlue = vec3(0.05, 0.1, 0.2);
        vec3 deepGreen = vec3(0.05, 0.15, 0.1);
        vec3 brightCyan = vec3(0.0, 0.9, 1.0);
        vec3 electricBlue = vec3(0.3, 0.5, 1.0);
        
        // Build the final chip color with subtle variation
        vec3 chipColor = mix(darkBlue, deepGreen, noise(uv * 2.0 + time * 0.05));
        chipColor += circuit * vec3(0.1, 0.2, 0.15); // Circuit overlay
        chipColor += bgNoise; // Add subtle texture
        
        // Add the sparks with glow
        vec3 sparkColor = mix(brightCyan, electricBlue, sin(time + uv.x + uv.y) * 0.5 + 0.5);
        vec3 finalColor = chipColor + sparks * sparkColor * 2.0 + sparkGlow * sparkColor * 0.5;
        
        // Output the final color
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    // Check if shader compiled successfully
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    
    return shader;
}

const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

const program = gl.createProgram();
gl.attachShader(program, vertexShader);
gl.attachShader(program, fragmentShader);
gl.linkProgram(program);

// Check if program linked successfully
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Unable to initialize the shader program: ' + gl.getProgramInfoLog(program));
}

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
