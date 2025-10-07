import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { ISize } from "@babylonjs/core/Maths/math.size";
import { Observable } from "@babylonjs/core/Misc/observable";
import { TAARenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/taaRenderingPipeline";
import type { Scene } from "@babylonjs/core/scene";
import type { Nullable } from "@babylonjs/core/types";

enum RenderState {
    Idle,
    Warmup,
    Capturing,
    Completed
}

class RenderStatusDisplay {
    private readonly _div: HTMLDivElement;
    private readonly _staticInfo: HTMLDivElement;
    private readonly _dynamicInfo: HTMLDivElement;

    private _renderState: RenderState = RenderState.Idle;

    public constructor() {
        const div = document.createElement("div");
        div.style.position = "absolute";
        div.style.left = "0px";
        div.style.top = "0px";
        div.style.color = "white";
        div.style.backgroundColor = "black";
        div.style.fontFamily = "monospace";
        div.style.fontSize = "20px";
        div.style.padding = "10px";
        div.style.zIndex = "100";
        document.body.appendChild(div);
        this._div = div;

        const staticInfo = document.createElement("div");
        div.appendChild(staticInfo);
        this._staticInfo = staticInfo;

        const dynamicInfo = document.createElement("div");
        dynamicInfo.style.marginTop = "10px";
        div.appendChild(dynamicInfo);
        this._dynamicInfo = dynamicInfo;
    }

    public set staticInfo(text: string) {
        this._staticInfo.innerText = text;
    }

    public set renderState(state: RenderState) {
        this._renderState = state;
    }

    public render(text?: string): void {
        switch (this._renderState) {
        case RenderState.Idle:
            this._dynamicInfo.innerText = "Idle...";
            break;
        case RenderState.Warmup:
            this._dynamicInfo.innerText = `[Shader warmup] ${text}`;
            break;
        case RenderState.Capturing:
            this._dynamicInfo.innerText = `[Capturing] ${text}`;
            break;
        case RenderState.Completed:
            this._dynamicInfo.innerText = "Completed.";
            break;
        }
    }

    public dispose(): void {
        this._div.remove();
    }
}

export class MovieSequenceRecorder {
    public saveFrame = false;
    public temporalSamples = 1;
    public spatialSamples = 8;
    public renderResolution: ISize = { width: 4096, height: 1716 };

    public targetFrameRate = 60;
    public animationFrameRate = 30;

    public captureEndFrame = 300;

    private readonly _canvas: HTMLCanvasElement;
    private readonly _scene: Scene;
    private readonly _camera: Camera;

    public readonly onCaptureStartObservable = new Observable<void>();
    private _animationUpdate: Nullable<(frameTime: number, deltaTime: number) => void>;

    public constructor(
        canvas: HTMLCanvasElement,
        scene: Scene,
        camera: Camera
    ) {
        this._canvas = canvas;
        this._scene = scene;
        this._camera = camera;

        this._animationUpdate = null;
    }

    public setCustomAnimationUpdate(callback: (frameTime: number, deltaTime: number) => void): void {
        this._animationUpdate = callback;
    }

    private _configureCanvas(): void {
        const canvas = this._canvas;
        canvas.style.width = `${this.renderResolution.width}px`;
        canvas.style.height = `${this.renderResolution.height}px`;
        canvas.style.position = "absolute";
        canvas.style.left = "50%";
        canvas.style.top = "50%";

        function resizeCanvas(): void {
            const width = window.innerWidth;
            const height = window.innerHeight;
            const scale = Math.min(width / 4096, height / 1716);
            canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
        }
        window.addEventListener("resize", resizeCanvas);
        resizeCanvas();

        const engine = this._scene.getEngine();
        engine.setHardwareScalingLevel(1);
        engine.resize();
    }

    public async capture(): Promise<void> {
        if (this._animationUpdate === null) {
            throw new Error("animation update callback is not set");
        }

        const saveFrame = this.saveFrame;
        const temporalSamples = Math.max(1, Math.min(8, this.temporalSamples));
        const spatialSamples = Math.max(1, Math.min(32, this.spatialSamples));
        const animationFrameRate = this.animationFrameRate;
        const frameRate = this.targetFrameRate;
        const canvas = this._canvas;
        const scene = this._scene;
        const camera = this._camera;
        const engine = scene.getEngine();
        const targetFrameRateToOriginal = animationFrameRate / frameRate; // 0.5 (60fps -> 30fps)
        const captureEndFrame = this.captureEndFrame;

        const taaRenderPipeline = new TAARenderingPipeline("taa", scene, [camera], Constants.TEXTURETYPE_FLOAT);
        taaRenderPipeline.isEnabled = true;
        taaRenderPipeline.samples = temporalSamples * spatialSamples;
        taaRenderPipeline.msaaSamples = 4;

        const renderStatusDisplay = new RenderStatusDisplay();
        this._configureCanvas();

        const directoryHandle = saveFrame
            ? await new Promise<any>((resolve) => {
                window.onclick = async(): Promise<void> => {
                    const handle = await (window as any).showDirectoryPicker();
                    window.onclick = null;
                    resolve(handle);
                };
            })
            : null;

        renderStatusDisplay.renderState = RenderState.Warmup;
        const shaderWarmupEndFrame = captureEndFrame * targetFrameRateToOriginal;
        renderStatusDisplay.render(`(0 / ${shaderWarmupEndFrame})`);
        // shader warmup
        for (let i = 0; i < shaderWarmupEndFrame; i += 50) {
            this._animationUpdate(i, 1 / animationFrameRate);
            scene.render();
            renderStatusDisplay.render(`(${i} / ${shaderWarmupEndFrame})`);
            await new Promise((resolve) => setTimeout(resolve));
        }

        // initial render to avoid black first frame
        taaRenderPipeline.disableOnCameraMove = true;
        for (let i = 0; i < 10; ++i) {
            this._animationUpdate(0, 1 / animationFrameRate);
            scene.render(true, false);
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        // capture frames
        const bufferCanvas = document.createElement("canvas");
        bufferCanvas.width = engine.getRenderWidth();
        bufferCanvas.height = engine.getRenderHeight();
        const bufferContext = bufferCanvas.getContext("2d")!;

        renderStatusDisplay.staticInfo = `Resolution: ${bufferCanvas.width}x${bufferCanvas.height}, Temporal samples: ${temporalSamples}, Spatial samples: ${spatialSamples}, Target frame rate: ${frameRate}fps`;
        renderStatusDisplay.renderState = RenderState.Capturing;
        renderStatusDisplay.render(`(0 / ${captureEndFrame})`);

        this.onCaptureStartObservable.notifyObservers();
        let lastFrameTime = 0;
        for (let frame = 0; frame < captureEndFrame; ++frame) {
            const frameTime = frame * targetFrameRateToOriginal;
            const nextFrameTime = (frame + 1) * targetFrameRateToOriginal;
            for (let spatialIndex = 0; spatialIndex < spatialSamples; ++spatialIndex) {
                taaRenderPipeline.disableOnCameraMove = spatialIndex === 0;

                const subFrameTime = spatialIndex === 0
                    ? frameTime
                    : frameTime + (nextFrameTime - frameTime) * (spatialIndex / spatialSamples);

                const deltaTime = (subFrameTime - lastFrameTime) / frameRate; // in seconds
                lastFrameTime = subFrameTime;

                this._animationUpdate(subFrameTime, deltaTime);

                for (let temporalIndex = 0; temporalIndex < temporalSamples; ++temporalIndex) {
                    await new Promise((resolve) => setTimeout(resolve, 0));
                    scene.render(true, false);
                    renderStatusDisplay.render(`(${frame} / ${captureEndFrame}) [${spatialIndex * temporalSamples + temporalIndex + 1} / ${spatialSamples * temporalSamples}]`);
                }
            }

            if (saveFrame) {
                bufferContext.drawImage(canvas, 0, 0, bufferCanvas.width, bufferCanvas.height);
                const data = await new Promise<Blob | null>((resolve) => bufferCanvas.toBlob((blob) => resolve(blob), "image/png"));
                if (data === null) throw new Error("failed to capture frame");
                (async(): Promise<void> => {
                    const fileHandle = await directoryHandle.getFileHandle(
                        `frame_${frame.toString().padStart(5, "0")}.png`,
                        { create: true }
                    );
                    const writable = await fileHandle.createWritable();
                    await writable.write(data);
                    await writable.close();
                })();
            } else {
                await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
            }
        }

        taaRenderPipeline.dispose();
    }
}
