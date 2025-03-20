// webgl-background.js
class FluidAnimation {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    
    if (!this.gl) {
      console.error('WebGL not supported');
      return;
    }
    
    // Check for floating point texture support
    this.ext = {
      formatRGBA: this.gl.getExtension('EXT_sRGB') || 
                 this.gl.getExtension('WEBGL_color_buffer_float') || 
                 this.gl.getExtension('OES_texture_float'),
      formatRG: this.gl.getExtension('EXT_color_buffer_half_float') || 
               this.gl.getExtension('OES_texture_half_float'),
      supportLinearFiltering: this.gl.getExtension('OES_texture_float_linear') ||
                             this.gl.getExtension('OES_texture_half_float_linear')
    };
    
    // Set up global parameters
    this.config = {
      TEXTURE_DOWNSAMPLE: 1,
      DENSITY_DISSIPATION: 0.98,
      VELOCITY_DISSIPATION: 0.99,
      PRESSURE_DISSIPATION: 0.8,
      PRESSURE_ITERATIONS: 25,
      CURL: 30,
      SPLAT_RADIUS: 0.5,
      SPLAT_FORCE: 6000,
      SHADING: true,
      COLORFUL: true,
      PAUSED: false,
      BACK_COLOR: { r: 0, g: 0, b: 0 },
      TRANSPARENT: false,
      BLOOM: true,
      BLOOM_ITERATIONS: 8,
      BLOOM_RESOLUTION: 256,
      BLOOM_INTENSITY: 0.8,
      BLOOM_THRESHOLD: 0.6,
      BLOOM_SOFT_KNEE: 0.7
    };
    
    this.pointer = {
      x: 0,
      y: 0,
      dx: 0,
      dy: 0,
      moved: false,
      down: false
    };
    
    this.audioEnabled = false;
    this.audioContext = null;
    this.audioAnalyser = null;
    this.audioDataArray = null;
    
    this.lastUpdateTime = Date.now();
    this.colorUpdateTime = 0;
    
    this.initShaders();
    this.initFramebuffers();
    this.initEventListeners();
    
    this.particles = [];
    this.initParticles();
    
    // Color palettes
    this.colorPalettes = [
      [
        { r: 0.58, g: 0.0, b: 0.83 }, // Deep purple
        { r: 0.0, g: 0.75, b: 1.0 },  // Electric blue
        { r: 1.0, g: 0.42, b: 0.0 },  // Fiery orange
        { r: 1.0, g: 0.0, b: 0.5 }    // Neon pink
      ]
    ];
    this.currentPalette = 0;
    
