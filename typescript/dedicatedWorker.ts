import { Nullable, Observable, Observer, Quaternion, Scene, StringDictionary, TransformNode, Vector3, VideoTexture } from "babylonjs";

// Example: https://www.babylonjs-playground.com/ts.html#22Y717

declare var Module: any;
declare function postMessage(data: any): void;

class DedicatedWorker {
    private static createFromSources(...sources: any[]): Worker {
        let workerCode: string = "";
        for (let idx = 0; idx < sources.length - 1; idx++) {
            workerCode += sources[idx].toString();
        }
        workerCode += "(" + sources[sources.length - 1].toString() + ")();";
        return new Worker(window.URL.createObjectURL(new Blob([workerCode])));
    }

    public static createFromLocation(jsUrl: string, onInitialized: () => void, onMessage: (event: MessageEvent) => void): Worker {
        let moduleDefition: string = `Module = {
            locateFile: function (path) {
                return \"` + jsUrl.replace(/.js$/, ".wasm") + `\";
            },
            onRuntimeInitialized: function () {
                (` + onInitialized.toString() + `)();
            }
        };`;
        let messageHandler: string = "this.onmessage = " + onMessage.toString() + ";";
        let importJavascript: string = "function importJavascript() { importScripts(\"" + jsUrl + "\"); }";
        return this.createFromSources(moduleDefition, messageHandler, importJavascript);
    }

    public static unexpectedMessageHandler(event: MessageEvent): void {
        throw Error("Unexpected message from WebWorker: " + event);
    }
}

export class ExampleWorker {
    private _worker: Worker;

    private constructor() {}

    private static onInitialized(): void {
        postMessage({
            message: "Got a module!"
        });
    }

    private static onMessage(event: MessageEvent): void {
        let data = event.data;
        data.wentToWorker = true;
        postMessage(data);
    }

    public static createAsync(): Promise<ExampleWorker> {
        return new Promise<ExampleWorker>((resolve: (worker: ExampleWorker) => void) => {
            let exampleWorker = new ExampleWorker();
            exampleWorker._worker = DedicatedWorker.createFromLocation(
                "https://syntheticmagus.github.io/webpiled-aruco-ar/v0.02/webpiled-aruco-ar/webpiled-aruco-ar.js",
                ExampleWorker.onInitialized,
                ExampleWorker.onMessage);
            exampleWorker._worker.onmessage = (event: MessageEvent) => {
                exampleWorker._worker.onmessage = DedicatedWorker.unexpectedMessageHandler;
                resolve(exampleWorker);
            };
        });
    }

    public sendMessageAsync(data: any): Promise<any> {
        let promise = new Promise<any>((resolve: (value: any) => void) => {
            this._worker.onmessage = (event: MessageEvent) => {
                resolve(event.data);
                this._worker.onmessage = DedicatedWorker.unexpectedMessageHandler;
            };
        });

        this._worker.postMessage(data);

        return promise;
    }
}

class ArUcoMarkerTracker {
    private static readonly MODULE_URL: string = "https://syntheticmagus.github.io/webpiled-aruco-ar/v0.02/webpiled-aruco-ar/webpiled-aruco-ar.js";
    private _worker: Worker;

    private constructor() {}

    private static onInitialized() {
        Module._reset();
        postMessage({ initialized: true });
    }

    private static onMessage(event: MessageEvent): void {
        const args = event.data;

        if (args.reset) {
            Module._reset();
            postMessage({ reset: true });
        }
        else if (args.calibrate) {
            Module._set_calibration_from_frame_size(args.width, args.height);
            postMessage({ calibrated: true });
        }
        else if (args.track) {
            let buf = Module._malloc(args.imageData.length * args.imageData.BYTES_PER_ELEMENT);
            Module.HEAP8.set(args.imageData, buf);
            let numMarkers = Module._process_image(args.width, args.height, buf, 1);
            Module._free(buf);

            let markers: any[] = [];
            let offset: number = 0;
            let id: number = 0;
            let tx: number = 0.0;
            let ty: number = 0.0;
            let tz: number = 0.0;
            let rx: number = 0.0;
            let ry: number = 0.0;
            let rz: number = 0.0;
            for (let markerIdx = 0; markerIdx < numMarkers; markerIdx++) {
                let ptr = Module._get_tracked_marker(markerIdx);

                offset = 0;
                id = Module.getValue(ptr + offset, "i32");
                offset += 12;
                tx = Module.getValue(ptr + offset, "double");
                offset += 8;
                ty = Module.getValue(ptr + offset, "double");
                offset += 8;
                tz = Module.getValue(ptr + offset, "double");
                offset += 8;
                rx = Module.getValue(ptr + offset, "double");
                offset += 8;
                ry = Module.getValue(ptr + offset, "double");
                offset += 8;
                rz = Module.getValue(ptr + offset, "double");

                markers.push({
                    id: id,
                    tx: tx,
                    ty: ty,
                    tz: tz,
                    rx: rx,
                    ry: ry,
                    rz: rz
                });
            }

            postMessage({
                markers: markers
            });
        }
    }

