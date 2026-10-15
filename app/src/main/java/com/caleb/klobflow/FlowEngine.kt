package com.caleb.klobflow

import android.Manifest
import android.content.pm.PackageManager
import androidx.camera.core.Camera
import androidx.camera.core.MirrorMode
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
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.*

data class Frame(val time:Long,val width:Int,val height:Int,val staffs:List<Segment?>,val metrics:Metrics,val guide:Guide,val analysisFps:Double,val source:String,val beat:BeatFrame=BeatFrame(),val fitStatus:String="",val audio:AudioTempo=AudioTempo(),val streak:StreakFrame=StreakFrame(),val averagedMetrics:Metrics=metrics,val background:BackgroundStatus=BackgroundStatus(),val pacer:PacerFrame=PacerFrame()) {
    fun json()=JSONObject().put("time",time).put("width",width).put("height",height)
        .put("staffs",JSONArray(staffs.map {it?.json() ?: JSONObject.NULL})).put("metrics",metrics.json())
        .put("feedback",JSONArray((if(pacer.enabled)pacer.feedback else guide.cues(staffs)).map {it.json()})).put("guide",guide.json()).put("config",guide.config.json()).put("analysisFps",analysisFps).put("source",source).put("beat",beat.json()).put("fitStatus",fitStatus).put("audio",audio.json()).put("streak",streak.json()).put("averagedMetrics",averagedMetrics.json()).put("background",background.json()).put("pacer",pacer.json())
}
data class FlowUi(val config:Config=Config(),val bitmap:Bitmap?=null,val frame:Frame?=null,
    val status:String="Ready when you are",val cameraReady:Boolean=false,val demo:Boolean=false,
    val recording:Boolean=false,val finalizing:Boolean=false,val elapsed:Long=0,val sharing:Boolean=false,val addresses:List<String> = emptyList(),
    val zoomMin:Float=1f,val zoomMax:Float=1f,val zoomRatio:Float=1f,
    val sessions:List<JSONObject> = emptyList(),val error:String?=null)

class FlowEngine(val context:Context,private val owner:LifecycleOwner) : AutoCloseable {
    private val preferences=context.getSharedPreferences("practice",Context.MODE_PRIVATE)
    @Volatile var config=runCatching {Config().patch(JSONObject(preferences.getString("config","{}")!!),restore=true)}.getOrDefault(Config());private set
    private val mutable=MutableStateFlow(FlowUi(config=config))
    val ui=mutable.asStateFlow()
    private val executor=Executors.newSingleThreadExecutor()
    private val demoTimer=Executors.newSingleThreadScheduledExecutor()
    private val main=Handler(Looper.getMainLooper())
    private var provider:ProcessCameraProvider?=null
    private var capture:VideoCapture<Recorder>?=null
    private var camera:Camera?=null
    val stream=FrameStream()
    private var activeAnalysis:ImageAnalysis?=null
    @Volatile private var active=false
    private var recording:Recording?=null
    private var recordingStarted=0L
    private var sessionId:String?=null
    private var sessionWriter:java.io.BufferedWriter?=null
    private var sessionFrames=0;private var sessionValid=0;private var errorSum=0.0
    private val sessionsDir=File(context.filesDir,"sessions").apply {mkdirs()}
    private val backgroundFilter=BackgroundFilter();private val detector=StaffDetector();private val tracker=StaffTracker();private val scorer=Scorer()
    @Volatile private var pcAudio=AudioTempo()
    private var fitRevision=0
    private val rollingErrors=RollingErrors();private val streakCoach=FlowStreak();private val timingCoach=TimingCoach();private val pacerCoach=MovingPacer();private val fit=FitHelper()
    private val processing=Any();private val sessionLock=Any()
    private var lastTime=0L;private var fps=0.0
    private var pacerCommandTime=Long.MIN_VALUE
    @Volatile private var packet="{}"
    @Volatile private var demo=false
    @Volatile private var closed=false
    private var server:PhoneServer?=null
    @Volatile private var generation=0
    init {refreshSessions()}

