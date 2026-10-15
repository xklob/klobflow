package com.caleb.klobflow.motion

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.hardware.display.DisplayManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Size
import android.view.Surface
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.Executors

data class CaptureState(
    val ready:Boolean=false, val sharing:Boolean=false, val front:Boolean=false,
    val zoom:Float=1f, val zoomMin:Float=1f, val zoomMax:Float=1f,
    val fps:Double=0.0, val requestedFps:Int=60, val addresses:List<String> = emptyList(),
    val message:String="Allow camera access to begin", val error:String?=null,
    val lensCorrection:String="Camera correction unknown"
)

/** Fresh camera source. No grid, scoring, colour thresholds, or tracking engine. */
@androidx.annotation.OptIn(ExperimentalCamera2Interop::class)
class CameraHost(private val context:Context) {
    private val preferences=context.getSharedPreferences("motion-camera",Context.MODE_PRIVATE)
    private var wantedZoom=preferences.getFloat("zoom",1f)
    private val mutable=MutableStateFlow(CaptureState(front=preferences.getBoolean("front",false),zoom=wantedZoom))
    val state=mutable.asStateFlow()
    private val executor=Executors.newSingleThreadExecutor()
    private val main=ContextCompat.getMainExecutor(context)
    private val providerFuture=ProcessCameraProvider.getInstance(context)
    private var provider:ProcessCameraProvider?=null
    private var camera:Camera?=null
    private var analysisUseCase:ImageAnalysis?=null
    private var previewUseCase:Preview?=null
    private var preview:PreviewView?=null
    private var owner:LifecycleOwner?=null
    @Volatile private var active=false
    @Volatile private var revision=0L
    private var wantSharing=preferences.getBoolean("sharing",false)
    private var server:CameraServer?=null
    private val frames=FrameStream()
    @Volatile private var physicalCamera="unknown"
    @Volatile private var focalLength=0f
    @Volatile private var correctionMode:Int?=null
    private var count=0
    private var cadenceStart=0L
    @Volatile private var displayRotation=Surface.ROTATION_0
    private val displays=context.getSystemService(DisplayManager::class.java)
    private var watchingDisplay=false
    private val displayListener=object:DisplayManager.DisplayListener {
        override fun onDisplayAdded(id:Int){}
        override fun onDisplayRemoved(id:Int){}
        override fun onDisplayChanged(id:Int){
            val display=preview?.display?:return
            if(display.displayId!=id)return
            displayRotation=display.rotation
            analysisUseCase?.targetRotation=displayRotation
            previewUseCase?.targetRotation=displayRotation
        }
    }