    public static createAsync(): Promise<ArUcoMarkerTracker> {
        return new Promise<ArUcoMarkerTracker>((resolve: (tracker: ArUcoMarkerTracker) => void) => {
            let tracker = new ArUcoMarkerTracker();
            tracker._worker = DedicatedWorker.createFromLocation(
                ArUcoMarkerTracker.MODULE_URL,
                ArUcoMarkerTracker.onInitialized,
                ArUcoMarkerTracker.onMessage);
            tracker._worker.onmessage = (event: MessageEvent) => {
                tracker._worker.onmessage = DedicatedWorker.unexpectedMessageHandler;
                resolve(tracker);
            };
        });
    }

    public setCalibrationAsync(width: number, height: number): Promise<void> {
        const promise = new Promise<void>((resolve, reject) => {
            this._worker.onmessage = (result) => {
                this._worker.onmessage = DedicatedWorker.unexpectedMessageHandler;

                if (result.data.calibrated) {
                    resolve();
                }
                else {
                    reject(result.data);
                }
            }
        });

        this._worker.postMessage({
            calibrate: true,
            width: width,
            height: height
        });

        return promise;
    }

    public findMarkersInImageAsync(videoTexture: VideoTexture): Promise<any[]> {
        const promise = new Promise<any[]>((resolve, reject) => {
            this._worker.onmessage = (result) => {
                this._worker.onmessage = DedicatedWorker.unexpectedMessageHandler;
                
                if (result.data.markers) {
                    resolve(result.data.markers);
                }
                else {
                    reject(result.data);
                }
            };
        });

        this._worker.postMessage({
            track: true,
            width: videoTexture.getSize().width,
            height: videoTexture.getSize().height,
            imageData: videoTexture.readPixels()
        });

        return promise;
    }
}

class FilteredVector3 extends Vector3 {
    private _idx: number;
    private _samples: Vector3[];
    private _sampleSquaredDistances: number[];
    private _sampleAverage: Vector3;

    public constructor(x: number, y: number, z: number, sampleCount: number = 1) {
        super(x, y, z);

        this._idx = 0;
        this._samples = [];
        this._sampleSquaredDistances = [];
        for (let idx = 0; idx < sampleCount; ++idx) {
            this._samples.push(new Vector3(x, y, z));
            this._sampleSquaredDistances.push(0.0);
        }

        this._sampleAverage = new Vector3(x, y, z);
    }

    public addSample(sample: Vector3): void {
        this._sampleAverage.scaleInPlace(this._samples.length);
        this._sampleAverage.subtractInPlace(this._samples[this._idx]);
        this._samples[this._idx].copyFrom(sample);
        this._sampleAverage.addInPlace(this._samples[this._idx]);
        this._sampleAverage.scaleInPlace(1.0 / this._samples.length);
        this._idx = (this._idx + 1) % this._samples.length;

        let avgSquaredDistance = 0.0;
        for (let idx = 0; idx < this._samples.length; ++idx) {
            this._sampleSquaredDistances[idx] = Vector3.DistanceSquared(this._sampleAverage, this._samples[idx]);
            avgSquaredDistance += this._sampleSquaredDistances[idx];
        }
        avgSquaredDistance /= this._samples.length;

        let numIncludedSamples = 0;
        this.set(0.0, 0.0, 0.0);
        for (let idx = 0; idx <= this._samples.length; ++idx) {
            if (this._sampleSquaredDistances[idx] <= avgSquaredDistance) {
                this.addInPlace(this._samples[idx]);
                numIncludedSamples += 1;
            }
        }
        this.scaleInPlace(1.0 / numIncludedSamples);
    }
}

class TrackedNode extends TransformNode {
    private _isTracking: boolean;
    private _notTrackedFramesCount: number; // TODO: Remove this feature, which only exists as a stopgap.

    public onTrackingAcquiredObservable: Observable<TrackedNode>;
    public onTrackingLostObservable: Observable<TrackedNode>;
    public disableWhenNotTracked: boolean;

    public constructor(name: string, scene?: Scene | null | undefined, disableWhenNotTracked: boolean = true) {
        super(name, scene, true);

        this._isTracking = false;
        this.disableWhenNotTracked = disableWhenNotTracked;
        if (this.disableWhenNotTracked) {
            this.setEnabled(false);
        }

        this._notTrackedFramesCount = 10;

        this.onTrackingAcquiredObservable = new Observable(observer => {
            if (this._isTracking) {
                this.onTrackingAcquiredObservable.notifyObserver(observer, this);
            }
        });
        this.onTrackingLostObservable = new Observable();

        this.rotationQuaternion = Quaternion.Identity();
    }