    this.resizeCanvas();
    this.update();
  }
  
  initShaders() {
    // Base Vertex Shader (used for most programs)
    const baseVertexShader = `
      precision highp float;
      attribute vec2 aPosition;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform highp vec2 texelSize;
      void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;
    
    // Clear Shader
    const clearShader = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform float value;
      void main () {
        gl_FragColor = value * texture2D(uTexture, vUv);
      }
    `;
    
    // Display Shader
    const displayShader = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform float time;
      void main () {
        vec3 color = texture2D(uTexture, vUv).rgb;
        
        // Apply post-processing effects
        // Slight color shifting based on time
        float r = color.r + 0.05 * sin(time * 0.1);
        float g = color.g + 0.05 * sin(time * 0.13 + 1.0);
        float b = color.b + 0.05 * sin(time * 0.16 + 2.0);
        
        // Subtle vignette effect
        vec2 center = vec2(0.5, 0.5);
        float dist = distance(vUv, center);
        float vignette = smoothstep(0.7, 1.4, dist);
        color = mix(vec3(r, g, b), color * 0.5, vignette * 0.5);
        
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    
    // Advection Shader
    const advectionShader = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uSource;
      uniform highp vec2 texelSize;
      uniform float dt;
      uniform float dissipation;
      void main () {
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
        gl_FragColor = dissipation * texture2D(uSource, coord);
        gl_FragColor.a = 1.0;
      }
    `;
    
    // Divergence Shader
    const divergenceShader = `
      precision highp float;
      precision highp sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;
        vec2 C = texture2D(uVelocity, vUv).xy;
        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
      }
    `;
    
    // Curl Shader
    const curlShader = `
      precision highp float;
      precision highp sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        float vorticity = R - L - T + B;
        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
      }
    `;
    
    // Vorticity Shader
    const vorticityShader = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uVelocity;
      uniform sampler2D uCurl;
      uniform float curl;
      uniform float dt;
      void main () {
        float L = texture2D(uCurl, vL).x;
        float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity += force * dt;
        velocity = min(max(velocity, -1000.0), 1000.0);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `;
    
    // Pressure Shader
    const pressureShader = `
      precision highp float;
      precision highp sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uDivergence;
      vec2 boundary(vec2 uv) {
        return uv;
      }
      void main () {
        float L = texture2D(uPressure, boundary(vL)).x;
        float R = texture2D(uPressure, boundary(vR)).x;
        float T = texture2D(uPressure, boundary(vT)).x;
        float B = texture2D(uPressure, boundary(vB)).x;
        float C = texture2D(uPressure, vUv).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
      }
    `;
    
    // Gradient Subtract Shader
    const gradientSubtractShader = `
      precision highp float;
      precision highp sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      vec2 boundary(vec2 uv) {
        return uv;
      }
      void main () {
        float L = texture2D(uPressure, boundary(vL)).x;
        float R = texture2D(uPressure, boundary(vR)).x;
        float T = texture2D(uPressure, boundary(vT)).x;
        float B = texture2D(uPressure, boundary(vB)).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B) * 0.5;
        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `;
    
    // Splat Shader
    const splatShader = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uTarget;
      uniform float aspectRatio;
      uniform vec3 color;
      uniform vec2 point;
      uniform float radius;
      void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
      }
    `;
    
    // Bloom Prefilter Shader
    const bloomPrefilterShader = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform vec3 curve;
      uniform float threshold;
      void main() {
        vec3 color = texture2D(uTexture, vUv).rgb;
        float brightness = max(color.r, max(color.g, color.b));
        float soft = brightness - curve.y;
        soft = clamp(soft, 0.0, curve.z);
        soft = curve.x * soft * soft;
        float contribution = max(soft, brightness - threshold);
        contribution /= max(brightness, 0.00001);
        gl_FragColor = vec4(color * contribution, 1.0);
      }
    `;
    
    // Bloom Blur Shader
    const bloomBlurShader = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform vec2 texelSize;
      uniform vec2 direction;
      void main() {
        vec3 color = vec3(0.0);
        vec2 off1 = vec2(1.3846153846) * direction;
        vec2 off2 = vec2(3.2307692308) * direction;
        color += texture2D(uTexture, vUv).rgb * 0.2270270270;
        color += texture2D(uTexture, vUv + texelSize * off1).rgb * 0.3162162162;
        color += texture2D(uTexture, vUv - texelSize * off1).rgb * 0.3162162162;
        color += texture2D(uTexture, vUv + texelSize * off2).rgb * 0.0702702703;
        color += texture2D(uTexture, vUv - texelSize * off2).rgb * 0.0702702703;
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    
    // Bloom Final Shader
    const bloomFinalShader = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform sampler2D uBloom;
      uniform float intensity;
      void main() {
        vec3 color = texture2D(uTexture, vUv).rgb;
        vec3 bloom = texture2D(uBloom, vUv).rgb;
        color += bloom * intensity;
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    
    // Compile all shaders and create programs
    this.programs = {
      clear: this.createProgram(baseVertexShader, clearShader),
      display: this.createProgram(baseVertexShader, displayShader),
      advection: this.createProgram(baseVertexShader, advectionShader),
      divergence: this.createProgram(baseVertexShader, divergenceShader),
      curl: this.createProgram(baseVertexShader, curlShader),
      vorticity: this.createProgram(baseVertexShader, vorticityShader),
      pressure: this.createProgram(baseVertexShader, pressureShader),
      gradientSubtract: this.createProgram(baseVertexShader, gradientSubtractShader),
      splat: this.createProgram(baseVertexShader, splatShader),
      bloomPrefilter: this.createProgram(baseVertexShader, bloomPrefilterShader),
      bloomBlur: this.createProgram(baseVertexShader, bloomBlurShader),
      bloomFinal: this.createProgram(baseVertexShader, bloomFinalShader)
    };
    
    // Create buffers for rendering
    const vertices = new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]);
    const buffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
    
    // Set up attribute pointers for all programs
    for (const program of Object.values(this.programs)) {
      this.gl.useProgram(program);
      const positionAttribute = this.gl.getAttribLocation(program, 'aPosition');
      this.gl.enableVertexAttribArray(positionAttribute);
      this.gl.vertexAttribPointer(positionAttribute, 2, this.gl.FLOAT, false, 0, 0);
    }
  }
  
  createProgram(vertexShader, fragmentShader) {
    const program = this.gl.createProgram();
    
    // Compile shaders
    const vs = this.compileShader(vertexShader, this.gl.VERTEX_SHADER);
    const fs = this.compileShader(fragmentShader, this.gl.FRAGMENT_SHADER);
    
    this.gl.attachShader(program, vs);
    this.gl.attachShader(program, fs);
    this.gl.linkProgram(program);
    
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      console.error('Failed to link program:', this.gl.getProgramInfoLog(program));
      return null;
    }
    
    return program;
  }
  
  compileShader(source, type) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error('Failed to compile shader:', this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }
    
    return shader;
  }
  
  initFramebuffers() {
    const simRes = this.getResolution(this.config.TEXTURE_DOWNSAMPLE);
    const dyeRes = this.getResolution(this.config.TEXTURE_DOWNSAMPLE);
    
    const texType = this.ext.formatRGBA ? this.gl.RGBA : this.gl.RGB;
    const texFilter = this.ext.supportLinearFiltering ? this.gl.LINEAR : this.gl.NEAREST;
    
    this.dye = this.createDoubleFBO(dyeRes.width, dyeRes.height, texType, texFilter);
    this.velocity = this.createDoubleFBO(simRes.width, simRes.height, texType, texFilter);
    this.divergence = this.createFBO(simRes.width, simRes.height, this.gl.RGBA, this.gl.NEAREST);
    this.curl = this.createFBO(simRes.width, simRes.height, this.gl.RGBA, this.gl.NEAREST);
    this.pressure = this.createDoubleFBO(simRes.width, simRes.height, this.gl.RGBA, this.gl.NEAREST);
    
    // Initialize bloom framebuffers
    if (this.config.BLOOM) {
      const bloomRes = this.getResolution(this.config.BLOOM_RESOLUTION);
      this.bloom = this.createFBO(bloomRes.width, bloomRes.height, this.gl.RGBA, this.gl.LINEAR);
      this.bloomFramebuffers = [];
      
      for (let i = 0; i < this.config.BLOOM_ITERATIONS; i++) {
        const width = bloomRes.width >> i;
        const height = bloomRes.height >> i;
        
        if (width < 2 || height < 2) break;
        
        const fbo = this.createFBO(width, height, this.gl.RGBA, this.gl.LINEAR);
        this.bloomFramebuffers.push(fbo);
      }
    }
  }
  
  createFBO(w, h, texType, texFilter) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, texFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, texFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, texType, w, h, 0, texType, gl.UNSIGNED_BYTE, null);
    
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    return {
      texture,
      fbo,
      width: w,
      height: h,
      attach(id) {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      }
    };
  }
  
  createDoubleFBO(w, h, texType, texFilter) {
    let fbo1 = this.createFBO(w, h, texType, texFilter);
    let fbo2 = this.createFBO(w, h, texType, texFilter);
    
    return {
      width: w,
      height: h,
      texelSizeX: 1.0 / w,
      texelSizeY: 1.0 / h,
      read: fbo1,
      write: fbo2,
      swap() {
        const temp = this.read;
        this.read = this.write;
        this.write = temp;
      }
    };
  }
  
  getResolution(scale) {
    return {
      width: Math.round(this.canvas.width * scale),
      height: Math.round(this.canvas.height * scale)
    };
  }
  
  initParticles() {
    const numParticles = 1000;
    for (let i = 0; i < numParticles; i++) {
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        vx: 0,
        vy: 0,
        age: 0,
        maxAge: 50 + Math.random() * 100
      });
    }
  }
  
  initEventListeners() {
    // Resize listener
    window.addEventListener('resize', () => this.resizeCanvas());
    
    // Mouse/touch event listeners
    this.canvas.addEventListener('mousemove', (e) => {
      this.pointer.moved = true;
      this.pointer.x = e.offsetX;
      this.pointer.y = e.offsetY;
      const dx = e.offsetX - this.pointer.x;
      const dy = e.offsetY - this.pointer.y;
      this.pointer.dx = dx;
      this.pointer.dy = dy;
    });
    
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      this.pointer.moved = true;
      const rect = this.canvas.getBoundingClientRect();
      const touch = e.targetTouches[0];
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      const dx = x - this.pointer.x;
      const dy = y - this.pointer.y;
      this.pointer.x = x;
      this.pointer.y = y;
      this.pointer.dx = dx;
      this.pointer.dy = dy;
    }, { passive: false });
    
    this.canvas.addEventListener('mousedown', () => {
      this.pointer.down = true;
      this.splat(this.pointer.x, this.pointer.y, this.getRandomSplatColor());
    });
    
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.pointer.down = true;
      const rect = this.canvas.getBoundingClientRect();
      const touch = e.targetTouches[0];
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      this.pointer.x = x;
      this.pointer.y = y;
      this.splat(x, y, this.getRandomSplatColor());
    }, { passive: false });
    
    window.addEventListener('mouseup', () => {
      this.pointer.down = false;
    });
    
    window.addEventListener('touchend', () => {
      this.pointer.down = false;
    });
    
    // Audio button
    const audioButton = document.createElement('button');
    audioButton.textContent = '🔊 Enable Audio Reactivity';
    audioButton.style.position = 'absolute';
    audioButton.style.bottom = '20px';
    audioButton.style.right = '20px';
    audioButton.style.padding = '10px';
    audioButton.style.background = 'rgba(0, 0, 0, 0.5)';
    audioButton.style.color = 'white';
    audioButton.style.border = 'none';
    audioButton.style.borderRadius = '5px';
    audioButton.style.cursor = 'pointer';
    audioButton.style.zIndex = '1000';
    
    audioButton.addEventListener('click', () => {
      if (!this.audioEnabled) {
        this.initAudio();
        audioButton.textContent = '🔊 Audio Enabled';
      } else {
        this.audioEnabled = false;
        if (this.audioContext) {
          this.audioContext.suspend();
        }
        audioButton.textContent = '🔊 Enable Audio Reactivity';
      }
    });
    
    document.body.appendChild(audioButton);
  }
  
  initAudio() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.audioEnabled = true;
      
      navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then(stream => {
          const source = this.audioContext.createMediaStreamSource(stream);
          this.audioAnalyser = this.audioContext.createAnalyser();
          this.audioAnalyser.fftSize = 256;
          source.connect(this.audioAnalyser);
          
          this.audioDataArray = new Uint8Array(this.audioAnalyser.frequencyBinCount);
        })
        .catch(err => {
          console.error('Error accessing microphone:', err);
          this.audioEnabled = false;
        });
    } catch (e) {
      console.error('Web Audio API not supported:', e);
      this.audioEnabled = false;
    }
  }
  
  getRandomSplatColor() {
    const palette = this.colorPalettes[this.currentPalette];
    const colorIndex = Math.floor(Math.random() * palette.length);
    const color = palette[colorIndex];
    
    return {
      r: color.r, 
      g: color.g, 
      b: color.b
    };
  }
  
  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    
    // Reinitialize framebuffers when canvas is resized
    this.initFramebuffers();
  }
  
  update() {
    const gl = this.gl;
    const dt = Math.min((Date.now() - this.lastUpdateTime) / 1000, 0.016);
    this.lastUpdateTime = Date.now();
    
    // Process audio if enabled
    if (this.audioEnabled && this.audioAnalyser && this.audioDataArray) {
      this.audioAnalyser.getByteFrequencyData(this.audioDataArray);
      let sum = 0;
      for (let i = 0; i < this.audioDataArray.length; i++) {
        sum += this.audioDataArray[i];
      }
      const average = sum / this.audioDataArray.length;
      const normalized = average / 256;
      
      // Use audio data to influence the simulation
      if (normalized > 0.4) {
        const x = Math.random() * this.canvas.width;
        const y = Math.random() * this.canvas.height;
        const force = normalized * 5;
        const color = this.getRandomSplatColor();
        
        this.splat(x, y, color, force);
      }
    }
    
    // Add energy based on mouse/touch movement
    if (this.pointer.moved) {
      this.pointer.moved = false;
      if (this.pointer.down) {
        const dx = this.pointer.dx || 0;
        const dy = this.pointer.dy || 0;
        const speed = Math.sqrt(dx * dx + dy * dy) * 0.5;
        
        if (speed > 1) {
          const color = this.getRandomSplatColor();
          this.splat(this.pointer.x, this.pointer.y, color, speed);
        }
      }
    }
    
    // Occasionally add random splats for more dynamic behavior
    if (Math.random() < 0.01) {
      const x = Math.random() * this.canvas.width;
      const y = Math.random() * this.canvas.height;
      const color = this.getRandomSplatColor();
      this.splat(x, y, color, 1 + Math.random() * 3);
    }
    
    // Main fluid simulation steps
    this.step(dt);
    
    // Update particle positions
    this.updateParticles(dt);
    
    // Render the fluid
    this.render();
    
    // Schedule next frame
    requestAnimationFrame(() => this.update());
  }
  
  step(dt) {
    const gl = this.gl;
    
    // Update velocity field
    gl.viewport(0, 0, this.velocity.width, this.velocity.height);
    
    // Advect velocity
    this.gl.useProgram(this.programs.advection);
    gl.uniform2f(gl.getUniformLocation(this.programs.advection, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(gl.getUniformLocation(this.programs.advection, 'uVelocity'), this.velocity.read.attach(0));
    gl.uniform1i(gl.getUniformLocation(this.programs.advection, 'uSource'), this.velocity.read.attach(1));
    gl.uniform1f(gl.getUniformLocation(this.programs.advection, 'dt'), dt);
    gl.uniform1f(gl.getUniformLocation(this.programs.advection, 'dissipation'), this.config.VELOCITY_DISSIPATION);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.write.fbo);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    this.velocity.swap();
    
    // Compute curl
    gl.useProgram(this.programs.curl);
    gl.uniform2f(gl.getUniformLocation(this.programs.curl, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(gl.getUniformLocation(this.programs.curl, 'uVelocity'), this.velocity.read.attach(0));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.curl.fbo);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    
    // Apply vorticity confinement
    gl.useProgram(this.programs.vorticity);
    gl.uniform2f(gl.getUniformLocation(this.programs.vorticity, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(gl.getUniformLocation(this.programs.vorticity, 'uVelocity'), this.velocity.read.attach(0));
    gl.uniform1i(gl.getUniformLocation(this.programs.vorticity, 'uCurl'), this.curl.attach(1));
    gl.uniform1f(gl.getUniformLocation(this.programs.vorticity, 'curl'), this.config.CURL);
    gl.uniform1f(gl.getUniformLocation(this.programs.vorticity, 'dt'), dt);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.write.fbo);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    this.velocity.swap();
    
    // Compute divergence
    gl.useProgram(this.programs.divergence);
    gl.uniform2f(gl.getUniformLocation(this.programs.divergence, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(gl.getUniformLocation(this.programs.divergence, 'uVelocity'), this.velocity.read.attach(0));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.divergence.fbo);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    
    // Clear pressure
    gl.useProgram(this.programs.clear);
    gl.uniform1i(gl.getUniformLocation(this.programs.clear, 'uTexture'), this.pressure.read.attach(0));
    gl.uniform1f(gl.getUniformLocation(this.programs.clear, 'value'), this.config.PRESSURE_DISSIPATION);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressure.write.fbo);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    this.pressure.swap();
    
    // Solve pressure
    gl.useProgram(this.programs.pressure);
    gl.uniform2f(gl.getUniformLocation(this.programs.pressure, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(gl.getUniformLocation(this.programs.pressure, 'uDivergence'), this.divergence.attach(0));
    
    for (let i = 0; i < this.config.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(gl.getUniformLocation(this.programs.pressure, 'uPressure'), this.pressure.read.attach(1));
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressure.write.fbo);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
      this.pressure.swap();
    }
    
    // Apply pressure gradient
    gl.useProgram(this.programs.gradientSubtract);
    gl.uniform2f(gl.getUniformLocation(this.programs.gradientSubtract, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(gl.getUniformLocation(this.programs.gradientSubtract, 'uPressure'), this.pressure.read.attach(0));
    gl.uniform1i(gl.getUniformLocation(this.programs.gradientSubtract, 'uVelocity'), this.velocity.read.attach(1));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.write.fbo);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    this.velocity.swap();
    
    // Advect dye
    gl.viewport(0, 0, this.dye.width, this.dye.height);
    gl.useProgram(this.programs.advection);
    gl.uniform2f(gl.getUniformLocation(this.programs.advection, 'texelSize'), this.dye.texelSizeX, this.dye.texelSizeY);
    gl.uniform1i(gl.getUniformLocation(this.programs.advection, 'uVelocity'), this.velocity.read.attach(0));
    gl.uniform1i(gl.getUniformLocation(this.programs.advection, 'uSource'), this.dye.read.attach(1));
    gl.uniform1f(gl.getUniformLocation(this.programs.advection, 'dt'), dt);
    gl.uniform1f(gl.getUniformLocation(this.programs.advection, 'dissipation'), this.config.DENSITY_DISSIPATION);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.dye.write.fbo);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    this.dye.swap();
  }
  
  updateParticles(dt) {
    const gl = this.gl;
    // Sample velocity field to update particle positions
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      
      // Sample velocity at particle position
      const x = p.x / this.canvas.width;
      const y = p.y / this.canvas.height;
      
      // Read velocity from texture
      const pixels = new Uint8Array(4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.read.fbo);
      gl.readPixels(
        Math.floor(x * this.velocity.width),
        Math.floor(y * this.velocity.height),
        1, 1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels
      );
      
      // Update particle position based on velocity
      p.vx = pixels[0] * 0.1;
      p.vy = pixels[1] * 0.1;
      
      p.x += p.vx;
      p.y += p.vy;
      
      // Wrap around if particle goes off-screen
      if (p.x < 0) p.x += this.canvas.width;
      if (p.x > this.canvas.width) p.x -= this.canvas.width;
      if (p.y < 0) p.y += this.canvas.height;
      if (p.y > this.canvas.height) p.y -= this.canvas.height;
      
      // Age particle
      p.age++;
      if (p.age > p.maxAge) {
        // Reset particle
        p.x = Math.random() * this.canvas.width;
        p.y = Math.random() * this.canvas.height;
        p.vx = 0;
        p.vy = 0;
        p.age = 0;
        p.maxAge = 50 + Math.random() * 100;
      }
    }
  }
  
  render() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    
    if (this.config.BLOOM) {
      this.applyBloom();
    }
    
    // Draw fluid
    gl.useProgram(this.programs.display);
    gl.uniform1i(gl.getUniformLocation(this.programs.display, 'uTexture'), this.dye.read.attach(0));
    gl.uniform1f(gl.getUniformLocation(this.programs.display, 'time'), this.lastUpdateTime * 0.001);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    
    // Draw particles
    // Note: This is a basic CPU-based particle rendering
    // For better performance, particles should be rendered using WebGL
    const ctx = this.canvas.getContext('2d');
    ctx.globalCompositeOperation = 'lighter';
    
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const alpha = 1.0 - (p.age / p.maxAge);
      
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.6})`;
      ctx.fill();
    }
  }
  
  applyBloom() {
    const gl = this.gl;
    
    // Extract bright areas
    gl.useProgram(this.programs.bloomPrefilter);
    const knee = this.config.BLOOM_THRESHOLD * this.config.BLOOM_SOFT_KNEE + 0.0001;
    const curve0 = this.config.BLOOM_THRESHOLD - knee;
    const curve1 = knee * 2;
    const curve2 = 0.25 / knee;
    gl.uniform3f(gl.getUniformLocation(this.programs.bloomPrefilter, 'curve'), curve0, curve1, curve2);
    gl.uniform1f(gl.getUniformLocation(this.programs.bloomPrefilter, 'threshold'), this.config.BLOOM_THRESHOLD);
    gl.uniform1i(gl.getUniformLocation(this.programs.bloomPrefilter, 'uTexture'), this.dye.read.attach(0));
    gl.viewport(0, 0, this.bloom.width, this.bloom.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloom.fbo);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    
    // Apply bloom blur
    gl.useProgram(this.programs.bloomBlur);
    
    let source = this.bloom;
    let dest = this.bloomFramebuffers[0];
    
    // Horizontal blur
    gl.uniform2f(gl.getUniformLocation(this.programs.bloomBlur, 'texelSize'), 1.0 / source.width, 1.0 / source.height);
    gl.uniform2f(gl.getUniformLocation(this.programs.bloomBlur, 'direction'), 1.0, 0.0);
    gl.uniform1i(gl.getUniformLocation(this.programs.bloomBlur, 'uTexture'), source.attach(0));
    gl.viewport(0, 0, dest.width, dest.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dest.fbo);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    
    // Vertical blur
    gl.uniform2f(gl.getUniformLocation(this.programs.bloomBlur, 'direction'), 0.0, 1.0);
    gl.uniform1i(gl.getUniformLocation(this.programs.bloomBlur, 'uTexture'), dest.attach(0));
    gl.viewport(0, 0, source.width, source.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, source.fbo);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    
    // Blend bloomed result with original
    gl.useProgram(this.programs.bloomFinal);
    gl.uniform1i(gl.getUniformLocation(this.programs.bloomFinal, 'uTexture'), this.dye.read.attach(0));
    gl.uniform1i(gl.getUniformLocation(this.programs.bloomFinal, 'uBloom'), this.bloom.attach(1));
    gl.uniform1f(gl.getUniformLocation(this.programs.bloomFinal, 'intensity'), this.config.BLOOM_INTENSITY);
    gl.viewport(0, 0, this.dye.width, this.dye.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.dye.write.fbo);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    this.dye.swap();
  }
  
  splat(x, y, color, force = 1.0) {
    const gl = this.gl;
    
    // Convert canvas coordinates to normalized coordinates
    const posX = x / this.canvas.width;
    const posY = 1.0 - y / this.canvas.height;
    
    // Add color dye
    gl.viewport(0, 0, this.dye.width, this.dye.height);
    gl.useProgram(this.programs.splat);
    gl.uniform1i(gl.getUniformLocation(this.programs.splat, 'uTarget'), this.dye.read.attach(0));
    gl.uniform1f(gl.getUniformLocation(this.programs.splat, 'aspectRatio'), this.canvas.width / this.canvas.height);
    gl.uniform2f(gl.getUniformLocation(this.programs.splat, 'point'), posX, posY);
    gl.uniform3f(gl.getUniformLocation(this.programs.splat, 'color'), color.r, color.g, color.b);
    gl.uniform1f(gl.getUniformLocation(this.programs.splat, 'radius'), this.config.SPLAT_RADIUS * force);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.dye.write.fbo);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    this.dye.swap();
    
    // Add velocity
    gl.viewport(0, 0, this.velocity.width, this.velocity.height);
    gl.useProgram(this.programs.splat);
    gl.uniform1i(gl.getUniformLocation(this.programs.splat, 'uTarget'), this.velocity.read.attach(0));
    gl.uniform1f(gl.getUniformLocation(this.programs.splat, 'aspectRatio'), this.canvas.width / this.canvas.height);
    gl.uniform2f(gl.getUniformLocation(this.programs.splat, 'point'), posX, posY);
    gl.uniform3f(gl.getUniformLocation(this.programs.splat, 'color'), 
      (Math.random() - 0.5) * this.config.SPLAT_FORCE * force, 
      (Math.random() - 0.5) * this.config.SPLAT_FORCE * force, 
      0.0);
    gl.uniform1f(gl.getUniformLocation(this.programs.splat, 'radius'), this.config.SPLAT_RADIUS);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.write.fbo);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    this.velocity.swap();
  }
}

// Main initialization
function initFluidAnimation() {
  const canvas = document.createElement('canvas');
  canvas.id = 'fluid-canvas';
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.zIndex = '-1';
  document.body.appendChild(canvas);
  
  const fluidAnimation = new FluidAnimation(canvas);
  
  // Add some initial color and motion
  setTimeout(() => {
    const width = canvas.width;
    const height = canvas.height;
    
    // Add some initial splats
    for (let i = 0; i < 5; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const color = fluidAnimation.getRandomSplatColor();
      fluidAnimation.splat(x, y, color, 2.0);
    }
  }, 100);
  
  return fluidAnimation;
}

// Start the animation when the page loads
window.addEventListener('DOMContentLoaded', () => {
  const fluidAnimation = initFluidAnimation();
  
  // Optional: Add event to help users on devices that don't support WebGL
  if (!fluidAnimation.gl) {
    const fallbackMessage = document.createElement('div');
    fallbackMessage.style.position = 'fixed';
    fallbackMessage.style.top = '50%';
    fallbackMessage.style.left = '50%';
    fallbackMessage.style.transform = 'translate(-50%, -50%)';
    fallbackMessage.style.color = 'white';
    fallbackMessage.style.fontFamily = 'sans-serif';
    fallbackMessage.style.textAlign = 'center';
    fallbackMessage.innerHTML = 'Your browser does not support WebGL, which is required for this background animation.';
    document.body.appendChild(fallbackMessage);
  }
});
