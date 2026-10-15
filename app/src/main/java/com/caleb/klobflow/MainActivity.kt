package com.caleb.klobflow

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.Lifecycle
import org.json.JSONArray
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date
import kotlin.math.*

// Lime and purple identify staff A and B only. Alignment cues use amber (move) and white (target).
val Lime=Color(0xffb6f36b)
val Lavender=Color(0xffb5a3ff)
private val Background=Color(0xff10130f)
internal val Muted=Color(0xffc3ccb9)
internal val Ink=Color(0xfff0f2e9)
internal val Amber=Color(0xffffb45e)
internal val Mint=Color(0xff8ff0c4)
internal val Cyan=Color(0xff6dd8ff)
internal val Slate=Color(0xffa9b8c9)
class MainActivity:ComponentActivity() {
    internal lateinit var engine:FlowEngine
    private var audioRequest=false
    private val audioPermission=registerForActivityResult(ActivityResultContracts.RequestPermission()){granted->if(granted)launchAudioConsent()else {audioRequest=false;PhoneAudio.report("Audio permission was declined. Manual BPM is available.")}}
    private val audioConsent=registerForActivityResult(ActivityResultContracts.StartActivityForResult()){result->
        audioRequest=false
        if(result.resultCode==RESULT_OK && result.data!=null){engine.updateConfig(JSONObject().put("tempoSource","phone").put("tempoEnabled",true));ContextCompat.startForegroundService(this,Intent(this,PlaybackTempoService::class.java).putExtra("consent",result.data))}
        else PhoneAudio.report("Audio sharing was canceled. Manual BPM is available.")
    }
    private fun launchAudioConsent(){
        val manager=getSystemService(android.media.projection.MediaProjectionManager::class.java)
        val intent=if(android.os.Build.VERSION.SDK_INT>=34)manager.createScreenCaptureIntent(android.media.projection.MediaProjectionConfig.createConfigForDefaultDisplay())else manager.createScreenCaptureIntent()
        audioConsent.launch(intent)
    }
    fun requestSystemAudio(){
        if(audioRequest)return
        if(PhoneAudio.state.value.running){engine.updateConfig(JSONObject().put("tempoSource","phone").put("tempoEnabled",true));return}
        engine.updateConfig(JSONObject().put("tempoSource","phone").put("tempoEnabled",true))
        PhoneAudio.report("Approve system audio in the Android sharing prompt.")
        audioRequest=true
        if(ContextCompat.checkSelfPermission(this,Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)launchAudioConsent()else audioPermission.launch(Manifest.permission.RECORD_AUDIO)
    }
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        engine=FlowEngine(this,this)
        setContent {MaterialTheme(colorScheme=darkColorScheme(primary=Lime,secondary=Lavender,background=Background,surface=Color(0xff1a2018),onPrimary=Background,onBackground=Color(0xfff0f2e9),onSurface=Color(0xfff0f2e9),secondaryContainer=Color(0xff334428),onSecondaryContainer=Lime)) {Surface(Modifier.fillMaxSize(),color=Background,contentColor=MaterialTheme.colorScheme.onBackground){FlowApp(engine)}}}
    }
    override fun onConfigurationChanged(newConfig:android.content.res.Configuration){super.onConfigurationChanged(newConfig);engine.rotationChanged(windowManager.defaultDisplay.rotation)}
    override fun onStart(){super.onStart();engine.foreground()}
    override fun onStop(){super.onStop();engine.background()}
    override fun onDestroy(){engine.close();super.onDestroy()}
}

