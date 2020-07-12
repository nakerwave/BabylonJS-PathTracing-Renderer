import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3, Vector2 } from '@babylonjs/core/Maths/math.vector';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { screenTextureShader, screenOutputShader } from './pathTracingShaders';

/**
 * Manage all the essential assets needed to build a Path Tracing (Engine, Scene Cameras, RenderingTargets, etc)
 */

export class PathTracingEngine {

    /**
    * BabylonJS Engine
    */
    engine: Engine;

    /**
     * WebGL Context
     */
    context: WebGL2RenderingContext;

    /**
     * Container
     */
    container: HTMLElement;

    /**
     * Canvas used to draw the 3D scene
     */
    canvas: HTMLCanvasElement;

    constructor() {
        // if (!Engine.isSupported()) throw 'WebGL not supported';
        this.container = document.getElementById('container');
        this.canvas = document.createElement('canvas');
        this.container.appendChild(this.canvas);

        // preserveDrawingBuffer and stencil needed for screenshot
        // premultipliedAlpha needed for .HDR to .ENV transformation
        let engineOption = { preserveDrawingBuffer: true, stencil: true, premultipliedAlpha: false };
        this.engine = new Engine(this.canvas, true, engineOption, false);

        // required by WebGL 2.0 for rendering to FLOAT textures
        this.context = this.canvas.getContext("webgl2");
        this.context.getExtension('EXT_color_buffer_float');

        // NOTE to avoid request for manifest files because it can block loading on safari
        this.engine.enableOfflineSupport = false;

        this.addScenes();
        this.addCameras();
        this.addRenderTargets();
        this.addPathTracingGeometry();

        this.engine.onResizeObservable.add(() => {
            let xResolution = this.context.drawingBufferWidth;
            let yResolution = this.context.drawingBufferHeight;
            this.setResolution(new Vector2(xResolution, yResolution));

            // Maybe engine resize will reset RenderTargetSize already
            // this.pathTracingRenderTarget.setSize(xResolution, yResolution);
            // this.screenTextureRenderTarget.setSize(xResolution, yResolution);

            // this.worldCamera.aspect = this.container.clientWidth / this.container.clientHeight;
            // this.worldCamera.updateProjectionMatrix();
        });

        this.engine.runRenderLoop(() => {
            this.animate();
        });
    }

    pathTracingScene: Scene;
    screenTextureScene: Scene;
    screenOutputScene: Scene;
    addScenes() {
        this.pathTracingScene = new Scene(this.engine);
        this.pathTracingScene.autoClear = false;
        this.screenTextureScene = new Scene(this.engine);
        this.screenTextureScene.autoClear = false;
        this.screenOutputScene = new Scene(this.engine);
        this.screenOutputScene.autoClear = false;
    }

    // quadCamera is simply the camera to help render the full screen quad (2 triangles),
    // hence the name.  It is an Orthographic camera that sits facing the view plane, which serves as
    // the window into our 3d world. This camera will not move or rotate for the duration of the app.
    quadCamera: FreeCamera;

    // worldCamera is the dynamic camera 3d object that will be positioned, oriented and 
    // constantly updated inside the 3d scene.  Its view will ultimately get passed back to the 
    // stationary quadCamera, which renders the scene to a fullscreen quad (made up of 2 large triangles).
    worldCamera: FreeCamera;
    addCameras() {
        this.quadCamera = new FreeCamera('QuadCamera', Vector3.Zero(), this.screenTextureScene);
        this.screenOutputScene.addCamera(this.quadCamera);

        this.quadCamera.mode = Camera.ORTHOGRAPHIC_CAMERA;
        let aspect = this.engine.getAspectRatio(this.quadCamera);
        let ortho = 1;
        this.quadCamera.orthoTop = ortho;
        this.quadCamera.orthoBottom = -ortho;
        this.quadCamera.orthoLeft = -ortho * aspect;
        this.quadCamera.orthoRight = ortho * aspect;

        this.worldCamera = new FreeCamera('QuadCamera', Vector3.Zero(), this.pathTracingScene);
        this.worldCamera.attachControl(this.canvas);
    }

    // setup render targets...
    pathTracingRenderTarget: RenderTargetTexture;
    screenTextureRenderTarget: RenderTargetTexture;
    addRenderTargets() {
        this.pathTracingRenderTarget = new RenderTargetTexture(
            'PathTracingRenderTarget', 
            { width: (window.innerWidth * this.pixelRatio), height: (window.innerHeight * this.pixelRatio) }, // Size
            this.pathTracingScene, // Scene
            false, // GenerateMipmaps
            null, // do not change aspect ratio
            0, // Type
            null, // isCube
            null, // samplingMode
            false, // DepthBuffer
            false, // StencilBuffer
            null, // isMulti
            0, // Format
        );

        this.screenTextureRenderTarget = new RenderTargetTexture(
            'ScreenTextureRenderTarget', 
            { width: (window.innerWidth * this.pixelRatio), height: (window.innerHeight * this.pixelRatio) }, // Size
            this.screenTextureScene, // Scene
            false, // GenerateMipmaps
            null, // do not change aspect ratio
            0, // Type
            null, // isCube
            null, // samplingMode
            false, // DepthBuffer
            false, // StencilBuffer
            null, // isMulti
            0, // Format
        );
        // THREEJS Parameters used:
        // {
        //     minFilter: THREE.NearestFilter,
        //         magFilter: THREE.NearestFilter,
        //             format: THREE.RGBAFormat,
        //                 type: THREE.FloatType,
        //                     depthBuffer: false,
        //                         stencilBuffer: false
        // };
        // this.screenTextureRenderTarget.texture.generateMipmaps = false;

        this.initSceneData();
    }