    public isTracking(): boolean {
        return this._isTracking;
    }

    public setTracking(position: Vector3, rotation: Quaternion, isTracking: boolean): void {
        this.position.copyFrom(position);
        this.rotationQuaternion ? this.rotationQuaternion.copyFrom(rotation) : this.rotationQuaternion = rotation.clone();

        // TODO: Remove this feature, which only exists as a stopgap.
        if (isTracking) {
            this._notTrackedFramesCount = 0;
        }
        else {
            this._notTrackedFramesCount += 1;
            if (this._notTrackedFramesCount < 5) {
                isTracking = true;
            }
        }

        if (!this._isTracking && isTracking) {
            this.onTrackingAcquiredObservable.notifyObservers(this);
        }
        else if (this._isTracking && !isTracking) {
            this.onTrackingLostObservable.notifyObservers(this);
        }
        this._isTracking = isTracking;
        this.setEnabled(!this.disableWhenNotTracked || this._isTracking);
    }
}

export class ArUcoMetaMarkerObjectTracker {
    private _scene: Scene;
    private _videoTexture: VideoTexture;
    private _runTrackingObserver: Nullable<Observer<Scene>> = null;
    private _tracker: ArUcoMarkerTracker;
    private _trackableObjects: StringDictionary<TrackedNode> = new StringDictionary<TrackedNode>();

    private __posEstimate: Vector3 = Vector3.Zero();
    private __posEstimateCount: number = 0;
    private __rightEstimate: Vector3 = Vector3.Zero();
    private __rightEstimateCount: number = 0;
    private __forwardEstimate: Vector3 = Vector3.Zero();
    private __forwardEstimateCount: number = 0;
    private __scratchVec: Vector3 = Vector3.Zero();
    private __filteredPos: FilteredVector3 = new FilteredVector3(0.0, 0.0, 0.0);
    private __filteredRight: FilteredVector3 = new FilteredVector3(0.0, 0.0, 0.0);
    private __filteredForward: FilteredVector3 = new FilteredVector3(0.0, 0.0, 0.0);
    private __targetPosition: Vector3 = Vector3.Zero();
    private __targetRotation: Quaternion = Quaternion.Identity();
    private __ulId: number = -1;
    private __urId: number = -1;
    private __llId: number = -1;
    private __lrId: number = -1;

    constructor(videoTexture: VideoTexture, scene: Scene) {
        this._scene = scene;
        this._videoTexture = videoTexture;
    }

    addTrackableObject(ul: number, ur: number, ll: number, lr: number) {
        const descriptor = [ul, ur, ll, lr].toString();
        this._trackableObjects.add(descriptor, new TrackedNode(descriptor.toString(), this._scene));
        return this._trackableObjects.get(descriptor);
    }

