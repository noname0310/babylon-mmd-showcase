import "@babylonjs/core/Loading/loadingScreen";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import "babylon-mmd/esm/Loader/pmxLoader";
import "babylon-mmd/esm/Runtime/Animation/mmdRuntimeCameraAnimation";
import "babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation";

import { FontAsset } from "@babylonjs/addons/msdfText/fontAsset";
import { TextRenderer } from "@babylonjs/addons/msdfText/textRenderer";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Constants } from "@babylonjs/core/Engines/constants";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { RectAreaLight } from "@babylonjs/core/Lights/rectAreaLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { DepthOfFieldEffectBlurLevel } from "@babylonjs/core/PostProcesses/depthOfFieldEffect";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import { Scene } from "@babylonjs/core/scene";
import type { Nullable } from "@babylonjs/core/types";
import { Inspector } from "@babylonjs/inspector";
import { PBRMaterialBuilder } from "babylon-mmd/esm/Loader/pbrMaterialBuilder";
import { RegisterDxBmpTextureLoader } from "babylon-mmd/esm/Loader/registerDxBmpTextureLoader";
import { SdefInjector } from "babylon-mmd/esm/Loader/sdefInjector";
import { VmdLoader } from "babylon-mmd/esm/Loader/vmdLoader";
import { StreamAudioPlayer } from "babylon-mmd/esm/Runtime/Audio/streamAudioPlayer";
import { MmdCamera } from "babylon-mmd/esm/Runtime/mmdCamera";
import type { MmdMesh } from "babylon-mmd/esm/Runtime/mmdMesh";
import { MmdWasmAnimation } from "babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmAnimation";
import { MmdWasmInstanceTypeSPR } from "babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease";
import { GetMmdWasmInstance } from "babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance";
import { MmdWasmRuntime } from "babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime";
import { MotionType } from "babylon-mmd/esm/Runtime/Optimized/Physics/Bind/motionType";
import { PhysicsStaticPlaneShape } from "babylon-mmd/esm/Runtime/Optimized/Physics/Bind/physicsShape";
import { RigidBody } from "babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBody";
import { RigidBodyConstructionInfo } from "babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBodyConstructionInfo";
import type { IPhysicsClock } from "babylon-mmd/esm/Runtime/Optimized/Physics/IPhysicsClock";
import { MmdWasmPhysics } from "babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysics";
import { MmdWasmPhysicsRuntimeImpl } from "babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntimeImpl";
import { DisplayTimeFormat, MmdPlayerControl } from "babylon-mmd/esm/Runtime/Util/mmdPlayerControl";

import type { ISceneBuilder } from "./baseRuntime";
import { createCameraSwitch } from "./createCameraSwitch";
import { createDefaultArcRotateCamera } from "./createDefaultArcRotateCamera";
import { MmdCameraAutoFocus } from "./mmdCameraAutoFocus";
import { MovieSequenceRecorder } from "./movieSequenceRecorder";

class OfflineMmdWasmPhysics extends MmdWasmPhysics {
    public useOfflineClock = true;
    public frameRate = 60;

    private readonly _engine: AbstractEngine;

    public constructor(scene: Scene) {
        super(scene);
        this._engine = scene.getEngine();
    }

    public override createPhysicsClock(): IPhysicsClock {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        const engine = this._engine;
        return {
            getDeltaTime(): number | undefined {
                if (self.useOfflineClock) {
                    return 1 / self.frameRate;
                } else {
                    const deltaTime = engine.getDeltaTime();
                    if (deltaTime === 0) {
                        return 1 / 60;
                    }
                    return deltaTime / 1000;
                }
            }
        };
    }
}

