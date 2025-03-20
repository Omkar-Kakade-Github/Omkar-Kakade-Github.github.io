// webgl-background.js
class CircuitBackground {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            console.error("Canvas element not found!");
            return;
        }

        // Initialize WebGL context
        this.gl = this.canvas.getContext("webgl") || this.canvas.getContext("experimental-webgl");
        if (!this.gl) {
            console.error("WebGL not supported");
            return;
        }

        // Set canvas to full window size
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        // Initialize shader program
        this.initShaders();
        
        // Create buffer for a full-screen quad
        this.initBuffers();
        
        // Start animation
        this.startTime = Date.now();
        this.animate();
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        if (this.gl) {
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    initShaders() {
        // Vertex shader
        const vsSource = `
            attribute vec4 aVertexPosition;
            varying vec2 vUv;
            
            void main() {
                gl_Position = aVertexPosition;
                vUv = aVertexPosition.xy * 0.5 + 0.5;
            }
        `;

        // Fragment shader
        const fsSource = `
            precision mediump float;
            varying vec2 vUv;
            uniform float uTime;
            uniform vec2 uResolution;

            // Hash function for pseudo-randomness
            float hash(vec2 p) {
                p = fract(p * vec2(123.34, 456.21));
                p += dot(p, p + 45.32);
                return fract(p.x * p.y);
            }

            // Noise function for organic patterns
            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                
                float a = hash(i);
                float b = hash(i + vec2(1.0, 0.0));
                float c = hash(i + vec2(0.0, 1.0));
                float d = hash(i + vec2(1.0, 1.0));
                
                return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
            }

            // Function to create circuit board pattern
            float circuit(vec2 p) {
                // Grid
                vec2 grid = step(vec2(0.05), fract(p * 2.0));
                float cells = grid.x * grid.y;
                
                // Create circuit paths
                vec2 pos = floor(p * 2.0);
                float pathSeed = hash(pos);
                
                // Horizontal and vertical lines
                vec2 fp = fract(p * 2.0) - 0.5;
                float hline = step(abs(fp.y), 0.02);
                float vline = step(abs(fp.x), 0.02);
                
                // Random path selection
                float path = 0.0;
                if (pathSeed < 0.25) path = hline;
                else if (pathSeed < 0.5) path = vline;
                else if (pathSeed < 0.75) path = hline * vline;
                
                // Add some components
                float comp = 0.0;
                if (hash(pos + 42.0) < 0.1) {
                    float size = 0.15 + hash(pos + 13.37) * 0.1;
                    comp = step(length(fp), size) * step(0.05, length(fp));
                }
                
                return path + comp;
            }

            // Electric spark effect
            float spark(vec2 p, float time, float seed) {
                // Calculate spark path
                float pathSeed = hash(vec2(seed));
                float sparkSpeed = 0.5 + pathSeed * 0.5;
                float sparkOffset = pathSeed * 10.0;
                
                // Animate spark position
                float sparkPos = fract((time * sparkSpeed + sparkOffset) * 0.5);
                
                // Calculate distance to spark
                float t = fract(sparkPos + pathSeed);
                vec2 sparkP = p;
                
                // Add some sinusoidal variation to make paths interesting
                float angle = pathSeed * 6.28;
                sparkP.x += sin(sparkP.y * 3.0 + time + pathSeed * 6.28) * 0.1;
                
                // Spark intensity based on distance to path
                float sparkWidth = 0.01 + pathSeed * 0.01;
                float sparkDist = abs(sparkP.x - sparkPos);
                float spark = smoothstep(sparkWidth, 0.0, sparkDist);
                
                // Glow effect
                float glow = exp(-sparkDist * 20.0) * 0.5;
                
                // Pulse effect
                float pulse = sin(time * 10.0 + pathSeed * 6.28) * 0.5 + 0.5;
                
                return (spark + glow) * pulse;
            }

            void main() {
                // Normalized coordinates
                vec2 uv = vUv;
                vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
                uv *= aspect;
                
                // Scale and offset
                vec2 p = uv * 5.0;
                
                // Base circuit pattern
                float pattern = circuit(p);
                
                // Scale for detail layer
                p *= 2.0;
                pattern += circuit(p) * 0.5;
                
                // Add subtle noise texture
                pattern += noise(p * 4.0) * 0.1;
                
                // Create multiple sparks
                float sparks = 0.0;
                for (int i = 0; i < 6; i++) {
                    float seed = float(i) / 6.0;
                    sparks += spark(uv, uTime, seed);
                }
                
                // Color mapping
                vec3 chipColor = mix(
                    vec3(0.05, 0.1, 0.2),  // Dark blue
                    vec3(0.05, 0.15, 0.1),  // Deep green
                    pattern
                );
                
                // Add spark color (bright cyan & electric blue)
                vec3 sparkColor = mix(
                    vec3(0.0, 0.8, 1.0),  // Bright cyan
                    vec3(0.2, 0.4, 1.0),  // Electric blue
                    sin(uTime * 2.0) * 0.5 + 0.5
                );
                
                // Combine colors
                vec3 finalColor = chipColor;
                finalColor += sparkColor * sparks * 1.5;
                
                // Output final color
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `;

        // Create shader program
        const vertexShader = this.compileShader(vsSource, this.gl.VERTEX_SHADER);
        const fragmentShader = this.compileShader(fsSource, this.gl.FRAGMENT_SHADER);
        this.program = this.createProgram(vertexShader, fragmentShader);

        // Set up uniforms
        this.timeUniformLocation = this.gl.getUniformLocation(this.program, "uTime");
        this.resolutionUniformLocation = this.gl.getUniformLocation(this.program, "uResolution");
    }

    compileShader(source, type) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Shader compilation error: ' + this.gl.getShaderInfoLog(shader));
            this.gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    createProgram(vertexShader, fragmentShader) {
        const program = this.gl.createProgram();
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);

        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            console.error('Program linking error: ' + this.gl.getProgramInfoLog(program));
            return null;
        }
        return program;
    }

    initBuffers() {
        // Create a full-screen quad
        this.positionBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);

        const positions = [
            -1.0, -1.0,
             1.0, -1.0,
            -1.0,  1.0,
             1.0,  1.0
        ];

        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(positions), this.gl.STATIC_DRAW);
        this.positionAttributeLocation = this.gl.getAttribLocation(this.program, "aVertexPosition");
    }

    render() {
        this.gl.clearColor(0.0, 0.0, 0.1, 1.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        // Use the shader program
        this.gl.useProgram(this.program);

        // Update uniforms
        const elapsedTime = (Date.now() - this.startTime) / 1000.0;
        this.gl.uniform1f(this.timeUniformLocation, elapsedTime);
        this.gl.uniform2f(this.resolutionUniformLocation, this.canvas.width, this.canvas.height);

        // Set up position attribute
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.vertexAttribPointer(this.positionAttributeLocation, 2, this.gl.FLOAT, false, 0, 0);
        this.gl.enableVertexAttribArray(this.positionAttributeLocation);

        // Draw
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    }

    animate() {
        this.render();
        requestAnimationFrame(() => this.animate());
    }
}
