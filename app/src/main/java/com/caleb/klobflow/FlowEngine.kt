package com.caleb.klobflow

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.MediaStore
import android.util.Range
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.*
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.Inet4Address
import java.net.NetworkInterface
import java.security.SecureRandom
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.*

data class Frame(val time:Long,val width:Int,val height:Int,val staffs:List<Segment?>,val metrics:Metrics,val guide:Guide,val analysisFps:Double,val source:String) {
    fun json()=JSONObject().put("time",time).put("width",width).put("height",height)
        .put("staffs",JSONArray(staffs.map {it?.json() ?: JSONObject.NULL})).put("metrics",metrics.json())
        .put("guide",guide.json()).put("config",guide.config.json()).put("analysisFps",analysisFps).put("source",source)
}
data class FlowUi(val config:Config=Config(),val bitmap:Bitmap?=null,val frame:Frame?=null,
    val status:String="Ready when you are",val cameraReady:Boolean=false,val demo:Boolean=false,
    val recording:Boolean=false,val finalizing:Boolean=false,val elapsed:Long=0,val sharing:Boolean=false,val pairCode:String="",val addresses:List<String> = emptyList(),
    val sessions:List<JSONObject> = emptyList(),val error:String?=null)

class FlowEngine(val context:Context,private val owner:LifecycleOwner) : AutoCloseable {
    private val preferences=context.getSharedPreferences("practice",Context.MODE_PRIVATE)
    @Volatile var config=runCatching {Config().patch(JSONObject(preferences.getString("config","{}")!!))}.getOrDefault(Config());private set
    private val mutable=MutableStateFlow(FlowUi(config=config))
    val ui=mutable.asStateFlow()
    private val executor=Executors.newSingleThreadExecutor()
    private val demoTimer=Executors.newSingleThreadScheduledExecutor()
    private val main=Handler(Looper.getMainLooper())
    private var provider:ProcessCameraProvider?=null
    private var capture:VideoCapture<Recorder>?=null
    private var activeAnalysis:ImageAnalysis?=null
    @Volatile private var active=false
    private var recording:Recording?=null
    private var recordingStarted=0L
    private var sessionId:String?=null
    private var sessionWriter:java.io.BufferedWriter?=null
    private var sessionFrames=0;private var sessionValid=0;private var errorSum=0.0
    private val sessionsDir=File(context.filesDir,"sessions").apply {mkdirs()}
    private val detector=StaffDetector();private val tracker=StaffTracker();private val scorer=Scorer()
    private val processing=Any();private val sessionLock=Any()
    private var lastTime=0L;private var fps=0.0;private var lastJpegTime=0L
    @Volatile private var packet="{}"
    @Volatile private var demo=false
    @Volatile private var closed=false
    private var server:PhoneServer?=null
    @Volatile private var generation=0
    init {refreshSessions()}