export class SceneBuilder implements ISceneBuilder {
    public async build(canvas: HTMLCanvasElement, engine: AbstractEngine): Promise<Scene> {
        SdefInjector.OverrideEngineCreateEffect(engine);
        RegisterDxBmpTextureLoader();

        const materialBuilder = new PBRMaterialBuilder();
        const scene = new Scene(engine);
        scene.clearColor = new Color4(0.001, 0.001, 0.001, 1.0);

        const cameraRoot = new TransformNode("CameraRoot", scene);
        cameraRoot.scaling.y = 0.9; // match with mmd model height
        const mmdCamera = new MmdCamera("MmdCamera", new Vector3(0, 10, 0), scene);
        mmdCamera.ignoreParentScaling = true;
        mmdCamera.parent = cameraRoot;
        mmdCamera.minZ = 1;
        mmdCamera.maxZ = 1000;
        const camera = createDefaultArcRotateCamera(scene);
        createCameraSwitch(scene, canvas, mmdCamera, camera);

        const hemisphericLight = new HemisphericLight("HemiSphereLight", new Vector3(0, 1, 0), scene);
        hemisphericLight.intensity = 0.1;

        const lightMaterial = new StandardMaterial("lightMaterial", scene);
        lightMaterial.disableLighting = true;
        lightMaterial.emissiveColor = new Color3(1.0, 1.0, 1.0);
        lightMaterial.roughness = 1.0;

        function createRectAreaLight(
            name: string,
            width: number,
            height: number,
            scene: Scene,
            meshOnly: boolean
        ): [TransformNode, Nullable<RectAreaLight>] {
            const lightNode = new TransformNode(name, scene);

            const ground = CreateGround(`${name}_lightMesh`, { width, height, subdivisions: 1, updatable: false }, scene);
            ground.material = lightMaterial;
            ground.rotation.x = -Math.PI / 2;
            ground.parent = lightNode;

            if (!meshOnly) {
                const rectAreaLight = new RectAreaLight(name, new Vector3(0, 0, 0), width, height, scene);
                rectAreaLight.intensity = 1.0;
                rectAreaLight.parent = lightNode;

                return [lightNode, rectAreaLight];
            } else {
                return [lightNode, null];
            }
        }

        // fake light array
        const rectAreaLightArrayCount = 30;
        const rectLightParent = new Mesh("RectAreaLightParent", scene);

        const rectLightLeftParent = new TransformNode("RectAreaLightLeftParent", scene);
        rectLightLeftParent.position.x = -30;
        rectLightLeftParent.position.y = 30;
        rectLightLeftParent.parent = rectLightParent;
        for (let i = 0; i < rectAreaLightArrayCount; ++i) {
            const [lightMesh] = createRectAreaLight(
                `RectAreaLight${i}`,
                40,
                2,
                scene,
                true
            );
            lightMesh.rotation.x = -Math.PI / 2;
            lightMesh.rotation.y = Math.PI / 8;

            lightMesh.position.z = -80 + (i * 20);

            lightMesh.parent = rectLightLeftParent;
        }
        rectLightLeftParent.rotation.z = Math.PI / 8;

        const rectLightRightParent = new TransformNode("RectAreaLightRightParent", scene);
        rectLightRightParent.position.x = 30;
        rectLightRightParent.position.y = 30;
        rectLightRightParent.parent = rectLightParent;
        for (let i = 0; i < rectAreaLightArrayCount; ++i) {
            const [lightMesh] = createRectAreaLight(
                `RectAreaLight${i}`,
                40,
                2,
                scene,
                true
            );
            lightMesh.rotation.x = -Math.PI / 2;
            lightMesh.rotation.y = -Math.PI / 8;

            lightMesh.position.z = -80 + (i * 20);

            lightMesh.parent = rectLightRightParent;
        }
        rectLightRightParent.rotation.z = -Math.PI / 8;

        const mirroredRectLights = rectLightParent.clone("RectAreaLightParent2");
        mirroredRectLights.scaling.y = -1;
        mirroredRectLights.parent = rectLightParent;

        // back light
        {
            const degToRad = Math.PI / 180;
            const position = new Vector3(-20, 30, 20);
            const target = new Vector3(0, 15, 0);
            const direction = target.subtract(position).normalize();
            const spotLight = new SpotLight("SpotLight", position, direction, 100 * degToRad, 1, scene);
            spotLight.intensity = 10000.0;

            const shadowGenerator = new ShadowGenerator(1024, spotLight);
            shadowGenerator.transparencyShadow = true;
            shadowGenerator.usePercentageCloserFiltering = true;
            shadowGenerator.forceBackFacesOnly = true;
            shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_HIGH;
            shadowGenerator.frustumEdgeFalloff = 0.1;
        }
        {
            const degToRad = Math.PI / 180;
            const position = new Vector3(20, 20, 20);
            const target = new Vector3(0, 15, 0);
            const direction = target.subtract(position).normalize();
            const spotLight = new SpotLight("SpotLight", position, direction, 100 * degToRad, 1, scene);
            spotLight.intensity = 10000.0;

            const shadowGenerator = new ShadowGenerator(1024, spotLight);
            shadowGenerator.transparencyShadow = true;
            shadowGenerator.usePercentageCloserFiltering = true;
            shadowGenerator.forceBackFacesOnly = true;
            shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_HIGH;
            shadowGenerator.frustumEdgeFalloff = 0.1;
        }

        // key light
        {
            const degToRad = Math.PI / 180;
            const position = new Vector3(-20, 30, -40);
            const target = new Vector3(0, 15, 0);
            const direction = target.subtract(position).normalize();
            const spotLight = new SpotLight("SpotLight", position, direction, 40 * degToRad, 1, scene);
            spotLight.intensity = 1000.0;

            const shadowGenerator = new ShadowGenerator(2048, spotLight);
            shadowGenerator.transparencyShadow = true;
            shadowGenerator.usePercentageCloserFiltering = true;
            shadowGenerator.forceBackFacesOnly = true;
            shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_HIGH;
            shadowGenerator.frustumEdgeFalloff = 0.1;
        }

        const ground = CreateGround("ground1", { width: 1000, height: 1000, subdivisions: 1, updatable: false }, scene);
        ground.receiveShadows = true;
        const groundMaterial = new PBRMaterial("ground1_material", scene);
        groundMaterial.roughness = 0.6500;
        groundMaterial.metallic = 0.0;
        groundMaterial.albedoColor = new Color3(0.05, 0.05, 0.05);
        ground.material = groundMaterial;
        groundMaterial.alpha = 0.8;

        const audioPlayer = new StreamAudioPlayer(scene);
        audioPlayer.source = "res/private_test/Telephone/Telephone_master.mp3";
        audioPlayer.volume = 0.5;
        audioPlayer.preservesPitch = false;

        // show loading screen
        engine.displayLoadingUI();

        const loadingTexts: string[] = [];
        const updateLoadingText = (updateIndex: number, text: string): void => {
            loadingTexts[updateIndex] = text;
            engine.loadingUIText = "<br/><br/><br/><br/>" + loadingTexts.join("<br/><br/>");
        };

        const vmdLoader = new VmdLoader(scene);
        vmdLoader.loggingEnabled = true;

        const frameRate = 60;
        const offlineMmdWasmPhysics = new OfflineMmdWasmPhysics(scene);
        offlineMmdWasmPhysics.useOfflineClock = true;
        offlineMmdWasmPhysics.frameRate = frameRate;

        const [mmdRuntime, mmdAnimation, modelMesh, textRenderer] = await Promise.all([
            (async(): Promise<MmdWasmRuntime> => {
                updateLoadingText(0, "Loading mmd runtime...");
                const wasmInstance = await GetMmdWasmInstance(new MmdWasmInstanceTypeSPR());
                updateLoadingText(0, "Loading mmd runtime... Done");

                const mmdRuntime = new MmdWasmRuntime(wasmInstance, scene, offlineMmdWasmPhysics);
                mmdRuntime.loggingEnabled = true;
                mmdRuntime.register(scene);
                mmdRuntime.setAudioPlayer(audioPlayer);
                return mmdRuntime;
            })(),
            vmdLoader.loadAsync("motion",
                [ // NOTE: you can download motion and music from https://www.youtube.com/watch?v=o0SNzFbNo4g
                    "res/private_test/Telephone/telephone_facial.vmd",
                    "res/private_test/Telephone/telephone_motion.vmd",
                    "res/private_test/Telephone/telephone_cam.vmd"
                ],
                (event) => updateLoadingText(1, `Loading motion... ${event.loaded}/${event.total} (${Math.floor(event.loaded * 100 / event.total)}%)`)),
            LoadAssetContainerAsync(
                // NOTE: you can download this model from https://bowlroll.net/file/320915
                "res/private_test/げのげ式初音ミク/げのげ式初音ミク.pmx",
                scene,
                {
                    onProgress: (event) => updateLoadingText(2, `Loading model... ${event.loaded}/${event.total} (${Math.floor(event.loaded * 100 / event.total)}%)`),
                    pluginOptions: {
                        mmdmodel: {
                            loggingEnabled: true,
                            materialBuilder: materialBuilder
                        }
                    }
                }
            ).then(result => {
                result.addAllToScene();
                return result.rootNodes[0] as MmdMesh;
            }),
            (async(): Promise<TextRenderer> => {
                updateLoadingText(3, "Loading font...");
                const sdfFontDefinition = await (await fetch("res/custom-msdf/custom-msdf.json")).text();
                const fontAsset = new FontAsset(sdfFontDefinition, "res/custom-msdf/custom.png", scene);

                const textRenderer = await TextRenderer.CreateTextRendererAsync(fontAsset, engine);
                updateLoadingText(3, "Loading font... Done");
                return textRenderer;
            })()
        ]);

        const wasmAnimation = new MmdWasmAnimation(mmdAnimation, mmdRuntime.wasmInstance, scene);

        const cameraAnimationHandle = mmdCamera.createRuntimeAnimation(wasmAnimation);
        mmdCamera.setRuntimeAnimation(cameraAnimationHandle);
        mmdRuntime.addAnimatable(mmdCamera);

        for (const mesh of modelMesh.metadata.meshes) mesh.receiveShadows = true;
        for (const light of scene.lights) {
            const generator = light.getShadowGenerator() as Nullable<ShadowGenerator>;
            if (generator) generator.addShadowCaster(modelMesh);
        }
        for (const mesh of modelMesh.metadata.meshes) {
            const modelMeshReflection = mesh.createInstance(mesh.name + "_reflection");
            modelMeshReflection.scaling.y *= -1;
            modelMeshReflection.parent = modelMesh;
        }

        const mmdModel = mmdRuntime.createMmdModel(modelMesh);
        const modelAnimationHandle = mmdModel.createRuntimeAnimation(wasmAnimation);
        mmdModel.setRuntimeAnimation(modelAnimationHandle);

        const physicsRuntime = mmdRuntime.physics!.getImpl(MmdWasmPhysicsRuntimeImpl);
        const info = new RigidBodyConstructionInfo(physicsRuntime.wasmInstance);
        info.motionType = MotionType.Static;
        info.shape = new PhysicsStaticPlaneShape(physicsRuntime, new Vector3(0, 1, 0), 0);
        const groundBody = new RigidBody(physicsRuntime, info);
        physicsRuntime.addRigidBodyToGlobal(groundBody);

        const defaultPipeline = new DefaultRenderingPipeline("default", true, scene);
        defaultPipeline.samples = 1;
        defaultPipeline.bloomEnabled = true;
        defaultPipeline.chromaticAberrationEnabled = true;
        defaultPipeline.chromaticAberration.aberrationAmount = 1;
        defaultPipeline.chromaticAberration.radialIntensity = 1;
        defaultPipeline.depthOfFieldEnabled = true;
        defaultPipeline.depthOfFieldBlurLevel = DepthOfFieldEffectBlurLevel.High;
        defaultPipeline.fxaaEnabled = true;
        defaultPipeline.imageProcessingEnabled = true;
        defaultPipeline.imageProcessing.exposure = 2.0;
        defaultPipeline.imageProcessing.toneMappingEnabled = true;
        defaultPipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
        defaultPipeline.imageProcessing.vignetteWeight = 0.5;
        defaultPipeline.imageProcessing.vignetteStretch = 0.5;
        defaultPipeline.imageProcessing.vignetteColor = new Color4(0, 0, 0, 0);
        defaultPipeline.imageProcessing.vignetteEnabled = true;
        const mmdCameraAutoFocus = new MmdCameraAutoFocus(mmdCamera, defaultPipeline);
        mmdCameraAutoFocus.setTarget(mmdModel);
        mmdCameraAutoFocus.register(scene);

        for (const depthRenderer of Object.values(scene._depthRenderer)) {
            depthRenderer.forceDepthWriteTransparentMeshes = true;
            engine.onResizeObservable.add(() => depthRenderer.getDepthMap().resize({
                width: engine.getRenderWidth(),
                height: engine.getRenderHeight()
            }));
        }

        const ssaoRenderingPipeline = new SSAO2RenderingPipeline("ssao", scene, { ssaoRatio: 0.5, blurRatio: 1.0 }, [mmdCamera, camera], undefined, Constants.TEXTURETYPE_FLOAT);
        ssaoRenderingPipeline.samples = 64;

        const clothMaterialNameSet = new Set<string>([
            "Clothes",
            "Clothes2",
            "Pantsu",
            "Skirt",
            "Tie"
        ]);
        const uvScale = 10;
        const fabricAoMap = new Texture("res/Fabric030_4K-PNG/Fabric030_4K-PNG_AmbientOcclusion.png", scene);
        fabricAoMap.uScale = uvScale;
        fabricAoMap.vScale = uvScale;
        fabricAoMap.wrapU = Texture.WRAP_ADDRESSMODE;
        fabricAoMap.wrapV = Texture.WRAP_ADDRESSMODE;
        const fabricNormalMap = new Texture("res/Fabric030_4K-PNG/Fabric030_4K-PNG_NormalGL.png", scene);
        fabricNormalMap.uScale = uvScale;
        fabricNormalMap.vScale = uvScale;
        fabricNormalMap.wrapU = Texture.WRAP_ADDRESSMODE;
        fabricNormalMap.wrapV = Texture.WRAP_ADDRESSMODE;
        fabricNormalMap.level = 0.3;
        const fabricRoughnessMap = new Texture("res/Fabric030_4K-PNG/Fabric030_4K-PNG_Roughness.png", scene);
        fabricRoughnessMap.uScale = uvScale;
        fabricRoughnessMap.vScale = uvScale;
        fabricRoughnessMap.wrapU = Texture.WRAP_ADDRESSMODE;
        fabricRoughnessMap.wrapV = Texture.WRAP_ADDRESSMODE;

        for (const material of scene.materials) {
            if (material instanceof PBRMaterial) {
                material.maxSimultaneousLights = 8;
                material.brdf.dielectricSpecularModel = Constants.MATERIAL_DIELECTRIC_SPECULAR_MODEL_OPENPBR;
                material.brdf.conductorSpecularModel = Constants.MATERIAL_CONDUCTOR_SPECULAR_MODEL_OPENPBR;
                material.brdf.useLegacySpecularEnergyConservation = false;

                if (clothMaterialNameSet.has(material.name)) {
                    material.ambientTexture = fabricAoMap;
                    material.bumpTexture = fabricNormalMap;
                    material.baseDiffuseRoughnessTexture = fabricRoughnessMap;
                    material.useAmbientInGrayScale = true;
                }
            }
        }

        textRenderer.color = new Color4(1, 1, 1, 1);
        textRenderer.addParagraph(`Music：めろくる/Mellowcle
Choreography&Motion Capture Performer：ぴのぴ
Model：げのげ
Video：noname0310
`, { textAlign: "left"}, Matrix.Translation(-20, 3, 0));

        textRenderer.addParagraph("Telephone feat.Miku Hatsune", { textAlign: "right"}, Matrix.Scaling(2, 2, 2).multiply(Matrix.Translation(20, 3, 0)));

        scene.onAfterRenderObservable.add(() => {
            if (scene.activeCamera !== mmdCamera) return;
            if (154 <= mmdRuntime.currentFrameTime) return;
            textRenderer.render(mmdCamera.getViewMatrix(), mmdCamera.getProjectionMatrix());
        });

        const outroTexture = new Texture("res/rbjs.png", scene);
        outroTexture.hasAlpha = true;
        const outroImagePlane = CreateGround("outroImage", { width: 1, height: 744 / 2000, subdivisions: 1, updatable: false }, scene);
        const outroImageMaterial = new StandardMaterial("outroImageMaterial", scene);
        outroImageMaterial.useAlphaFromDiffuseTexture = true;
        outroImageMaterial.diffuseTexture = outroTexture;
        outroImageMaterial.emissiveTexture = outroTexture;
        outroImageMaterial.backFaceCulling = false;
        outroImageMaterial.disableLighting = true;
        outroImageMaterial.transparencyMode = Material.MATERIAL_ALPHATESTANDBLEND;
        outroImagePlane.material = outroImageMaterial;
        outroImagePlane.rotation.x = -Math.PI / 2;
        outroImagePlane.position.x = 0;
        outroImagePlane.position.y = 25;
        outroImagePlane.position.z = 20;

        outroImagePlane.scaling.setAll(80);
        outroImagePlane.alphaIndex = 100000;
        scene.onAfterRenderObservable.add(() => {
            // if (4479 <= mmdRuntime.currentFrameTime && mmdRuntime.currentFrameTime < 4545) {
            if (mmdRuntime.currentFrameTime < 154) {
                mmdCameraAutoFocus.unregister(scene);
                rectLightParent.setEnabled(false);
                outroImagePlane.isVisible = true;
            } else {
                mmdCameraAutoFocus.register(scene);
                rectLightParent.setEnabled(true);
                outroImagePlane.isVisible = false;
            }
        });

        scene.onReadyObservable.addOnce(() => engine.hideLoadingUI());

        Inspector;
        // Inspector.Show(scene, { overlay: true });

        const captureImageSequence = false;
        if (captureImageSequence) {
            mmdRuntime.unregister(scene);

            const recorder = new MovieSequenceRecorder(canvas, scene, mmdCamera);
            recorder.saveFrame = true;
            recorder.animationFrameRate = 30;
            recorder.targetFrameRate = frameRate;
            recorder.temporalSamples = 8;
            recorder.spatialSamples = 1;
            recorder.renderResolution = { width: 4096, height: 1716 };
            recorder.captureEndFrame = mmdRuntime.animationFrameTimeDuration * (frameRate / 30);

            recorder.setCustomAnimationUpdate((frameTime, deltaTime) => {
                mmdRuntime.seekAnimation(frameTime, true);
                mmdRuntime.beforePhysics(deltaTime);
                mmdRuntime.afterPhysics();
            });

            recorder.onCaptureStartObservable.addOnce(() => {
                mmdRuntime.initializeAllMmdModelsPhysics(false);
            });

            await recorder.capture();

            mmdRuntime.register(scene);
            const mmdPlayerControl = new MmdPlayerControl(scene, mmdRuntime, audioPlayer);
            mmdPlayerControl.displayTimeFormat = DisplayTimeFormat.Frames;
            mmdPlayerControl.showPlayerControl();
        } else {
            const mmdPlayerControl = new MmdPlayerControl(scene, mmdRuntime, audioPlayer);
            mmdPlayerControl.displayTimeFormat = DisplayTimeFormat.Frames;
            mmdPlayerControl.showPlayerControl();
        }

        return scene;
    }
}