    fun attach(view:PreviewView,lifecycleOwner:LifecycleOwner) {
        if(preview===view && owner===lifecycleOwner)return
        preview=view;owner=lifecycleOwner
        providerFuture.addListener({
            try{provider=providerFuture.get();if(active)bind()}
            catch(error:Exception){mutable.update{it.copy(ready=false,error=error.message,message="Camera unavailable")}}
        },main)
    }
    fun resume(){
        active=true
        if(!watchingDisplay){displays.registerDisplayListener(displayListener,Handler(Looper.getMainLooper()));watchingDisplay=true}
        bind()
    }
    fun pause(){
        active=false;revision++
        if(watchingDisplay){displays.unregisterDisplayListener(displayListener);watchingDisplay=false}
        owner?.let{camera?.cameraInfo?.zoomState?.removeObservers(it)}
        provider?.unbindAll();camera=null;analysisUseCase=null;previewUseCase=null;stopSharing()
        mutable.update{it.copy(ready=false,message="Camera paused")}
    }
    fun close(){pause();executor.shutdownNow()}
    fun switchCamera(){
        wantedZoom=1f
        mutable.update{it.copy(front=!it.front,zoom=1f)}
        preferences.edit().putBoolean("front",state.value.front).putFloat("zoom",wantedZoom).apply()
        bind()
    }
    fun retry(){bind()}
    fun zoom(value:Float){
        val c=camera?:return
        val z=c.cameraInfo.zoomState.value?:return
        wantedZoom=value.coerceIn(z.minZoomRatio,z.maxZoomRatio)
        preferences.edit().putFloat("zoom",wantedZoom).apply()
        c.cameraControl.setZoomRatio(wantedZoom)
    }
    fun sharing(enabled:Boolean){
        wantSharing=enabled
        preferences.edit().putBoolean("sharing",enabled).apply()
        if(enabled && active && state.value.ready)startSharing() else stopSharing()
    }
    private fun bind(){
        if(!active)return
        if(ContextCompat.checkSelfPermission(context,Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED){
            mutable.update{it.copy(ready=false,message="Allow camera access to begin")};return
        }
        val p=provider?:return
        val view=preview?:return
        val lifecycle=owner?:return
        revision++;val current=revision
        camera?.cameraInfo?.zoomState?.removeObservers(lifecycle)
        stopSharing();p.unbindAll();camera=null;count=0;cadenceStart=0
        mutable.update{it.copy(ready=false,fps=0.0,error=null,message="Opening camera")}
        val front=state.value.front
        val selector=if(front)CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
        try {
            val info=p.availableCameraInfos.firstOrNull{selector.filter(listOf(it)).isNotEmpty()}?:error("This camera is unavailable")
            val camera2=Camera2CameraInfo.from(info)
            val ranges=camera2.getCameraCharacteristic(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES).orEmpty()
            val rate=ranges.filter{it.upper>=60 && it.lower<=60}.minByOrNull{it.upper-it.lower}
                ?:ranges.maxWithOrNull(compareBy<android.util.Range<Int>>{it.upper}.thenBy{it.lower})
            val supported=camera2.getCameraCharacteristic(CameraCharacteristics.DISTORTION_CORRECTION_AVAILABLE_MODES)?:intArrayOf()
            val correction=when {
                supported.contains(CaptureRequest.DISTORTION_CORRECTION_MODE_FAST)->CaptureRequest.DISTORTION_CORRECTION_MODE_FAST
                supported.contains(CaptureRequest.DISTORTION_CORRECTION_MODE_HIGH_QUALITY)->CaptureRequest.DISTORTION_CORRECTION_MODE_HIGH_QUALITY
                else->null
            }
            physicalCamera=camera2.cameraId;focalLength=0f;correctionMode=null
            displayRotation=view.display?.rotation?:Surface.ROTATION_0
            val resolution=ResolutionSelector.Builder().setResolutionStrategy(ResolutionStrategy(Size(1280,720),ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)).build()
            val analysisBuilder=ImageAnalysis.Builder().setTargetRotation(displayRotation).setResolutionSelector(resolution).setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            val interop=Camera2Interop.Extender(analysisBuilder)
            if(rate!=null)interop.setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE,rate)
            if(correction!=null)interop.setCaptureRequestOption(CaptureRequest.DISTORTION_CORRECTION_MODE,correction)
            interop.setSessionCaptureCallback(object:CameraCaptureSession.CaptureCallback(){
                override fun onCaptureCompleted(session:CameraCaptureSession,request:CaptureRequest,result:TotalCaptureResult){
                    if(current!=revision)return
                    physicalCamera=result[CaptureResult.LOGICAL_MULTI_CAMERA_ACTIVE_PHYSICAL_ID]?:camera2.cameraId
                    focalLength=result[CaptureResult.LENS_FOCAL_LENGTH]?:0f
                    correctionMode=result[CaptureResult.DISTORTION_CORRECTION_MODE]
                }
            })
            val analysis=analysisBuilder.build().apply{setAnalyzer(executor){image->try{process(image,current)}catch(error:Exception){mutable.update{it.copy(error=error.message)}}finally{image.close()}}}
            val nativePreview=Preview.Builder().setTargetRotation(displayRotation).build().also{it.surfaceProvider=view.surfaceProvider}
            analysisUseCase=analysis;previewUseCase=nativePreview
            // PreviewView mirrors front cameras itself; mirror the rear preview too.
            view.scaleX=if(front)1f else -1f
            camera=p.bindToLifecycle(lifecycle,selector,nativePreview,analysis)
            camera!!.cameraInfo.zoomState.observe(lifecycle){z->mutable.update{it.copy(zoom=z.zoomRatio,zoomMin=z.minZoomRatio,zoomMax=z.maxZoomRatio)}}
            val zoomRange=camera!!.cameraInfo.zoomState.value
            if(zoomRange!=null)camera!!.cameraControl.setZoomRatio(wantedZoom.coerceIn(zoomRange.minZoomRatio,zoomRange.maxZoomRatio))
            mutable.update{it.copy(ready=true,error=null,requestedFps=rate?.upper?:30,message="Camera ready · mirrored preview",lensCorrection=if(correction==null)"No camera lens-correction mode reported" else "Camera lens correction requested")}
            if(wantSharing)startSharing()
        }catch(error:Exception){mutable.update{it.copy(ready=false,error=error.message,message="Camera unavailable")}}
    }
    private fun process(image:ImageProxy,current:Long){
        if(!active || current!=revision)return
        val now=SystemClock.elapsedRealtime();if(cadenceStart==0L)cadenceStart=now
        count++
        if(now-cadenceStart>=500){val fps=count*1000.0/(now-cadenceStart);count=0;cadenceStart=now;mutable.update{it.copy(fps=fps)}}
        if(!state.value.sharing)return
        val original=image.toBitmap()
        val oriented=Bitmap.createBitmap(original,0,0,original.width,original.height,Matrix().apply{postRotate(image.imageInfo.rotationDegrees.toFloat())},true)
        if(oriented!==original)original.recycle()
        val scale=minOf(1f,960f/maxOf(oriented.width,oriented.height))
        val output=if(scale<1f)Bitmap.createScaledBitmap(oriented,(oriented.width*scale).toInt(),(oriented.height*scale).toInt(),true) else oriented
        if(output!==oriented)oriented.recycle()
        try {
            val bytes=ByteArrayOutputStream();output.compress(Bitmap.CompressFormat.JPEG,82,bytes)
            if(!active || current!=revision || !state.value.sharing)return
            frames.publish(liveJson().put("time",now).put("width",output.width).put("height",output.height).toString(),bytes.toByteArray())
        }finally{output.recycle()}
    }
    fun liveJson():JSONObject {
        val current=state.value
        return JSONObject().put("protocol",2).put("version",BuildConfig.VERSION_NAME).put("source","camera")
            .put("cameraReady",current.ready).put("mirrored",false).put("fps",current.fps)
            .put("currentConfig",JSONObject().put("mirror",false).put("facing",if(current.front)"front" else "back"))
            .put("zoom",JSONObject().put("ratio",current.zoom).put("min",current.zoomMin).put("max",current.zoomMax))
            .put("camera",JSONObject().put("physicalId",physicalCamera).put("focalLengthMm",focalLength)
                .put("rotation",displayRotation)
                .put("distortionCorrectionMode",correctionMode?:JSONObject.NULL))
    }
    private fun startSharing(){
        if(server!=null)return
        val candidate=CameraServer(this,frames);frames.start()
        try{candidate.start(5000,false);server=candidate;mutable.update{it.copy(sharing=true,addresses=addresses(),error=null)}}
        catch(error:Exception){frames.stop();candidate.stop();mutable.update{it.copy(sharing=false,error="Could not share the camera: ${error.message}")}}
    }
    private fun stopSharing(){frames.stop();server?.stop();server=null;mutable.update{it.copy(sharing=false,addresses=emptyList())}}
    private fun addresses():List<String> = runCatching{NetworkInterface.getNetworkInterfaces().toList().flatMap{it.inetAddresses.toList()}.filterIsInstance<Inet4Address>().filter{!it.isLoopbackAddress&&!it.isLinkLocalAddress}.map{"${it.hostAddress}:8787"}}.getOrDefault(emptyList())
}