@Composable fun FlowApp(engine:FlowEngine) {
    val ui by engine.ui.collectAsStateWithLifecycle()
    val context=LocalContext.current
    var page by remember {mutableIntStateOf(0)}
    var focus by remember {mutableStateOf(false)}
    var setup by remember {mutableStateOf(false)}
    var message by remember {mutableStateOf<String?>(null)}
    var permission by remember {mutableStateOf(ContextCompat.checkSelfPermission(context,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)}
    val request=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){granted->permission=granted;if(granted)engine.bindCamera()else message="Camera permission is needed to track your practice. You can still try the demo."}
    fun run(block:()->Unit){try{block()}catch(e:Exception){message=e.message ?: "Action failed"}}
    fun patch(key:String,value:Any)=run{engine.updateConfig(JSONObject().put(key,value))}
    // One coach for the status boxes and the overlay, so text and drawn cues always agree.
    val coach=remember {AlignmentFeedback()}
    val feedback=remember(ui.frame?.time){ui.frame?.let {coach.update(it.time,it.staffs,it.guide,it.background)}}
    if(focus)PracticeFocus(ui,engine,feedback,{focus=false}){message=it}
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME){permission=ContextCompat.checkSelfPermission(context,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED}
    Column(Modifier.fillMaxSize().background(Background).safeDrawingPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=15.dp),verticalAlignment=Alignment.CenterVertically) {
            Text("╱╱",color=Lime,fontSize=28.sp,fontWeight=FontWeight.Bold)
            Spacer(Modifier.width(10.dp));Text("klobflow",fontSize=25.sp,fontWeight=FontWeight.SemiBold)
            Spacer(Modifier.weight(1f));Text(if(ui.demo)"DEMO" else "FLOW LAB",color=if(ui.demo)Lavender else Muted,fontSize=12.sp,letterSpacing=2.sp)
        }
        if(message!=null || ui.error!=null) Surface(color=Color(0xff47372b),modifier=Modifier.fillMaxWidth()) {
            Row(Modifier.padding(12.dp),verticalAlignment=Alignment.CenterVertically){Text(message ?: ui.error!!,Modifier.weight(1f),fontSize=15.sp,lineHeight=20.sp);if(message!=null)TextButton(onClick={message=null}){Text("OK")}}
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal=16.dp)) {
            when(page){
                0->{
                    Text("Find your lines.",fontSize=28.sp,fontWeight=FontWeight.Medium)
                    Text(ui.status,color=Muted,fontSize=14.sp,modifier=Modifier.padding(top=5.dp,bottom=12.dp))
                    if(!ui.cameraReady && !ui.demo) Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        Button(onClick={if(permission)run{engine.bindCamera()}else request.launch(Manifest.permission.CAMERA)},modifier=Modifier.weight(1f)){Text(if(permission)"Open camera" else "Allow camera")}
                        OutlinedButton(onClick={engine.startDemo()}){Text("Try demo")}
                    }
                    FlowRow(horizontalArrangement=Arrangement.spacedBy(7.dp)) {listOf("grid" to "Grid","circles" to "Circles","cube" to "Cube","free" to "Free","antispin" to "Antispin").forEach {(key,label)->FilterChip(selected=ui.config.mode==key,onClick={patch("mode",key)},label={Text(label)})}}
                    Row {listOf(2 to "Two staves",1 to "One staff / one hand").forEach {(count,label)->FilterChip(enabled=ui.config.mode!="antispin" || count==1,selected=ui.config.staffCount==count,onClick={patch("staffCount",count)},label={Text(label)},modifier=Modifier.padding(end=6.dp))}}
                    ModeTutorial(ui.config.mode)
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        OutlinedButton(enabled=ui.frame!=null,onClick={run{engine.command(JSONObject().put("action","fit").put("zoom",true))}},modifier=Modifier.weight(1f)){Text("Auto-fit")}
                        OutlinedButton(enabled=ui.frame!=null,onClick={focus=true},modifier=Modifier.weight(1f)){Text("Full screen")}
                    }
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        val capturing=ui.frame?.background?.state in listOf("countdown","capturing")
                        OutlinedButton(enabled=ui.cameraReady&&!ui.demo,onClick={run{engine.command(JSONObject().put("action","background").put("mode",if(capturing)"cancel" else "capture"))}},modifier=Modifier.weight(1f)){Text(if(capturing)"Cancel capture" else "Background · 5s")}
                        OutlinedButton(onClick={setup=!setup}){Text(if(setup)"Close setup" else "Setup")}
                    }
                    if(setup){
                        Text("Colors, room lights & guide fit",fontSize=20.sp,color=Lime,modifier=Modifier.padding(top=8.dp))
                        StaffColorPicker(ui,engine){message=it}
                        BackgroundControls(ui,engine){message=it}
                        FitControls(ui,engine)
                    }
                    if(!focus)CameraPanel(ui,engine,feedback){message=it}
                    if(ui.cameraReady && ui.zoomMax>ui.zoomMin){
                        var zoomDraft by remember(ui.zoomRatio){mutableFloatStateOf(ui.zoomRatio)}
                        Row(verticalAlignment=Alignment.CenterVertically){Text("Zoom · %.2f×".format(ui.zoomRatio),Modifier.weight(1f),color=Lime,fontSize=15.sp);TextButton(onClick={patch("zoom",0.0)}){Text("Widest")}}
                        Slider(value=zoomDraft.coerceIn(ui.zoomMin,ui.zoomMax),onValueChange={zoomDraft=it},onValueChangeFinished={patch("zoom",zoomDraft.toDouble())},valueRange=ui.zoomMin..ui.zoomMax)
                    }
                    // Alignment errors are 5-second averages of clear samples. A current raw gap, or tracking that is not
                    // yet confirmed clear, always masks them, so a stale average is never shown as current.
                    val f=ui.frame
                    val scoring=feedback?.trackingConfirmed==true
                    fun shown(raw:Double?,averaged:Double?)=if(raw==null || !scoring)null else averaged
                    val deviation=shown(f?.metrics?.deviation,f?.averagedMetrics?.deviation)
                    Row(Modifier.fillMaxWidth().padding(top=12.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                        Metric("${if(ui.config.mode=="antispin")"Line drift" else if(ui.config.mode=="cube")"Vertex" else if(ui.config.mode=="circles")"Circle" else "Grid"} error",deviation,"%",Modifier.weight(1f),ui.config.tolerance)
                        if(ui.config.mode!="antispin")Metric("Angle error",shown(f?.metrics?.angle,f?.averagedMetrics?.angle),"°",Modifier.weight(1f))
                        if(ui.config.staffCount==2)Metric("Symmetry",shown(f?.metrics?.symmetry,f?.averagedMetrics?.symmetry),"%",Modifier.weight(1f),ui.config.tolerance)
                    }
                    Text("Error cards show 5-second averages of clear samples.",color=Muted,fontSize=13.sp,modifier=Modifier.padding(top=4.dp,bottom=10.dp))
                    val count=ui.config.staffCount
                    val good=f?.staffs?.take(count)?.count {it!=null && it.confidence>=0.55} ?: 0
                    val snapshot=f?.background?.state=="countdown" || f?.background?.state=="capturing"
                    Text(when{
                        snapshot->"Background snapshot · keep staves out of view"
                        scoring->(if(count==1)"● One staff tracked" else "● Both staves tracked")+(if(deviation==null)"" else if(deviation<=ui.config.tolerance)" · within target" else " · outside target")
                        good==count->"Precision paused · waiting for clear tips"
                        else->"$good / $count staves visible · scores paused"
                    },color=if(scoring)Lime else Ink,fontSize=15.sp)
                    Text("${f?.analysisFps?.toInt() ?: 0} analysis fps · projected 2D measurements",color=Muted,fontSize=13.sp,modifier=Modifier.padding(top=5.dp,bottom=12.dp))
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                        Button(onClick={run{if(ui.recording)engine.stopRecording()else engine.startRecording()}},enabled=(ui.cameraReady && !ui.demo && !ui.finalizing),modifier=Modifier.weight(1f),colors=ButtonDefaults.buttonColors(containerColor=if(ui.recording)Color(0xffec9b85)else Lime)) {
                            Text(if(ui.finalizing)"Saving…" else if(ui.recording)"Stop · ${ui.elapsed/1000}s" else "● Record practice")
                        }
                        OutlinedButton(onClick={if(ui.demo){if(permission)run{engine.bindCamera()}else request.launch(Manifest.permission.CAMERA)}else patch("facing",if(ui.config.facing=="front")"back" else "front")},enabled=!ui.recording && !ui.finalizing){Text(if(ui.demo)"Camera" else "Flip")}
                    }
                    Text("Video saves to Movies / Klobflow. Analysis saves with the session. Keep the app in the foreground.",color=Muted,fontSize=14.sp,lineHeight=19.sp,modifier=Modifier.padding(vertical=10.dp))
                    SharePanel(ui,{run{engine.share(!ui.sharing)}})
                }
                1->{
                    Text("Make the space yours.",fontSize=25.sp)
                    Text("Set the guide to your practice plane. A fixed phone and clear contrast give the most useful feedback.",color=Muted,fontSize=15.sp,lineHeight=20.sp,modifier=Modifier.padding(vertical=10.dp))
                    Label("TRACKING")
                    Toggle("Mirror camera",ui.config.mirror){patch("mirror",it)}
                    Toggle("LED staves",ui.config.led){patch("led",it)}
                    Text(if(ui.config.led)"Detect bright, elongated shapes. No markers required." else "Experimental edge mode for unlit staves.",color=Muted,fontSize=14.sp)
                    StaffColorPicker(ui,engine){message=it}
                    ControlSlider("Brightness threshold",ui.config.threshold.toFloat(),60f..250f){patch("threshold",it.toInt())}
                    ControlSlider("Minimum staff length in the image",(ui.config.minLength*100).toFloat(),10f..80f,"%"){patch("minLength",it/100.0)}
                    val edge=ui.frame?.let {min(it.width,it.height)}
                    Text("The staff's apparent end-to-end length in the camera image, as a percent of the image's shorter edge. Shorter lights are ignored."+
                        (if(edge!=null)" Here ${(ui.config.minLength*100).roundToInt()}% of the $edge-pixel edge is ${(edge*ui.config.minLength).roundToInt()} pixels." else "")+
                        " On 1920 × 1080 video, 22% is 238 pixels. This is not the guide size or the staff's real length.",color=Muted,fontSize=14.sp,lineHeight=19.sp)
                    Row(horizontalArrangement=Arrangement.spacedBy(8.dp),modifier=Modifier.padding(top=8.dp)){listOf(30,60).forEach {rate->FilterChip(selected=ui.config.fps==rate,onClick={patch("fps",rate)},label={Text("$rate fps target")})}}
                    Text("Recording requests the selected frame rate. Analysis follows the latest available frames; hardware and processing determine the actual rate.",color=Muted,fontSize=14.sp,lineHeight=19.sp)
                    Label("BEAT TIMING")
                    BeatSettings(ui,engine)
                    Label("GUIDE CALIBRATION")
                    Text("Framing stays fixed until you press Auto-fit. Get into position first, then keep your full staves visible for two seconds.",color=Muted,fontSize=14.sp,lineHeight=19.sp)
                    FitControls(ui,engine)
                    ControlSlider("Center X",(ui.config.cx*100).toFloat(),10f..90f,"%"){patch("cx",it/100.0)}
                    ControlSlider("Center Y",(ui.config.cy*100).toFloat(),10f..90f,"%"){patch("cy",it/100.0)}
                    ControlSlider("Size",(ui.config.scale*100).toFloat(),10f..48f,"%"){patch("scale",it/100.0)}
                    ControlSlider("Rotation",ui.config.rotation.toFloat(),-90f..90f,"°"){patch("rotation",it.toDouble())}
                    if(ui.config.mode=="cube")ControlSlider("Cube projection depth",(ui.config.cubeDepth*100).toFloat(),10f..90f,"%"){patch("cubeDepth",it/100.0)}
                    if(ui.config.mode=="circles")ControlSlider("Circle separation",(ui.config.circleSeparation*100).toFloat(),0f..180f,"%"){patch("circleSeparation",it/100.0)}
                    ControlSlider("Target tolerance",ui.config.tolerance.toFloat(),1f..50f,"%"){patch("tolerance",it.toDouble())}
                    Text("Allowed distance from the guide as a percent of its width (diameter in Circles). Higher is more forgiving; detection is unchanged.",color=Muted,fontSize=14.sp,lineHeight=19.sp)
                    Toggle("Alignment cues (arrows and targets)",ui.config.showFeedback){patch("showFeedback",it)}
                    Toggle("Show guide",ui.config.showGuide){patch("showGuide",it)}
                    Toggle("Diagonal grid lines",ui.config.diagonals){patch("diagonals",it)}
                    Toggle("Tip trails",ui.config.trails){patch("trails",it)}
                    Text("The newest tip cycles through the full rainbow every 4.2 seconds. Each segment keeps its color while fading; brighter segments are newer. Subtle highlights mark clear detections.",color=Muted,fontSize=14.sp)
                    Toggle("Streak glow and particles",ui.config.streakEffects){patch("streakEffects",it)}
                    Text("Keep every tip on the guide. Glow grows smoothly to a brilliant white-gold aura at 30 seconds. Forgiveness holds your earned power.",color=Muted,fontSize=14.sp,lineHeight=19.sp)
                    Label("STREAK FORGIVENESS")
                    ControlSlider("Tracking grace",ui.config.trackingGraceMs.toFloat(),0f..3000f,steps=29,valueLabel={if(it==0f)"Off"else"${it.roundToInt()} ms"}){patch("trackingGraceMs",it.roundToInt())}
                    ControlSlider("Alignment grace",ui.config.alignmentGraceMs.toFloat(),0f..1000f,steps=19,valueLabel={if(it==0f)"Off"else"${it.roundToInt()} ms"}){patch("alignmentGraceMs",it.roundToInt())}
                    Text("Tracking grace holds your streak through missing or blurred tips. Alignment grace covers brief off-target blips. Earned seconds freeze during either hold. Scores and on-target cues stay unchanged.",color=Muted,fontSize=14.sp,lineHeight=19.sp)
                    if(ui.config.staffCount==2)Toggle("Mirror-symmetry measurement",ui.config.symmetry){patch("symmetry",it)}
                    OutlinedButton(onClick={run{engine.updateConfig(Config().json().put("facing",ui.config.facing).put("fps",ui.config.fps))}}){Text("Reset practice settings")}
                }
                2->{
                    Text("Your practice log.",fontSize=25.sp)
                    Text("Recordings stay on your phone. Export the analysis to inspect every measured frame on your PC.",color=Muted,fontSize=15.sp,lineHeight=20.sp,modifier=Modifier.padding(vertical=12.dp))
                    if(ui.sessions.isEmpty())Text("No sessions yet. Record your first practice from the live view.",Modifier.padding(vertical=32.dp),color=Muted)
                    ui.sessions.forEach {s->
                        Surface(shape=RoundedCornerShape(16.dp),modifier=Modifier.fillMaxWidth().padding(bottom=10.dp)) {
                            Column(Modifier.padding(16.dp)){
                                Text(DateFormat.getDateTimeInstance(DateFormat.MEDIUM,DateFormat.SHORT).format(Date(s.getLong("createdAt"))),fontWeight=FontWeight.Medium)
                                Text("${s.getLong("durationMs")/1000}s · ${s.optInt("validFrames")} scored / ${s.optInt("frames")} samples",color=Muted,fontSize=14.sp)
                                if(!s.isNull("recordingError"))Text("Recording error ${s.optInt("recordingError")}. Check video before relying on it.",color=Amber,fontSize=14.sp)
                                Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                                    TextButton(onClick={run{context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(s.getString("videoUri")),"video/mp4").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))}}){Text("Play video")}
                                    TextButton(onClick={run{val uri=FileProvider.getUriForFile(context,"${context.packageName}.files",engine.sessionFile(s.getString("id")));context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("application/x-ndjson").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),"Export analysis"))}}){Text("Export analysis")}
                                }
                            }
                        }
                    }
                }
                else->{
                    Text("Practice with intention.",fontSize=25.sp)
                    Text("1. Put the phone on a stable support, with your whole movement in frame. Use the rear camera with the PC companion for a larger practice view.\n\n2. Turn on your LED staves. Avoid bright windows or long lights in the background. If another light is tracked, choose your LED colors on the Adjust page or capture the background on the Practice page.\n\n3. Choose Grid for lines, Circles for radial consistency, or Cube for endpoint alignment with projected vertices. Press Auto-fit to fit the guide to your stance. Use Identify staves if automatic selection is wrong.\n\n4. Begin slowly. Missing or ambiguous staves pause the scores. Identical props and endpoints can swap after occlusion.\n\n5. Record, then review your video alongside the exported measurements.",color=Muted,fontSize=15.sp,lineHeight=21.sp,modifier=Modifier.padding(vertical=12.dp))
                    Label("VTG DRILL NOTES")
                    Text("Timing is listed first, direction second. These choices annotate your session; Klobflow does not infer hands, grip, flower ratios, or VTG patterns from staff lines.",color=Muted,fontSize=15.sp,lineHeight=20.sp)
                    listOf("tog-same" to "Together / same","split-same" to "Split / same","tog-opp" to "Together / opposite","split-opp" to "Split / opposite").forEach {(key,label)->FilterChip(selected=ui.config.timing==key,onClick={patch("timing",key)},label={Text(label)})}
                    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf("1:1","1:3","1:5").forEach {ratio->FilterChip(selected=ui.config.ratio==ratio,onClick={patch("ratio",ratio)},label={Text(ratio)})}}
                    Label("UNDERSTAND THE NUMBERS")
                    Text("Error is RMS endpoint distance as a percentage of the guide's width (circle diameter in Circles). Cube error uses the nearest vertex. Angle error compares staff orientation to guide lines. Symmetry reflects one staff across the guide's center axis. Lower is closer. The cards show 5-second averages of clear samples; any current uncertainty pauses them at once.\n\nSpeed variation compares angular speeds over the last 1.2 seconds. It needs steady, visible motion. Deliberate stalls and transitions can increase it. None of these numbers is an overall skill grade.\n\nA single camera measures projected 2D geometry. The cube is a visual reference, not a measurement of 3D depth.",color=Muted,fontSize=15.sp,lineHeight=20.sp,modifier=Modifier.padding(vertical=10.dp))
                    TextButton(onClick={context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse("https://noelyee.com/instruction/vulcan-tech-gospel/")))}){Text("Noel Yee · Vulcan Tech Gospel ↗")}
                    TextButton(onClick={context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse("https://flowartsinstitute.com/wp-content/uploads/2015/02/VTGpostersmall.jpg")))}){Text("VTG reference poster ↗")}
                    Text("Independent practice tool. No endorsement by VTG or its contributors.",color=Muted,fontSize=13.sp)
                }
            }
            Spacer(Modifier.height(24.dp))
        }
        NavigationBar(containerColor=Background,tonalElevation=0.dp){listOf("Practice","Adjust","Sessions","Guide").forEachIndexed {i,label->NavigationBarItem(selected=page==i,onClick={page=i},icon={Text(listOf("◎","⊞","▤","◇")[i],fontSize=20.sp)},label={Text(label)})}}
    }
}
/** Tracking validity and the alignment explanation live in separate fixed boxes. */
@Composable private fun StatusBoxes(feedback:Coaching?,compact:Boolean=false,horizontal:Boolean=false) {
    val tracking=feedback?.tracking ?: BoxText("idle","NO CAMERA YET","Open the camera or try the demo.")
    val alignment=if(feedback==null)BoxText("idle","WAITING","Alignment feedback appears when your staves are tracked.")
        else feedback.summary ?: BoxText(when(feedback.state){"aligned","settling"->"ok";"adjust"->"warn";"free"->"idle";else->"wait"},feedback.title,feedback.detail,cues=feedback.cues)
    val inactive={b:BoxText->b.tone=="wait" || b.tone=="idle"}
    val (trackingText,trackingUrgent)=rememberHeldText(tracking){a,b->a.tone=="ok" && b.tone!="ok" || (a.title=="BACKGROUND SNAPSHOT")!=(b.title=="BACKGROUND SNAPSHOT")}
    // Text that names drawn arrows/targets must appear and disappear with them, never fade over absent marks.
    val (alignmentText,alignmentUrgent)=rememberHeldText(alignment){a,b->a.cues&&!b.cues || a.title=="ON GUIDE" && b.title!="ON GUIDE" || inactive(b) && !inactive(a) || (a.title=="FREE FLOW")!=(b.title=="FREE FLOW")}
    if(horizontal)Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
        StatusBox("Tracking",trackingText,trackingUrgent,Modifier.weight(1f).padding(bottom=8.dp),compact=compact)
        StatusBox("Alignment",alignmentText,alignmentUrgent,Modifier.weight(1f).padding(bottom=8.dp),compact=compact)
    }else{
        StatusBox("Tracking",trackingText,trackingUrgent,Modifier.padding(bottom=8.dp),compact=compact)
        StatusBox("Alignment",alignmentText,alignmentUrgent,Modifier.padding(bottom=8.dp),compact=compact)
    }
}
@Composable private fun PracticeFocus(ui:FlowUi,engine:FlowEngine,feedback:Coaching?,onClose:()->Unit,onError:(String)->Unit) {
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false,decorFitsSystemWindows=false)){
        Surface(Modifier.fillMaxSize(),color=Background){
            Column(Modifier.fillMaxSize().safeDrawingPadding().padding(12.dp)){
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween){
                    TextButton(onClick=onClose){Text("Exit full screen")}
                    Button(enabled=ui.cameraReady&&!ui.demo&&!ui.finalizing,onClick={try{if(ui.recording)engine.stopRecording()else engine.startRecording()}catch(e:Exception){onError(e.message ?: "Recording failed");onClose()}}){Text(if(ui.finalizing)"Saving…" else if(ui.recording)"Stop · ${ui.elapsed/1000}s" else "Record")}
                }
                ui.error?.let {Text(it,color=Amber,fontSize=15.sp)}
                BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()){
                    if(maxWidth>maxHeight){
                        val previewHeight=(maxHeight-58.dp).coerceAtLeast(96.dp)
                        val feedbackWidth=minOf(300.dp,maxWidth*.45f)
                        Row(Modifier.fillMaxSize(),horizontalArrangement=Arrangement.spacedBy(12.dp)){
                            Column(Modifier.weight(1f).fillMaxHeight(),verticalArrangement=Arrangement.Center){CameraPanel(ui,engine,feedback,focus=true,previewMaxHeight=previewHeight,onError=onError)}
                            Column(Modifier.width(feedbackWidth).fillMaxHeight().verticalScroll(rememberScrollState())){StatusBoxes(feedback,compact=true,horizontal=true);BeatFeedback(ui,compact=true)}
                        }
                    }else{
                        Column(Modifier.fillMaxSize()){
                            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth(),contentAlignment=Alignment.Center){
                                val previewHeight=(maxHeight-58.dp).coerceAtLeast(96.dp)
                                Column{CameraPanel(ui,engine,feedback,focus=true,previewMaxHeight=previewHeight,onError=onError)}
                            }
                            StatusBoxes(feedback,compact=true)
                            BeatFeedback(ui,compact=true)
                        }
                    }
                }
            }
        }
    }
}
@Composable private fun CameraPanel(ui:FlowUi,engine:FlowEngine,feedback:Coaching?,focus:Boolean=false,previewMaxHeight:Dp=Dp.Infinity,onError:(String)->Unit) {
    var identifying by remember {mutableStateOf(false)}
    var calibrating by remember {mutableStateOf(false)}
    var planeAspect by remember {mutableStateOf("1.0")}
    var picks by remember {mutableStateOf(emptyList<P>())}
    val cueSectors=remember {IntArray(4){-1}}
    val labelPaint=remember {android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {typeface=android.graphics.Typeface.DEFAULT_BOLD;textAlign=android.graphics.Paint.Align.CENTER}}
    val backgroundState=ui.frame?.background?.state ?: "off"
    // New detection filters or a new background snapshot invalidate old, possibly false, trails.
    val trails=remember(ui.frame?.source,ui.frame?.width,ui.frame?.height,ui.config.facing,ui.config.mirror,ui.config.zoom,ui.config.staffCount,ui.config.staffColors,ui.config.led,backgroundState) {mutableStateListOf<Pair<Long,List<Segment?>>>()}
    LaunchedEffect(ui.frame?.time){ui.frame?.let {f->trails.add(f.time to f.staffs);while(trails.isNotEmpty() && (f.time-trails.first().first>4200 || trails.size>512))trails.removeAt(0)}}
    var previousBackground by remember {mutableStateOf("off")}
    var savedAt by remember {mutableLongStateOf(0L)}
    LaunchedEffect(backgroundState){if(backgroundState=="ready" && (previousBackground=="countdown" || previousBackground=="capturing"))savedAt=SystemClock.uptimeMillis();previousBackground=backgroundState}
    val aspect=ui.bitmap?.let {it.width.toFloat()/it.height} ?: (4f/3f)
    BoxWithConstraints(Modifier.fillMaxWidth()){
    Box(Modifier.width(minOf(maxWidth,previewMaxHeight*aspect)).aspectRatio(aspect).align(Alignment.TopCenter).background(Color(0xff080b08),RoundedCornerShape(16.dp)).semantics{contentDescription="Practice camera preview"}
        .pointerInput(identifying,calibrating,ui.config.staffCount,planeAspect,ui.frame?.width,ui.frame?.height){if(identifying || calibrating)detectTapGestures {pos->
            picks=picks+P((pos.x/size.width).toDouble(),(pos.y/size.height).toDouble())
            if(picks.size==(if(calibrating)4 else ui.config.staffCount*2)){try{if(calibrating)engine.command(JSONObject().put("action","calibrate").put("points",JSONArray(picks.map {it.json()})).put("aspect",planeAspect.toDouble()))else engine.seed(picks)}catch(e:Exception){onError(e.message ?: "Could not apply selection")};picks=emptyList();identifying=false;calibrating=false}
        }}) {
        ui.bitmap?.let {Image(it.asImageBitmap(),"Live practice camera",Modifier.fillMaxSize())}
        if(ui.bitmap==null)Text("A little space. Two staves.\nYour next practice starts here.",Modifier.align(Alignment.Center).padding(20.dp),color=Muted)
        Canvas(Modifier.fillMaxSize()) {
            val f=ui.frame ?: return@Canvas
            val g=f.guide
            val unit=min(size.width/g.aspectX.toFloat(),size.height/g.aspectY.toFloat())
            fun p(v:P)=Offset((v.x*unit).toFloat(),(v.y*unit).toFloat())
            // Cue sizes are in dp, so they stay readable on any screen density.
            val k=1.dp.toPx()
            val outline=Color.Black.copy(alpha=.72f)
            fun ring(center:Offset,radius:Float,color:Color,width:Float){drawCircle(outline,radius,center,style=Stroke(width+3.5f*k));drawCircle(color,radius,center,style=Stroke(width))}
            // Match the browser aura in camera space. Guides and measured cues draw above it.
            val power=if(ui.config.streakEffects)f.streak.energy.toFloat().coerceIn(0f,1f)else 0f
            if(power>0f){
                val scale=(unit/480).coerceIn(.6f,1.5f);val heat=power*power
                val phase=if(android.animation.ValueAnimator.areAnimatorsEnabled())(f.time/3600.0).toFloat()else(-PI/2).toFloat()
                f.staffs.forEach {s->if(s!=null&&!s.blurred&&!s.occluded&&s.confidence>=.55){
                    drawLine(Color(0xffffb32b).copy(alpha=.12f*heat),p(s.a),p(s.b),(12+20*power)*scale,cap=StrokeCap.Round)
                    drawLine(Color(0xffffde71).copy(alpha=.28f*heat),p(s.a),p(s.b),(5+11*power)*scale,cap=StrokeCap.Round)
                    drawLine(Color(0xfffffbe8).copy(alpha=.55f*heat),p(s.a),p(s.b),(2+3*power)*scale,cap=StrokeCap.Round)
                    listOf(s.a,s.b).forEach {tip->
                        val pos=p(tip);val halo=(16+64*power)*scale;val rim=(12+30*power)*scale
                        val aura=Brush.radialGradient(
                            0f to Color(0xfffffff6).copy(alpha=.95f*power),
                            .16f to Color(0xfffff6bf).copy(alpha=.82f*power),
                            .35f to Color(0xffffd359).copy(alpha=.55f*power),
                            .65f to Color(0xffffa92b).copy(alpha=.2f*power),
                            1f to Color(0xffffa92b).copy(alpha=0f),center=pos,radius=halo)
                        drawCircle(aura,halo,pos)
                        // Fixed counts and smooth rotation avoid particle pop-in and flashing.
                        repeat(6){n->
                            val a=phase+n*PI/3;val reach=halo*(.76f+.1f*(n%3));val start=rim*.7f;val half=(1+3*power)*scale
                            val dx=cos(a).toFloat();val dy=sin(a).toFloat()
                            val ray=Path().apply {
                                moveTo(pos.x+dx*reach,pos.y+dy*reach)
                                lineTo(pos.x+dx*start-dy*half,pos.y+dy*start+dx*half)
                                lineTo(pos.x+dx*start+dy*half,pos.y+dy*start-dx*half);close()
                            }
                            drawPath(ray,Color(0xfffff0ae).copy(alpha=.65f*heat))
                        }
                        drawCircle(Color(0xffffd770).copy(alpha=.28f*power),rim,pos,style=Stroke((3+5*power)*scale))
                        drawArc(Color(0xfffffce2).copy(alpha=.9f*power),-90f,(360*f.streak.progress.coerceIn(0.0,1.0)).toFloat(),false,
                            Offset(pos.x-rim,pos.y-rim),androidx.compose.ui.geometry.Size(rim*2,rim*2),style=Stroke((1+1.8f*power)*scale,cap=StrokeCap.Round))
                        val coreRadius=(5+11*power)*scale
                        val core=Brush.radialGradient(0f to Color.White.copy(alpha=power),.35f to Color(0xfffffdde).copy(alpha=.9f*power),
                            1f to Color(0xffffe696).copy(alpha=0f),center=pos,radius=coreRadius)
                        drawCircle(core,coreRadius,pos)
                        repeat(4){n->
                            val a=-phase+n*PI/2;val r=rim+(7+8*power)*scale
                            drawCircle(Color(0xfffffde6).copy(alpha=.95f*heat),(1+2.2f*power)*scale,
                                Offset(pos.x+cos(a).toFloat()*r,pos.y+sin(a).toFloat()*r))
                        }
                    }
                }}
            }
            if(ui.config.showGuide){
                // A dark casing keeps the white dashed guide readable over bright LEDs and daylight.
                val guidePath=Path().apply {
                    g.displayLines.forEach {val a=p(it.a);val b=p(it.b);moveTo(a.x,a.y);lineTo(b.x,b.y)}
                    g.circlePaths.forEach {path->path.forEachIndexed {i,v->val o=p(v);if(i==0)moveTo(o.x,o.y)else lineTo(o.x,o.y)}}
                }
                drawPath(guidePath,Color.Black.copy(alpha=.55f),style=Stroke(4f*k,join=StrokeJoin.Round))
                drawPath(guidePath,Color(0xfff4f8ee).copy(alpha=.72f),style=Stroke(1.6f*k,pathEffect=PathEffect.dashPathEffect(floatArrayOf(7f*k,6f*k))))
                if(ui.config.mode in listOf("grid","cube"))g.displayVertices.forEach {drawCircle(Color.Black.copy(alpha=.7f),4.5f*k,p(it));drawCircle(Color(0xffeef5e6),2.8f*k,p(it))}
            }
            if(ui.config.trails){
                val width=4f*(unit/480).coerceIn(.5f,2f)*(1+power*.35f)
                fun visible(s:Segment?)=s!=null&&!s.occluded&&(s.confidence>=.55||s.blurred)
                fun fade(time:Long)=(1-(f.time-time)/4200f).coerceIn(0f,1f)
                trails.forEachIndexed {index,entry->entry.second.forEachIndexed {i,s->if(visible(s)){
                    // One rainbow turn per trail lifetime. A sample keeps its hue as it fades.
                    val staff=s!!;val color=Color.hsl(Math.floorMod(entry.first,4200L)*360f/4200f,1f,.7f)
                    val previous=trails.getOrNull(index-1);val old=previous?.second?.getOrNull(i)
                    if(previous!=null&&visible(old)&&entry.first-previous.first in 1..150&&
                        max(old!!.a.distance(staff.a),old.b.distance(staff.b))<=min(old.length,staff.length)*.6){
                        val alpha=.72f*fade(previous.first)*(if(old.blurred||staff.blurred).55f else 1f)
                        drawLine(color.copy(alpha=alpha),p(old.a),p(staff.a),width,cap=StrokeCap.Round)
                        drawLine(color.copy(alpha=alpha),p(old.b),p(staff.b),width,cap=StrokeCap.Round)
                    }
                    // Same width as the line; a small brightness lift marks real clear samples.
                    if(!staff.blurred&&staff.confidence>=.55)listOf(staff.a,staff.b).forEach {
                        drawCircle(color.copy(alpha=fade(entry.first)*.14f),width*.48f,p(it))
                    }
                }}}
            }
            f.staffs.forEachIndexed {i,s->if(s!=null){val col=(if(i==0)Lime else Lavender).copy(alpha=if(s.occluded).35f else if(s.blurred).75f else if(s.confidence>=0.55)1f else .35f);drawLine(col,p(s.a),p(s.b),4f,pathEffect=if(s.blurred&&!s.occluded)PathEffect.dashPathEffect(floatArrayOf(8f,5f))else null);ring(p(s.a),6f*k,col,1.8f*k);ring(p(s.b),6f*k,col,1.8f*k)}}
            // Labels sit on dark plates and never overlap each other or the rings they explain.
            val placed=mutableListOf<Rect>()
            fun tag(text:String,textSize:Float,fill:Color,ink:Color,stroke:Color?,candidates:List<(Float,Float)->Offset>,force:Boolean=false,alpha:Float=1f):Boolean {
                labelPaint.style=android.graphics.Paint.Style.FILL;labelPaint.textSize=textSize;labelPaint.color=ink.toArgb();labelPaint.alpha=(alpha*255).roundToInt()
                val w=labelPaint.measureText(text)+textSize*.9f;val h=textSize*1.5f
                candidates.forEachIndexed {index,candidate->
                    val center=candidate(w,h)
                    val left=(center.x-w/2).coerceIn(1f,max(1f,size.width-w-1f));val top=(center.y-h/2).coerceIn(1f,max(1f,size.height-h-1f))
                    val rect=Rect(left,top,left+w,top+h)
                    if(placed.any {it.overlaps(rect)} && !(force && index==candidates.lastIndex))return@forEachIndexed
                    placed.add(rect)
                    drawRoundRect(fill,rect.topLeft,rect.size,CornerRadius(h*.3f),alpha=alpha)
                    if(stroke!=null)drawRoundRect(stroke,rect.topLeft,rect.size,CornerRadius(h*.3f),style=Stroke(1.5f*k),alpha=alpha)
                    drawContext.canvas.nativeCanvas.drawText(text,rect.center.x,rect.center.y+textSize*.36f,labelPaint)
                    return true
                }
                return false
            }
            fun beside(center:Offset,ux:Float,uy:Float,r:Float):(Float,Float)->Offset={w,h->val reach=r+5f*k+abs(ux)*w/2+abs(uy)*h/2;Offset(center.x+ux*reach,center.y+uy*reach)}
            // A letter at each staff's middle names the line; lime and purple identify staves, not scores.
            f.staffs.forEachIndexed {i,s->if(s!=null && i<ui.config.staffCount){
                val mid=p(s.center);val note=if(s.occluded)" · LAST SEEN" else if(s.blurred)" · ENDS UNCLEAR" else if(s.confidence<.55)" · UNSURE" else ""
                tag("${if(i==0)"A" else "B"}$note",14.sp.toPx(),if(i==0)Lime else Lavender,Background,Background,listOf<(Float,Float)->Offset>({_,_->mid},{_,h->Offset(mid.x,mid.y-h*1.2f)},{_,h->Offset(mid.x,mid.y+h*1.2f)}),force=true,alpha=if(s.occluded).65f else 1f)
            }}
            if(ui.config.mode=="antispin"){
                if(ui.config.showGuide)g.displayLines.forEachIndexed {i,s->
                    val color=if(i==0)Cyan else Lavender
                    drawLine(color,p(s.a),p(s.b),2.5f*k)
                    val pos=p(s.a);tag(if(i==0)"HORIZONTAL" else "VERTICAL",13.sp.toPx(),Background,color,null,listOf(beside(pos,0f,-1f,12f*k),beside(pos,1f,0f,12f*k)))
                }
                if(ui.config.showFeedback)feedback?.tips.orEmpty().forEach {cue->val pos=p(cue.tip);val horizontal=cue.axis=="horizontal"
                    tag(if(horizontal)"H TIP" else "V TIP",13.sp.toPx(),Background,if(horizontal)Cyan else Lavender,null,listOf(beside(pos,0f,-1f,20f*k),beside(pos,1f,0f,20f*k),beside(pos,-1f,0f,20f*k)))
                }
            }
            if(f.beat.enabled){
                val on=f.beat.phase<.18;val grow=on&&android.animation.ValueAnimator.areAnimatorsEnabled()
                f.beat.targets.forEachIndexed {i,points->points.forEachIndexed {j,target->
                    val pos=p(target);val r=(if(grow)10f else 8f)*k
                    ring(pos,r,if(i==0)Cyan else Lavender,(if(on)3.4f else 2.4f)*k)
                    labelPaint.textSize=13.sp.toPx();labelPaint.alpha=255
                    labelPaint.style=android.graphics.Paint.Style.STROKE;labelPaint.strokeWidth=3.5f*k;labelPaint.color=android.graphics.Color.BLACK
                    drawContext.canvas.nativeCanvas.drawText("${j+1}",pos.x+r+7f*k,pos.y-r,labelPaint)
                    labelPaint.style=android.graphics.Paint.Style.FILL;labelPaint.color=android.graphics.Color.WHITE
                    drawContext.canvas.nativeCanvas.drawText("${j+1}",pos.x+r+7f*k,pos.y-r,labelPaint)
                }}
                if(ui.config.mode!="antispin")f.staffs.forEach {s->if(s!=null && s.confidence>=.55){
                    val pos=p(s.a);ring(pos,8f*k,Cyan,2.5f*k);drawCircle(Color.White,4f*k,pos)
                    tag("BEAT TIP",13.sp.toPx(),Background,Cyan,null,listOf(beside(pos,0f,-1f,10f*k),beside(pos,1f,0f,10f*k),beside(pos,-1f,0f,10f*k)))
                }}
            }
            // Correction cues: amber ring = the tip to move, arrow = which way, white bullseye = where it belongs.
            // Nothing is drawn (and no text refers to cues) when they are off or tracking is not confirmed.
            val cues=if(ui.config.showFeedback)feedback?.tips.orEmpty() else emptyList()
            if(cues.isEmpty())cueSectors.fill(-1)
            val tipLabels=mutableListOf<()->Unit>();val targetLabels=mutableListOf<()->Unit>()
            cues.forEachIndexed {i,cue->
                val tip=p(cue.tip);val target=p(cue.target);val dx=target.x-tip.x;val dy=target.y-tip.y;val dist=hypot(dx,dy)
                // Inside tolerance but not yet confirmed: a plain white ring, never an amber "move" cue.
                if(!cue.onTarget && cue.error<=ui.config.tolerance){ring(tip,15f*k,Color.White,3f*k);if(i<cueSectors.size)cueSectors[i]=-1;return@forEachIndexed}
                if(cue.onTarget){
                    ring(tip,15f*k,Color.White,3f*k)
                    val badge=Offset(tip.x+12f*k,tip.y-12f*k)
                    drawCircle(Color(0xff0b0f0b),7.5f*k,badge);drawCircle(Color.White,7.5f*k,badge,style=Stroke(1.6f*k))
                    val check=Path().apply {moveTo(badge.x-3.4f*k,badge.y+.2f*k);lineTo(badge.x-.9f*k,badge.y+2.8f*k);lineTo(badge.x+3.6f*k,badge.y-2.6f*k)}
                    drawPath(check,Color.White,style=Stroke(2.3f*k,cap=StrokeCap.Round,join=StrokeJoin.Round))
                    if(i<cueSectors.size)cueSectors[i]=-1
                    return@forEachIndexed
                }
                val tipR=14f*k;val targetR=17f*k;val ux=if(dist>0f)dx/dist else 0f;val uy=if(dist>0f)dy/dist else -1f
                ring(target,targetR,Color.White,3.2f*k);drawCircle(outline,5f*k,target);drawCircle(Color.White,3f*k,target)
                if(dist>tipR+targetR+8f*k){
                    val start=Offset(tip.x+ux*(tipR+2f*k),tip.y+uy*(tipR+2f*k));val end=Offset(target.x-ux*(targetR+3f*k),target.y-uy*(targetR+3f*k))
                    val head=min(15f*k,hypot(end.x-start.x,end.y-start.y)*.65f);val shaftEnd=Offset(end.x-ux*head*.7f,end.y-uy*head*.7f)
                    drawLine(outline,start,shaftEnd,9.5f*k,cap=StrokeCap.Round);drawLine(Amber,start,shaftEnd,5f*k,cap=StrokeCap.Round)
                    val arrowHead=Path().apply {moveTo(end.x,end.y);lineTo(end.x-ux*head-uy*head*.62f,end.y-uy*head+ux*head*.62f);lineTo(end.x-ux*head+uy*head*.62f,end.y-uy*head-ux*head*.62f);close()}
                    drawPath(arrowHead,outline,style=Stroke(3.5f*k,join=StrokeJoin.Round));drawPath(arrowHead,Amber)
                }
                ring(tip,tipR,Amber,3.6f*k)
                placed.add(Rect(tip.x-tipR-2f*k,tip.y-tipR-2f*k,tip.x+tipR+2f*k,tip.y+tipR+2f*k))
                placed.add(Rect(target.x-targetR-2f*k,target.y-targetR-2f*k,target.x+targetR+2f*k,target.y+targetR+2f*k))
                val (sector,words)=direction(dx.toDouble(),dy.toDouble(),if(i<cueSectors.size)cueSectors[i] else -1)
                if(i<cueSectors.size)cueSectors[i]=sector
                tipLabels.add {tag("TIP $words",15.sp.toPx(),Color(0xf20b0f0b),Color(0xffffd29e),Amber,listOf(beside(tip,-ux,-uy,tipR),beside(tip,-uy,ux,tipR),beside(tip,uy,-ux,tipR)))}
                targetLabels.add {tag("TARGET",12.sp.toPx(),Color(0xf20b0f0b),Color.White,Color.White,listOf(beside(target,ux,uy,targetR),beside(target,-uy,ux,targetR),beside(target,uy,-ux,targetR)))}
            }
            // Instructions first, then TARGET names, so crowded scenes keep the most useful words.
            tipLabels.forEach {it()};targetLabels.forEach {it()}
            picks.forEach {ring(Offset((it.x*size.width).toFloat(),(it.y*size.height).toFloat()),9f*k,Color.White,2.5f*k)}
        }
        if(ui.demo)Text("SYNTHETIC DEMO",Modifier.align(Alignment.TopStart).padding(12.dp).background(Background).padding(6.dp),color=Lavender,fontSize=12.sp)
        if(calibrating)Text("Tap "+listOf("top left","top right","bottom right","bottom left")[picks.size],Modifier.align(Alignment.TopCenter).background(Background).padding(8.dp),color=Lime,fontSize=16.sp)
        if(identifying)Text("Tap ${if(picks.size<2)"staff A" else "staff B"}, end ${picks.size%2+1}",Modifier.align(Alignment.TopCenter).background(Background).padding(8.dp),color=Lime,fontSize=16.sp)
        // A steady countdown over the live preview: only the numeral changes, once per second.
        val snapshotStatus=ui.frame?.background
        val saved=backgroundState=="ready" && SystemClock.uptimeMillis()-savedAt<2200
        if(snapshotStatus!=null && (backgroundState=="countdown" || backgroundState=="capturing" || saved))
            Surface(color=Color(0xee080b0a),shape=RoundedCornerShape(14.dp),border=BorderStroke(2.dp,Slate),modifier=Modifier.align(Alignment.Center).padding(16.dp)){
                Column(Modifier.padding(horizontal=18.dp,vertical=12.dp),horizontalAlignment=Alignment.CenterHorizontally){
                    Text(when(backgroundState){"countdown"->"MOVE STAVES OUT OF VIEW";"capturing"->"CAPTURING BACKGROUND";else->"BACKGROUND SAVED"},fontSize=20.sp,fontWeight=FontWeight.Bold,color=Ink,textAlign=TextAlign.Center)
                    Text(when(backgroundState){"countdown"->"${max(1L,(snapshotStatus.remainingMs+999)/1000)}";"capturing"->"…";else->"✓"},fontSize=52.sp,lineHeight=56.sp,fontWeight=FontWeight.Bold,color=Slate)
                    Text(if(backgroundState=="ready")"Bring your staves back into view." else "Keep the phone still. The video stays live.",fontSize=15.sp,color=Ink,textAlign=TextAlign.Center)
                }
            }
    }
    }
    if(ui.config.streakEffects&&!identifying&&!calibrating&&backgroundState!="countdown"&&backgroundState!="capturing")ui.frame?.streak?.let {flow->
        // The state label holds like the status boxes; the counter ticks live within the shown state.
        val streakText=remember {StableText<String>()}
        val shownState=streakText.update(SystemClock.uptimeMillis(),flow.state){a,b->a=="building" && b!="building" || (a=="held" || a=="recovering") && (b=="paused" || b=="ready") || b=="off" || b=="free"}
        Surface(color=Color(0xee0b140f),shape=RoundedCornerShape(10.dp),modifier=Modifier.fillMaxWidth().padding(top=6.dp)){
            Column(Modifier.padding(10.dp)){
                Text(if(shownState==flow.state)flow.label else StreakFrame(state=shownState).label,color=if(shownState=="paused"||shownState=="held"||shownState=="recovering")Slate else Color(0xfffff1bf),fontSize=14.sp,fontWeight=FontWeight.Bold)
                LinearProgressIndicator(progress={flow.progress.toFloat()},modifier=Modifier.fillMaxWidth().padding(vertical=5.dp).height(4.dp),color=Color(0xffffe28d),trackColor=Color(0xff28332a))
                if(!focus)Text(if(flow.state=="free")"Choose a guide to earn a streak."else"Best %.1fs · full power at 30s".format(flow.bestSeconds),color=Muted,fontSize=12.sp)
            }
        }
    }
    if(focus)return
    Spacer(Modifier.height(8.dp))
    StatusBoxes(feedback)
    BeatFeedback(ui)
    Text(detectionSummary(ui.config,backgroundState),color=Ink,fontSize=14.sp,modifier=Modifier.padding(top=8.dp))
    var showLegend by remember {mutableStateOf(false)}
    TextButton(onClick={showLegend=!showLegend}){Text(if(showLegend)"Hide line & ring explanations" else "What do the lines and rings mean?")}
    if(showLegend)Column(Modifier.padding(top=8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
        LegendRow(Lime,"Lime line = staff A, purple = staff B. Each line joins that staff's two tracked ends; the colors only tell the staves apart.")
        LegendRow(Lime.copy(alpha=.5f),"Faint curve = where each tip traveled in the last 4 seconds. Gaps mean the tip was hidden or unclear.")
        LegendRow(Amber,"Amber ring + arrow: move that tip to the white bullseye labeled TARGET.")
        LegendRow(Color.White,"White ring with ✓ = that tip is within tolerance.")
        LegendRow(Lavender,"Dashed staff = motion blur. Scores pause until it is sharp.")
        if(ui.config.tempoEnabled)LegendRow(Cyan,"Blue numbered rings = beat points. The white dot marks the timing tip.")
    }
    Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){
        TextButton(onClick={identifying=!identifying;calibrating=false;picks=emptyList()},enabled=ui.frame!=null){Text(if(identifying)"Cancel" else "Identify staves")}
        TextButton(onClick={engine.resetTracking();trails.clear()}){Text("Reacquire")}
    }
    Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){
        TextButton(onClick={calibrating=!calibrating;identifying=false;picks=emptyList()},enabled=ui.frame!=null){Text(if(calibrating)"Cancel calibration" else "Calibrate angle")}
        if(ui.config.planeCorners.isNotEmpty())TextButton(onClick={engine.updateConfig(JSONObject().put("planeCorners",JSONArray()))}){Text("Clear angle")}
    }
    if(calibrating){
        Text("Mark a rectangle in your movement plane, clockwise from top left. Use a square for 1:1. Keep the phone fixed.",color=Muted,fontSize=14.sp,lineHeight=19.sp)
        OutlinedTextField(value=planeAspect,onValueChange={planeAspect=it},label={Text("Rectangle width ÷ height (0.25–4)")},singleLine=true,modifier=Modifier.fillMaxWidth())
    } else if(ui.config.planeCorners.isNotEmpty()){
        Text("Angle corrected in the calibrated plane. Recalibrate after moving the phone. Zoom, camera, or orientation changes clear calibration.",color=Lime,fontSize=14.sp,lineHeight=19.sp)
    }
}
@Composable private fun LegendRow(color:Color,text:String) {
    Row(verticalAlignment=Alignment.Top){
        Box(Modifier.padding(top=8.dp).size(18.dp,4.dp).background(color,RoundedCornerShape(2.dp)))
        Spacer(Modifier.width(8.dp))
        Text(text,color=Ink,fontSize=14.sp,lineHeight=19.sp)
    }
}
@Composable private fun Metric(label:String,value:Double?,suffix:String,modifier:Modifier,target:Double?=null) {
    Surface(shape=RoundedCornerShape(12.dp),modifier=modifier){Column(Modifier.padding(10.dp)){
        Text(label,color=Muted,fontSize=12.sp)
        Text(value?.let {"%.1f%s".format(it,suffix)} ?: "—",fontSize=24.sp,color=if(value==null)Muted else if(target!=null && value>target)Color(0xffedc293) else Lime)
        Text("5-s avg",color=Muted,fontSize=11.sp)
    }}
}
@Composable private fun SharePanel(ui:FlowUi,toggle:()->Unit) {
    Surface(shape=RoundedCornerShape(16.dp),modifier=Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp)){
        Row(verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text("A bigger practice space",fontWeight=FontWeight.Medium);Text("Connect your PC by USB or Wi-Fi / LAN",color=Muted,fontSize=14.sp)};Switch(ui.sharing,onCheckedChange={toggle()})}
        if(ui.sharing){
            Text(ui.addresses.joinToString("\n").ifBlank {"No LAN address found. Connect to Wi-Fi."},color=Lime,fontSize=16.sp)
            Text("Open localhost:8788 on the PC. Choose USB cable, or enter this Wi-Fi address. No pairing code. Anyone on your LAN can connect while sharing is on. Sharing pauses when you leave and resumes when you reopen.",color=Muted,fontSize=14.sp,lineHeight=19.sp)
        }
    }}
}
@Composable private fun Label(text:String){Text(text,color=Lime,fontSize=13.sp,letterSpacing=2.sp,modifier=Modifier.padding(top=24.dp,bottom=8.dp))}
@Composable private fun Toggle(label:String,value:Boolean,changed:(Boolean)->Unit){Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(label,Modifier.weight(1f),fontSize=16.sp);Switch(value,changed)}}
@Composable private fun ControlSlider(label:String,value:Float,range:ClosedFloatingPointRange<Float>,unit:String="",steps:Int=0,valueLabel:((Float)->String)?=null,changed:(Float)->Unit) {
    var draft by remember(value){mutableFloatStateOf(value)}
    Row(Modifier.fillMaxWidth().padding(top=12.dp)){Text(label,Modifier.weight(1f),fontSize=15.sp);Text(valueLabel?.invoke(draft)?:"${draft.toInt()}$unit",color=Lime,fontSize=15.sp)}
    Slider(value=draft,onValueChange={draft=it},onValueChangeFinished={changed(draft)},valueRange=range,steps=steps)
}