    processResults(results: any) {
        // TODO: THIS IS HACKED CODE

        this._trackableObjects.forEach((descriptor: string, trackedObject: TrackedNode) => {
            var nums = descriptor.split(',');
            this.__ulId = parseInt(nums[0]);
            this.__urId = parseInt(nums[1]);
            this.__llId = parseInt(nums[2]);
            this.__lrId = parseInt(nums[3]);

            this.__posEstimate.set(0.0, 0.0, 0.0);
            this.__posEstimateCount = 0.0;
            this.__rightEstimate.set(0.0, 0.0, 0.0);
            this.__rightEstimateCount = 0.0;
            this.__forwardEstimate.set(0.0, 0.0, 0.0);
            this.__forwardEstimateCount = 0.0;

            if (results[this.__llId]) {
                if (results[this.__urId]) {
                    this.__scratchVec.set(0.0, 0.0, 0.0);
                    this.__scratchVec.addInPlace(results[this.__llId].position);
                    this.__scratchVec.addInPlace(results[this.__urId].position);
                    this.__scratchVec.scaleInPlace(0.5);
                    
                    this.__posEstimate.addInPlace(this.__scratchVec);
                    this.__posEstimateCount += 1.0;
                }

                if (results[this.__lrId]) {
                    this.__scratchVec.set(0.0, 0.0, 0.0);
                    this.__scratchVec.addInPlace(results[this.__lrId].position);
                    this.__scratchVec.subtractInPlace(results[this.__llId].position);
                    this.__scratchVec.normalize();
                    
                    this.__rightEstimate.addInPlace(this.__scratchVec);
                    this.__rightEstimateCount += 1.0;
                }
                
                if (results[this.__ulId]) {
                    this.__scratchVec.set(0.0, 0.0, 0.0);
                    this.__scratchVec.addInPlace(results[this.__ulId].position);
                    this.__scratchVec.subtractInPlace(results[this.__llId].position);
                    this.__scratchVec.normalize();
                    
                    this.__forwardEstimate.addInPlace(this.__scratchVec);
                    this.__forwardEstimateCount += 1.0;
                }
            }

            if (results[this.__urId]) {
                if (results[this.__lrId]) {
                    this.__scratchVec.set(0.0, 0.0, 0.0);
                    this.__scratchVec.addInPlace(results[this.__urId].position);
                    this.__scratchVec.subtractInPlace(results[this.__lrId].position);
                    this.__scratchVec.normalize();
                    
                    this.__forwardEstimate.addInPlace(this.__scratchVec);
                    this.__forwardEstimateCount += 1.0;
                }
                
                if (results[this.__ulId]) {
                    this.__scratchVec.set(0.0, 0.0, 0.0);
                    this.__scratchVec.addInPlace(results[this.__urId].position);
                    this.__scratchVec.subtractInPlace(results[this.__ulId].position);
                    this.__scratchVec.normalize();
                    
                    this.__rightEstimate.addInPlace(this.__scratchVec);
                    this.__rightEstimateCount += 1.0;
                }
            }

            if (results[this.__lrId] && results[this.__ulId]) {
                this.__scratchVec.set(0.0, 0.0, 0.0);
                this.__scratchVec.addInPlace(results[this.__lrId].position);
                this.__scratchVec.addInPlace(results[this.__ulId].position);
                this.__scratchVec.scaleInPlace(0.5);
                
                this.__posEstimate.addInPlace(this.__scratchVec);
                this.__posEstimateCount += 1.0;
            }

            if (this.__posEstimateCount * this.__rightEstimateCount * this.__forwardEstimateCount > 0) {
                this.__posEstimate.scaleInPlace(1.0 / this.__posEstimateCount);
                this.__rightEstimate.scaleInPlace(1.0 / this.__rightEstimateCount);
                this.__forwardEstimate.scaleInPlace(1.0 / this.__forwardEstimateCount);

                this.__filteredPos.addSample(this.__posEstimate);
                this.__filteredRight.addSample(this.__rightEstimate);
                this.__filteredForward.addSample(this.__forwardEstimate);

                this.__targetPosition.copyFrom(this.__filteredPos);
                Quaternion.RotationQuaternionFromAxisToRef(
                    this.__filteredRight, 
                    Vector3.Cross(this.__filteredForward, this.__filteredRight), 
                    this.__filteredForward,
                    this.__targetRotation);

                trackedObject.setTracking(
                    this.__targetPosition, 
                    this.__targetRotation, 
                    true);
            }
            else {
                trackedObject.setTracking(
                    this.__targetPosition, 
                    this.__targetRotation, 
                    true);
            }
        });
    }

    setCalibrationAsync(scalar = 1) {
        return this._tracker.setCalibrationAsync(
            Math.round(scalar * this._videoTexture.getSize().width), 
            Math.round(scalar * this._videoTexture.getSize().height));
    }

    static getQuaternionFromRodrigues(x: number, y: number, z: number) {
        var rot = new Vector3(-x, y, -z);
        var theta = rot.length();
        rot.scaleInPlace(1.0 / theta);
        if (theta !== 0.0) {
            return Quaternion.RotationAxis(rot, theta);
        }
        else {
            return null;
        }
    };

    startTracking() {
        var running = false;
        this._runTrackingObserver = this._scene.onAfterRenderObservable.add(() => {
            if (!running) {
                running = true;

                this._tracker.findMarkersInImageAsync(this._videoTexture).then(markers => {
                    if (markers) {
                        var results: any = {};

                        markers.forEach(marker => {
                            results[marker.id] = {
                                position: new Vector3(marker.tx, -marker.ty, marker.tz),
                                rotation: ArUcoMetaMarkerObjectTracker.getQuaternionFromRodrigues(marker.rx, marker.ry, marker.rz)
                            }
                        });

                        this.processResults(results);
                    }

                    running = false;
                });
            }
        });
    }

    stopTracking() {
        this._scene.onAfterRenderObservable.remove(this._runTrackingObserver);
        this._runTrackingObserver = null;
    }

    static createAsync(videoTexture: VideoTexture, scene: Scene) {
        var objectTracker = new ArUcoMetaMarkerObjectTracker(videoTexture, scene);
        return ArUcoMarkerTracker.createAsync().then(tracker => {
            objectTracker._tracker = tracker;
            return objectTracker.setCalibrationAsync();
        }).then(() => {
            return objectTracker;
        });
    }
}