    fun bindCamera() {
        check(Looper.myLooper()==Looper.getMainLooper())
        demo=false;active=true;generation++;val currentGeneration=generation
        mutable.update {it.copy(demo=false,cameraReady=false,error=null,status="Opening ${config.facing} camera…")}
        val future=ProcessCameraProvider.getInstance(context)
        future.addListener({
            if(closed || demo || currentGeneration!=generation)return@addListener
            try {
                val p=future.get();provider=p;p.unbindAll()
                val selector=if(config.facing=="front")CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
                require(p.hasCamera(selector)){"This device has no ${config.facing} camera. Switch cameras or try the demo."}
                val rotation=context.getSystemService(android.view.WindowManager::class.java).defaultDisplay.rotation
                val analysis=ImageAnalysis.Builder().setTargetRotation(rotation).setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setResolutionSelector(ResolutionSelector.Builder().setResolutionStrategy(ResolutionStrategy(Size(640,480),ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)).build()).build()
                activeAnalysis=analysis
                val mirrored=config.facing=="front"
                analysis.setAnalyzer(executor){ image ->
                    try {
                        if(!demo && !closed && active && currentGeneration==generation) analyzeImage(image,mirrored,currentGeneration)
                    } catch(e:Exception){mutable.update {it.copy(error="Frame analysis failed: ${e.message}")}}
                    finally {image.close()}
                }
                var bound=false;var last:Exception?=null
                for((quality,target) in listOf(Quality.FHD to config.fps,Quality.HD to config.fps,Quality.HD to 30,Quality.SD to 30).distinct()) {
                    try {
                        val recorder=Recorder.Builder().setQualitySelector(QualitySelector.from(quality,FallbackStrategy.lowerQualityOrHigherThan(Quality.SD))).build()
                        val video=VideoCapture.Builder(recorder).setTargetRotation(rotation).setTargetFrameRate(Range(target,target)).build()
                        p.bindToLifecycle(owner,selector,analysis,video);capture=video;bound=true
                        val desc=when(quality){Quality.FHD->"1080p";Quality.HD->"720p";else->"480p"}
                        mutable.update {it.copy(cameraReady=true,status="$desc · $target fps target · ${if(mirrored)"mirrored selfie" else "rear camera"}")}
                        break
                    } catch(e:Exception){last=e;p.unbindAll()}
                }
                if(!bound)throw last ?: IllegalStateException("Camera setup unavailable")
                resetTracking()
            } catch(e:Exception){mutable.update {it.copy(error=e.message ?: "Could not open camera",status="Camera unavailable",cameraReady=false)}}
        },ContextCompat.getMainExecutor(context))
    }
    private fun analyzeImage(image:ImageProxy,mirror:Boolean,streamGeneration:Int) {
        val now=SystemClock.elapsedRealtime()
        // Keep CPU/display work bounded independently of the video encoder's requested 60 fps.
        if(now-lastTime<30)return
        val original=image.toBitmap()
        val matrix=Matrix().apply {postRotate(image.imageInfo.rotationDegrees.toFloat());if(mirror)postScale(-1f,1f)}
        val oriented=Bitmap.createBitmap(original,0,0,original.width,original.height,matrix,true)
        if(oriented!==original)original.recycle()
        process(oriented,now,"camera",streamGeneration)
    }
    private fun process(bitmap:Bitmap,now:Long,source:String,streamGeneration:Int=generation) {
        if(closed || !active || streamGeneration!=generation)return
        synchronized(processing) {
            val c=config
            val scale=384.0/max(bitmap.width,bitmap.height)
            val small=Bitmap.createScaledBitmap(bitmap,max(2,(bitmap.width*scale).toInt()),max(2,(bitmap.height*scale).toInt()),true)
            val pixels=IntArray(small.width*small.height);small.getPixels(pixels,0,small.width,0,0,small.width,small.height)
            val detected=detector.detect(pixels,small.width,small.height,c)
            if(small!==bitmap)small.recycle()
            val staffs=tracker.update(detected,now)
            val guide=Guide(c,bitmap.width,bitmap.height)
            if(lastTime>0 && now>lastTime)fps=if(fps==0.0)1000.0/(now-lastTime) else fps*0.85+1000.0/(now-lastTime)*0.15
            lastTime=now
            val frame=Frame(now,bitmap.width,bitmap.height,staffs,scorer.score(now,staffs,guide),guide,fps,source)
            if(!active || streamGeneration!=generation)return
            val elapsed=if(recordingStarted>0)now-recordingStarted else 0L
            mutable.update {it.copy(bitmap=bitmap,frame=frame,elapsed=elapsed)}
            synchronized(sessionLock){
                sessionWriter?.let {writer->
                    val row=frame.json().put("elapsedMs",elapsed)
                    try {writer.write(row.toString());writer.newLine();sessionFrames++;if(frame.metrics.deviation!=null){sessionValid++;errorSum+=frame.metrics.deviation}}
                    catch(e:Exception){main.post {mutable.update {it.copy(error="Telemetry could not be saved: ${e.message}")};stopRecording()}}
                }
            }
            if(ui.value.sharing && now-lastJpegTime>=100) {
                val bytes=ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.JPEG,65,bytes)
                packet=frame.json().put("image",android.util.Base64.encodeToString(bytes.toByteArray(),android.util.Base64.NO_WRAP)).toString()
                lastJpegTime=now
            }
        }
    }
    fun startDemo() {
        if(ui.value.recording || ui.value.finalizing)return
        generation++;provider?.unbindAll();demo=true;active=true
        mutable.update {it.copy(demo=true,cameraReady=false,error=null,status="DEMO · synthetic LED staves through the real tracker")}
        resetTracking()
        if(demoScheduled)return
        demoScheduled=true
        demoTimer.scheduleWithFixedDelay({
            if(!demo || closed)return@scheduleWithFixedDelay
            val bitmap=Bitmap.createBitmap(640,480,Bitmap.Config.ARGB_8888)
            val canvas=Canvas(bitmap);canvas.drawColor(Color.rgb(15,20,18))
            val t=SystemClock.elapsedRealtime()/1500.0
            val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply {strokeWidth=7f;strokeCap=Paint.Cap.ROUND}
            listOf(0,1).forEach {i->
                val angle=if(i==0)t else PI-t;val cx=if(i==0)225.0 else 415.0;val cy=240.0
                paint.color=if(i==0)Color.rgb(182,243,107)else Color.rgb(181,163,255)
                canvas.drawLine((cx-cos(angle)*105).toFloat(),(cy-sin(angle)*105).toFloat(),(cx+cos(angle)*105).toFloat(),(cy+sin(angle)*105).toFloat(),paint)
            }
            process(bitmap,SystemClock.elapsedRealtime(),"demo")
        },0,33,TimeUnit.MILLISECONDS)
    }
    private var demoScheduled=false
    fun updateConfig(patch:JSONObject) {
        val next=config.patch(patch)
        val cameraChange=next.facing!=config.facing || next.fps!=config.fps
        require(!(cameraChange && (ui.value.recording || ui.value.finalizing))){"Stop recording before changing camera or frame rate."}
        synchronized(processing){config=next;scorer.reset()}
        preferences.edit().putString("config",next.json().toString()).apply()
        mutable.update {it.copy(config=next)}
        if(cameraChange && !demo)bindCamera()
    }
    fun resetTracking(){synchronized(processing){tracker.reset();scorer.reset();lastTime=0;fps=0.0}}
    fun seed(points:List<P>) {
        require(points.size==4 && points.all {it.x.isFinite() && it.y.isFinite() && it.x in 0.0..1.0 && it.y in 0.0..1.0}){"Tap four valid staff endpoints."}
        val f=ui.value.frame ?: error("Wait for camera frames")
        val g=f.guide
        val p=points.map {P(it.x*g.aspectX,it.y*g.aspectY)}
        val segments=listOf(Segment(p[0],p[1]),Segment(p[2],p[3]))
        require(segments.all {it.length>=0.08}){"Staff endpoints are too close together."}
        synchronized(processing){tracker.seed(segments,SystemClock.elapsedRealtime());scorer.reset()}
    }
    fun startRecording() {
        require(!demo && ui.value.cameraReady){"Open the camera to record a real practice session."}
        require(recording==null && !ui.value.finalizing){"Recording is already active or saving."}
        val video=capture ?: error("Camera is not ready")
        val id="klobflow-${System.currentTimeMillis()}"
        val values=ContentValues().apply {put(MediaStore.Video.Media.DISPLAY_NAME,"$id.mp4");put(MediaStore.Video.Media.MIME_TYPE,"video/mp4");put(MediaStore.Video.Media.RELATIVE_PATH,"Movies/Klobflow")}
        val output=MediaStoreOutputOptions.Builder(context.contentResolver,MediaStore.Video.Media.EXTERNAL_CONTENT_URI).setContentValues(values).build()
        sessionId=id;sessionFrames=0;sessionValid=0;errorSum=0.0
        mutable.update {it.copy(recording=true,elapsed=0,error=null)}
        try {
            recording=video.output.prepareRecording(context,output).start(ContextCompat.getMainExecutor(context)){event->
                when(event){
                    is VideoRecordEvent.Start->{
                        recordingStarted=SystemClock.elapsedRealtime()
                        synchronized(sessionLock){
                            try {sessionWriter=File(sessionsDir,"$id.jsonl").bufferedWriter().apply {write(JSONObject().put("type","header").put("schema",1).put("id",id).put("config",config.json()).put("note","Projected 2D measurements. Relative timing starts at the recording-start callback; video sync is approximate.").toString());newLine()}}
                            catch(e:Exception){mutable.update {it.copy(error="Cannot save analysis: ${e.message}")};stopRecording()}
                        }
                    }
                    is VideoRecordEvent.Finalize->{
                        synchronized(sessionLock){
                            runCatching {sessionWriter?.close()};sessionWriter=null
                            val duration=event.recordingStats.recordedDurationNanos/1_000_000
                            val metadata=JSONObject().put("id",id).put("createdAt",id.substringAfterLast('-').toLong()).put("durationMs",duration)
                                .put("videoUri",event.outputResults.outputUri.toString()).put("frames",sessionFrames).put("validFrames",sessionValid)
                                .put("meanDeviation",if(sessionValid>0)errorSum/sessionValid else JSONObject.NULL).put("recordingError",if(event.hasError())event.error else JSONObject.NULL)
                                .put("config",config.json())
                            runCatching {File(sessionsDir,"$id.json").writeText(metadata.toString())}.onFailure {e->mutable.update {it.copy(error="Could not save session summary: ${e.message}")}}
                        }
                        recording=null;recordingStarted=0;sessionId=null
                        mutable.update {it.copy(recording=false,finalizing=false,elapsed=0,error=if(event.hasError())"Recording ended with camera error ${event.error}; check saved video." else it.error)}
                        refreshSessions()
                    }
                }
            }
        }catch(e:Exception){recording=null;sessionId=null;mutable.update {it.copy(recording=false,error=e.message)};throw e}
    }
    fun stopRecording(){recording?.let {mutable.update {s->s.copy(recording=false,finalizing=true)};it.stop()}}
    fun share(enabled:Boolean) {
        if(!enabled){server?.stop();server=null;packet="{}";mutable.update {it.copy(sharing=false,pairCode="",addresses=emptyList())};return}
        if(server!=null)return
        val random=ByteArray(8).also {SecureRandom().nextBytes(it)}
        val token=random.joinToString(""){"%02x".format(it)}
        val instance=PhoneServer(this,token)
        try {instance.start(5000,false);server=instance;mutable.update {it.copy(sharing=true,pairCode=token,addresses=lanAddresses(),error=null)}}
        catch(e:Exception){instance.stop();throw IllegalStateException("Could not start local sharing: ${e.message}")}
    }
    private fun lanAddresses():List<String> = runCatching {NetworkInterface.getNetworkInterfaces().toList().flatMap {it.inetAddresses.toList()}.filterIsInstance<Inet4Address>().filter {!it.isLoopbackAddress && !it.isLinkLocalAddress}.map {"${it.hostAddress}:8787"}}.getOrDefault(emptyList())
    fun liveJson():JSONObject = JSONObject(packet).put("status",ui.value.status).put("recording",ui.value.recording).put("finalizing",ui.value.finalizing).put("elapsedMs",ui.value.elapsed)
        .put("currentConfig",config.json()).put("error",ui.value.error ?: JSONObject.NULL).put("version",BuildConfig.VERSION_NAME).put("cameraReady",ui.value.cameraReady)
    fun sessionsJson()=JSONArray(ui.value.sessions)
    fun sessionFile(id:String):File {require(id.matches(Regex("klobflow-[0-9]{13}"))){"Invalid session"};return File(sessionsDir,"$id.jsonl").also {require(it.isFile){"Session unavailable"}}}
    private fun refreshSessions(){mutable.update {it.copy(sessions=sessionsDir.listFiles().orEmpty().filter {f->f.extension=="json"}.sortedByDescending {f->f.name}.take(100).mapNotNull {f->runCatching {JSONObject(f.readText())}.getOrNull()})}}
    fun command(j:JSONObject) {
        when(j.optString("action")) {
            "config"->updateConfig(j.getJSONObject("config"))
            "reset"->resetTracking()
            "record"->startRecording()
            "stop"->stopRecording()
            "seed"->{val a=j.getJSONArray("points");seed((0 until a.length()).map {val p=a.getJSONArray(it);P(p.getDouble(0),p.getDouble(1))})}
            else->throw IllegalArgumentException("Unknown action")
        }
    }
    fun rotationChanged(rotation:Int){activeAnalysis?.targetRotation=rotation;capture?.targetRotation=rotation;resetTracking()}
    fun background(){active=false;stopRecording();share(false);demo=false;generation++;provider?.unbindAll();mutable.update {it.copy(cameraReady=false,frame=null,bitmap=null,status="Camera paused")}}
    override fun close(){closed=true;generation++;stopRecording();share(false);provider?.unbindAll();executor.shutdown();demoTimer.shutdown()}
}