    // this full-screen quad mesh performs the path tracing operations and produces a screen-sized image
    pathTracingGeometry: Mesh;
    // this full-screen quad mesh copies the image output of the pathtracing shader and feeds it back in to that shader as a 'previousTexture'
    screenTextureGeometry: Mesh;
    screenTextureMaterial: ShaderMaterial;
    // this full-screen quad mesh takes the image output of the path tracing shader (which is a continuous blend of the previous frame and current frame),
    // and applies gamma correction (which brightens the entire image), and then displays the final accumulated rendering to the screen
    screenOutputGeometry: Mesh;
    screenOutputMaterial: ShaderMaterial;
    addPathTracingGeometry() {
        this.pathTracingGeometry = MeshBuilder.CreatePlane("plane", { width: 2, height: 2 }, this.pathTracingScene);
        this.initPathTracingShaders();

        this.screenTextureGeometry = MeshBuilder.CreatePlane("plane", { width: 2, height: 2 }, this.screenTextureScene);

        this.screenTextureMaterial = new ShaderMaterial("shader", this.screenTextureScene, {
            vertexSource: screenTextureShader.vertexShader,
            fragmentSource: screenTextureShader.fragmentShader,
        }, {
            attributes: ["position", "normal", "uv"],
            uniforms: screenTextureShader.uniforms
        });
        this.screenTextureMaterial.disableDepthWrite = true;

        // ThreeJS Shader Material to compare with babylons
        // screenTextureMaterial = new THREE.ShaderMaterial({
        //     uniforms: screenTextureShader.uniforms,
        //     vertexShader: screenTextureShader.vertexShader,
        //     fragmentShader: screenTextureShader.fragmentShader,
        //     depthWrite: false,
        //     depthTest: false
        // });
        // screenTextureMaterial.uniforms.tPathTracedImageTexture.value = pathTracingRenderTarget.texture;
        this.screenTextureGeometry.material = this.screenTextureMaterial;

        this.screenOutputGeometry = MeshBuilder.CreatePlane("plane", { width: 2, height: 2 }, this.screenTextureScene);
        
        this.screenOutputMaterial = new ShaderMaterial("shader", this.screenTextureScene, {
            vertexSource: screenOutputShader.vertexShader,
            fragmentSource: screenOutputShader.fragmentShader,
        }, {
            attributes: ["position", "normal", "uv"],
            uniforms: screenOutputShader.uniforms
        });
        this.screenOutputMaterial.disableDepthWrite = true;

        this.screenOutputGeometry.material = this.screenOutputMaterial;
    }

    // Depend on every demo
    initSceneData() {
        
    }

    pathTracingFragmentShader: string;
    pathTracingMaterial: ShaderMaterial;
    // Depend on every demo
    initPathTracingShaders() {
        this.pathTracingFragmentShader = 'shaderText';

        this.pathTracingMaterial = new ShaderMaterial("shader", this.pathTracingScene, {
            vertexSource: screenOutputShader.vertexShader,
            fragmentSource: screenOutputShader.fragmentShader,
        }, {
            attributes: ["position", "normal", "uv"],
            uniforms: screenOutputShader.uniforms
        });
        this.screenOutputMaterial.disableDepthWrite = true;

        this.pathTracingGeometry.material = this.pathTracingMaterial
        // the following keeps the large scene ShaderMaterial quad right in front 
        //   of the camera at all times. This is necessary because without it, the scene 
        //   quad will fall out of view and get clipped when the camera rotates past 180 degrees.
        // worldCamera.add(pathTracingMesh);
    }

    // Depend on every demo
    updateVariablesAndUniforms() {

    }

    pixelRatio: number;
    setPixelRatio(ratio: number) {
        this.pixelRatio = ratio;
        this.engine.setHardwareScalingLevel(ratio);
    }

    setFieldofView(fieldofView: number) {
        if (fieldofView > 150)
            fieldofView = 150
        if (fieldofView < 1)
            fieldofView = 1;

        let fovScale = fieldofView * 0.5 * (Math.PI / 180.0);
        let uVLen = Math.tan(fovScale);
        let uULen = uVLen * this.engine.getAspectRatio(this.worldCamera);
        this.pathTracingMaterial.setFloat('uVLen', uVLen);
        this.pathTracingMaterial.setFloat('uULen', uULen);
    }

    setAperture(Aperture: number) {
        this.pathTracingMaterial.setFloat('uApertureSize', Aperture);
    }

    setResolution(resolution: Vector2) {
        this.pathTracingMaterial.setVector2('uResolution', resolution);
    }

    animate() {
        let frameTime = this.engine.getDeltaTime();

        // update scene/demo-specific input(if custom), variables and uniforms every animation frame
        this.updateVariablesAndUniforms();

        // RENDERING in 3 steps

        // STEP 1
        // Perform PathTracing and Render(save) into pathTracingRenderTarget, a full-screen texture.
        // Read previous screenTextureRenderTarget(via texelFetch inside fragment shader) to use as a new starting point to blend with
        this.pathTracingRenderTarget.render();
        this.pathTracingScene.render();

        // STEP 2
        // Render(copy) the pathTracingScene output(pathTracingRenderTarget above) into screenTextureRenderTarget.
        // This will be used as a new starting point for Step 1 above (essentially creating ping-pong buffers)
        this.screenTextureRenderTarget.render();
        this.screenTextureScene.render();

        // STEP 3
        // Render full screen quad with generated pathTracingRenderTarget in STEP 1 above.
        // After the image is gamma-corrected, it will be shown on the screen as the final accumulated output
        this.screenOutputScene.render();
    }


}