    fun foreground() {
        rotationChanged(context.getSystemService(android.view.WindowManager::class.java).defaultDisplay.rotation)
        if(ui.value.demo)startDemo()
        else if(ContextCompat.checkSelfPermission(context,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)bindCamera()
        if(preferences.getBoolean("sharingEnabled",false))runCatching {startSharing()}.onFailure {e->mutable.update {it.copy(error=e.message)}}
    }
    fun bindCamera() {
        check(Looper.myLooper()==Looper.getMainLooper())
        if(closed)return
        camera?.cameraInfo?.zoomState?.removeObservers(owner)
        synchronized(processing){fitRevision++;fit.cancel();backgroundFilter.clear();pacerCoach.reset();streakCoach.reset()}
        demo=false;active=true;generation++;val currentGeneration=generation
        mutable.update {it.copy(config=config,demo=false,cameraReady=false,frame=null,bitmap=null,error=null,status="Opening ${config.facing} camera…")}
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
                val mirrored=config.mirror
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
                        val video=VideoCapture.Builder(recorder).setMirrorMode(if(mirrored)MirrorMode.MIRROR_MODE_ON else MirrorMode.MIRROR_MODE_OFF).setTargetRotation(rotation).setTargetFrameRate(Range(target,target)).build()
                        camera=p.bindToLifecycle(owner,selector,analysis,video);capture=video;bound=true
                        camera!!.cameraInfo.zoomState.observe(owner){z->mutable.update {it.copy(zoomMin=z.minZoomRatio,zoomMax=z.maxZoomRatio,zoomRatio=z.zoomRatio)}}
                        applyZoom()
                        val desc=when(quality){Quality.FHD->"1080p";Quality.HD->"720p";else->"480p"}
                        mutable.update {it.copy(cameraReady=true,status="$desc · $target fps target · ${if(mirrored)"mirrored ${config.facing} camera" else "${config.facing} camera"}")}
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
        // KEEP_ONLY_LATEST bounds work without discarding every other 60 fps frame.
        val original=image.toBitmap()
        val matrix=Matrix().apply {postRotate(image.imageInfo.rotationDegrees.toFloat());if(mirror)postScale(-1f,1f)}
        val oriented=Bitmap.createBitmap(original,0,0,original.width,original.height,matrix,true)
        if(oriented!==original)original.recycle()
        process(oriented,now,"camera",streamGeneration)
    }
    private fun process(bitmap:Bitmap,now:Long,source:String,streamGeneration:Int=generation) {
        if(closed || !active || streamGeneration!=generation)return
        synchronized(processing) {
            // A source may have changed while this frame waited for a reset/configuration lock.
            if(closed || !active || streamGeneration!=generation)return
            // A converted camera frame can wait behind a newer transport command.
            // Drop that old observation instead of rewinding the exercise clock.
            if(now<pacerCommandTime)return
            val c=config
            val scale=384.0/max(bitmap.width,bitmap.height)
            val small=Bitmap.createScaledBitmap(bitmap,max(2,(bitmap.width*scale).toInt()),max(2,(bitmap.height*scale).toInt()),true)
            val pixels=IntArray(small.width*small.height);small.getPixels(pixels,0,small.width,0,0,small.width,small.height)
            val foreground=backgroundFilter.apply(pixels,small.width,small.height,now,"$source:${c.facing}:${c.mirror}:${c.zoom}")
            val detected=detector.detect(foreground,small.width,small.height,c,tracker.hints(now,c.staffCount))
            if(small!==bitmap)small.recycle()
            val staffs=tracker.update(detected,now,c.staffCount)
            val guide=Guide(c,bitmap.width,bitmap.height)
            if(lastTime>0 && now>lastTime)fps=if(fps==0.0)1000.0/(now-lastTime) else fps*0.85+1000.0/(now-lastTime)*0.15
            lastTime=now
            val fitVersion=fitRevision
            val fitPatch=fit.update(now,staffs,guide,ui.value.zoomMin.toDouble(),ui.value.zoomMax.toDouble(),ui.value.zoomRatio.toDouble())
            if(fitPatch!=null)main.post {if(active && streamGeneration==generation && fitVersion==fitRevision)updateConfig(fitPatch,fromFit=true)}
            val audio=if(c.tempoSource=="phone")PhoneAudio.state.value else if(c.tempoSource=="pc")pcAudio else AudioTempo(status="Manual tempo")
            val ready=c.tempoSource=="manual" || audio.usable(now.toDouble())
            val beat=timingCoach.update(now,staffs,guide,if(c.tempoSource=="manual")c.bpm else (audio.bpm ?: c.bpm)*c.audioRate,if(c.tempoSource=="manual")null else audio.origin+c.audioOffsetMs,ready)
            val metrics=scorer.score(now,staffs,guide)
            val pacer=pacerCoach.update(now,staffs,guide)
            val frame=Frame(now,bitmap.width,bitmap.height,staffs,metrics,guide,fps,source,beat,fit.status,audio,streakCoach.update(now,staffs,guide,pacer),rollingErrors.update(now,metrics,c),backgroundFilter.status,pacer)
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
            if(ui.value.sharing) {
                val bytes=ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.JPEG,65,bytes)
                if(!active || streamGeneration!=generation || !ui.value.sharing)return
                packet=frame.json().toString()
                stream.publish(liveJson().toString(),bytes.toByteArray())
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
            val demoGeneration=generation
            val bitmap=Bitmap.createBitmap(640,480,Bitmap.Config.ARGB_8888)
            val canvas=Canvas(bitmap);canvas.drawColor(Color.rgb(15,20,18))
            val t=SystemClock.elapsedRealtime()/1500.0
            val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply {strokeWidth=7f;strokeCap=Paint.Cap.ROUND}
            (0 until config.staffCount).forEach {i->
                val angle=if(i==0)t else PI-t;val cx=if(config.staffCount==1)320.0 else if(i==0)225.0 else 415.0;val cy=240.0
                paint.color=if(i==0)Color.rgb(182,243,107)else Color.rgb(181,163,255)
                if(config.mode=="antispin"){
                    val guide=Guide(config,640,480);val phase=t*(if(i==1 && config.pacerPattern=="opposite")-1 else 1)+Math.toRadians(if(i==1)config.pacerOffset else 0.0)
                    val a=guide.project(guide.antispinPoint(cos(phase),0.0,i));val b=guide.project(guide.antispinPoint(0.0,sin(phase),i))
                    canvas.drawLine((a.x*480).toFloat(),(a.y*480).toFloat(),(b.x*480).toFloat(),(b.y*480).toFloat(),paint)
                }else canvas.drawLine((cx-cos(angle)*105).toFloat(),(cy-sin(angle)*105).toFloat(),(cx+cos(angle)*105).toFloat(),(cy+sin(angle)*105).toFloat(),paint)
            }
            process(bitmap,SystemClock.elapsedRealtime(),"demo",demoGeneration)
        },0,33,TimeUnit.MILLISECONDS)
    }
    private var demoScheduled=false
    fun updateConfig(patch:JSONObject,fromFit:Boolean=false) {
        val next=config.patch(patch)
        val cameraChange=next.facing!=config.facing || next.fps!=config.fps || next.mirror!=config.mirror
        val zoomChange=next.zoom!=config.zoom
        require(!(cameraChange && (ui.value.recording || ui.value.finalizing))){"Stop recording before changing camera or frame rate."}
        if(next.tempoSource!="phone" || !next.tempoEnabled)context.stopService(android.content.Intent(context,PlaybackTempoService::class.java))
        if(next.tempoSource!="pc")pcAudio=AudioTempo()
        synchronized(processing){
            if(!fromFit){fitRevision++;fit.cancel()}
            if(next.staffCount!=config.staffCount || next.staffColors!=config.staffColors || next.led!=config.led || zoomChange)tracker.reset()
            if(cameraChange || zoomChange)backgroundFilter.clear()
            timingCoach.reconfigure(config,next);pacerCoach.reconfigure(config,next);config=next;scorer.reset()
        }
        preferences.edit().putString("config",next.json().toString()).apply()
        mutable.update {it.copy(config=next)}
        if(cameraChange && !demo && active)bindCamera()
        else if(zoomChange && !demo && active)applyZoom()
    }
    fun resetTracking(){synchronized(processing){tracker.reset();scorer.reset();timingCoach.reset();pacerCoach.reset();pacerCommandTime=Long.MIN_VALUE;streakCoach.reset();rollingErrors.reset();lastTime=0;fps=0.0}}
    fun seed(points:List<P>) {
        require(points.size==config.staffCount*2 && points.all {it.x.isFinite() && it.y.isFinite() && it.x in 0.0..1.0 && it.y in 0.0..1.0}){"Tap both endpoints of each selected staff."}
        val f=ui.value.frame ?: error("Wait for camera frames")
        val g=f.guide
        val p=points.map {P(it.x*g.aspectX,it.y*g.aspectY)}
        val segments=(0 until config.staffCount).map {Segment(p[it*2],p[it*2+1])}
        require(segments.all {it.length>=0.08}){"Staff endpoints are too close together."}
        synchronized(processing){tracker.seed(segments,SystemClock.elapsedRealtime());scorer.reset();pacerCoach.reset();streakCoach.reset();rollingErrors.reset()}
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
    private fun applyZoom() {
        val c=camera ?: return
        val zoomGeneration=generation
        val z=c.cameraInfo.zoomState.value ?: return
        val ratio=if(config.zoom==0.0)z.minZoomRatio else config.zoom.toFloat().coerceIn(z.minZoomRatio,z.maxZoomRatio)
        val request=c.cameraControl.setZoomRatio(ratio)
        request.addListener({runCatching {request.get()}.onFailure {e->if(active && !demo && generation==zoomGeneration && camera===c)mutable.update {it.copy(error="Could not change zoom: ${e.cause?.message ?: e.message}")}}},ContextCompat.getMainExecutor(context))
    }
    fun share(enabled:Boolean) {
        if(enabled)startSharing() else stopSharing()
        preferences.edit().putBoolean("sharingEnabled",enabled).apply()
    }
    private fun startSharing() {
        if(server!=null)return
        val instance=PhoneServer(this)
        stream.start()
        try {instance.start(5000,false);server=instance;mutable.update {it.copy(sharing=true,addresses=lanAddresses(),error=null)}}
        catch(e:Exception){stream.stop();instance.stop();throw IllegalStateException("Could not start local sharing: ${e.message}")}
    }
    private fun stopSharing(){stream.stop();server?.stop();server=null;packet="{}";mutable.update {it.copy(sharing=false,addresses=emptyList())}}
    private fun lanAddresses():List<String> = runCatching {NetworkInterface.getNetworkInterfaces().toList().flatMap {it.inetAddresses.toList()}.filterIsInstance<Inet4Address>().filter {!it.isLoopbackAddress && !it.isLinkLocalAddress}.map {"${it.hostAddress}:8787"}}.getOrDefault(emptyList())
    fun liveJson():JSONObject = JSONObject(packet).put("status",ui.value.status).put("recording",ui.value.recording).put("finalizing",ui.value.finalizing).put("elapsedMs",ui.value.elapsed)
        .put("protocol",2).put("zoom",JSONObject().put("min",ui.value.zoomMin).put("max",ui.value.zoomMax).put("ratio",ui.value.zoomRatio))
        .put("currentConfig",config.json()).put("error",ui.value.error ?: JSONObject.NULL).put("version",BuildConfig.VERSION_NAME).put("cameraReady",ui.value.cameraReady)
    fun sessionsJson()=JSONArray(ui.value.sessions)
    fun sessionFile(id:String):File {require(id.matches(Regex("klobflow-[0-9]{13}"))){"Invalid session"};return File(sessionsDir,"$id.jsonl").also {require(it.isFile){"Session unavailable"}}}
    private fun refreshSessions(){mutable.update {it.copy(sessions=sessionsDir.listFiles().orEmpty().filter {f->f.extension=="json"}.sortedByDescending {f->f.name}.take(100).mapNotNull {f->runCatching {JSONObject(f.readText())}.getOrNull()})}}
    fun command(j:JSONObject) {
        when(j.optString("action")) {
            "config"->updateConfig(j.getJSONObject("config"))
            "pacer"->synchronized(processing){
                val operation=j.getString("operation")
                require(operation in listOf("start","pause","resume","restart","stop")){"Choose start, pause, resume, restart or stop"}
                val frame=ui.value.frame
                require(operation=="stop" || active && frame!=null){"Start the camera or demo before using guide dots"}
                require(operation in listOf("pause","stop") || backgroundFilter.status.state !in listOf("countdown","capturing")){"Finish the background snapshot before starting guide dots"}
                val commandTime=SystemClock.elapsedRealtime()
                pacerCoach.command(operation,commandTime,Guide(config,frame?.width ?: 640,frame?.height ?: 480))
                pacerCommandTime=commandTime
                streakCoach.reset()
            }
            "calibrate"->{
                val f=ui.value.frame ?: error("Wait for camera frames")
                val corners=j.getJSONArray("points")
                updateConfig(JSONObject().put("planeCorners",corners).put("planeAspect",j.getDouble("aspect"))
                    .put("calibrationImageAspect",f.width.toDouble()/f.height)
                    .put("calibrationRotation",context.getSystemService(android.view.WindowManager::class.java).defaultDisplay.rotation))
            }
            "audioStart"->(context as? MainActivity)?.requestSystemAudio() ?: error("Open Klobflow on the phone to authorize audio")
            "audioStop"->{context.stopService(android.content.Intent(context,PlaybackTempoService::class.java));pcAudio=AudioTempo();updateConfig(JSONObject().put("tempoSource","manual"))}
            "audioTempo"->{
                require(config.tempoSource=="pc"){"Select PC system audio first"}
                val bpm=if(j.isNull("bpm"))null else j.getDouble("bpm")
                val age=j.optDouble("ageMs",0.0);require(age.isFinite() && age in 0.0..5000.0){"Invalid audio age"}
                val confidence=j.getDouble("confidence");val origin=j.optDouble("origin",0.0);val now=SystemClock.elapsedRealtime().toDouble()
                val holding=j.optBoolean("holding",false);val remaining=j.optDouble("holdRemainingMs",0.0)
                require(remaining.isFinite() && remaining in 0.0..15000.0 && (!holding || bpm!=null && confidence>=.6)){"Invalid audio hold"}
                require((bpm==null || bpm.isFinite() && bpm in 30.0..400.0) && confidence.isFinite() && confidence in 0.0..1.0 && origin.isFinite() && (bpm==null || abs(origin-now)<if(holding)25000 else 10000)){"Invalid or unsynchronized audio tempo"}
                val level=j.optDouble("level",0.0);val history=j.optDouble("historySeconds",0.0)
                val candidate=if(j.isNull("candidateBpm"))null else j.getDouble("candidateBpm")
                require(level.isFinite() && level in 0.0..1.0 && history.isFinite() && history in 0.0..8.0 && (candidate==null || candidate.isFinite() && candidate in 60.0..200.0)){"Invalid audio signal details"}
                pcAudio=AudioTempo(j.optBoolean("running",false),bpm,origin,confidence,level,now-age,if(holding)"Holding the last steady beat"else if(bpm==null)"Waiting for a reliable PC audio beat"else "Following PC system audio",history,candidate,holding,remaining)
            }
            "fit"->synchronized(processing){fitRevision++;fit.begin(zoom=j.optBoolean("zoom",false),size=j.optBoolean("sizeOnly",false))}
            "background"->synchronized(processing){
                val mode=j.optString("mode","capture")
                require(mode in listOf("capture","clear","cancel")){"Choose capture, clear or cancel"}
                if(mode=="capture"){require(ui.value.cameraReady && !demo){"Start the camera before capturing the background"};backgroundFilter.begin(SystemClock.elapsedRealtime())}else backgroundFilter.clear()
                fitRevision++;fit.cancel();resetTracking()
            }
            "syncBeat"->synchronized(processing){timingCoach.reset(SystemClock.elapsedRealtime().toDouble())}
            "reset"->resetTracking()
            "record"->startRecording()
            "stop"->stopRecording()
            "seed"->{val a=j.getJSONArray("points");seed((0 until a.length()).map {val p=a.getJSONArray(it);P(p.getDouble(0),p.getDouble(1))})}
            else->throw IllegalArgumentException("Unknown action")
        }
    }
    fun rotationChanged(rotation:Int){
        synchronized(processing){backgroundFilter.clear()}
        activeAnalysis?.targetRotation=rotation;capture?.targetRotation=rotation
        if(config.planeCorners.isNotEmpty() && config.calibrationRotation!=rotation)updateConfig(JSONObject().put("planeCorners",JSONArray()))
        resetTracking()
    }
    fun background(){active=false;stopRecording();stopSharing();demo=false;generation++;provider?.unbindAll();mutable.update {it.copy(cameraReady=false,frame=null,bitmap=null,status="Camera paused")}}
    override fun close(){closed=true;generation++;stopRecording();stopSharing();provider?.unbindAll();executor.shutdown();demoTimer.shutdown()}
}
